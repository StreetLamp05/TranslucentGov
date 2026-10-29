import { eq } from "drizzle-orm";
import { db } from "../db";
import { reports, type Report } from "../db/schema";
import { enqueue } from "../jobs";
import { blobToImage, GeminiError } from "../lib/gemini";
import { ROUTING } from "../lib/routing";
import { SCREENING_FAILED_REASON, screeningErrorSummary } from "../lib/screening";
import { screenPost, type Verdict } from "../lib/screenPrompt";
import { transcribe } from "../lib/transcribe";
import { readObject, statObject } from "../storage";

// Screens a pending report with Gemini (§4.2.1) and flips it to open or held.
// Enqueued as `screenReport { reportId }` by posting,
// a retake and Try again. pg-boss doesn't retry (server/jobs.ts), so the one retry is a new job.

export const SCREEN_REPORT = "screenReport";
export type ScreenReportPayload = { reportId: string; attempt?: number };

// Wait before the retry when Gemini sent no retry delay.
export const RETRY_DELAY_MS = 1000;
const GEOCODE_TIMEOUT_MS = 5000;

type Media = { clipStorageId: string | null; frameStorageIds: string[] };

// §4.2.1: each verdict maps to exactly one status.
const STATUS_FOR: Record<Verdict, "open" | "held"> = {
  pass: "open",
  mute: "open",
  retake: "held",
  reject: "held",
  emergency: "held",
};

async function loadBlob(key: string, contentType?: string): Promise<Blob> {
  let bytes: Uint8Array;
  try {
    bytes = await readObject(key);
  } catch (error) {
    throw new Error(`Screening: file ${key} is missing from storage`, { cause: error });
  }
  return new Blob([bytes as BlobPart], contentType ? { type: contentType } : undefined);
}

// The street name for the card (§1.1.2), e.g. "Floyd Rd". Never a house number: the street
// is public, and a number can point at someone's home. Any failure means no street, not a
// retry, because the card works without one.
export async function reverseGeocode(lat: number, lng: number): Promise<string | undefined> {
  const key = process.env.GOOGLE_GEOCODING_KEY;
  if (!key) {
    console.warn("Screening: GOOGLE_GEOCODING_KEY is not set, so the report has no street");
    return undefined;
  }
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("result_type", "street_address|route");
    url.searchParams.set("key", key);
    const response = await fetch(url, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as {
      status?: string;
      results?: { address_components?: { short_name?: string; types?: string[] }[] }[];
    };
    if (body.status !== "OK") {
      if (body.status !== "ZERO_RESULTS") throw new Error(`status ${body.status}`);
      return undefined;
    }
    for (const result of body.results ?? []) {
      const route = result.address_components?.find((c) => c.types?.includes("route"));
      if (route?.short_name) return route.short_name;
    }
    return undefined;
  } catch (error) {
    console.warn(`Screening: reverse geocoding ${lat},${lng} failed, so the report has no street:`, error);
    return undefined;
  }
}

// A retake replaces the files on the same report (§4.2.1), so a result for the old files must
// not land on the new ones.
function sameMedia(report: Report, media: Media): boolean {
  return (
    report.clipStorageId === media.clipStorageId &&
    report.frameStorageIds.length === media.frameStorageIds.length &&
    report.frameStorageIds.every((key, i) => key === media.frameStorageIds[i])
  );
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The report, locked, while a result for `media` still belongs on it. When the load itself
// failed there's no media to compare, so only the status is checked.
async function stillScreening(tx: Tx, reportId: string, media: Media | undefined): Promise<Report | null> {
  const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).for("update");
  if (!report || report.status !== "pending") return null;
  if (media && !sameMedia(report, media)) return null;
  return report;
}

async function applyVerdict(
  reportId: string,
  media: Media,
  result: {
    verdict: Verdict;
    reason: string;
    category: NonNullable<Report["category"]>;
    title: string;
    street?: string;
    transcript?: string;
    segments?: Report["segments"];
  },
): Promise<void> {
  const { verdict, reason, category, title, street, transcript, segments } = result;
  await db.transaction(async (tx) => {
    const report = await stillScreening(tx, reportId, media);
    if (!report) return;
    const status = STATUS_FOR[verdict];
    await tx
      .update(reports)
      .set({
        reason,
        title,
        // A missing street keeps the stored one.
        ...(street === undefined ? {} : { street }),
        // Always written: a photo retake of a narrated video must not keep the old transcript.
        transcript: transcript ?? null,
        segments: segments ?? null,
        category,
        ...ROUTING[category], // owner and agency (§2.1.2)
        verdict,
        status,
        audioMuted: verdict === "mute",
        // Going public moves a report to the top of the feed (§5.1.2). Samples keep the
        // backdated order US25 seeds them with (§6.1.1).
        ...(status === "open" && !report.isSample ? { lastActivityAt: Date.now() } : {}),
      })
      .where(eq(reports.id, reportId));
  });
}

// After the retry also fails (§4.2.1).
async function markFailed(reportId: string, media: Media | undefined, error: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await stillScreening(tx, reportId, media))) return;
    // Clear what an earlier screening of other media left, so `release` can't publish media
    // nobody screened.
    await tx
      .update(reports)
      .set({
        status: "held",
        reason: SCREENING_FAILED_REASON,
        screeningError: screeningErrorSummary(error),
        verdict: null,
        category: null,
        owner: null,
        agency: null,
        title: null,
        audioMuted: false,
      })
      .where(eq(reports.id, reportId));
  });
}

// Transcribe (videos), screen with Gemini, then apply the verdict (§4.2.1).
export async function screenReport({ reportId, attempt = 0 }: ScreenReportPayload): Promise<void> {
  let media: Media | undefined;
  // The load sits inside the try too, so a transient failure there still ends in a retry or
  // `held` instead of leaving the poster on "Checking…".
  try {
    const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
    if (!report || report.status !== "pending") return;
    media = { clipStorageId: report.clipStorageId, frameStorageIds: report.frameStorageIds };
    const { clipStorageId, frameStorageIds } = media;

    const [street, transcription, images] = await Promise.all([
      report.street ?? reverseGeocode(report.lat, report.lng),
      // Photo posts have no audio (§1.1.4).
      report.mediaType === "video" && clipStorageId
        ? statObject(clipStorageId).then(async (stat) => {
            const blob = await loadBlob(clipStorageId, stat?.contentType);
            return transcribe(blob, stat?.contentType ?? "");
          })
        : undefined,
      Promise.all(
        frameStorageIds.map(async (key) => {
          // The stored type, so a PNG or WebP frame isn't sent labelled as JPEG.
          const stat = await statObject(key);
          return blobToImage(await loadBlob(key, stat?.contentType));
        }),
      ),
    ]);
    const result = await screenPost({
      images,
      transcript: transcription?.text,
      description: report.description ?? undefined,
      street,
    });
    await applyVerdict(reportId, media, {
      ...result,
      street,
      transcript: transcription?.text,
      segments: transcription?.segments,
    });
  } catch (error) {
    console.error(`screenReport: attempt ${attempt} on ${reportId} failed:`, error);
    const message = error instanceof Error ? error.message : String(error);
    // One retry for every error, refusals and rate limits included, after Gemini's delay
    // (§4.2.1). A second failure holds the report.
    if (attempt < 1) {
      const delayMs = (error instanceof GeminiError ? error.retryAfterMs : undefined) ?? RETRY_DELAY_MS;
      await enqueue(SCREEN_REPORT, { reportId, attempt: attempt + 1 }, { delaySeconds: Math.ceil(delayMs / 1000) });
    } else {
      await markFailed(reportId, media, message);
    }
  }
}

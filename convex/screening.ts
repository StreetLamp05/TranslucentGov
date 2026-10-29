"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { blobToImage, GeminiError } from "./lib/gemini";
import { screenPost } from "./lib/screenPrompt";
import { transcribe } from "./lib/transcribe";

// Wait before the retry when neither Gemini nor Groq sent a retry delay.
export const RETRY_DELAY_MS = 1000;
const GEOCODE_TIMEOUT_MS = 5000;

async function loadBlob(ctx: ActionCtx, id: Id<"_storage">): Promise<Blob> {
  const blob = await ctx.storage.get(id);
  if (!blob) throw new Error(`Screening: file ${id} is missing from storage`);
  return blob;
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

// Gemini's errors carry `retryAfterMs`. Groq's (US11) only say "Retry after N seconds." in
// the message.
function retryDelayMs(error: unknown): number {
  if (error instanceof GeminiError) return error.retryAfterMs ?? RETRY_DELAY_MS;
  const seconds = error instanceof Error ? /Retry after ([\d.]+) seconds/.exec(error.message)?.[1] : undefined;
  return seconds ? Number(seconds) * 1000 : RETRY_DELAY_MS;
}

// Signature from US5; mutations live in screeningDb.ts, because a "use node" file can only
// contain actions. Transcribe (videos), screen with Gemini, then apply the verdict (§4.2.1).
export const screenReport = internalAction({
  // `attempt` counts tries: omitted or 0 is the first, and a retry reschedules with attempt + 1 (§4.2.1).
  args: { reportId: v.id("reports"), attempt: v.optional(v.number()) },
  handler: async (ctx, { reportId, attempt = 0 }) => {
    let media: { clipStorageId?: Id<"_storage">; frameStorageIds: Id<"_storage">[] } | undefined;
    // The load sits inside the try too, so a transient failure there still ends in a retry or
    // `held` instead of leaving the poster on "Checking…".
    try {
      const report = await ctx.runQuery(internal.screeningDb.loadForScreening, { reportId });
      if (!report) return;
      media = report.media;
      const { clipStorageId, frameStorageIds } = report.media;

      const [street, transcription, images] = await Promise.all([
        report.street ?? reverseGeocode(report.lat, report.lng),
        // Photo posts have no audio (§1.1.4).
        report.mediaType === "video" && clipStorageId
          ? loadBlob(ctx, clipStorageId).then((blob) => transcribe(blob, report.clipContentType || blob.type))
          : undefined,
        Promise.all(frameStorageIds.map(async (id) => blobToImage(await loadBlob(ctx, id)))),
      ]);
      const result = await screenPost({
        images,
        transcript: transcription?.text,
        description: report.description,
        street,
      });
      await ctx.runMutation(internal.screeningDb.applyVerdict, {
        reportId,
        media,
        ...result,
        street,
        transcript: transcription?.text,
        segments: transcription?.segments,
      });
    } catch (error) {
      console.error(`screenReport: attempt ${attempt} on ${reportId} failed:`, error);
      if (attempt < 1) {
        await ctx.scheduler.runAfter(retryDelayMs(error), internal.screening.screenReport, {
          reportId,
          attempt: attempt + 1,
        });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.runMutation(internal.screeningDb.markFailed, { reportId, media, error: message });
      }
    }
  },
});

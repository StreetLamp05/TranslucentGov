import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getOrCreateResident } from "./auth";
import { db } from "./db";
import { fixAttempts, fixers, reports } from "./db/schema";
import { seedFixers } from "./fixers";
import { parseId } from "./http";
import { enqueue, type Tx } from "./jobs";
import { ATTACH_SEED_FIX, POLL_SECONDS, type AttachSeedFixPayload, type SeedFix } from "./jobs/seedFix";
import { UserError } from "./lib/errors";
import { validLocation } from "./lib/location";
import { MAX_DESCRIPTION_LENGTH } from "./lib/postLimits";
import { checkPostMedia } from "./lib/postMedia";
import { assertKeysUnused, mediaKeys, type PostMedia } from "./posts";
import { isUploadedBy, statObject } from "./storage";
import { assertNotIntake } from "./videoIntake";

// Sample reports for the demo (§6.1.1), from /admin/seed (routes: app/api/admin/). Ports
// convex/seed.ts. The page uploads each sample's files to MinIO, then seedSamples saves them as
// `isSample` reports and queues the real screenReport for each, then, for a sample with a fix
// clip, the real verifyFix (server/jobs/seedFix.ts). Admin-only: the routes check the session.

// Batches are screened 10 s apart, so they stay under the model API's tokens-per-minute limit.
export const SCREEN_STAGGER_SECONDS = 10;
export const TRANSCRIBABLE = ["video/mp4", "video/webm"];
export const NOT_TRANSCRIBABLE = "the clip must be MP4 or WebM (convert an iPhone .MOV first).";

export type SeedSample = PostMedia & {
  description?: string;
  lat: number;
  lng: number;
  // Backdating (§6.1.1). Each defaults to now; lastActivityAt defaults to createdAt.
  createdAt?: number;
  lastActivityAt?: number;
  // This device's resident token, so the demo phone's Me page shows the sample (§5.4.1).
  residentToken?: string;
  fix?: SeedFix;
};

// ---- Reads for the page ---------------------------------------------------------------------

/** For the page's "fixed by" picker. Never the passcodes or tokens. */
export async function listFixers() {
  return db.select({ id: fixers.id, name: fixers.name, org: fixers.org }).from(fixers).orderBy(fixers.name);
}

/**
 * Every sample with its screening and fix progress, newest first, so the admin can watch a batch
 * finish and spot one to rescreen or release (§4.2.1).
 */
export async function listSamples() {
  const rows = await db.select().from(reports).where(eq(reports.isSample, true)).orderBy(desc(reports.creationTime));
  const attempts = rows.length
    ? await db
        .select({ reportId: fixAttempts.reportId, status: fixAttempts.status, reason: fixAttempts.reason })
        .from(fixAttempts)
        .where(inArray(fixAttempts.reportId, rows.map((row) => row.id)))
        .orderBy(fixAttempts.creationTime)
    : [];
  // The latest attempt per report: they come oldest first.
  const latest = new Map(attempts.map((attempt) => [attempt.reportId, attempt]));
  return rows.map((report) => {
    const fix = latest.get(report.id);
    return {
      id: report.id,
      status: report.status,
      title: report.title,
      category: report.category,
      agency: report.agency,
      verdict: report.verdict,
      reason: report.reason,
      lat: report.lat,
      lng: report.lng,
      createdAt: report.createdAt,
      fixedAt: report.fixedAt,
      fix: fix ? { status: fix.status, reason: fix.reason } : null,
    };
  });
}

// ---- Fixers ---------------------------------------------------------------------------------

/** seedFixers (server/fixers.ts) for a request body: `[{ name, org, passcode }]`. */
export async function seedFixersFromBody(body: unknown) {
  if (!Array.isArray(body) || body.length === 0) throw new UserError("Add at least one fixer.");
  const list = body.map((item: unknown, i) => {
    const { name, org, passcode } = (item ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof org !== "string" || typeof passcode !== "string") {
      throw new UserError(`Fixer ${i + 1}: needs a name, org and passcode.`);
    }
    if (!name.trim() || !org.trim()) throw new UserError(`Fixer ${i + 1}: needs a name and an org.`);
    return { name, org, passcode };
  });
  return seedFixers(list);
}

// ---- Samples --------------------------------------------------------------------------------

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";
const isKeyList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const optionalTime = (value: unknown) => value === undefined || value === null || typeof value === "number";

function parseFix(value: unknown, fail: (message: string) => never): SeedFix {
  const { clipStorageId, frameStorageIds, by, fixedAt } = (value ?? {}) as Record<string, unknown>;
  if (!isString(clipStorageId)) return fail("a fix needs its clip.");
  if (!isKeyList(frameStorageIds)) return fail("a fix has invalid frames.");
  if (!optionalTime(fixedAt)) return fail("a date isn't valid.");
  const { kind, fixerId } = (by ?? {}) as Record<string, unknown>;
  if (kind === "resident") return { clipStorageId, frameStorageIds, by: { kind }, fixedAt: (fixedAt as number | null) ?? undefined };
  if (kind === "fixer" && isString(fixerId)) {
    return { clipStorageId, frameStorageIds, by: { kind, fixerId }, fixedAt: (fixedAt as number | null) ?? undefined };
  }
  return fail("choose who filmed the fix.");
}

function parseSample(value: unknown, fail: (message: string) => never): SeedSample {
  const s = (value ?? {}) as Record<string, unknown>;
  if (s.mediaType !== "video" && s.mediaType !== "photos") return fail("unknown sample type.");
  if (s.clipStorageId != null && typeof s.clipStorageId !== "string") return fail("invalid clip.");
  if (!isKeyList(s.frameStorageIds)) return fail("invalid frames.");
  if (s.description != null && typeof s.description !== "string") return fail("invalid description.");
  if (typeof s.lat !== "number" || typeof s.lng !== "number") return fail("that location isn't valid.");
  if (!optionalTime(s.createdAt) || !optionalTime(s.lastActivityAt)) return fail("a date isn't valid.");
  if (s.residentToken != null && typeof s.residentToken !== "string") return fail("invalid resident token.");
  return {
    mediaType: s.mediaType,
    clipStorageId: (s.clipStorageId as string | null | undefined) ?? undefined,
    frameStorageIds: s.frameStorageIds,
    description: (s.description as string | null | undefined) ?? undefined,
    lat: s.lat,
    lng: s.lng,
    createdAt: (s.createdAt as number | null | undefined) ?? undefined,
    lastActivityAt: (s.lastActivityAt as number | null | undefined) ?? undefined,
    residentToken: (s.residentToken as string | null | undefined) ?? undefined,
    fix: s.fix == null ? undefined : parseFix(s.fix, fail),
  };
}

// Throws a UserError "Sample N: …" for the first thing wrong with the sample.
async function check(sample: SeedSample, now: number, label: string): Promise<void> {
  const fail = (message: string): never => {
    throw new UserError(`${label}: ${message}`);
  };
  // The files' own checks (existence, kind, size, frame counts) throw without the label.
  const labelled = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      if (error instanceof UserError) fail(error.message[0].toLowerCase() + error.message.slice(1));
      throw error;
    }
  };

  const { lat, lng } = sample;
  if (!validLocation(lat, lng)) fail("that location isn't valid.");
  if (sample.description && sample.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    fail(`the description can be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }

  const createdAt = sample.createdAt ?? now;
  const lastActivityAt = sample.lastActivityAt ?? createdAt;
  const fixedAt = sample.fix?.fixedAt;
  // Whole milliseconds: the columns are bigint, and anything else would fail in the database.
  const dates = [createdAt, lastActivityAt, fixedAt ?? now];
  if (dates.some((t) => !Number.isSafeInteger(t))) fail("a date isn't valid.");
  if (dates.some((t) => t > now)) fail("a date is in the future.");
  if (lastActivityAt < createdAt) fail("last activity is before it was posted.");
  if (fixedAt !== undefined && fixedAt < createdAt) fail("it was fixed before it was posted.");

  for (const key of mediaKeys(sample)) {
    if (!(await isUploadedBy(key, { kind: "admin" }))) fail("an uploaded file is missing.");
  }
  await labelled(() => checkPostMedia(statObject, sample));
  if (sample.mediaType === "video") {
    // Transcription only takes these (lib/transcribe.ts), so anything else (an iPhone .MOV) would be
    // held as "screening failed" with no way to rescreen it.
    const clip = await statObject(sample.clipStorageId!);
    const type = (clip?.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!TRANSCRIBABLE.includes(type)) fail(NOT_TRANSCRIBABLE);
  }

  const fix = sample.fix;
  if (fix) {
    for (const key of mediaKeys({ mediaType: "video", ...fix })) {
      if (!(await isUploadedBy(key, { kind: "admin" }))) fail("an uploaded file is missing.");
    }
    await labelled(() => checkPostMedia(statObject, { mediaType: "video", ...fix }));
    if (fix.by.kind === "fixer") {
      const fixerId = parseId(fix.by.fixerId);
      const [fixer] = fixerId ? await db.select({ id: fixers.id }).from(fixers).where(eq(fixers.id, fixerId)) : [];
      if (!fixer) fail("that fixer doesn't exist.");
    }
  }
}

// The sample report already made from these files, so a batch sent twice (a double tap, a retry
// after a dropped response) isn't seeded twice.
async function existingSample(tx: Pick<Tx, "select">, sample: SeedSample): Promise<string | null> {
  const keys = sql`array[${sql.join(mediaKeys(sample).map((key) => sql`${key}`), sql`, `)}]::text[]`;
  const [row] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.isSample, true), sql`array_append(${reports.frameStorageIds}, ${reports.clipStorageId}) && ${keys}`))
    .limit(1);
  return row?.id ?? null;
}

const fixKeys = (fix: SeedFix | undefined) => (fix ? [fix.clipStorageId, ...fix.frameStorageIds] : []);

/**
 * Saves each sample as a pending `isSample` report and queues the real screenReport, staggered
 * SCREEN_STAGGER_SECONDS apart. A fix clip is attached once its report is open (attachSeedFix).
 * Every sample is checked first and the saves share a transaction, so a bad sample leaves
 * nothing half-seeded. Safe to run again: a sample whose files already make a sample report
 * returns that report's id and queues nothing.
 */
export async function seedSamples(body: unknown): Promise<string[]> {
  if (!Array.isArray(body)) throw new UserError("Add at least one sample.");
  const now = Date.now();
  const samples = body.map((value: unknown, i) =>
    parseSample(value, (message) => {
      throw new UserError(`Sample ${i + 1}: ${message}`);
    }),
  );

  const seen = new Set<string>();
  for (const [i, sample] of samples.entries()) {
    await check(sample, now, `Sample ${i + 1}`);
    for (const key of [...mediaKeys(sample), ...fixKeys(sample.fix)]) {
      if (seen.has(key)) throw new UserError(`Sample ${i + 1}: a file is used twice.`);
      seen.add(key);
    }
  }

  // Residents are made before the transaction opens: they use the shared connection, which the
  // transaction would hold. A sample already seeded needs none.
  const residentIds = await Promise.all(
    samples.map(async (sample) =>
      (await existingSample(db, sample)) ? null : getOrCreateResident(sample.residentToken?.trim() || crypto.randomUUID()),
    ),
  );

  const ids: string[] = [];
  let queued = 0;
  await db.transaction(async (tx) => {
    for (const [i, sample] of samples.entries()) {
      // Checked again inside, so two batches sent at once don't both insert it.
      const already = await existingSample(tx, sample);
      if (already) {
        ids.push(already);
        continue;
      }
      const residentId = residentIds[i];
      // Only if the sample it matched was deleted while this batch ran.
      if (!residentId) throw new UserError("A sample changed while seeding. Try again.");
      const keys = [...mediaKeys(sample), ...fixKeys(sample.fix)];
      await assertKeysUnused(tx, keys);
      await assertNotIntake(tx, keys);
      const createdAt = sample.createdAt ?? now;
      const lastActivityAt = sample.lastActivityAt ?? createdAt;
      const [report] = await tx
        .insert(reports)
        .values({
          residentId,
          mediaType: sample.mediaType,
          description: sample.description?.trim() || undefined,
          clipStorageId: sample.clipStorageId,
          frameStorageIds: sample.frameStorageIds,
          lat: sample.lat,
          lng: sample.lng,
          status: "pending",
          audioMuted: false,
          isSample: true, // from the start, so going public skips the feed bump and the purge skips it
          meTooCount: 0,
          lastActivityAt,
          revealViews: 0,
          createdAt,
        })
        .returning({ id: reports.id });
      const delaySeconds = queued++ * SCREEN_STAGGER_SECONDS;
      await enqueue("screenReport", { reportId: report.id }, { tx, delaySeconds });
      if (sample.fix) {
        const payload: AttachSeedFixPayload = { reportId: report.id, fix: sample.fix, lastActivityAt, polls: 0 };
        await enqueue(ATTACH_SEED_FIX, payload, { tx, delaySeconds: delaySeconds + POLL_SECONDS });
      }
      ids.push(report.id);
    }
  });
  return ids;
}

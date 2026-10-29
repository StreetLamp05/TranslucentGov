import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./db";
import { fixAttempts, reports } from "./db/schema";
import { enqueue, type Tx } from "./jobs";
import { UserError } from "./lib/errors";
import { validLocation } from "./lib/location";
import { MAX_DESCRIPTION_LENGTH } from "./lib/postLimits";
import { checkPostMedia } from "./lib/postMedia";
import { ownerReport, reportDoc, type OwnerReport } from "./lib/publicReport";
import { isUploadedBy, statObject } from "./storage";
import { reportMedia } from "./reportMedia";

export type PostMedia = {
  mediaType: "video" | "photos";
  clipStorageId?: string;
  frameStorageIds: string[];
};

export const FILE_IN_USE = "An uploaded file is already used by another post. Try posting again.";

/**
 * Throws unless no other report or fix attempt references any of these keys. `isUploadedBy`
 * only proves the caller uploaded a key; without this, one key on two reports lets a retake or
 * purge of either delete the other's media. Call it in the transaction that saves the keys: the
 * advisory locks make two requests racing on one key take turns, so the second sees the first.
 */
export async function assertKeysUnused(tx: Tx, keys: string[], exceptReportId?: string): Promise<void> {
  const unique = [...new Set(keys)].sort();
  if (unique.length === 0) return;
  for (const key of unique) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  const keyArray = sql`array[${sql.join(unique.map((key) => sql`${key}`), sql`, `)}]::text[]`;
  const [report] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        or(
          inArray(reports.clipStorageId, unique),
          inArray(reports.fixStorageId, unique),
          sql`${reports.frameStorageIds} && ${keyArray}`,
        ),
        exceptReportId ? sql`${reports.id} <> ${exceptReportId}` : undefined,
      ),
    )
    .limit(1);
  if (report) throw new UserError(FILE_IN_USE);
  const [attempt] = await tx
    .select({ id: fixAttempts.id })
    .from(fixAttempts)
    .where(or(inArray(fixAttempts.clipStorageId, unique), sql`${fixAttempts.frameStorageIds} && ${keyArray}`))
    .limit(1);
  if (attempt) throw new UserError(FILE_IN_USE);
}

/** Every object key a post's media names. */
export const mediaKeys = (media: PostMedia): string[] =>
  [media.clipStorageId, ...media.frameStorageIds].filter((key): key is string => typeof key === "string");

export const FILE_NOT_YOURS = "An uploaded file is missing. Try posting again.";

/**
 * The checks a new post and a retake share (§4.1.1): the files exist, are the right kind and
 * size, and were uploaded by this resident (a key alone proves nothing, since public URLs carry
 * keys). Throws a UserError otherwise.
 */
export async function checkResidentMedia(residentId: string, media: PostMedia): Promise<void> {
  for (const key of mediaKeys(media)) {
    if (!(await isUploadedBy(key, { kind: "resident", id: residentId }))) throw new UserError(FILE_NOT_YOURS);
  }
  await checkPostMedia(statObject, media);
}

/** Reads the media fields of a request body, refusing a body of the wrong shape. */
export function mediaFrom(body: Record<string, unknown>): PostMedia {
  const { mediaType, clipStorageId, frameStorageIds } = body;
  if (mediaType !== "video" && mediaType !== "photos") throw new UserError("Unknown post type.");
  if (clipStorageId != null && typeof clipStorageId !== "string") throw new UserError("Invalid clip.");
  if (!Array.isArray(frameStorageIds) || !frameStorageIds.every((key) => typeof key === "string")) {
    throw new UserError("Invalid frames.");
  }
  return { mediaType, clipStorageId: clipStorageId ?? undefined, frameStorageIds: frameStorageIds as string[] };
}

// A resident's post (§4.1.1): files are uploaded first (server/files.ts), then this saves the
// report as `pending` and queues screening (§2.1.3). Video and photo posts both come through here.
export async function createReport(
  residentId: string,
  input: PostMedia & { description?: unknown; lat: unknown; lng: unknown },
): Promise<string> {
  if (input.description != null && typeof input.description !== "string") {
    throw new UserError("Invalid description.");
  }
  const description = input.description?.trim() || undefined;
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new UserError(`The description can be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (!validLocation(input.lat, input.lng)) throw new UserError("That location isn't valid.");

  await checkResidentMedia(residentId, input);

  const now = Date.now();
  // The job is queued in the transaction, so screening never runs for a report that didn't save.
  return db.transaction(async (tx) => {
    await assertKeysUnused(tx, mediaKeys(input));
    const [report] = await tx
      .insert(reports)
      .values({
        residentId,
        mediaType: input.mediaType,
        description,
        clipStorageId: input.clipStorageId,
        frameStorageIds: input.frameStorageIds,
        lat: input.lat as number,
        lng: input.lng as number,
        status: "pending",
        audioMuted: false,
        isSample: false,
        meTooCount: 0,
        lastActivityAt: now,
        revealViews: 0,
        createdAt: now,
      })
      .returning({ id: reports.id });
    await enqueue("screenReport", { reportId: report.id }, { tx });
    return report.id;
  });
}

// The poster's own report, for the Checking… screen (§4.2.1): null unless the resident posted
// it (§7.1.1), so another device can't read a held clip or its reason.
export async function myReport(residentId: string | null, reportId: string | null): Promise<OwnerReport | null> {
  if (!residentId || !reportId) return null;
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.residentId, residentId)));
  return row ? ownerReport(reportMedia, reportDoc(row), residentId) : null;
}

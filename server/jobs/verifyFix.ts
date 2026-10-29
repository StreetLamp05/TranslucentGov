import { eq } from "drizzle-orm";
import { db } from "../db";
import { fixAttempts, fixers, reports, type FixAttempt, type Report } from "../db/schema";
import { enqueue } from "../jobs";
import { checkFix, type FixVerdict } from "../lib/fixPrompt";
import { blobToImage, GeminiError } from "../lib/gemini";
import { readObject, statObject } from "../storage";

// The proof-of-fix check (§4.3.1): the original's images go in as BEFORE, the fix clip's frames
// as AFTER, and Gemini's verdict closes the report or goes back to the person filming.
// Enqueued as `verifyFix { fixAttemptId }`.

export const VERIFY_FIX = "verifyFix";
export type VerifyFixPayload = { fixAttemptId: string; attempt?: number };

// Wait before the retry when Gemini didn't send a retry delay.
export const RETRY_DELAY_MS = 1000;
export const FAILED_REASON = "We couldn't check this clip. Try recording it again.";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// One fix per report (§4.3.1): an attempt is only worth checking while it's `checking` and its
// report is still `open`. Otherwise another fix got there first, or the report is gone, so the
// attempt is marked `superseded`. Returns the locked pair when the check should go ahead.
async function claim(tx: Tx, fixAttemptId: string): Promise<{ attempt: FixAttempt; report: Report } | null> {
  const [attempt] = await tx.select().from(fixAttempts).where(eq(fixAttempts.id, fixAttemptId)).for("update");
  if (!attempt || attempt.status !== "checking") return null;
  const [report] = await tx.select().from(reports).where(eq(reports.id, attempt.reportId)).for("update");
  if (!report || report.status !== "open") {
    await tx.update(fixAttempts).set({ status: "superseded" }).where(eq(fixAttempts.id, fixAttemptId));
    return null;
  }
  return { attempt, report };
}

async function beginCheck(fixAttemptId: string) {
  return db.transaction(async (tx) => {
    const claimed = await claim(tx, fixAttemptId);
    if (!claimed) return null;
    const { attempt, report } = claimed;
    return {
      beforeKind: report.mediaType,
      beforeKeys: report.frameStorageIds,
      afterKeys: attempt.frameStorageIds,
      category: report.category ?? undefined,
      title: report.title ?? undefined,
    };
  });
}

// Re-runs the guard, since another attempt may have closed the report while Gemini was checking.
async function applyFixVerdict(fixAttemptId: string, verdict: FixVerdict, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await claim(tx, fixAttemptId);
    if (!claimed) return;
    const { attempt, report } = claimed;

    if (verdict === "verified") {
      const now = Date.now();
      // The card names the fixer's org (§3.1.2, §4.3.2). Neighbors have none.
      const [fixer] =
        attempt.byKind === "fixer" ? await tx.select({ org: fixers.org }).from(fixers).where(eq(fixers.id, attempt.byId)) : [];
      await tx
        .update(reports)
        .set({
          status: "fixed",
          fixStorageId: attempt.clipStorageId,
          fixedAt: now,
          fixedBy: attempt.byId,
          fixedByKind: attempt.byKind,
          fixedByOrg: fixer?.org ?? null,
          lastActivityAt: now,
        })
        .where(eq(reports.id, report.id));
    }
    await tx.update(fixAttempts).set({ status: verdict, reason }).where(eq(fixAttempts.id, fixAttemptId));
  });
}

// Same guard: if another fix closed the report meanwhile, this attempt is superseded, not
// failed, so the person isn't told to record again for a report that's already fixed.
async function markFailed(fixAttemptId: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await claim(tx, fixAttemptId))) return;
    await tx.update(fixAttempts).set({ status: "failed", reason: FAILED_REASON }).where(eq(fixAttempts.id, fixAttemptId));
  });
}

async function loadImages(keys: string[]) {
  return Promise.all(
    keys.map(async (key) => {
      let bytes: Uint8Array;
      try {
        bytes = await readObject(key);
      } catch (error) {
        throw new Error(`Fix check: file ${key} is missing from storage`, { cause: error });
      }
      // The stored type, so a PNG or WebP frame isn't sent labelled as JPEG.
      const stat = await statObject(key);
      return blobToImage(new Blob([bytes as BlobPart], stat?.contentType ? { type: stat.contentType } : undefined));
    }),
  );
}

export async function verifyFix({ fixAttemptId, attempt = 0 }: VerifyFixPayload): Promise<void> {
  // beginCheck sits inside the try too, so a transient failure there still ends in a retry
  // or `failed` instead of leaving the attempt on "Checking…".
  try {
    const check = await beginCheck(fixAttemptId);
    if (!check) return;

    const [before, after] = await Promise.all([loadImages(check.beforeKeys), loadImages(check.afterKeys)]);
    const { verdict, reason } = await checkFix({
      before,
      beforeKind: check.beforeKind,
      after,
      category: check.category,
      title: check.title,
    });
    await applyFixVerdict(fixAttemptId, verdict, reason);
  } catch (error) {
    console.error(`verifyFix: attempt ${attempt} on ${fixAttemptId} failed:`, error);
    if (attempt < 1) {
      const delayMs = (error instanceof GeminiError ? error.retryAfterMs : undefined) ?? RETRY_DELAY_MS;
      await enqueue(VERIFY_FIX, { fixAttemptId, attempt: attempt + 1 }, { delaySeconds: Math.ceil(delayMs / 1000) });
    } else {
      await markFailed(fixAttemptId);
    }
  }
}

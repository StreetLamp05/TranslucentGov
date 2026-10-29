import { eq } from "drizzle-orm";
import { getOrCreateResident } from "../auth";
import { db } from "../db";
import { fixAttempts, fixers, reports, type Report } from "../db/schema";
import { enqueue } from "../jobs";
import { CITY_ONLY, neighborCanConfirm } from "../lib/fixRules";
import { VERIFY_FIX } from "./verifyFix";

// The seed's fix clips (§6.1.1). Ports convex/seed.ts `attachFix` and `backdateFix`, which
// rescheduled themselves; here each polls by queueing itself again, POLL_SECONDS later. The
// names and types live here, not in server/seed.ts, so the worker doesn't load route code.

export const ATTACH_SEED_FIX = "attachSeedFix";
export const BACKDATE_SEED_FIX = "backdateSeedFix";
// A seed fix waits for its report's screening, checking this often for up to 10 minutes.
export const POLL_SECONDS = 10;
export const MAX_POLLS = 60;

export type SeedFix = {
  clipStorageId: string;
  frameStorageIds: string[];
  by: { kind: "fixer"; fixerId: string } | { kind: "resident" };
  fixedAt?: number;
};

export type AttachSeedFixPayload = { reportId: string; fix: SeedFix; lastActivityAt: number; polls: number };
export type BackdateSeedFixPayload = { attemptId: string; fixedAt: number; lastActivityAt: number; polls: number };

/**
 * Waits for the report's screening, then files the fix clip as an attempt and queues the real
 * verifyFix (§4.3.1). An attempt filed while the report is pending would be superseded.
 */
export async function attachSeedFix(payload: AttachSeedFixPayload): Promise<void> {
  const { reportId, fix, lastActivityAt, polls } = payload;
  const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
  if (!report) return;
  if (report.status === "pending") {
    if (polls + 1 >= MAX_POLLS) {
      console.warn(`seed: ${reportId} is still pending after ${MAX_POLLS} checks, so its fix clip was dropped`);
      return;
    }
    await enqueue(ATTACH_SEED_FIX, { ...payload, polls: polls + 1 }, { delaySeconds: POLL_SECONDS });
    return;
  }
  if (report.status !== "open") {
    console.warn(`seed: ${reportId} is ${report.status}, so its fix clip was dropped. Release it, then seed the fix again.`);
    return;
  }

  const byId = await fixerOrNeighbor(report, fix.by);
  if (!byId) return;
  await db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(fixAttempts)
      .values({
        reportId,
        byKind: fix.by.kind,
        byId,
        clipStorageId: fix.clipStorageId,
        frameStorageIds: fix.frameStorageIds,
        // The report's own location, so the 50 m check (§4.3.1) is skipped on purpose. The real
        // verifyFix still checks the before and after.
        lat: report.lat,
        lng: report.lng,
        status: "checking",
        createdAt: Date.now(),
      })
      .returning({ id: fixAttempts.id });
    await enqueue(VERIFY_FIX, { fixAttemptId: attempt.id }, { tx });
    if (fix.fixedAt !== undefined) {
      const backdate: BackdateSeedFixPayload = { attemptId: attempt.id, fixedAt: fix.fixedAt, lastActivityAt, polls: 0 };
      await enqueue(BACKDATE_SEED_FIX, backdate, { tx, delaySeconds: POLL_SECONDS });
    }
  });
}

// A neighbor can only confirm a report the city doesn't own (§4.3.2); the seed obeys that too.
async function fixerOrNeighbor(report: Report, by: SeedFix["by"]): Promise<string | null> {
  if (by.kind === "fixer") {
    const [fixer] = await db.select({ id: fixers.id }).from(fixers).where(eq(fixers.id, by.fixerId));
    if (fixer) return fixer.id;
    console.warn(`seed: the fixer for ${report.id} no longer exists, so its fix clip was dropped`);
    return null;
  }
  if (!neighborCanConfirm({ status: report.status, owner: report.owner ?? undefined })) {
    console.warn(`seed: ${report.id}: ${CITY_ONLY} Its neighbor fix clip was dropped; seed it with a fixer.`);
    return null;
  }
  return getOrCreateResident(crypto.randomUUID());
}

/**
 * verifyFix stamps fixedAt as now; a sample may be backdated (§6.1.1). Feed order follows
 * lastActivityAt (§5.1.2), so it becomes the later of the seeded value and fixedAt.
 */
export async function backdateSeedFix(payload: BackdateSeedFixPayload): Promise<void> {
  const { attemptId, fixedAt, lastActivityAt, polls } = payload;
  const [attempt] = await db.select().from(fixAttempts).where(eq(fixAttempts.id, attemptId));
  if (!attempt) return;
  if (attempt.status === "checking") {
    if (polls + 1 >= MAX_POLLS) {
      console.warn(`seed: fix attempt ${attemptId} is still checking after ${MAX_POLLS} checks, so fixedAt wasn't backdated`);
      return;
    }
    await enqueue(BACKDATE_SEED_FIX, { ...payload, polls: polls + 1 }, { delaySeconds: POLL_SECONDS });
    return;
  }
  if (attempt.status !== "verified") return;
  const [report] = await db.select().from(reports).where(eq(reports.id, attempt.reportId));
  // Only the fix this attempt made: not one closed by another attempt.
  if (!report || report.status !== "fixed" || report.fixStorageId !== attempt.clipStorageId) return;
  await db
    .update(reports)
    .set({ fixedAt, lastActivityAt: Math.max(lastActivityAt, fixedAt) })
    .where(eq(reports.id, report.id));
}

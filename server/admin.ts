import { eq } from "drizzle-orm";
import { db } from "./db";
import { reports, videoIntakeAdminSessions } from "./db/schema";
import { parseId } from "./http";
import { enqueue } from "./jobs";
import { isAdminPasscode } from "./lib/adminPasscode";
import { ADMIN_SESSION_MS } from "./lib/auth";
import { UserError } from "./lib/errors";
import { createUploadUrl } from "./storage";

// What the admin pages (/admin/seed, /admin/video-intake) share: the login, uploads, and the
// operator tools for a report that's held or stuck (§4.2.1). The login and the tools port
// convex/videoIntakeAuth.ts and convex/screeningDb.ts `rescreen` / `release`, which were run
// from the Convex CLI. Routes are app/api/admin/; all but the login need an admin session.

export const WRONG_ADMIN_PASSCODE = "Invalid admin passcode.";

/** A session for the right passcode. It lasts ADMIN_SESSION_MS, and the purge job clears it afterwards. */
export async function adminLogin(passcode: unknown): Promise<{ token: string; expiresAt: number }> {
  if (typeof passcode !== "string" || !isAdminPasscode(passcode)) throw new UserError(WRONG_ADMIN_PASSCODE, 401);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const expiresAt = Date.now() + ADMIN_SESSION_MS;
  await db.insert(videoIntakeAdminSessions).values({ token, expiresAt });
  return { token, expiresAt };
}

/**
 * A presigned PUT URL for an admin's upload (a sample's clip or frame, or an intake video).
 * Only media, as for residents: MinIO is served from the app's origin (server/storage.ts).
 */
export async function createAdminUploadUrl(contentType: unknown): Promise<{ key: string; url: string }> {
  if (typeof contentType !== "string" || !/^(video|image)\/[\w.+-]+$/i.test(contentType)) {
    throw new UserError("Only video and image files can be uploaded.");
  }
  return createUploadUrl(contentType, { kind: "admin" });
}

const NO_SUCH_REPORT = "No such report.";

// A held verdict outranks mute (§4.2.1), so release needs `force` for these.
const HELD_VERDICTS = new Set(["retake", "reject", "emergency"]);

/**
 * Screens a held report again, or a pending one whose screening died (a job that crashes never
 * retries). An open or fixed report would drop off the feed. A duplicate run on a pending report
 * is safe: the second result finds it no longer pending.
 */
export async function rescreenReport(rawId: unknown): Promise<void> {
  const id = parseId(rawId);
  if (!id) throw new UserError(NO_SUCH_REPORT, 404);
  await db.transaction(async (tx) => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, id)).for("update");
    if (!report) throw new UserError(NO_SUCH_REPORT, 404);
    if (report.status !== "held" && report.status !== "pending") {
      throw new UserError(`Only a held or pending report can be rescreened (this one is ${report.status}).`, 409);
    }
    await tx.update(reports).set({ status: "pending", verdict: null, reason: null, screeningError: null }).where(eq(reports.id, id));
    await enqueue("screenReport", { reportId: id }, { tx });
  });
}

/** "held → open only by hand" (§4.2.1). Bumps lastActivityAt like screening does (§5.1.2), except for samples. */
export async function releaseReport(rawId: unknown, force: unknown): Promise<void> {
  const id = parseId(rawId);
  if (!id) throw new UserError(NO_SUCH_REPORT, 404);
  await db.transaction(async (tx) => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, id)).for("update");
    if (!report) throw new UserError(NO_SUCH_REPORT, 404);
    if (report.status !== "held") {
      throw new UserError(`Only a held report can be released (this one is ${report.status}).`, 409);
    }
    // A card can't render without these, e.g. after "screening failed". Rescreen it instead.
    if (!report.category || !report.title) {
      throw new UserError("This report has no category or title yet. Rescreen it instead.", 409);
    }
    // Make the operator see the verdict and confirm: its audio and text were never checked for mute.
    if (report.verdict && HELD_VERDICTS.has(report.verdict) && force !== true) {
      throw new UserError(
        `This report was held as ${report.verdict} ("${report.reason ?? ""}"), and its audio and text were never checked for mute. Release it anyway with force.`,
        409,
      );
    }
    await tx
      .update(reports)
      .set({ status: "open", ...(report.isSample ? {} : { lastActivityAt: Date.now() }) })
      .where(eq(reports.id, id));
  });
}

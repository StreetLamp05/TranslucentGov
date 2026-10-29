import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { fixers, reports, type Fixer } from "./db/schema";
import { UserError } from "./lib/errors";
import { parseId } from "./http";
import { publicReport, publicReportOrNull, reportDoc } from "./lib/publicReport";
import { reportMedia } from "./reportMedia";

// Fixer access (§3.1.2): a passcode per fixer, kept in the DB. The passcode is checked once,
// server-side, and swapped for a token the /fix screen keeps in localStorage. Ports
// convex/fixers.ts; the routes are app/api/fixers/.

// The same message for every failure, so it never hints whether a passcode exists.
export const WRONG_PASSCODE = "Wrong passcode";

/**
 * Upserts fixers by passcode, so re-running it updates names and orgs without duplicating rows
 * or logging anyone out. Seeding a fixer under a new passcode adds a second row and leaves the
 * old passcode (and its token) working: to revoke a passcode, delete its row.
 */
export async function seedFixers(
  list: readonly { name: string; org: string; passcode: string }[],
): Promise<{ inserted: number; updated: number }> {
  const seen = new Set<string>();
  for (const fixer of list) {
    const passcode = fixer.passcode.trim();
    if (!passcode) throw new UserError(`Passcode for ${fixer.name} is empty`);
    if (seen.has(passcode)) throw new UserError(`Passcode for ${fixer.name} is used twice`);
    seen.add(passcode);
  }

  return db.transaction(async (tx) => {
    let inserted = 0;
    let updated = 0;
    for (const fixer of list) {
      const passcode = fixer.passcode.trim();
      const row = { name: fixer.name.trim(), org: fixer.org.trim(), passcode };
      const [existing] = await tx.select({ id: fixers.id }).from(fixers).where(eq(fixers.passcode, passcode));
      if (existing) {
        await tx.update(fixers).set(row).where(eq(fixers.id, existing.id));
        updated++;
      } else {
        await tx.insert(fixers).values(row);
        inserted++;
      }
    }
    return { inserted, updated };
  });
}

/**
 * Reuses the fixer's token when it has one, so logging in on a second device doesn't log out
 * the first. The coalesce is atomic: two first logins at once end up with the same token.
 */
export async function fixerLogin(passcode: string): Promise<{ token: string; org: string }> {
  const clean = passcode.trim();
  if (!clean) throw new UserError(WRONG_PASSCODE, 401);
  const [fixer] = await db
    .update(fixers)
    .set({ token: sql`coalesce(${fixers.token}, ${crypto.randomUUID()})` })
    .where(eq(fixers.passcode, clean))
    .returning({ token: fixers.token, org: fixers.org });
  if (!fixer?.token) throw new UserError(WRONG_PASSCODE, 401);
  return { token: fixer.token, org: fixer.org };
}

/** What the /fix screen may know about the logged-in fixer: the org, never the row (§3.1.2). */
export function fixerSession(fixer: Fixer): { org: string } {
  return { org: fixer.org };
}

// Every open report, whoever owns it (§4.3.2), through the public projection (§7.1.1). The
// client sorts them nearest first from the phone's location (§5.3.1); Mableton's scale doesn't
// need a bounding box here (§1.1.1).
export async function openReportsForFixer() {
  const rows = await db.select().from(reports).where(eq(reports.status, "open"));
  return Promise.all(rows.map((row) => publicReport(reportMedia, reportDoc(row))));
}

// One report for the fixer's detail screen. Unlike the list, it keeps returning the report once
// it's fixed, so the screen can show the result instead of losing it. Null for an ID that isn't
// a public report (unknown, malformed, pending or held).
export async function fixerReport(rawId: string) {
  const id = parseId(rawId);
  if (!id) return null;
  const [row] = await db.select().from(reports).where(eq(reports.id, id));
  return publicReportOrNull(reportMedia, row ? reportDoc(row) : null);
}

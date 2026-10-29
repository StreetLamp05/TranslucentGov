import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { meToos, reports } from "./db/schema";
import { isUuid } from "./http";

// Enough for a feed window; caps the reads one call can make.
const MAX_REPORT_IDS = 50;

// The caller's relation to some reports, for the card's Me too button (§5.1.1): which of them
// they posted and which they already me-too'd. Only ever the caller's own ids, keyed by their
// device, so it never reveals who posted or me-too'd anything else (§7.1.1). An id that isn't
// a UUID can't be a report, so it is skipped.
export async function myRelation(
  residentId: string | null,
  reportIds: string[],
): Promise<{ mine: string[]; meTooed: string[] }> {
  const ids = [...new Set(reportIds.filter(isUuid))].slice(0, MAX_REPORT_IDS);
  if (!residentId || ids.length === 0) return { mine: [], meTooed: [] };

  const [posted, tapped] = await Promise.all([
    db
      .select({ id: reports.id })
      .from(reports)
      .where(and(inArray(reports.id, ids), eq(reports.residentId, residentId))),
    db
      .select({ id: meToos.reportId })
      .from(meToos)
      .where(and(inArray(meToos.reportId, ids), eq(meToos.residentId, residentId))),
  ]);
  const mine = new Set(posted.map((row) => row.id));
  const meTooed = new Set(tapped.map((row) => row.id));
  // In the order asked, as M0 returned them.
  return { mine: ids.filter((id) => mine.has(id)), meTooed: ids.filter((id) => meTooed.has(id)) };
}

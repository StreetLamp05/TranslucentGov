import { desc, inArray } from "drizzle-orm";
import { db } from "./db";
import { reports } from "./db/schema";
import { isPublicStatus, PUBLIC_STATUSES } from "./lib/publicReport";
import { ROUTING } from "./lib/routing";
import {
  agencyForSlug,
  groupFor,
  triageOverview,
  triageQueue,
  type QueueRow,
  type TriageGroup,
  type TriageQueue,
} from "./lib/triageGroups";
import { getDownloadUrl } from "./storage";

// The triage dashboard on Postgres (§5.5): the same shapes as M0's convex/triage.ts and
// triageGroup.ts, with the grouping done by the unchanged helpers in lib/triageGroups.ts
// against the active routing table. Public and read-only (§3.1.3); only open and fixed
// reports are read (§2.1.3).

// /gov's overview (§5.5.1): every agency with its open and fixed counts. Only category and
// status are selected, so no report field can reach the response.
export async function triageGroups(): Promise<TriageGroup[]> {
  const rows = await db
    .select({ category: reports.category, status: reports.status })
    .from(reports)
    .where(inArray(reports.status, [...PUBLIC_STATUSES]));
  return triageOverview(
    ROUTING,
    rows.map(({ category, status }) => {
      if (!isPublicStatus(status)) throw new Error(`triageGroups: a report is ${status}, not public`);
      return { ...(category !== null && { category }), status };
    }),
  );
}

// One agency's queue (§5.5.2), or null for a slug that isn't an agency. Rows are an allowlist:
// no transcript, segments, description, poster, tokens or fixer identity (§7.1.1). The group
// comes from the routing table, not the stored `agency` (§2.1.4). Thumbnails are presigned
// only for this group's rows, not every public report.
export async function triageQueueFor(slug: string): Promise<TriageQueue | null> {
  const group = agencyForSlug(ROUTING, slug);
  if (!group) return null;
  const rows = await db
    .select({
      id: reports.id,
      title: reports.title,
      street: reports.street,
      category: reports.category,
      status: reports.status,
      meTooCount: reports.meTooCount,
      createdAt: reports.createdAt,
      fixedAt: reports.fixedAt,
      isSample: reports.isSample,
      frameKeys: reports.frameStorageIds,
    })
    .from(reports)
    .where(inArray(reports.status, [...PUBLIC_STATUSES]))
    // The helpers' sorts are stable, so this settles a full tie newest row first, as the feed does.
    .orderBy(desc(reports.creationTime));
  const mine = rows.filter((row) => groupFor(ROUTING, row.category ?? undefined) === group.agency);
  const queueRows = await Promise.all(
    mine.map(async (row): Promise<QueueRow> => {
      // Like toMapReport: a read path that drops the status filter fails loudly instead of
      // putting a held report on a public page.
      if (!isPublicStatus(row.status)) {
        throw new Error(`triageQueue: report ${row.id} is ${row.status}, not public`);
      }
      return {
        _id: row.id,
        ...(row.title !== null && { title: row.title }),
        ...(row.street !== null && { street: row.street }),
        ...(row.category !== null && { category: row.category }),
        status: row.status,
        meTooCount: row.meTooCount,
        createdAt: row.createdAt,
        ...(row.fixedAt !== null && { fixedAt: row.fixedAt }),
        isSample: row.isSample,
        thumbnailUrl: row.frameKeys[0] ? await getDownloadUrl(row.frameKeys[0]) : null,
      };
    }),
  );
  return triageQueue(ROUTING, slug, queueRows);
}

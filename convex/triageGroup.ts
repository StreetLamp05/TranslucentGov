import { v } from "convex/values";
import { query } from "./_generated/server";
import { isPublicStatus, PUBLIC_STATUSES } from "./lib/publicReport";
import { ROUTING } from "../server/lib/routing";
import { agencyForSlug, groupFor, triageQueue, type QueueRow, type TriageQueue } from "../server/lib/triageGroups";

// One agency's queue on the triage dashboard (§5.5.2): its open reports ranked by me-toos,
// then what it has fixed. Public and read-only (§3.1.3); rows are an allowlist, so pending
// and held reports, transcripts, posters and fixers never come back. null for an unknown slug.
export const queue = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<TriageQueue | null> => {
    const group = agencyForSlug(ROUTING, slug);
    if (!group) return null;
    const byStatus = await Promise.all(
      PUBLIC_STATUSES.map(async (status) => {
        const reports = await ctx.db
          .query("reports")
          .withIndex("by_status_createdAt", (q) => q.eq("status", status))
          .collect();
        // Storage URLs only for this group's rows, not every public report.
        const mine = reports.filter((report) => groupFor(ROUTING, report.category) === group.agency);
        return await Promise.all(
          mine.map(async (report): Promise<QueueRow> => {
            // Like toMapReport: a future read path that drops the status filter fails loudly
            // instead of putting a held report on a public page.
            if (!isPublicStatus(report.status)) {
              throw new Error(`triageGroup.queue: report ${report._id} is ${report.status}, not public`);
            }
            return {
              _id: report._id,
              title: report.title,
              street: report.street,
              category: report.category,
              status: report.status,
              meTooCount: report.meTooCount,
              createdAt: report.createdAt,
              fixedAt: report.fixedAt,
              isSample: report.isSample,
              thumbnailUrl: report.frameStorageIds[0] ? await ctx.storage.getUrl(report.frameStorageIds[0]) : null,
            };
          }),
        );
      }),
    );
    return triageQueue(ROUTING, slug, byStatus.flat());
  },
});

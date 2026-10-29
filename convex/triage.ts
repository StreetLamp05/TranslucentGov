import { query } from "./_generated/server";
import { PUBLIC_STATUSES } from "./lib/publicReport";
import { ROUTING } from "./lib/routing";
import { triageOverview, type TriageGroup } from "./lib/triageGroups";

// The triage dashboard's overview (§5.5.1): every agency in the active routing table with
// its open and fixed counts. Public and read-only (§3.1.3), so it returns no report fields,
// only each group and its counts. pending and held reports never count (§2.1.3).
export const overview = query({
  args: {},
  handler: async (ctx): Promise<TriageGroup[]> => {
    const byStatus = await Promise.all(
      PUBLIC_STATUSES.map(async (status) => {
        const reports = await ctx.db
          .query("reports")
          .withIndex("by_status_createdAt", (q) => q.eq("status", status))
          .collect();
        return reports.map((report) => ({ category: report.category, status }));
      }),
    );
    return triageOverview(ROUTING, byStatus.flat());
  },
});

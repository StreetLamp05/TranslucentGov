import { db } from "./db";
import { reports } from "./db/schema";
import { isPublicStatus, type ReportStatus } from "./lib/publicReport";
import { OWNERS, type Owner } from "./lib/routing";

// §6.2.1's supporting counters, pulled live during the pitch. No dashboard screen.
// CLI only, like M0's internalQuery: `npm run impact` (scripts/impact-stats.ts). Samples stay in, because the on-stage
// me-toos and reveal views land on seeded reports. The per-owner timings (median days, 30-day
// share) then come from backdated seed dates (§6.1.1), so they aren't findings. Pitch the live
// counters only. `samples` counts the seeded public reports, overall and per owner; `byStatus`
// has no sample split. Oct 30, with real Mableton posts: add `-- --exclude-samples`.

// The columns the counters read.
type StatsReport = {
  status: ReportStatus;
  owner: Owner | null;
  isSample: boolean;
  meTooCount: number;
  revealViews: number;
  createdAt: number;
  fixedAt: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const FIX_WINDOW_DAYS = 30;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const ratio = (num: number, den: number) => (den === 0 ? null : round(num / den, 3));

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ownerStats(reports: StatsReport[], now: number) {
  const fixed = reports.filter((r) => r.status === "fixed");
  // A fixed report always has fixedAt (§4.3.1); one without it can't be timed, so it's left
  // out of the day counts but still counts as fixed.
  const daysToFix = (r: StatsReport) => (r.fixedAt! - r.createdAt) / DAY_MS;
  const fixDays = fixed.filter((r) => r.fixedAt !== null).map(daysToFix);
  // The 30-day share only looks at reports 30+ days old, fixed or open, so a young open report
  // and a young fix are both left out and neither can skew it.
  const old = reports.filter(
    (r) => now - r.createdAt >= FIX_WINDOW_DAYS * DAY_MS && (r.status !== "fixed" || r.fixedAt !== null),
  );
  const fixedInWindow = old.filter((r) => r.status === "fixed" && daysToFix(r) <= FIX_WINDOW_DAYS).length;
  const medianDays = median(fixDays);
  return {
    reports: reports.length,
    samples: reports.filter((r) => r.isSample).length,
    fixed: fixed.length,
    medianDaysToFix: medianDays === null ? null : round(medianDays, 1),
    atLeast30DaysOld: old.length,
    fixedWithin30Days: fixedInWindow,
    shareFixedWithin30Days: ratio(fixedInWindow, old.length),
  };
}

export async function impact({ excludeSamples = false, now = Date.now() }: { excludeSamples?: boolean; now?: number } = {}) {
  const rows: StatsReport[] = await db
    .select({
      status: reports.status,
      owner: reports.owner,
      isSample: reports.isSample,
      meTooCount: reports.meTooCount,
      revealViews: reports.revealViews,
      createdAt: reports.createdAt,
      fixedAt: reports.fixedAt,
    })
    .from(reports);
  const all = rows.filter((r) => !(excludeSamples && r.isSample));
  const live = all.filter((r) => isPublicStatus(r.status));

  const byOwner = Object.fromEntries(
    OWNERS.map((owner) => [owner, ownerStats(live.filter((r) => (r.owner ?? "unknown") === owner), now)]),
  ) as Record<Owner, ReturnType<typeof ownerStats>>;

  const fixedCount = live.filter((r) => r.status === "fixed").length;
  const revealViews = live.reduce((sum, r) => sum + r.revealViews, 0);
  const meToos = live.reduce((sum, r) => sum + r.meTooCount, 0);

  return {
    excludeSamples,
    samples: live.filter((r) => r.isSample).length,
    byOwner,
    revealViews: { total: revealViews, perFixedReport: ratio(revealViews, fixedCount) },
    meToos: { meToos, reports: live.length, shareOfReportsPlusMeToos: ratio(meToos, live.length + meToos) },
    byStatus: {
      pending: all.filter((r) => r.status === "pending").length,
      held: all.filter((r) => r.status === "held").length,
      open: all.filter((r) => r.status === "open").length,
      fixed: fixedCount,
    },
  };
}

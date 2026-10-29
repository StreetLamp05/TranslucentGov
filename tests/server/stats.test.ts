import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { reports } from "@/server/db/schema";
import { impact } from "@/server/stats";
import { insertResident } from "./reports";

const NOW = Date.UTC(2026, 9, 25, 16);
const DAY = 24 * 60 * 60 * 1000;

type Fixture = {
  status: "pending" | "held" | "open" | "fixed";
  owner?: "city" | "cobb" | "utility" | "unknown";
  ageDays: number; // createdAt = NOW − ageDays
  fixDays?: number; // fixedAt = createdAt + fixDays
  revealViews?: number;
  meTooCount?: number;
  isSample?: boolean;
};

// Expected numbers are worked out by hand, in the comments beside each row.
const FIXTURES: Fixture[] = [
  // cobb: fixes at 10, 40 and 20 days; one open 50 days (a miss); one open 5 days (undecided).
  { status: "fixed", owner: "cobb", ageDays: 60, fixDays: 10, revealViews: 10, meTooCount: 1 },
  { status: "fixed", owner: "cobb", ageDays: 60, fixDays: 40, revealViews: 0 },
  { status: "fixed", owner: "cobb", ageDays: 30, fixDays: 20, revealViews: 5 },
  { status: "open", owner: "cobb", ageDays: 50, meTooCount: 3 },
  { status: "open", owner: "cobb", ageDays: 5 },
  // city: fixes at 3 and 6 days.
  { status: "fixed", owner: "city", ageDays: 10, fixDays: 3, revealViews: 3 },
  { status: "fixed", owner: "city", ageDays: 10, fixDays: 6, revealViews: 2 },
  // utility: open 12 days, so nothing is decided yet.
  { status: "open", owner: "utility", ageDays: 12 },
  // Not public: only counted by status.
  { status: "held", owner: "cobb", ageDays: 40, revealViews: 50, meTooCount: 50 },
  { status: "pending", ageDays: 0 },
  // A backdated sample (§6.1.1): cobb, fixed in 2 days.
  { status: "fixed", owner: "cobb", ageDays: 25, fixDays: 2, revealViews: 100, meTooCount: 5, isSample: true },
];

async function seed(fixtures: Fixture[] = FIXTURES) {
  const resident = await insertResident();
  if (fixtures.length === 0) return;
  await db.insert(reports).values(
    fixtures.map((f) => {
      const createdAt = NOW - f.ageDays * DAY;
      const fixedAt = f.fixDays === undefined ? undefined : createdAt + f.fixDays * DAY;
      return {
        residentId: resident.id,
        mediaType: "video" as const,
        frameStorageIds: [],
        lat: 33.8187,
        lng: -84.5824,
        owner: f.owner,
        status: f.status,
        audioMuted: false,
        isSample: f.isSample ?? false,
        meTooCount: f.meTooCount ?? 0,
        lastActivityAt: fixedAt ?? createdAt,
        revealViews: f.revealViews ?? 0,
        createdAt,
        fixedAt,
        fixedByKind: fixedAt === undefined ? undefined : ("fixer" as const),
      };
    }),
  );
}

describe("impact", () => {
it("excluding samples, every number matches the hand-worked fixture", async () => {
  await seed();
  const stats = await impact({ excludeSamples: true, now: NOW });

  expect(stats).toEqual({
    excludeSamples: true,
    samples: 0,
    byOwner: {
      // Fix days 10, 20, 40 → median 20. 30+ days old: the three fixes and the 50-day open one; 2 of 4 within 30.
      cobb: { reports: 5, samples: 0, fixed: 3, medianDaysToFix: 20, atLeast30DaysOld: 4, fixedWithin30Days: 2, shareFixedWithin30Days: 0.5 },
      // Fix days 3, 6 → median 4.5. Both are 10 days old, so too young for the 30-day share.
      city: { reports: 2, samples: 0, fixed: 2, medianDaysToFix: 4.5, atLeast30DaysOld: 0, fixedWithin30Days: 0, shareFixedWithin30Days: null },
      utility: { reports: 1, samples: 0, fixed: 0, medianDaysToFix: null, atLeast30DaysOld: 0, fixedWithin30Days: 0, shareFixedWithin30Days: null },
      unknown: { reports: 0, samples: 0, fixed: 0, medianDaysToFix: null, atLeast30DaysOld: 0, fixedWithin30Days: 0, shareFixedWithin30Days: null },
    },
    // 10 + 0 + 5 + 3 + 2 = 20 views over 5 fixes. The held report's 50 don't count.
    revealViews: { total: 20, perFixedReport: 4 },
    // 1 + 3 = 4 me-toos on 8 public reports → 4 / 12.
    meToos: { meToos: 4, reports: 8, shareOfReportsPlusMeToos: 0.333 },
    byStatus: { pending: 1, held: 1, open: 3, fixed: 5 },
  });
});

it("with samples (the default), the sample counts everywhere", async () => {
  await seed();
  const stats = await impact({ now: NOW });

  expect(stats.excludeSamples).toBe(false);
  expect(stats.samples).toBe(1);
  // Fix days 2, 10, 20, 40 → median 15. The sample is 25 days old, so the 30-day share is unchanged.
  expect(stats.byOwner.cobb).toEqual({
    reports: 6,
    samples: 1,
    fixed: 4,
    medianDaysToFix: 15,
    atLeast30DaysOld: 4,
    fixedWithin30Days: 2,
    shareFixedWithin30Days: 0.5,
  });
  expect(stats.byOwner.city.medianDaysToFix).toBe(4.5);
  // 120 views over 6 fixes; 9 me-toos on 9 public reports.
  expect(stats.revealViews).toEqual({ total: 120, perFixedReport: 20 });
  expect(stats.meToos).toEqual({ meToos: 9, reports: 9, shareOfReportsPlusMeToos: 0.5 });
  expect(stats.byStatus).toEqual({ pending: 1, held: 1, open: 3, fixed: 6 });
});

it("the 30-day share only counts reports 30+ days old: a fix on day 30 is a hit, and young reports are left out", async () => {
  await seed([
    { status: "open", owner: "utility", ageDays: 29.9 }, // too young
    { status: "fixed", owner: "utility", ageDays: 29.9, fixDays: 1 }, // too young, even though it's a quick fix
    { status: "open", owner: "utility", ageDays: 30 }, // miss
    { status: "fixed", owner: "utility", ageDays: 40, fixDays: 30 }, // hit
    { status: "fixed", owner: "utility", ageDays: 40, fixDays: 30.5 }, // miss
  ]);
  const { byOwner } = await impact({ now: NOW });
  expect(byOwner.utility).toMatchObject({ reports: 5, fixed: 3, atLeast30DaysOld: 3, fixedWithin30Days: 1, shareFixedWithin30Days: 0.333 });
});

it("a report with no owner counts as unknown, a fixed report missing fixedAt still counts as fixed, and the median rounds to 1 decimal", async () => {
  await seed([
    { status: "fixed", ageDays: 40, fixDays: 1, revealViews: 3 },
    { status: "fixed", ageDays: 40, fixDays: 2.25, revealViews: 3 },
    { status: "fixed", ageDays: 40, revealViews: 3 }, // no fixedAt: fixed, but can't be timed
  ]);
  const stats = await impact({ now: NOW });
  // Median of 1 and 2.25 is 1.625 → 1.6. Only the two timed fixes count toward the 30-day share.
  expect(stats.byOwner.unknown).toEqual({
    reports: 3,
    samples: 0,
    fixed: 3,
    medianDaysToFix: 1.6,
    atLeast30DaysOld: 2,
    fixedWithin30Days: 2,
    shareFixedWithin30Days: 1,
  });
  // Every count of fixes agrees: 3.
  expect(stats.byStatus.fixed).toBe(3);
  expect(stats.revealViews).toEqual({ total: 9, perFixedReport: 3 });
});

it("an empty database gives zeros and nulls, never NaN, and survives a JSON round trip", async () => {
  const stats = await impact({ now: NOW });

  expect(stats.revealViews).toEqual({ total: 0, perFixedReport: null });
  expect(stats.meToos).toEqual({ meToos: 0, reports: 0, shareOfReportsPlusMeToos: null });
  expect(stats.byStatus).toEqual({ pending: 0, held: 0, open: 0, fixed: 0 });
  // `curl` prints the return value as JSON: nothing may be lost or turned into null.
  expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
});

  it("defaults to the current time", async () => {
    expect((await impact()).excludeSamples).toBe(false);
  });
});

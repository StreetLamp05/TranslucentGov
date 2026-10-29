import { expect, it, vi } from "vitest";

// worker/index.ts is what actually registers the jobs and the nightly purge on pg-boss (§1.1.1),
// so check its wiring with pg-boss replaced.
const { work, schedule } = vi.hoisted(() => ({ work: vi.fn<(name: string) => Promise<void>>(async () => {}), schedule: vi.fn<(name: string, cron: string) => Promise<void>>(async () => {}) }));
vi.mock("@/server/jobs", () => ({
  boss: vi.fn(async () => ({ stop: vi.fn() })),
  enqueue: vi.fn(),
  schedule,
  work,
}));

it("registers every job handler and schedules purgeExpired daily at 10:00 UTC", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  await import("@/worker/index");
  await vi.waitFor(() => expect(schedule).toHaveBeenCalled());

  expect(work.mock.calls.map(([name]) => name).sort()).toEqual(
    ["attachSeedFix", "backdateSeedFix", "purgeExpired", "screenReport", "transcribeVideo", "verifyFix"].sort(),
  );
  expect(schedule.mock.calls).toEqual([["purgeExpired", "0 10 * * *"]]);
});

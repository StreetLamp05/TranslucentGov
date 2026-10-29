import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { enqueue, schedule } from "@/server/jobs";
import { enqueuedJobs, scheduledJobs } from "./fakes";

// tests/server/** gets the recording fake of @/server/jobs (tests/server/fakes.ts). The real
// pg-boss round trip is in the US33 verification notes (tasks/US33-todo.md).

describe("the jobs fake", () => {
  it("records enqueued jobs, their delay and whether they were queued in a transaction", async () => {
    await enqueue("screenReport", { reportId: "r1" });
    await db.transaction(async (tx) => {
      await enqueue("screenReport", { reportId: "r2" }, { delaySeconds: 30, tx });
    });

    expect(enqueuedJobs).toEqual([
      { name: "screenReport", payload: { reportId: "r1" }, delaySeconds: undefined, inTransaction: false },
      { name: "screenReport", payload: { reportId: "r2" }, delaySeconds: 30, inTransaction: true },
    ]);
  });

  it("records schedules", async () => {
    await schedule("purgeExpired", "0 10 * * *");
    expect(scheduledJobs.get("purgeExpired")).toBe("0 10 * * *");
  });

  it("starts every test with no jobs", () => {
    expect(enqueuedJobs).toEqual([]);
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { reports, type Segment } from "@/server/db/schema";
import { backfillSpanish } from "@/server/backfillSpanish";
import { GeminiError } from "@/server/lib/gemini";
import { insertReport, insertResident } from "./reports";

const EN: Segment[] = [{ start: 0, end: 3, text: "This pothole's been here since June." }];
const ES: Segment[] = [{ start: 0, end: 3, text: "Este bache lleva aquí desde junio." }];

const translate = vi.fn<(segments: Segment[]) => Promise<Segment[]>>();
const sleep = vi.fn<(ms: number) => Promise<void>>();
const run = () => backfillSpanish({ translate, sleep, pauseMs: 4000, log: () => {} });
const segmentsEsOf = async (id: string) => (await db.select().from(reports).where(eq(reports.id, id)))[0].segmentsEs;

beforeEach(() => {
  translate.mockReset().mockResolvedValue(ES);
  sleep.mockReset().mockResolvedValue();
});

describe("backfillSpanish", () => {
  it("translates each report that has segments and no Spanish, one call per report, pausing between calls", async () => {
    const resident = await insertResident();
    const a = await insertReport(resident.id);
    const b = await insertReport(resident.id);

    expect(await run()).toEqual({ translated: 2, skipped: 0, failed: 0 });

    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenCalledWith(EN);
    expect(await segmentsEsOf(a.id)).toEqual(ES);
    expect(await segmentsEsOf(b.id)).toEqual(ES);
    // Between the calls, not before the first or after the last.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(4000);
  });

  it("is idempotent: a second run makes no calls and keeps the Spanish", async () => {
    const resident = await insertResident();
    const report = await insertReport(resident.id);
    await run();
    translate.mockClear();

    expect(await run()).toEqual({ translated: 0, skipped: 0, failed: 0 });
    expect(translate).not.toHaveBeenCalled();
    expect(await segmentsEsOf(report.id)).toEqual(ES);
  });

  it("leaves alone reports with Spanish already, without speech, or muted", async () => {
    const resident = await insertResident();
    const has = await insertReport(resident.id, { segmentsEs: [{ start: 0, end: 1, text: "Ya está." }] });
    const photos = await insertReport(resident.id, { mediaType: "photos", segments: null, transcript: null });
    const silent = await insertReport(resident.id, { segments: [] });
    const muted = await insertReport(resident.id, { audioMuted: true });

    expect(await run()).toEqual({ translated: 0, skipped: 0, failed: 0 });

    expect(translate).not.toHaveBeenCalled();
    expect(await segmentsEsOf(has.id)).toEqual([{ start: 0, end: 1, text: "Ya está." }]);
    for (const row of [photos, silent, muted]) expect(await segmentsEsOf(row.id)).toBeNull();
  });

  it("counts a failure, keeps going, and leaves the failed report for the next run", async () => {
    const resident = await insertResident();
    const bad = await insertReport(resident.id);
    const good = await insertReport(resident.id);
    translate.mockRejectedValueOnce(new GeminiError("bad_output", "nope")).mockResolvedValueOnce(ES);

    expect(await run()).toEqual({ translated: 1, skipped: 0, failed: 1 });

    expect(await segmentsEsOf(bad.id)).toBeNull();
    expect(await segmentsEsOf(good.id)).toEqual(ES);
  });

  it("counts an empty translation as a failure, so the report is retried next run", async () => {
    const resident = await insertResident();
    const report = await insertReport(resident.id);
    translate.mockResolvedValueOnce([]);

    expect(await run()).toEqual({ translated: 0, skipped: 0, failed: 1 });
    expect(await segmentsEsOf(report.id)).toBeNull();
  });

  it("retries once after Gemini's delay when rate limited", async () => {
    const resident = await insertResident();
    const report = await insertReport(resident.id);
    translate.mockRejectedValueOnce(new GeminiError("rate_limited", "slow down", 7000));

    expect(await run()).toEqual({ translated: 1, skipped: 0, failed: 0 });

    expect(translate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(await segmentsEsOf(report.id)).toEqual(ES);
  });

  it("doesn't overwrite Spanish that lands while it was translating", async () => {
    const resident = await insertResident();
    const report = await insertReport(resident.id);
    const fresh = [{ start: 0, end: 3, text: "Del trabajo de transcripción." }];
    translate.mockImplementationOnce(async () => {
      await db.update(reports).set({ segmentsEs: fresh }).where(eq(reports.id, report.id));
      return ES;
    });

    expect(await run()).toEqual({ translated: 0, skipped: 1, failed: 0 });
    expect(await segmentsEsOf(report.id)).toEqual(fresh);
  });
});

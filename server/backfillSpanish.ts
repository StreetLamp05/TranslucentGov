import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { reports, type Segment } from "./db/schema";
import { GeminiError } from "./lib/gemini";

// Fills `reports.segmentsEs` for reports transcribed before US48 (§5.1.1). One translate call
// per report, a pause between calls for the free tier. Run by scripts/backfill-spanish-captions.ts.

// Flash-Lite's free tier allows about 15 requests a minute: this stays under it.
export const DEFAULT_PAUSE_MS = 5000;

export type BackfillResult = { translated: number; skipped: number; failed: number };

export async function backfillSpanish({
  translate,
  pauseMs = DEFAULT_PAUSE_MS,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}: {
  translate: (segments: Segment[]) => Promise<Segment[]>;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<BackfillResult> {
  // Muted reports never show their captions (§4.2.1), and a report without speech has nothing
  // to translate. Rows that already have Spanish are the ones a rerun skips.
  const todo = await db
    .select({ id: reports.id, segments: reports.segments })
    .from(reports)
    .where(and(isNull(reports.segmentsEs), eq(reports.audioMuted, false), sql`jsonb_array_length(${reports.segments}) > 0`))
    .orderBy(reports.creationTime);
  const result: BackfillResult = { translated: 0, skipped: 0, failed: 0 };

  for (const [index, row] of todo.entries()) {
    if (index > 0) await sleep(pauseMs);
    try {
      let segmentsEs: Segment[];
      try {
        segmentsEs = await translate(row.segments!);
      } catch (error) {
        // One retry after Gemini's own delay when it rate-limits.
        if (!(error instanceof GeminiError) || error.kind !== "rate_limited") throw error;
        await sleep(error.retryAfterMs ?? pauseMs);
        segmentsEs = await translate(row.segments!);
      }
      // An empty translation would be stored as "has Spanish" with nothing in it.
      if (segmentsEs.length === 0) throw new Error("Gemini returned no Spanish lines");
      // Only while it's still empty, so a rerun or a racing screening never overwrites Spanish.
      const updated = await db
        .update(reports)
        .set({ segmentsEs })
        .where(and(eq(reports.id, row.id), isNull(reports.segmentsEs)))
        .returning({ id: reports.id });
      if (updated.length > 0) result.translated += 1;
      else result.skipped += 1;
      log(`${row.id}: ${updated.length > 0 ? "translated" : "already had Spanish"}`);
    } catch (error) {
      result.failed += 1;
      log(`${row.id}: failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return result;
}

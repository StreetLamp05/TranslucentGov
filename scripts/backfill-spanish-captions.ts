// Fills the Spanish captions (`reports.segmentsEs`, US48) of reports transcribed before they
// existed, by translating their English segments: one Gemini call per report, paced for the free
// tier. Safe to rerun: it only touches reports that still have no Spanish, and prints a count.
//
// In the worker image (it has the code, tsx and GEMINI_API_KEY):
//   docker compose run --rm --no-deps worker node_modules/.bin/tsx scripts/backfill-spanish-captions.ts
// Locally: npx tsx scripts/backfill-spanish-captions.ts   (DATABASE_URL, GEMINI_API_KEY from .env.local)
import "../worker/env.ts"; // first: server modules read their env when they load
import { backfillSpanish } from "../server/backfillSpanish.ts";
import { translateSegments } from "../server/lib/translateSegments.ts";

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY isn't set.");
  const { translated, skipped, failed } = await backfillSpanish({ translate: translateSegments });
  console.log(`Done: ${translated} translated, ${skipped} already had Spanish, ${failed} failed.`);
  process.exitCode = failed > 0 ? 1 : 0;
  // The pg pool keeps the process alive.
  process.exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

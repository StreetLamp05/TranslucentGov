// Runs checkFix over the US3 before/after pairs and prints expected vs actual (§4.3.1).
// Calls the real Gemini API (GEMINI_API_KEY, model from GEMINI_MODEL or the default in convex/lib/gemini.ts).
//
// Usage: npx tsx --env-file=.env.local scripts/eval-fix.ts [path/to/fix-pairs.json]
//
// fix-pairs.json (default scripts/fixtures/fix-pairs.json) is an array of pairs. Image paths are
// relative to the file. Clips go in as their extracted frames (JPEG/PNG, ≤1280px long edge), so
// the eval needs no ffmpeg. `beforeKind` is "video" (the default) or "photos":
//   [{ "id": "pothole-repaired", "before": ["pothole-before-1.jpg"], "after": ["pothole-after-1.jpg"],
//      "category": "pothole", "title": "Deep pothole in the right lane", "expected": { "verdict": "verified" } }]
// The card's pairs: same spot repaired → verified, same spot unrepaired → not_fixed, different
// spot → not_fixed, worker's face visible → retake. The face pair must show the same spot
// fully repaired: not_fixed outranks retake, so a face filmed mid-repair comes back not_fixed.
// Entries without `before`, `after` or `expected.verdict` are listed as skipped, and any skip
// fails the run, so a file in some other shape can't pass as "0/0 match".
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ImageMediaType } from "../convex/lib/gemini";
import { checkFix, type FixInput, type FixResult } from "../convex/lib/fixPrompt";

type Pair = {
  id: string;
  before?: string[];
  after?: string[];
  beforeKind?: FixInput["beforeKind"];
  category?: string;
  title?: string;
  expected: { verdict: FixResult["verdict"] };
};

const MEDIA_TYPES: Record<string, ImageMediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function loadImage(file: string) {
  const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
  if (!mediaType) throw new Error(`${file}: not an image (jpg, png or webp)`);
  return { mediaType, data: readFileSync(file).toString("base64") };
}

async function main() {
  const pairsPath = path.resolve(process.argv[2] ?? "scripts/fixtures/fix-pairs.json");
  const dir = path.dirname(pairsPath);
  const entries = JSON.parse(readFileSync(pairsPath, "utf8")) as Pair[];
  if (!Array.isArray(entries)) throw new Error(`${pairsPath}: expected an array of pairs`);
  const pairs = entries.filter((p) => p.before?.length && p.after?.length && p.expected?.verdict);
  const skipped = entries.filter((p) => !pairs.includes(p));
  for (const p of skipped) console.log(`SKIP  ${p.id ?? JSON.stringify(p)}: needs "before", "after" and "expected.verdict"`);

  let matches = 0;
  for (const p of pairs) {
    try {
      const result = await checkFix({
        before: p.before!.map((file) => loadImage(path.join(dir, file))),
        beforeKind: p.beforeKind ?? "video",
        after: p.after!.map((file) => loadImage(path.join(dir, file))),
        category: p.category,
        title: p.title,
      });
      const ok = result.verdict === p.expected.verdict;
      if (ok) matches++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${p.id}`);
      console.log(`      expected ${p.expected.verdict}`);
      console.log(`      actual   ${result.verdict}  (${result.reason})`);
    } catch (error) {
      console.log(`ERROR ${p.id}: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`      expected ${p.expected.verdict}`);
    }
  }
  console.log(`\n${matches}/${pairs.length} match${skipped.length ? `, ${skipped.length} skipped` : ""}`);
  process.exitCode = pairs.length > 0 && matches === pairs.length && skipped.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

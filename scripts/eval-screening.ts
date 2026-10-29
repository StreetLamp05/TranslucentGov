// Runs screenPost over the US3 screening fixtures and prints expected vs actual (§4.2.1).
// Calls the real Gemini API (GEMINI_API_KEY, model from GEMINI_MODEL or the default in convex/lib/gemini.ts).
//
// Usage: npx tsx --env-file=.env.local scripts/eval-screening.ts [path/to/labels.json]
//
// labels.json (default scripts/fixtures/labels.json) is an array of cases. Image paths are
// relative to the labels file. Videos go in as their extracted frames, and narration goes
// in as `transcript`, so the eval needs neither ffmpeg nor transcription:
//   [{ "id": "clean-pothole", "images": ["pothole.jpg"], "transcript": "...", "description": "...",
//      "street": "Floyd Rd", "expected": { "verdict": "pass", "category": "pothole" } }]
// Entries without `images` or `expected.verdict` are listed as skipped, and any skip fails the
// run, so a labels.json in some other shape can't pass as "0/0 match".
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ImageMediaType } from "../convex/lib/gemini";
import { screenPost, type ScreenResult } from "../convex/lib/screenPrompt";

type Case = {
  id: string;
  images?: string[];
  transcript?: string;
  description?: string;
  street?: string;
  expected: { verdict: ScreenResult["verdict"]; category?: ScreenResult["category"] };
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
  const labelsPath = path.resolve(process.argv[2] ?? "scripts/fixtures/labels.json");
  const dir = path.dirname(labelsPath);
  const entries = JSON.parse(readFileSync(labelsPath, "utf8")) as Case[];
  const cases = entries.filter((c) => c.images?.length && c.expected?.verdict);
  const skipped = entries.filter((c) => !cases.includes(c));
  for (const c of skipped) console.log(`SKIP  ${c.id ?? JSON.stringify(c)}: needs "images" and "expected.verdict"`);

  let matches = 0;
  for (const c of cases) {
    const want = `${c.expected.verdict}${c.expected.category ? ` / ${c.expected.category}` : ""}`;
    try {
      const result = await screenPost({
        images: c.images!.map((file) => loadImage(path.join(dir, file))),
        transcript: c.transcript,
        description: c.description,
        street: c.street,
      });
      const ok =
        result.verdict === c.expected.verdict && (!c.expected.category || result.category === c.expected.category);
      if (ok) matches++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${c.id}`);
      console.log(`      expected ${want}`);
      console.log(`      actual   ${result.verdict} / ${result.category}  "${result.title}"  (${result.reason})`);
    } catch (error) {
      console.log(`ERROR ${c.id}: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`      expected ${want}`);
    }
  }
  console.log(`\n${matches}/${cases.length} match${skipped.length ? `, ${skipped.length} skipped` : ""}`);
  process.exitCode = cases.length > 0 && matches === cases.length && skipped.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

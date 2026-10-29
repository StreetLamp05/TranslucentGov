// Transcribes clips with the real Gemini API (§1.1.4) and prints each transcript as JSON.
//
// Usage: npx tsx scripts/try-transcribe.ts <clip.mp4|webm>...
// The key comes from GEMINI_API_KEY (and the model from GEMINI_MODEL) in the environment.
// Clips over MAX_INLINE_BYTES go through the Files API, the rest inline.
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { MAX_INLINE_BYTES, transcribe } from "../server/lib/transcribe.ts";

const CONTENT_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm" };

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error("usage: npx tsx scripts/try-transcribe.ts <clip.mp4|webm>...");

  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY isn't set.");

  for (const file of files) {
    try {
      const contentType = CONTENT_TYPES[extname(file).toLowerCase()];
      if (!contentType) throw new Error("Only .mp4 and .webm clips can be transcribed.");
      const bytes = await readFile(file);
      const started = Date.now();
      const result = await transcribe(new Blob([bytes], { type: contentType }), contentType, basename(file));
      const via = bytes.length > MAX_INLINE_BYTES ? "files-api" : "inline";
      console.log(JSON.stringify({ file, via, ms: Date.now() - started, ...result }));
    } catch (error) {
      process.exitCode = 1;
      console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

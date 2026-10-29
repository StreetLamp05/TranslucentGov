// Posts a fixture through the app's HTTP routes (/api/files, /api/posts), then waits for
// screening (US13) to move it out of `pending` and prints the result and the elapsed time.
// Calls the real Google Maps and Gemini APIs with the keys the app and worker run with.
//
// Usage (needs `npm run dev` and `npm run worker` running, on this worktree's database):
//   npx tsx --env-file=.env.local scripts/try-screening.ts <clip.mp4|webm> <frame.jpg>...
//   npx tsx --env-file=.env.local scripts/try-screening.ts --photos <photo.jpg>...
// A video needs its frames as images (the browser grabs ~6 in the app, §4.1.1). From a US3
// clip: ffmpeg -i clip.mp4 -vf "fps=6/20,scale=-2:1280" frame-%d.jpg
// Add `--description "..."` for the optional text, and `--at <lat>,<lng>` to post somewhere
// other than Mableton. APP_URL (default http://127.0.0.1:3000) says where the app is.
import { readFileSync } from "node:fs";
import path from "node:path";
import { RESIDENT_TOKEN_HEADER } from "../lib/data/headers";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const TIMEOUT_MS = 120_000;

function parseArgs(argv: string[]) {
  let photos = false;
  let description: string | undefined;
  let at = { lat: 33.8158, lng: -84.5825 }; // Mableton
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--photos") photos = true;
    else if (arg === "--description") description = argv[++i];
    else if (arg === "--at") {
      const [lat, lng] = (argv[++i] ?? "").split(",").map(Number);
      at = { lat, lng };
    } else files.push(arg);
  }
  const clip = photos ? undefined : files[0];
  const frames = photos ? files : files.slice(1);
  if (frames.length === 0) {
    console.error("usage: try-screening.ts <clip> <frame>... | --photos <photo>...  [--description text] [--at lat,lng]");
    process.exit(2);
  }
  return { photos, clip, frames, description, at };
}

async function main() {
  const { photos, clip, frames, description, at } = parseArgs(process.argv.slice(2));
  const base = process.env.APP_URL ?? "http://127.0.0.1:3000";
  const token = `try-screening-${crypto.randomUUID()}`;

  async function call<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { [RESIDENT_TOKEN_HEADER]: token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${route}: ${data?.error ?? response.status}`);
    return data as T;
  }

  async function upload(file: string): Promise<string> {
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
    if (!type) throw new Error(`${file}: unknown file type`);
    const { key, url } = await call<{ key: string; url: string }>("POST", "/api/files", { contentType: type });
    const response = await fetch(url, { method: "PUT", headers: { "Content-Type": type }, body: readFileSync(file) });
    if (!response.ok) throw new Error(`${file}: upload failed (${response.status})`);
    return key;
  }

  const clipStorageId = clip ? await upload(clip) : undefined;
  const frameStorageIds = await Promise.all(frames.map(upload));

  const started = Date.now();
  const reportId = await call<string>("POST", "/api/posts", {
    mediaType: photos ? "photos" : "video",
    clipStorageId,
    frameStorageIds,
    description,
    ...at,
  });
  console.log(`report ${reportId} created, waiting for screening…`);

  while (Date.now() - started < TIMEOUT_MS) {
    const report = await call<Record<string, unknown> | null>("GET", `/api/posts/mine?reportId=${reportId}`);
    if (report && report.status !== "pending") {
      const { status, verdict, reason, category, owner, agency, title, street, audioMuted, transcript } = report;
      console.log(JSON.stringify({ status, verdict, reason, category, owner, agency, title, street, audioMuted, transcript }, null, 2));
      console.log(`pending → ${status} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`report ${reportId} was still pending after ${TIMEOUT_MS / 1000} s`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

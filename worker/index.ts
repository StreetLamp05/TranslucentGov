import "./env"; // first: the imports below read env when they load
import { boss, schedule, work, type JobHandler } from "@/server/jobs";
import { PURGE_CRON, PURGE_EXPIRED, purgeExpired } from "@/server/jobs/purgeExpired";
import { SCREEN_REPORT, screenReport } from "@/server/jobs/screenReport";
import { ATTACH_SEED_FIX, attachSeedFix, BACKDATE_SEED_FIX, backdateSeedFix } from "@/server/jobs/seedFix";
import { TRANSCRIBE_VIDEO, transcribeVideo } from "@/server/jobs/transcribeVideo";
import { VERIFY_FIX, verifyFix } from "@/server/jobs/verifyFix";

// The job worker (§1.1.1): `npm run worker` locally, the `worker` service in docker compose.
// Screening, fix verification, transcription and purge run here, so the Gemini key never
// reaches the browser.

// Job name → handler.
// (`never` lets each handler type its own payload.)
const handlers: Record<string, JobHandler<never>> = {
  [SCREEN_REPORT]: screenReport,
  [VERIFY_FIX]: verifyFix,
  [TRANSCRIBE_VIDEO]: transcribeVideo,
  [ATTACH_SEED_FIX]: attachSeedFix,
  [BACKDATE_SEED_FIX]: backdateSeedFix,
  [PURGE_EXPIRED]: purgeExpired,
};

// Job name → cron expression (UTC), for jobs that run on a schedule. Each needs a handler above.
const schedules: Record<string, string> = {
  [PURGE_EXPIRED]: PURGE_CRON,
};

async function main() {
  for (const [name, handler] of Object.entries(handlers)) await work(name, handler);
  for (const [name, cron] of Object.entries(schedules)) await schedule(name, cron);

  const instance = await boss();
  const names = Object.keys(handlers);
  console.log(`worker: ready, ${names.length ? names.join(", ") : "no handlers yet"}`);

  const stop = async () => {
    await instance.stop({ graceful: true });
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

main().catch((error) => {
  console.error("worker:", error);
  process.exit(1);
});

import "./env"; // first: the imports below read env when they load
import { boss, schedule, work, type JobHandler } from "@/server/jobs";

// The job worker (§1.1.1): `npm run worker` locally, the `worker` service in docker compose.
// Screening, fix verification, transcription and purge run here, so the Gemini key never
// reaches the browser.

// Job name → handler. US36 adds screenReport and verifyFix, US39 transcribeVideo and purgeExpired.
// (`never` lets each handler type its own payload.)
const handlers: Record<string, JobHandler<never>> = {};

// Job name → cron expression (UTC), for jobs that run on a schedule. Each needs a handler above.
const schedules: Record<string, string> = {};

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

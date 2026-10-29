import "../worker/env"; // first: server/db builds its pool from DATABASE_URL when it loads
import { impact } from "../server/stats";

// Prints §6.2.1's impact counters as JSON, pulled live during the pitch (no dashboard screen).
// Like M0's internalQuery it is CLI only: there is no HTTP route for it.
//
// Usage: npm run impact [-- --exclude-samples]
// DATABASE_URL comes from the environment or .env / .env.local. Samples stay in by default,
// because the on-stage me-toos and reveal views land on seeded reports. Oct 30, with real
// Mableton posts: pass --exclude-samples.
async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--exclude-samples");
  if (unknown.length > 0) throw new Error(`usage: npm run impact [-- --exclude-samples] (got ${unknown.join(" ")})`);
  console.log(JSON.stringify(await impact({ excludeSamples: args.includes("--exclude-samples") }), null, 2));
}

main().then(
  // The database pool would keep the process alive.
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

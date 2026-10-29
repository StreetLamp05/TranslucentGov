import { loadEnvConfig } from "@next/env";

// Loads .env / .env.local the way Next.js does. worker/index.ts imports this first, because
// server modules read their env when imported (server/db/index.ts builds its pool then).
loadEnvConfig(process.cwd());

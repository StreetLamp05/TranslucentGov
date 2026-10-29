import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// DATABASE_URL comes from .env.local (scripts/worktree-setup.sh writes it), or from the
// environment inside docker compose.
loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});

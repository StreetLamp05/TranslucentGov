import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// The app and the worker share one Postgres (§1.1.1). The pool connects on first query, so
// importing this during `next build` needs no database. tests/server/setup.ts swaps in PGlite.
// Kept on globalThis so `next dev` hot reloads reuse it instead of opening a new pool each time.
const cached = globalThis as { govtokPool?: Pool };
const pool = (cached.govtokPool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

export const db = drizzle({ client: pool, schema, casing: "snake_case" });
export type Db = typeof db;

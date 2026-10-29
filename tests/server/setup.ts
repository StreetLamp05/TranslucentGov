import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { fakeS3Send, resetFakes } from "./fakes";

// Setup for tests/server/** (the "server" project in vitest.config.mts). Server code imports
// `db` from @/server/db; here that is PGlite, an in-process Postgres with the drizzle/
// migrations applied, so no Docker is needed (§1.1.1). MinIO and pg-boss are in-memory fakes
// (tests/server/fakes.ts). Every test starts with empty tables, an empty bucket and no jobs.

vi.mock("@/server/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle({ client: new PGlite(), schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  return { db };
});

vi.mock("@/server/jobs", async (importOriginal) => {
  const { fakeJobs } = await import("./fakes");
  return { ...(await importOriginal<typeof import("@/server/jobs")>()), ...fakeJobs };
});

vi.spyOn(S3Client.prototype, "send").mockImplementation(fakeS3Send);

const tables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => `"${getTableName(table as PgTable)}"`)
  .join(", ");

beforeEach(async () => {
  vi.stubEnv("S3_ENDPOINT", "http://minio:9000");
  vi.stubEnv("S3_PUBLIC_URL", "https://govtok.test");
  vi.stubEnv("S3_BUCKET", "govtok");
  vi.stubEnv("S3_ACCESS_KEY", "test-access");
  vi.stubEnv("S3_SECRET_KEY", "test-secret");
  resetFakes();
  const { db } = await import("@/server/db");
  await db.execute(sql.raw(`TRUNCATE ${tables} CASCADE`));
});

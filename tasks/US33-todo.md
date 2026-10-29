# US33 (#4): Run the app, Postgres and MinIO with docker compose

Spec §1.1.1 (M1 retcon). Parent F9 (#1). Wave 1 with US31; US34 builds on this.

## Plan
- [x] Deps: `drizzle-orm`, `pg`, `pg-boss`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`; dev `drizzle-kit`, `@electric-sql/pglite`, `@types/pg`. Scripts `db:generate`, `db:migrate`.
- [x] `server/db/schema.ts`: all 7 Convex tables (not `placeholder`), same fields and indexes. uuid ids, ms timestamps as `bigint` (mode number), storage ids as MinIO object keys (`text`), enums as `pgEnum`.
- [x] `drizzle.config.ts` + generated `drizzle/` migration. `server/db/index.ts`: node-postgres `db` from `DATABASE_URL`.
- [x] `server/storage.ts`: presigned PUT, presigned GET, delete (internal endpoint for calls, public endpoint for signing so phone URLs go through Caddy).
- [x] `server/jobs.ts`: `enqueue(name, payload, { delaySeconds })`, `schedule(name, cron)` on pg-boss. `worker/index.ts`: registers a name → handler map (empty).
- [x] Vitest: a `server` project (node env) for `tests/server/**`, `tests/server/setup.ts` mocks `@/server/db` with PGlite + migrations. Sample test + schema/enum sync test.
- [x] `Dockerfile` (app standalone + worker targets), `.dockerignore`, `next.config.ts` `output: "standalone"`.
- [x] `docker-compose.yml` (fixed project name `govtok` so worktrees share one stack): postgres (volume), minio (volume) + minio-init (bucket), migrate (one-shot), app, worker, caddy.
- [x] `Caddyfile`: `{$DOMAIN:localhost}`, `tls {$TLS:internal}`, `/<bucket>/*` → minio, rest → app.
- [x] `scripts/worktree-setup.sh`: per-worktree database + bucket in the shared stack, written to `.env.local`, migrations applied.
- [x] README setup section.
- [x] Verify: `npm test`, `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm run db:migrate` against compose Postgres, `docker compose up` + `curl -k https://localhost`, storage round-trip against MinIO, a pg-boss enqueue/work round-trip.

## Notes / calls made
- `.env.example` is denied to agents by `.claude/settings.json` (read rules on `.env.*`), so the new variables are documented in the README and have defaults in compose. The user pastes the block into `.env.example`.
- Convex keeps working until US40. `worktree-setup.sh` keeps its Convex step only while `convex/` exists, so it drops out automatically when US40 deletes the folder.
- `category` / `owner` are `pgEnum`s copied from `convex/lib/routing.ts`. A test keeps them in sync.
- MinIO's official images are gone from Docker Hub and quay (pull denied). Compose uses `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, a maintained community build of the same server (includes `mc`).
- The app image build needs `NEXT_PUBLIC_CONVEX_URL` until US40 (`ConvexClientProvider` throws at prerender without one), so compose defaults the build arg to the local Convex address.
- `createUploadUrl` signs the Content-Type: MinIO is served from the app's origin, so an unsigned type would let an upload store `text/html` and run as the app. Caddy also sends `nosniff` + `CSP: sandbox` on the bucket path.
- Download URLs are signed at the top of the hour (2h TTL), so a key's URL is stable for up to an hour and feed polling won't reload a playing video.
- Indexes Convex reads with `.unique()` are unique indexes here (Postgres check-then-insert isn't serialized). `reportId` FKs cascade on delete.

## Verification (2026-10-28)
- `npm test`: 69 files, 687 tests pass (incl. `tests/server/schema.test.ts`, `tests/server/storage.test.ts` on PGlite).
- `npx tsc --noEmit`, `npm run lint`, `npm run build` (standalone), `npm run check:bundle`: pass.
- `npx drizzle-kit generate`: "No schema changes" (migration matches schema).
- `docker compose up -d --wait`: all services healthy, `migrate` and `minio-init` exit 0, worker logs `worker: ready, no handlers yet`, 7 tables + `pgboss` schema in Postgres. `curl -k https://localhost/` → 200 (`<title>GovTok</title>`), `/post` and `/dev/camera` → 200, `http://localhost/` → 308 to HTTPS.
- Storage against real MinIO through Caddy (`https://localhost`): presigned PUT 200; PUT with a different Content-Type 403; presigned GET 200 with `video/mp4`, `nosniff`, `CSP: sandbox`, same bytes; delete, then GET 404; deleting a missing key is fine.
- pg-boss on compose Postgres: `enqueue` immediate ran in 2.2s, `delaySeconds: 3` ran at 4.2s; `schedule("…", "0 10 * * *")` is listed by `getSchedules`. (On this host Postgres fsync is slow at times, `IO:WalSync` waits up to ~8s, which made some runs lag; not a code issue.)
- `scripts/worktree-setup.sh` in this worktree: created `govtok_us33` + `govtok-us33`, wrote `.env.local`, migrated, then set up the local Convex deployment as before.

## Review fixes (round 1)
Review verdict: NEEDS_INPUT. All 7 ACs pass with proof; no blocking findings. Fixed without a decision:
- `server/storage.ts`: added `statObject(key)` (size + type, null if missing) and `readObject(key)` (bytes over the server endpoint, for the worker, which can't reach Caddy's public URL). Verified against real MinIO: stat `{ size: 300000, contentType: 'video/webm' }`, same bytes back, stat null after delete.
- `creationTime` defaults to `clock_timestamp()`, not `now()`, so rows in one transaction don't tie. `drizzle/0000_init.sql` regenerated (nothing merged yet); my local `govtok` and `govtok_us33` databases reset and re-migrated. Regression test in `tests/server/schema.test.ts`.
- `server/db/index.ts`, `server/jobs.ts`: the pool and pg-boss instance are cached on `globalThis`, so `next dev` hot reloads don't leak connections.
- `docker-compose.yml`: `S3_PUBLIC_URL` can be overridden (needed with a non-443 `HTTPS_PORT`); `pgsty/minio` pinned by digest; a comment warns that `down -v` from any worktree wipes the shared stack.
- `scripts/worktree-setup.sh`: the Convex step runs first, so Convex-track worktrees don't need Docker. Name capped at 40 characters (Postgres's 63 limit). `mc mb` retried 3×. Re-run verified.
- `tests/server/setup.ts`: `fileURLToPath` for the migrations path.
- `@next/env` declared in `package.json` (16.4.3, matching next).
- README: drops the "city IT team runs it" overclaim until US40, documents `S3_PUBLIC_URL`/`HTTPS_PORT` and the shared-stack `down -v` warning, and lists the storage and jobs functions.
- Re-verified: `npm test` 69 files / 688 tests, `tsc`, `lint`, `build`, `check:bundle`, drizzle "No schema changes", `docker compose up -d --build --wait` healthy, `https://localhost` 200.

## Decisions (user, 2026-10-28) and round 2
All four took the recommended option. `.env.example` is handled by David outside this card and is never committed (dispatcher, 2026-10-28).
1. **Uploads ownership table.** `uploads` (key PK, uploaderKind resident/fixer/admin, uploaderId, contentType, createdAt; indexes by uploader and createdAt). `createUploadUrl(contentType, uploader)` records the row. `isUploadedBy(key, uploader)` is what ports check before saving a key from a request. `deleteObject` also removes the row. Spec §1.1.1 and §8 updated.
2. **Scoped MinIO user.** `minio-init` creates `govtok-app` (`S3_ACCESS_KEY`/`S3_SECRET_KEY`) with a policy for get/put/delete/list on `<bucket>` and `<bucket>-*` only. App and worker use it, never root. Re-runnable (policy create, user add and attach all idempotent, checked twice). `worktree-setup.sh` runs `minio-init`, creates its bucket as root, and writes the app user to `.env.local`. README and US41 (#12) checklist: change every password before setting `DOMAIN`.
3. **Shared test fakes.** `tests/server/fakes.ts`: S3Client#send replaced by an in-memory bucket (`objects`, `putTestObject`), so storage.ts runs for real down to the network. `@/server/jobs` replaced by a recorder (`enqueuedJobs` with delay and inTransaction, `scheduledJobs`). Both reset before each test. Tests: `tests/server/storage.test.ts`, `tests/server/jobs.test.ts`.
4. **Transactional enqueue, no retries.** `enqueue(name, payload, { delaySeconds, tx })` sends through pg-boss's `fromDrizzle(tx, sql)`. `retryLimit: 0` on enqueue and schedule.

Verified:
- `npm test` 70 files / 694 tests; `tsc`, `lint`, `build`, `check:bundle` pass; drizzle "No schema changes" (8 tables). Migration regenerated as one `0000_init.sql`; local `govtok` and `govtok_us33` reset.
- Real Postgres: an enqueue in a committed transaction exists with `retryLimit=0`; one in a rolled-back transaction doesn't.
- Real MinIO as `govtok-app` through Caddy: PUT 200, stat/read fine, `isUploadedBy` true for the uploader and false for another resident, delete clears the object and its row. CreateBucket and ListObjects on a non-`govtok*` bucket → AccessDenied; the `govtok-us33` worktree bucket is allowed.
- `docker compose up -d --build --wait` healthy; app env `S3_ACCESS_KEY=govtok-app`; `https://localhost` 200; worker ready.
- `scripts/worktree-setup.sh` re-run: Convex first, then database, bucket and migrations.

## Review round 2: CLEAN. Review fixes
All 7 ACs and the 4 decisions verified against real Postgres, MinIO, pg-boss and Caddy; nothing blocking. Fixed without a decision:
- Worker SIGTERM: `Dockerfile` runs `node_modules/.bin/tsx worker/index.ts` directly (npm swallowed SIGTERM). `docker compose stop worker` now exits 0 in 0.24s (was exit 1, `npm error signal SIGTERM`).
- No "convex" left in `server/` or `worker/` comments (US40's grep AC covers them, and only US33 may edit `schema.ts`). `grep -rli convex server worker` → 0 files.
- `tests/server/fakes.ts`: GetObject on a missing key throws `NoSuchKey`, as MinIO does (HEAD keeps `NotFound`). Regression test in `storage.test.ts`.
- `createUploadUrl` docstring: the caller must allow only video/* and image/*. The signature only stops the browser swapping types.
- Spec §1.1.1 / §8 wording: the risk is closed once US35/US38/US39 save only keys `isUploadedBy` accepts; the policy covers `<bucket>-*`; "no longer holds". `schema.ts` no longer claims M0 recorded uploaders.
- README: URL-safe passwords (the Postgres one goes into `DATABASE_URL` unencoded), and `worktree-setup.sh` reads passwords from the shell, not `.env`.
- Re-verified: 70 files / 694 tests, tsc, lint, build, check:bundle, drizzle "No schema changes", `https://localhost` 200.

## Review section (final)
Verdict: CLEAN. Ready for a manual commit. Non-blocking follow-ups, for the sibling cards (not done here):
- Sibling card bodies should state the duties this card creates:
  - US36: jobs aren't retried, so a handler enqueues its own retry.
  - US35: `createUploadUrl(contentType, uploader)` returns `{key, url}`; allow only media types; call `isUploadedBy` before saving keys; `deleteObject` runs after commit.
  - US38 and US39: call `isUploadedBy`.
  - US40: `scripts/worktree-setup.sh`'s Convex block and the `NEXT_PUBLIC_CONVEX_URL` build arg (`Dockerfile`, `docker-compose.yml`) must go, and `tests/server/schema.test.ts` imports `@/convex/lib/routing` (US34 moves it).
- Screening concurrency: `work()` runs one job at a time (pg-boss default). Three simultaneous posts → the third waits about a minute. Exposing a concurrency option in `server/jobs.ts` is a US33-file change.
- Upload size is unbounded (a presigned PUT has no limit), and orphaned uploads (URL issued, never saved) aren't purged by any card yet.
- No automated test exercises the real pg-boss `enqueue({ tx })`; it was verified by hand on compose Postgres.
- The shared stack's Caddy bind-mounts `./Caddyfile` from whichever worktree last ran `up`.
- The `<bucket>-*` grant would cover a future `govtok-backup` bucket (US41's backup step).
- Pre-existing spec gaps: US41 says SAN_FRANCISCO while the spec says Mableton; release/rescreen and fixer revocation still need Convex tooling; §4.1.1 cites Convex storage limits.

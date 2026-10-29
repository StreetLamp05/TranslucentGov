# US39: Seed demo data, run video intake and purge nightly on Postgres

Issue #10, Spec §6.1, §7.1.1. Parent F9. Branch `US39-seed-demo-data-run-video-intake-and-purge-nightly-on-postgres`.
Dispatcher ("Cp command") supervises: it commits, opens the PR and merges. Questions and the final report go to it by SendMessage.

## Scope handed over by the dispatcher
1. Seed fixers on Postgres: wire `seedFixers` into the admin seed flow, update the README runbook line.
2. Port operator tools `rescreen` and `release` (convex/screeningDb.ts) to admin routes.
3. Scope `scripts/check-client-bundle.sh` to client output; update its test.
Constraints: no schema/migration changes; don't edit `server/http.ts`, `lib/data/*`, `server/jobs.ts`, `server/storage.ts`; never touch `.env.example`; no commits.

## Design
- Admin auth: `POST /api/admin/login {passcode}` → session token (30 min, `video_intake_admin_sessions`); every other admin route calls `caller.requireAdmin()`. The seed page moves from raw-passcode-per-call to the same session.
- `server/admin.ts`: login, admin upload URL, rescreen, release.
- `server/videoIntake.ts`: saveUpload (size/type checked against MinIO), get, listRecent. Job `transcribeVideo` (Gemini, via `server/lib/transcribe.ts`).
- `server/seed.ts`: listFixers, listSamples, seedSamples (checks first, one transaction, re-run safe: a sample whose files are already a sample report is returned, not duplicated), seedFixers from a body. Jobs in `server/jobs/seedFix.ts` (`attachSeedFix`, `backdateSeedFix`) replace Convex's self-rescheduling mutations.
- `server/purge.ts` + job `purgeExpired` (cron `0 10 * * *`): held non-sample reports (age from the newest upload) and unverified fix attempts older than 7 days with their MinIO objects, intake rows older than 7 days, expired admin sessions.
- Worker map + schedule in `worker/index.ts`.
- Pages `app/admin/seed`, `app/admin/video-intake` ported off Convex, plus Fixers form and Rescreen/Release buttons.

## Checklist
- [x] server/admin.ts, server/videoIntake.ts, server/seed.ts, server/purge.ts
- [x] jobs: transcribeVideo, purgeExpired, seedFix; worker map + schedule
- [x] routes under app/api/admin/
- [x] pages + lib/adminUpload.ts + useAdminSession
- [x] scripts/check-client-bundle.sh + test
- [x] README runbook
- [x] tests: seed, purge, videoIntake, admin (operator), worker
- [x] npm test, npm run build, npm run lint, npx tsc --noEmit
- [x] review-card, fixes, report to dispatcher (sent)

## Review fixes
- `saveUpload` no longer deletes a rejected upload's object when a report, fix attempt or intake entry already holds the key, and takes the key's lock so two saves of one key can't both insert. Seed refuses a key an intake entry holds (`assertNotIntake`). Tests added in `tests/server/videoIntake.test.ts`.
- Seed dates must be whole milliseconds: a fractional or absurd `createdAt` / `lastActivityAt` / `fixedAt` is a 400, not a bigint 500. Tests added in `tests/server/seed.test.ts`.
- Video-intake sign-in clears the old record id, so an entry from an expired session doesn't reappear.

## Review
Single reviewer, no blockers. Verified: `npm test` (1193), `npm run build`, `npm run lint`, `npx tsc --noEmit`, `scripts/check-client-bundle.sh` against the real build (ADMIN_PASSCODE appears in server chunks only).
Left for decision: session expiry (30 min) discards an in-progress seed batch; a failed transcription has no retry (Convex had none either); spec §6.1.1/§7.1.1/§8 still describe the raw-passcode seed and Convex cron; orphaned presigned uploads are never purged (pre-existing).

## Dispatcher follow-up: sliding admin session
`requireAdminSession` (server/auth.ts) extends the session to now + 30 min on every successful call, so only 30 idle minutes logs out. server/http.ts untouched. The pages no longer run a fixed client timer: a 401 from any admin action signs the page out (`useAdminSession().handleError`). Tests in tests/server/admin.test.ts ("the session slides").

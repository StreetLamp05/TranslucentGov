# US38 — Log in as a fixer and submit proof of fix on Postgres (#9)

Spec §4.3 (proof of fix, neighbors), §5.3 (fixer screen). Parent F9. Ports `convex/fixers.ts` + `fixes.ts`.
Depends on US34 (merged). US36 owns the `verifyFix` handler; this card only enqueues it.

## Design
- `server/fixers.ts`: `seedFixers`, `fixerLogin` (atomic token issue, reuses an existing token), `fixerSession`, `openReportsForFixer`, `fixerReport`.
- `server/fixes.ts`: `resolveBy` (fixer or resident, from the `as` field), `createProofUploadUrl`, `submitFix`, `myFixAttempt`.
  - `submitFix` checks, in M0's order: report open, city-only for residents, valid lat/lng, 50 m geofence, 1-6 frames, every key was uploaded by the caller (`isUploadedBy`), type/size via `statObject`.
  - The `fixAttempts` insert and `enqueue("verifyFix", { fixAttemptId }, { tx })` share one transaction.
- Routes (all `route()`, ids through `parseId`, reads through `searchArgs`):
  - `POST /api/fixers/login`, `GET /api/fixers/{session,open-reports,report}`
  - `POST /api/fixes` (submit), `POST /api/fixes/upload-url`, `GET /api/fixes/attempt`
  - Neighbors ("Is it fixed?", §4.3.2) use the same `/api/fixes/*` routes with `as: "resident"`.
- Client: `app/fix/*` and `components/fix/*` move to `query`/`mutate`/`useLive`. `components/fix/uploadProof.ts` is the upload helper (presigned PUT), kept out of `lib/` so it can't collide with US35.
- Convex `fixers.ts`/`fixes.ts` and their tests stay until US40.

## Steps
- [x] server/fixers.ts, server/fixes.ts
- [x] route handlers
- [x] app/fix pages, FixerList, FixCapture, uploadProof
- [x] tests/server/{fixers,fixes}.test.ts (PGlite); update FixCapture/FixerList component tests
- [x] Verify: npm test, build, lint, tsc
- [ ] Review (review-card), fixes, report to dispatcher

## Verification (before review)
- `npm test` 845/845 (new: tests/server/{fixers,fixes}.test.ts on PGlite, components/fix/uploadProof). `npm run lint`, `tsc` (root and `-p convex`), `npm run build` and `check:bundle` clean. All seven routes show in the build output.
- No Convex or compose run: no schema or function push was made.

## Review (one round, review-card)
- All five ACs substantiated; no blocking findings, so there were no Review fixes. Reviewer ran `vitest` on server/fixers, server/fixes and components/fix: 72/72.
- Open, non-blocking (Decide, for the dispatcher):
  - **D1: nothing seeds fixers on Postgres.** `seedFixers` exists and is tested, but no route/script calls it. M0 used `npx convex run fixers:seed` (README:233). The manual test needs a fixer row. Candidates: a `scripts/seed-fixers.ts`, or a US39 admin route.
  - **D2: `/confirm/[reportId]` still reads the report from Convex** while FixCapture now calls the Postgres routes. Mixed stack fails (Convex ids fail `parseId`). Needs US37/US40 to port the page.
  - D3: the "polls" test checks the wiring (key, 2 s interval, route and args); the polling itself is US34's `useLive` and is tested there.
  - D4: the PGlite "login at once" test can't show real concurrency; the SQL (`coalesce` in one UPDATE) is atomic on Postgres.
  - D5: the report-open check in `submitFix` is outside the transaction, so a fixer and a neighbor can both insert an attempt. Same as M0's no-dedupe; `verifyFix` (US36) marks the later one `superseded`.

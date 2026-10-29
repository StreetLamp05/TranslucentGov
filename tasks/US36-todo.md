# US36: Run Gemini screening and fix verification as worker jobs (#7)

Spec §4.2, §4.3. Parent F9 (#1). Dispatcher rules: no commit, no schema changes, don't touch
`.env.example`, `server/{http,jobs,storage}.ts`, `lib/data/*`. Contracts: `screenReport {reportId}`,
`verifyFix {fixAttemptId}`. pg-boss has `retryLimit: 0`, so retries re-enqueue with `delaySeconds`.

## Plan
- [ ] Port `convex/lib/{gemini,screenPrompt,fixPrompt,transcribe}.ts` → `server/lib/` (convex copies stay until US40)
- [ ] `server/jobs/screenReport.ts`: load (pending only), read MinIO via `readObject`/`statObject`, geocode, transcribe, screen, apply verdict in a tx guarded on status + same media
- [ ] `server/jobs/verifyFix.ts`: claim/supersede, check, apply (fix fields + fixedByOrg), failed
- [ ] Retry: rate-limited/other → one re-enqueue with `delaySeconds` (retryAfterMs or 1 s, ceil'd); refusal → held at once; second failure → held "screening failed" / attempt `failed`
- [ ] Register both in `worker/index.ts`
- [ ] Tests (PGlite, Gemini mocked) under `tests/server/`
- [ ] Verify: npm test, build, lint, tsc

## Progress
- [x] All plan items done. Server tests 61 for the two jobs (PGlite, Gemini mocked); lib tests ported to tests/server/lib/.
- [x] Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (936 pass), `npm run build` all pass.
- Choice (revised on the dispatcher's call): every error, refusals and 429s included, retries once with `delaySeconds = ceil(retryAfterMs/1000)` (default 1 s), then holds / marks failed, as convex/screening.ts did. "Refusals hold" in the AC means after the retry. (First version held a refusal at once; reverted.)
- Not ported: operator `rescreen`/`release` (convex/screeningDb.ts), not in this card's files. Needed before US40 deletes Convex.

## Review (one round) — RUN-CARD-VERDICT: CLEAN
Review fixes:
- Frame/photo blobs lost their stored content type (a PNG/WebP went to Gemini as image/jpeg). Both jobs now `statObject` each frame and pass its type; a test per job.
Left as is: catch-path `enqueue`/`markFailed` can throw and strand a report in pending (same as Convex); `verifyFix.claim` lock order attempt→report (no conflicting code today).
Decided by the dispatcher: refusals retry once (matches Convex and spec); `rescreen`/`release` go to US39.

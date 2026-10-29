# US34 — Shared server layer and live-polling hook (#5)

Spec §1.1.1 (route handlers, `useLive`, polling ~2s / ~10s), §3.1 (device token, fixer token, admin session).
Parent F9. Unblocks US35–US39 (each ports a slice of `convex/` onto these pieces).

## Design
- **Client**
  - `lib/data/api.ts`: `query(path, args)` (GET, args as search params) and `mutate(path, body)` (POST JSON).
  - Every call carries the caller's identity as headers, from the same places the Convex calls read it today:
    - `X-Resident-Token`: `getResidentToken()`
    - `X-Fixer-Token`: `getFixerToken()`, when logged in
    - `X-Admin-Session`: from `setAdminSession()`, since the intake page holds its session in memory
  - Server errors come back as `ApiError`. Its `data` holds the user-facing message the way `ConvexError.data` does, so the `err instanceof X && typeof err.data === "string"` call sites port one-for-one.
  - `subscribeToMutations` lets `useLive` refetch after any `mutate()`.
- `lib/data/useLive.ts`: `useLive(key | null, fetcher, { intervalMs })`.
  - Returns `undefined` while loading or skipped (`null` key = Convex `"skip"`).
  - Polls every `intervalMs` while the tab is visible, and refetches on focus or return to visible, and after any `mutate()`.
  - Latest request wins. An unchanged JSON payload keeps the old reference, so screens don't re-render each poll.
  - A failed poll keeps the last value and retries on the next tick, because HTTP polling is flakier than a websocket.
  - `LIVE_STATUS_MS = 2000` and `LIVE_LIST_MS = 10000` come from §1.1.1.
- **Server**
  - `server/http.ts`: `route(handler)` wraps a Next route handler.
    - `ctx.caller` resolves identity lazily, the same way `convex/lib/auth.ts` does: `findResident` for reads, `resident()` = getOrCreate for writes, `fixer()` = requireFixer, `requireAdmin()` = the admin session.
    - The return value is JSON-serialized (`undefined` → `null`).
    - A `UserError` becomes `{ error }` with its status. Anything else becomes a 500 `"Server Error"` and is logged (like Convex hiding non-ConvexErrors).
    - `readJson(req)` throws a 400 on a bad body.
  - `server/auth.ts`: the Postgres versions of `getOrCreateResident` / `findResident` / `requireFixer` / `requireAdminSession`, with the same messages.
  - `server/reportMedia.ts`: the Postgres `ReportMedia` (presigned GET URLs plus a fixer org lookup), so US35/US37/US38 don't each write it.
- **Moved modules (`server/lib/`)**
  - Pure modules move whole: `city`, `geo`, `postLimits`, `clipLimit`, `fixRules`, `screening`, `videoIntakeValidation`. All importers are re-pointed and the convex/lib copies are deleted.
  - The four that bind to Convex are split. The pure core moves, and a thin Convex adapter stays in `convex/lib`:
    - `routing`: the tables move, and the `v` validators go to `convex/schema.ts`.
    - `publicReport`: the projection is generic over a `ReportMedia` source and the report doc type. `convex/lib/publicReport.ts` binds it to `QueryCtx` and keeps the `Id`-typed `PublicReport` / `OwnerReport` for unported components. `reportDoc(row)` maps a Drizzle row to the same `_id` / undefined shape the client already reads.
    - `postMedia`: the checks take a `stat(key)` callback and throw `UserError`. The Convex adapter rethrows them as `ConvexError`.
    - `auth`: the pure part (`cleanToken`, `sameSecret`, `isAdminPasscode`, messages) moves. The ctx lookups stay in convex, and the Postgres lookups are in `server/auth.ts`.
  - `server/lib/errors.ts`: `UserError` (message is safe to show; has an HTTP status).
- Overlaps: `convex/lib/transcribe.ts` gets only its clipLimit import line changed (US32 rewrites it). `screenPrompt` / `fixPrompt` / `gemini` stay, with only their import lines changed.

## Steps
- [x] server/lib: errors, city, geo, postLimits, clipLimit, fixRules, screening, videoIntakeValidation, routing, publicReport, postMedia, auth
- [x] convex adapters (routing validators → schema, publicReport, postMedia, auth) and re-point all imports (convex, app, components, lib, tests, scripts)
- [x] Move pure-module tests to tests/server/lib/ (mirror source paths)
- [x] convex/_generated/api.d.ts entries for removed lib modules (hand edit; codegen needs a deployment)
- [x] lib/data/api.ts, lib/data/useLive.ts
- [x] server/auth.ts, server/http.ts, server/reportMedia.ts
- [x] Tests: tests/lib/data/{api,useLive}.test.ts, tests/server/http.test.ts (auth resolution + error mapping), tests/server/lib/publicReport.test.ts (reportDoc)
- [x] Verify: npm test, build, lint, tsc (root + convex), check:bundle, esbuild-bundle every convex function file
- [x] Snapshot message to dispatcher, then review


## Verification (before review)
- `npm test`: 761/761. `npm run lint`: clean. `tsc` (root and `-p convex`): clean. `next build`: OK. `check:bundle`: clean.
- A temporary `app/api/us34-probe` route, static and `[id]`, built and passed Next 16's route-handler type check. It was then deleted.
- That probe showed every route importing `server/http.ts` would carry the ADMIN_PASSCODE name into `.next`, so `isAdminPasscode` moved to `server/lib/adminPasscode.ts`.
- esbuild bundled all 25 `convex/*.ts` function files, and none pulled in drizzle, pg or S3.
- No Convex push: this worktree has no confirmed local deployment. `_generated/api.d.ts` was hand-edited to drop the moved modules; the reviewer matched it against the files in `convex/`.
- The snapshot was committed by the dispatcher as 14f8145.

## Review fixes (one round, review-card v0.2)
- **F1, blocking.** `useLive` aborted its in-flight request on every tick, so a response slower than `intervalMs` never landed. A status screen on a link slower than 2s spun forever.
  - Ticks, focus and visibility now skip while a request is out. Only `mutate()` and key changes supersede one.
  - Regression test: 3s round trips at 2s polling. It fails on 14f8145 and passes now.
  - This also fixes focus and visibilitychange double-firing.
- **F3.** The privacy allowlist in `server/lib/publicReport.ts` is checked at compile time again (`satisfies ProjectedReport<ReportDoc>`). Adding `residentId` now fails tsc; confirmed by trying it. The Postgres test checks every private field.
- **F4.** Stale `convex/lib/city.ts` / `clipLimit.ts` / routing-test paths fixed in README, `presets.ts`, `ReportsMap.tsx`, `lib/demo.ts` and `postLimits.ts`.
- **F6.**
  - `route()` calls `unstable_rethrow`, so Next's `redirect()` / `notFound()` aren't turned into 500s. Test added.
  - `Caller.fixer()` documents that the row holds the passcode and token.
- **S2.** Comments in the new `server/` and `lib/data/` files say "M0" instead of naming Convex, so US40's `grep -ri convex lib server` has less to clean up.
- Re-verified: `npm test` 763/763, lint, tsc (root and convex), build, check:bundle.

## Review (2026-10-28)
- All six ACs were verified by the reviewer with proof. F1 was fixed after the review.
- Open, not blocking: the items under "Decide" in the final report to the dispatcher. These are F2 input parsing and bad UUIDs, the spec doc's old paths, F5 bundle-check scope, and S1 merge overlap with US32.
- **F2 (dispatcher decision: add now).** These are additive in `server/http.ts`: `isUuid(value)`, `parseId(value)` (string | null), and `searchArgs(req)` with `.string` / `.optionalString` / `.int` / `.list`. A missing or malformed required value is a 400 UserError.
  - Tests cover a junk id staying null instead of reaching Postgres (which itself rejects it), and round-tripping through the client's `withArgs`.
  - `npm test` 767/767, tsc (root and convex), lint.

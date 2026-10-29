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
- [ ] Verify: npm test, build, lint, tsc (root + convex), check:bundle, esbuild-bundle every convex function file
- [ ] Snapshot message to dispatcher, then review

## Progress (paused 2026-10-28: usage limit)
- Done: all code and tests above. `lib/data/headers.ts` holds the shared header names.
- Checked: tsc (root and convex) is clean. The new and moved tests pass (9 files, 87 tests).
- Left:
  - Run the full `npm test`, `npm run build`, `npm run lint` and `check:bundle`.
  - esbuild-bundle the convex function files.
  - Send the "US34 IMPLEMENTED" snapshot to the dispatcher (translucentgov-e5).
  - Run the review-card round.
- Note for review: `check-client-bundle.sh` scans all of `.next/`. Once US39 adds admin routes that import `server/lib/auth` (`isAdminPasscode`), it will flag the ADMIN_PASSCODE name.

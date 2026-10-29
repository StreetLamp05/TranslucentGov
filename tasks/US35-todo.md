# US35 — Post a report and tap Me too on Postgres (#6)

Spec §4.1 (posting, duplicate check), §4.2.1 (retake / try again), §1.1.1 (route handlers, MinIO presigned PUT, polling).
Parent F9. Builds on US34 (`route()`, `useLive`, `query`/`mutate`) and US33 (schema, `server/storage.ts`, `server/jobs.ts`).
Dispatcher rules: no commits, no edits to `server/{http,auth,jobs,storage}.ts`, `lib/data/*`, `server/db/schema.ts`; `parseId` on every id from a URL/body; `enqueue("screenReport", { reportId }, { tx })` in the same transaction as the write; `isUploadedBy` before saving a key; delete replaced objects after commit.

## Design
- **Server modules** (`server/`): plain functions taking resolved ids, so tests call them directly and routes stay thin.
  - `posts.ts`: `createReport(residentId, input)`, `myReport(residentId | null, reportId)`.
  - `files.ts`: `generateUploadUrl(caller, { contentType, as })` — only `video/*` and `image/*`; `as: "fixer"` requires a fixer token.
  - `nearby.ts`: `nearbyOpen(residentId | null, lat, lng)`.
  - `meToos.ts`: `meToo(residentId, reportId)`; transaction with row lock.
  - `retake.ts`: `retakeReport`, `retryScreening`; both enqueue `screenReport` in the transaction; old objects deleted after commit.
  - `relation.ts`: `myRelation(residentId | null, reportIds)`.
- **Routes** (`app/api/`): `posts` (POST create), `posts/mine` (GET), `files` (POST), `nearby` (GET), `me-too` (POST), `retake` (POST), `retake/retry` (POST), `relation` (GET). Identity comes from headers, so `token` / `fixerToken` args disappear; everything else keeps its M0 name and shape. Storage IDs are MinIO keys.
- **Client**: `lib/upload.ts` gains `uploadMedia` (route → browser PUT with the signed Content-Type). The Convex-era `uploadFile` stays unchanged so `FixCapture` and other unported callers compile; US40 deletes it (dispatcher call). `PostFlow` / `NearbyCheck` / `CheckingScreen` swap `useMutation`/`useQuery` for `mutate`/`useLive` (`LIVE_STATUS_MS` for the Checking… poll). `ApiError.data` replaces `ConvexError.data`.
- **Confirm page** (`app/confirm/[reportId]/page.tsx`) is listed as owned here, but it reads `feed.reportById` (US37) and renders `FixCapture` (US38). See Open questions.

## Steps
- [x] server/{posts,files,nearby,meToos,retake,relation}.ts
- [x] app/api route handlers
- [x] lib/upload.ts
- [x] components/post/{PostFlow,NearbyCheck,CheckingScreen}.tsx
- [x] Server tests on PGlite: tests/server/{posts,nearby,meToos,retake,relation,files}.test.ts
- [x] Component + upload tests against `useLive` / `mutate`
- [x] Verify: npm test, build, lint, tsc

## Decisions
- `app/confirm/[reportId]/page.tsx` left untouched (dispatcher agreed): it only reads US37's `feed.reportById` and renders US38's `FixCapture`.
- `tests/components/me/MeReportCard.test.tsx` got the minimal mock changes (two tests), because the Me page renders the exported `Retake` / `ScreeningFailed` now backed by the route handlers. US37 may touch the same lines.
- The Convex functions and `tests/convex/{posts,nearby,meToos,retake,relation}.test.ts` stay for unported callers; US40 removes them.

## Verification
- `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` 863/863; `npm run build` OK (8 new /api routes); `check:bundle` ok.

## Review fixes (one round, review-card)
- **F1, medium.** A JSON body of `null` (or a number, string or array) made five POST routes 500 with a TypeError. Added `server/body.ts` `readBody` (400 "The request body must be a JSON object.") and use it in `posts`, `files`, `me-too`, `retake`, `retake/retry`; test in `tests/server/meToos.test.ts`.
- **F2, nit.** `validLocation` moved from `server/posts.ts` to `server/lib/location.ts`, so `server/nearby.ts` no longer pulls jobs and storage through `posts`.

## Left for the user (Decide, non-blocking)
- `uploadMedia` rejects a file with an empty `blob.type` ("no type"), where M0's `uploadFile` sent it untyped. A signed PUT needs a type; choose a fallback by media kind, or keep the error.
- `/api/nearby` failing leaves PostFlow on "Checking for nearby reports…" forever (`useLive` swallows errors; M0's `useQuery` threw). Add a timeout or skip-to-camera?
- Concurrency tests run on single-connection PGlite, so they don't prove the row locks; no test for an `enqueue` failure rolling the write back.
- `image/svg+xml` is signed (matches the `image/*` allowlist; Caddy CSP sandbox is the guard).

## Dispatcher follow-up: shared keys (closed)
- `assertKeysUnused` (server/posts.ts) runs inside the saving transaction on create and retake. It takes a per-key advisory lock, then refuses (400) any key another report (clip, frames, fix) or fix attempt already references. No schema change. Tests: second post on the same clip/frame/photo, two racing posts, retake onto another report's frame.
- GOVTOK_DECISIONS.md §8 line 101 now says both checks together close the risk.
- Dispatcher-confirmed notes, left as is: untyped-file upload error, nearby failure hang, lock tests on single-connection PGlite.

RUN-CARD-VERDICT: CLEAN
- /confirm ported to GET /api/feed/[id] via useLive (tests/app/confirm/page.test.tsx); MeReportCard's CheckingReport cast dropped. main merged (uncommitted).

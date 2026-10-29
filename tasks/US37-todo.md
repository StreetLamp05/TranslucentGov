# US37 — Browse the feed, map and Me page from Postgres (#8)

Spec §5.1 (feed, order snapshot), §5.2 (map), §5.4 (Me page), §6.2 (reveal views, impact counters).
Parent F9. Builds on US34's `route()`, `useLive`, `reportMedia`, `publicReport`/`reportDoc`, `parseId`, `searchArgs`.

## Design
- **Server** (`server/`): plain async functions over Drizzle, one per ported Convex query, all with the old return shapes.
  - `feed.ts`: `feed()` (open + fixed, `lastActivityAt` desc then newest row, 50), `reportById(id | null)`.
  - `map.ts`: `mapReports()` selects only the marker columns; `toMapReport` still throws on a non-public row.
  - `me.ts`: `myReports(residentId | null)`, `myMeToos(residentId | null)`. The device identity comes from `caller.findResident()`, so a read never creates a resident.
  - `reveal.ts`: `recordRevealView(id | null)` is one `UPDATE … SET reveal_views = reveal_views + 1 WHERE status = 'fixed'`, so concurrent views don't lose counts.
  - `stats.ts`: `impact({ excludeSamples, now })`, same arithmetic as `convex/stats.ts`.
  - Every report leaves through `publicReport` / `ownerReport` / `publicReportOrNull` with `reportMedia` (presigned MinIO GETs).
- **Routes** (`app/api/`): `GET /api/feed`, `GET /api/feed/[id]` (`parseId`: junk → `null`), `GET /api/map`, `GET /api/me/reports`, `GET /api/me/me-toos`, `POST /api/reveal`.
  - Stats stay CLI only, as M0's `internalQuery` was (dispatcher decision): `npm run impact [-- --exclude-samples]` runs `scripts/impact-stats.ts` against `DATABASE_URL`. No HTTP route.
- **Client**
  - `Feed`, `MapScreen`, `MePage` read through `useLive` (`LIVE_LIST_MS`, ~10 s). `useRecordRevealView` posts to `/api/reveal` via `mutate`.
  - `CardRail` polls `GET /api/relation` and posts `POST /api/me-too` (US35's routes; contract below). The Convex optimistic update becomes a local "tapped" count, replaced by the refetch.
  - Feed order stays snapshotted (§5.1.2). A report approved after the feed opened is appended at the end, so nothing moves under the finger; reopening the feed re-sorts.
  - Shared card components (`FeedCard`, `CardOverlay`, `MeReportCard`, `lib/captions`, map files) now take their types from `server/lib/publicReport` / `server/map` (`_id` is a plain string). Type-import lines only.
- **Contract with US35** (not in this card): `GET /api/relation?reportIds=<id>&…` → `{ mine: string[], meTooed: string[] }`; `POST /api/me-too` `{ reportId }`.

## Steps
- [x] server/{feed,map,me,reveal,stats}.ts
- [x] app/api routes
- [x] Port tests to PGlite: tests/server/{feed,map,me,reveal,stats}.test.ts, tests/server/api.test.ts (route glue), shared fixtures in tests/server/reports.ts
- [x] Components onto useLive / mutate; types onto server/lib
- [x] Component tests against useLive (Feed, MapScreen (+ live poll test), MePage, CardRail, CardReveal)
- [x] Verify: npm test, build, lint, tsc (root and convex)

## Verification (before review)
- `npm test`: 846/846 (87 files). `npm run lint`: clean. `tsc` root and `-p convex`: clean. `npm run build`: OK, six `/api` routes listed.
- `check:bundle`: see the final run below.
- Not done: the manual compose-stack test (approve a report in one tab, watch it appear in another). The `MapScreen.live` test covers the poll with fake timers.
- Convex originals (`convex/{feed,map,me,reveal,stats}.ts`, `tests/convex/*`) are left for US40, which avoids editing `convex/_generated/api.d.ts` in parallel with the sibling cards.

## Review fixes (one round, review-card)
- `POST /api/reveal` returned a 500 for a JSON body of `null` or a number (destructured it). It now reads `body?.reportId`; test covers `null` and `7`.

## Review (2026-10-29)
- All ACs verified by the reviewer except the full gate, which I ran (see Verification).
- Dispatcher decisions: US37 merges before US35 (CardRail shows no Me too until US35's `/api/relation` and `/api/me-too` land); stats moved from an HTTP route to the `npm run impact` CLI, which removes the `ADMIN_PASSCODE` bundle leak. Accepted: CardRail's optimistic +1 persists if the server answers `added: false`.

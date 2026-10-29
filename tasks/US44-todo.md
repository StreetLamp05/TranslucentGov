# US44: Serve the triage dashboard from Postgres (issue #16)

Spec §5.5.1, §5.5.2, §1.1.1. Builds on US42/US43 (Convex, kept until US40) and US37's pattern.

- [x] Move `convex/lib/triageGroups.ts` → `server/lib/triageGroups.ts` (only the `Id<"reports">` type became `string`); re-point convex/triage*.ts, components/gov, tests; move its test to tests/server/lib/
- [x] `server/triage.ts`: `triageGroups()` and `triageQueueFor(slug)`: open/fixed only, narrow column select, presigned MinIO thumbnails for this group's rows only
- [x] Route handlers `app/api/triage/overview` and `app/api/triage/[slug]`
- [x] `/gov` and `/gov/[slug]` use `useLive` (LIVE_LIST_MS, 10 s)
- [x] PGlite tests (pending/held exclusion, derived group ignoring stale `agency`, no private fields, unknown slug, Routing unclear, null thumbnail), route test, page polling test
- [x] Verify: `npm test` (107 files / 1105+ tests), `npm run build`, `npm run lint`, `npx tsc --noEmit` all pass
- [x] Review (review-card): no blocking findings

## Review fixes
- Queue query had no ORDER BY, so a full me-too/createdAt tie came out in arbitrary order: now `ORDER BY creationTime DESC` (feed's tiebreak)
- Renamed the misleading `thumbnailKey` alias to `frameKeys`; added a fixed-rows ordering test against PGlite

Manual test (human, compose stack) left open: approve a report in another tab; it should appear in `/gov/<slug>` within ~10 s.

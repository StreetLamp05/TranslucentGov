# US43: Work an agency's queue at /gov/<slug> (#15)

Spec: §5.5.2 (queue), §2.1.4 (group key), §3.1.3 (public fields only). Parent F10 (#13). Stacked on `dashboard` (US42 not merged to main yet; user call).

## Plan
- [x] `convex/lib/triageGroups.ts` (US42) additions, pure:
  - `agencyForSlug(routing, slug)`: the group for a slug, or null
  - `QueueRow` type: the allowlisted row fields
  - `triageQueue(routing, slug, rows)`: null for an unknown slug; otherwise the group's rows split into open (by `1 + meTooCount` desc, older `createdAt` first on a tie) and fixed (by `fixedAt` desc)
- [x] `convex/triageGroup.ts`: `queue({slug})` reads `open` + `fixed` through `by_status_createdAt`, keeps the group's rows, projects them (thumbnail = first frame's URL) and calls `triageQueue`
- [x] `components/gov/AgencyQueue.tsx` + `app/gov/[slug]/page.tsx`: Open and Recently fixed sections; rows show thumbnail, title, street, `statusText` (the feed's wording), me-too count, Sample badge; tap → `/?report=<id>`; unknown slug → "No such group" + link to `/gov`
- [x] Tests: `tests/convex/lib/triageGroups.test.ts` (additions), `tests/convex/triageGroup.test.ts`, `tests/components/gov/AgencyQueue.test.tsx`
- [x] Verify under Node 24: vitest, tsc, eslint, next build

## Verification (2026-10-28, Node 24 via `npx node@24`)
- New and touched tests: 23/23 pass (`triageGroups` + `triageGroup` + `triage` + `AgencyList` + `AgencyQueue`).
- Full `vitest run`: 691 passed, 10 failed. Same 10 Windows bash-script tests (`tests/vercel.test.ts`, `tests/scripts/check-client-bundle.test.ts`) that failed before US42.
- `tsc --noEmit`, `eslint .`: clean. `next build`: compiles; `/gov/[slug]` is dynamic.
- `convex/_generated/api.d.ts`: `triageGroup` added by hand. Regenerate with `npx convex codegen` to confirm.

## Review (2026-10-28): verdict CLEAN, all 5 ACs verified with proof
Review fixes (no decision needed; re-verified: 24/24 dashboard tests, tsc, eslint, build):
- `convex/triageGroup.ts` throws on a non-public status, like `toMapReport`, so a held report can't leak if the status filter is ever dropped
- The leak test now includes an unmuted report with a transcript (the case where `publicReport` would show it)
- `other` → "Routing unclear" is tested through the query, and the always-false conditional in the order assertion is gone
- `triageGroups.ts` comment corrected: it imports only the `Id` type; US44 swaps that type

Decide (left for the user, non-blocking):
- A fresh live post sorts to the bottom of its agency's Open list (0 me-toos, newest = last on a tie, per §5.5.2), which may push it off-screen during the ~8 s §6.1.2 beat. Options: break ties newest-first, highlight a just-arrived report, keep the list short before the demo, or rehearse the scroll (US45).
- Spec tidy-ups: Session state still says "US44 #16 closed"; §5.5.2 says rows follow §5.3.1, but the card uses the feed's wording and no per-row chip; §5.3.1 / §6.1.1 have stale "Claude" / "stay Mableton" lines.
- Before committing: `npx convex codegen` to confirm the hand-added `triageGroup` entry in `api.d.ts`.

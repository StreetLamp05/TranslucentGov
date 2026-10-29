# US42: See every agency's open and fixed counts at /gov (#14)

Spec: §2.1.4 (group key), §3.1.3 (access), §5.5.1 (shape). Parent F10 (#13).

## Plan
- [x] `convex/lib/triageGroups.ts`: pure helpers that take the routing table as an argument, so both city profiles are testable
  - `agencySlug(agency)`: lowercase, `&` → "and", other non-alphanumerics → `-`
  - `agencyGroups(routing)`: distinct agencies in table order, each with its owner and categories
  - `groupFor(routing, category)`: `routing[category].agency`; a missing category falls back to `other`
  - `triageOverview(routing, rows)`: every agency with open/fixed counts, sorted by open desc, "Routing unclear" (`routing.other.agency`) last
- [x] `convex/triage.ts`: `overview` query reads `open` + `fixed` through `by_status_createdAt` and returns only agency, owner, slug and counts
- [x] `components/gov/AgencyList.tsx` + `app/gov/page.tsx`: public, outside `app/(tabs)` (no tab bar), live via `useQuery`; rows link to `/gov/<slug>`
- [x] Tests: `tests/convex/lib/triageGroups.test.ts`, `tests/convex/triage.test.ts`, `tests/components/gov/AgencyList.test.tsx`
- [x] Verify: `npm test`, `npm run build`, `npm run lint`, `npx tsc --noEmit`

## Verification (2026-10-28, under Node 24 via `npx node@24`; local Node is 22.13, below the repo's engine)
- `vitest run`: 681 passed, 10 failed. The 10 are `tests/vercel.test.ts` and `tests/scripts/check-client-bundle.test.ts` (bash-script tests, exit code null on Windows). They fail identically with this card's files stashed, so they were already failing.
- New tests: `triageGroups` (11) + `triage` (1) + `AgencyList` (1) pass.
- `tsc --noEmit`: clean. `eslint .`: clean. `next build`: compiles, `/gov` prerendered.
- `convex/_generated/api.d.ts` edited by hand (adds `triage` and `lib/triageGroups`) because `convex codegen` wasn't permitted. Regenerate with `npx convex codegen` before committing to confirm it matches.
- No Convex push: no schema change, and a push to the shared deployment is off-limits.

## Notes
- No schema change. Groups are derived at query time (§2.1.4), not read from the stored `agency`.
- Don't touch the feed card's stored-agency display (out of scope per the card).

## Review (2026-10-28): verdict CLEAN, all 6 ACs verified with proof
Review fixes (no decision needed; re-verified: 15/15 card tests, tsc, eslint, build):
- `/gov` subtitle is neutral ("Public reports in …") because the counts include unlabelled seeded samples (§6.1.1)
- `AgencyList.tsx` imports through the `@/convex/lib` alias, like most components
- Test: every agency in both routing tables has a single owner, guarding the one-chip-per-group assumption

Decide (left for the user):
- The query returns the owner *value* (`utility`) and the client maps it to the label through `OWNER_CHIP`; the card text says "owner label". Recommendation: keep it, since chip colours need the value and the labels are `ACTIVE_CITY.ownerLabels`.
- M1 planning gap: US34/US37/US40 don't list `convex/triage.ts` or `convex/lib/triageGroups.ts`, so US40 (delete `convex/`) would break `/gov`.
- ~~Oct 30 data: switching to Mableton regroups leftover SF reports.~~ Resolved (user, 2026-10-28): Oct 30 stays San Francisco with the SF data kept (§6.1.1 retcon), so nothing regroups.
- Spec tidy-ups: the Session state "Next up" line is stale; §5.5.1 says "Convex subscriptions" (polling on M1); §3.1.3 says `publicReport.ts` shape vs US43's narrower allowlist.
- Before committing: run `npx convex codegen` to confirm the hand-edited `api.d.ts`.

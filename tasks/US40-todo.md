# US40: Remove Convex from the codebase (#11)

Spec: §1.1.1. Parent F9. AC: see issue #11. Dispatcher scope additions (peer message): lib/upload.ts uploadFile, convex/lib ports, compose/Dockerfile build arg, docs `npx convex run`, README SF runbook, minimal spec text, skills/worktree-setup tooling.

## Plan
- [x] Wait for test-coverage audit; port uncovered tests/convex cases into tests/server
- [x] Repoint scripts (eval-*, try-*) from convex/lib to server/lib; port try-screening off Convex
- [x] Delete convex/, tests/convex/, convex.json, vercel.json, ConvexClientProvider, scripts/{convex-env,vercel-build,with-node}.sh
- [x] layout.tsx provider removal; lib/upload.ts uploadFile removal
- [x] package.json: drop convex, convex-test, dev:backend, npm-run-all if unused; vitest.config, eslint, gitignore, dockerignore, compose, Dockerfile
- [x] Comments in app/components/lib/server/scripts: no "convex"
- [x] worktree-setup.sh, .claude/skills (dispatch/run/start/review) tooling lines
- [x] README, CLAUDE.md stack line, spec text (§1.1.1, §4.2.1, §6.1.1, §7.1.1/§8), hackathon.md left alone? (not in grep scope)
- [x] Verify: grep AC, npm test (889 pass), build, lint, tsc, drizzle-kit "No schema changes"
- [x] docker compose up + seed on a clean stack (project us40check, ports 18080/18443/25432/29000), verified 2026-10-29: all services healthy, migrate exit 0, empty feed `[]` over Caddy HTTPS, admin login + presigned PUT + /api/admin/samples created a report, feed served it with a working presigned frame URL (200 image/jpeg). Without GEMINI_API_KEY the sample is held ("screening failed"), so I set title/category by SQL in the throwaway DB and released it. Torn down with `down -v`, images removed, builder pruned; govtok volumes untouched. `npm run build` re-run after the last edits: passes.
## Review fixes

## Notes
- Ported 9 uncovered tests from tests/convex into tests/server (screenReport x1, lib/publicReport x7, http x1). fixPrompt/gemini/screenPrompt/auth convex copies were duplicates.
- App test project switched from edge-runtime to node; @edge-runtime/vm and npm-run-all2 removed (only Convex needed them).
- scripts/try-screening.ts rewritten to post through /api/files + /api/posts.
- Not touched: .env.example (still lists Convex vars; David owns it), hackathon.md (Cal Hacks log).

## Review fixes
- GOVTOK_DECISIONS.md: stale Convex statements at §3.1.1 (residents upsert), §3.1.2 (passcode check, revocation), §6.1.1 seeding, §8 retake risk (now covered by isUploadedBy + assertKeysUnused; also path), §5.5 build note.
- lib/upload.ts header comment re-wrapped.
## Review
Reviewer: no blocking findings; all ACs verified except clean-clone `docker compose up` + seed (host disk full, ENOSPC) which was only checked statically.
Open for David: .env.example still says "copied onto the Convex deployment by scripts/convex-env.sh" (line 12) and likely lists Convex vars; untouched by instruction.

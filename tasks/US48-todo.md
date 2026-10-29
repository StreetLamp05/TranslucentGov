# US48: Switch the app between English and Spanish (issue #32)

Spec §: new (2026-10-29), extends §5.1.1 captions. Peer note (dispatcher): one nullable schema change only; don't touch `.env.example`; hook ES into the single caption block (`useCaption` in `CardOverlay.tsx`) and keep US46's pause behavior; agency names stay untranslated; backfill script runs in the worker image.

## Plan
- [x] Backend: `reports.segmentsEs` (nullable jsonb) + generated migration; `db:generate` says "No schema changes" after
- [x] `transcribe()` returns `{ text, segments, segmentsEs }` from the same Gemini call (schema + prompt, flash-lite and safetySettings unchanged)
- [x] `screenReport` stores `segmentsEs`; retake clears it; `publicReport` projects it only where `segments` is (never when `audioMuted`)
- [x] `lib/captions.ts`: pick `segmentsEs` for ES, fall back to `segments` when null/empty
- [x] `lib/i18n/`: dictionary (per-area files, `en`/`es`), `LocaleProvider` (useSyncExternalStore on localStorage, try/catch → en), `useT`, `LanguageSelector`
- [x] Selector on feed + Me page
- [x] Convert strings: post, feed, map, me, fix, confirm, gov (+ tab bar, demo banner)
- [x] Test: every ES key present and non-empty, same `{placeholders}` as EN
- [x] `scripts/backfill-spanish-captions.ts` (idempotent, one Gemini call per report, paced, prints count) + test with Gemini mocked
- [x] GOVTOK_DECISIONS.md §5.1.1 build-decision note
- [x] Verify: `npm test`, `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm run db:generate`

## Verification (before review)
- `npx tsc --noEmit`, `npm run lint`: clean. `npm test`: 100 files, 953 tests pass. `npm run build` and `npm run check:bundle`: ok. `npm run db:generate`: "No schema changes, nothing to migrate" after `0001_abnormal_nightmare.sql` (one `ADD COLUMN "segments_es" jsonb`).
- Backfill run against this worktree's Postgres (`govtok_us48`) with a fake translator: run 1 translated 2, run 2 translated 0 (idempotent); a row that already had Spanish and a photo post were untouched.

## Review fixes
- `transcribe()` drops Gemini's `segmentsEs` when there are no English segments (a clip with no speech can't get captions). Test added.
- The backfill treats an empty translation as a failure instead of storing `[]` (live path stores NULL). Test added.
- New `tests/lib/i18n/serverStrings.test.ts` pins the client's English copies of `CLIP_TOO_BIG`, `CITY_ONLY` and `tooFarMessage` to the server's.
- Dispatcher decisions (2026-10-29): the live transcription path keeps `segmentsEs` only when it has as many segments as `segments`, else null (test added); §8 "Spanish UI and posts" narrowed to Spanish-language posting/screening, noting the UI and captions shipped in US48.
- Spec note in `GOVTOK_DECISIONS.md` §5.1.1 now says the backfill skips muted reports and ones without speech.

## Left for the user (Decide, non-blocking)
- (Dispatcher: keep.) The backfill covers every status, including `held` reports that are never public. Kept: a held report can be released later and would then have no Spanish.
- `components/capture/recorderMessage.ts` maps the recorder hook's English sentences to keys by string equality; `EMPTY_CLIP_MESSAGE`/`RECORDER_ERROR_MESSAGE` in `lib/hooks/useClipRecorder.ts` are private and untested. Cleaner: the hook returns keys.
- `MeReportCard.reportStatusText` duplicates `CardOverlay.statusText` (separate `me.status.*` / `feed.status.*` keys).
- Operational: the `migrate` service must run before the backfill so `segments_es` exists.

## Review
RUN-CARD-VERDICT: CLEAN (one independent reviewer, no blocking findings; the two defects it found are fixed above; Decide items listed above). AC proof is in the final report.

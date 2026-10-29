# US31 (#2): Screen reports and verify fixes with Gemini

Spec: §1.1.1, §1.1.3 (Gemini retcon), §4.2.1, §4.3.1. Parent: F9 (#1).
Consumer: US32 (`transcribe.ts`) reuses the client and `GeminiError` from `convex/lib/gemini.ts`.

## Decisions
- Same call shape as `callClaudeJSON`: `callGeminiJSON({ system, content, schema })` → parsed JSON. `content` is Gemini `Part[]`; `imageBlock` now returns `{ inlineData: { mimeType, data } }` (still base64: local Convex storage URLs point at localhost).
- `responseSchema` (OpenAPI subset, `Type.*`), per the AC and §1.1.3. The prompt modules define their schemas in that format, with `propertyOrdering`. `additionalProperties` isn't part of it; `required` lists every property.
- Error kinds: `refusal` (prompt `blockReason`, or a safety-type `finishReason`), `max_tokens`, `bad_output` (non-JSON text, empty answer, other finish reasons; replaces Claude's `bad_stop`), `rate_limited` (HTTP 429, `retryAfterMs` from the error's `RetryInfo.retryDelay`), `api`.
- `GEMINI_MODEL` with a default in code; `GEMINI_API_KEY`. No SDK retries: the pipeline owns the single retry.
- Groq stays (US32 owns transcription).

## Plan
- [x] `npm install @google/genai@2.31.0`, `npm uninstall @anthropic-ai/sdk`
- [x] `convex/lib/gemini.ts` (replaces `claude.ts`): `geminiClient`, `geminiModel`, `geminiRequestError` (for US32), `callGeminiJSON`, `GeminiError`, image helpers
- [x] `screenPrompt.ts` / `fixPrompt.ts`: Gemini parts + `responseSchema`
- [x] Import lines in `convex/screening.ts`, `convex/fixVerification.ts` (+ a comment in `convex/seed.ts` for the grep AC)
- [x] Tests: `tests/convex/lib/gemini.test.ts` (replaces `claude.test.ts`), prompt tests, `tests/convex/fixVerification.test.ts`, `tests/convex/screening.test.ts` import
- [x] Scripts: `eval-screening.ts`, `eval-fix.ts`, `try-screening.ts`, `convex-env.sh`, `check-client-bundle.sh` (+ its test)
- [x] `.env.example`: out of this card (David via the dispatcher, 2026-10-28: never committed, he maintains it himself; already updated in the main checkout)
- [x] `grep -ri anthropic convex app components lib scripts package.json` is empty
- [x] Verify: `npm test`, `npm run build`, `npm run lint`, `npx tsc --noEmit` (root and convex), `check:bundle`
- [ ] Evals on Gemini: screening scored on free Flash-Lite (12/13); the Pro default is blocked on billing (see Eval scores). `eval-fix.ts` has no before/after pairs (gap, per David)

## Open
- AC6 (eval scores next to "the last Claude run"): there's no recorded Claude eval run. US12/US22 never got labeled fixtures (`scripts/fixtures/labels.json` is US3's transcription metadata, not eval cases; no `fix-pairs.json`, no images).

## Progress (2026-10-28)
- 67 files, 689 tests pass. tsc (root and convex) clean, eslint clean, `next build` OK, `check:bundle` finds no leaks, AC grep empty.
- No Convex push: agent permissions block reading `.env.local`, so I couldn't confirm this worktree points at a local deployment, and a blind push could replace the shared dev deployment's functions. Instead, esbuild bundled `convex/screening.ts` and `convex/fixVerification.ts` for Node 24, and a plain-Node smoke run of the real SDK against a fake `fetch` confirmed the wire request (contents/parts, `systemInstruction`, `responseSchema`, `thinkingLevel: LOW`, key in a header rather than the URL) and that a 429 `ApiError.message` is the JSON body with `RetryInfo.retryDelay`, which `parseRetryDelay` reads.
- `.env.local` has no `GEMINI_API_KEY` (per `check:bundle`), so no live call or eval has run.

## Review fixes (round 1, 2026-10-28)
Review verdict: NEEDS_INPUT (AC5 `.env.example`, AC6 evals). Fixed without a decision (all non-blocking, so no second review round):
- `convex/_generated/api.d.ts`: swapped the stale `lib/claude` entry for `lib/gemini`, matching codegen output (hand edit, since codegen needs a deployment).
- `convex/lib/gemini.ts`: the "GEMINI_MODEL must be a Gemini 3 model" warning moved next to `DEFAULT_GEMINI_MODEL`, where whoever picks the model will see it.
- `convex/seed.ts`: vendor-neutral stagger comment (the 10 s spacing was tuned for Anthropic and hasn't been checked against Gemini).
- `convex/lib/screening.ts` comments name Gemini. Regression tests in `tests/convex/lib/screening.test.ts` show Gemini 500/429 errors reduce to "Gemini request failed (500)" / "Gemini rate limited" with no vendor body.
- Re-verified: 691/691 tests, tsc (root and convex), lint, AC grep empty.

## Left for the user (Decide)
- Blocking: AC5 `.env.example` hand edit; AC6 eval (labeled set, key, Claude baseline from `main` before merge) or amend AC6/§1.1.3.
- No `safetySettings`: an emergency post that trips a safety block is held as "screening failed" instead of showing Call 911.
- On-screen "Claude" copy: `components/fix/FixCapture.tsx:194,202`, `app/confirm/[reportId]/page.tsx:42`.
- Write build decisions back to GOVTOK_DECISIONS.md (model + date, bad_stop→bad_output, thinkingLevel LOW, no safetySettings, RetryInfo delay, GIF dropped, §8's stale `callClaudeJSON`).
- No request timeout on `geminiClient()` (same as before: Claude's SDK default matched the 10-min action limit).
- §7: vendor data terms (billing-enabled project so Google doesn't train on unscreened faces/plates).

## Eval (2026-10-28, user decisions)
- Labeled set = production reports whose stored verdict is `pass` (user: "the ones that passed are correct"). Read-only pull from `--prod`: `feed:feed` (frames, transcript, description, street, category) joined with `npx convex data reports` (verdict). 13 cases, all videos, 6 frames each. Prod also has 8 `held/reject`, left out.
- **Known gap (user: "we can just have a gap in the testing for now"):** no face/plate (`retake`), `emergency`, `mute` or `reject` cases, so the eval shows Gemini doesn't hold good posts and picks the right category, not that it catches plates or 911 cases.
- Cases and frames live in the session scratchpad (`eval/eval-cases.json` + 78 JPEGs), not the repo: they're residents' real clips.
- Claude baseline (main's code extracted to the scratchpad, since this branch deletes the client): **13/13 match** (verdict and category).
- Gemini: not run yet. Neither `.env.local` has `GEMINI_API_KEY`.

## Review fixes (round 2)
- `geminiClient()` throws `GeminiError("api", "GEMINI_API_KEY is not set")` when the key is missing. Before, the SDK fell back to Google Cloud default credentials and failed with "Could not load the default credentials", which never names the key (found by the keyless eval run). Regression test in `gemini.test.ts`; the prompt and pipeline tests now stub the key. 692/692 tests, tsc, lint clean.
- Gemini eval attempt 2 (key in the main checkout's `.env.local`): `gemini-3.1-pro-preview` is in `models.list`, but every call is 429. Quota `GenerateContentInputTokensPerModelPerDay-FreeTier`, limit 0 for `gemini-3.1-pro`: the key's project needs billing enabled.
- Fix: that 429's `RetryInfo` asked for 21093 s (~6 h), and the pipeline honored it, so a post would sit on "Checking…" for hours. `parseRetryDelay` now caps at `MAX_RETRY_DELAY_MS` (60 s); a second failure holds the report as before. Regression test added. 693/693 tests, tsc, lint clean.

## Eval scores (for the PR body)
`scripts/eval-screening.ts` over 13 production reports with a stored `pass` verdict (videos, 6 frames each, with transcript, description and street). Rebuilt after the 2026-10-28 reboot wiped the scratchpad; same 13 reports.

| Model | Score | Notes |
|---|---|---|
| Claude Opus 5.5 (`main`, last Claude run) | **13/13** | verdict and category all match |
| `gemini-3.5-flash-lite` (free tier, **new code default**) | **12/13** (twice: before and after `SAFETY_SETTINGS`) | 24 s for all 13. Miss: `jn748dvg1w` (pothole) → `retake`, "license plate is readable". A parked Mini's front plate is in frame 6, blurry and only partly legible: strict rather than a clear error. Categories all match |
| `gemini-3.1-pro-preview` (code default) | not run | 429: free tier limit 0 for `gemini-3.1-pro` (needs billing) |
| `gemini-3.7-flash` (free tier) | 1/13 (1 answered, it matched) | 503 "high demand", then 429 `GenerateRequestsPerDayPerProjectPerModel-FreeTier` = **20 requests/day** (reported as `gemini-3.8-flash`). Not viable for a demo |

- `scripts/eval-fix.ts`: not run, no before/after pairs exist (known gap).
- Known gap (David): no face/plate, emergency, mute or reject cases, so this doesn't show Gemini catches plates or 911 cases.
- Free-model probe (one tiny call each): OK on `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite(-preview)`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.7-flash`. 404 (retired for new users): `gemini-2.5-flash`, `gemini-2.5-flash-lite`. Free limit 0: `gemini-omni-*`.

## Decisions from David (via the dispatcher, 2026-10-28) and changes
1. Model: default is now `gemini-3.5-flash-lite` on the free tier, no billing (`convex/lib/gemini.ts`). Spec §1.1.3 records the free-tier data tradeoff and the 12/13 eval.
2. `SAFETY_SETTINGS`: all six harm categories the Gemini API accepts (harassment, hate speech, sexually explicit, dangerous content, civic integrity, jailbreak) set to `OFF`. A live probe confirmed the API accepts each with `OFF`. The four `IMAGE_*` categories are left out, since the SDK documents them as unsupported on the Gemini API. A test asserts the settings go out in the request.
3. Vendor-neutral copy: `FixCapture.tsx:194` "Comparing your clip with the original…", `:202` "Your clip matches the original. The report is now fixed.", `app/confirm/[reportId]/page.tsx:42` "We compare it with the original." Code comments that still mention Claude were left alone (minimal).
4. Spec write-back in `GOVTOK_DECISIONS.md` §1.1.3 "Build decisions (2026-10-28, US31)": model and date, the eval, thinkingLevel LOW, safety OFF, bad_stop→bad_output, the 60 s RetryInfo cap (accepted), GIF dropped. §8: `callClaudeJSON` → `callGeminiJSON`.
- Non-blocking notes kept: no request timeout on `geminiClient()`; §7 doesn't cover vendor data terms.
- Re-verified: 694/694 tests, tsc (root and convex), eslint, `next build`, `check:bundle` (no leaks), AC grep empty. Live: `eval-screening.ts` on the default with `GEMINI_MODEL` unset scored 12/13 in 59 s, same miss.

## Review round 2: CLEAN (2026-10-28)
All 8 ACs checked off with proof by two independent reviewers (AC5 and AC6 as scoped by David). No blocking findings, no disagreement.

### Review fixes (round 3, non-blocking, no re-review needed)
- Spec §1.1.3 privacy wording corrected against https://ai.google.dev/gemini-api/terms (verified): unpaid-service input and output may be read by human reviewers, and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Paid terms need an active billing account on the key's Cloud project. Removed my wrong claim that billing is a `GEMINI_MODEL` change.
- Spec §1.1.3: the "evals must show no regression on face/plate/911" gate is marked as an accepted gap (user decision).
- Spec §1.1.3 safety bullet: blocks that can't be turned off (PROHIBITED_CONTENT, SPII, BLOCKLIST, IMAGE_SAFETY) still end in "screening failed". CIVIC_INTEGRITY is deprecated but accepted (watch item).
- Tests: the request-shape test asserts `maxOutputTokens: 16000`; `fixPrompt.test.ts` asserts FIX_SCHEMA `required` / `propertyOrdering`. 695/695, tsc, lint clean.

### Notes for whoever merges (not done in this card)
- David should read the free-tier terms above: they may change the no-billing call before real Mableton posts flow.
- Deploy order: set `GEMINI_API_KEY` (and unset `ANTHROPIC_API_KEY` / `CLAUDE_MODEL`) on the prod Convex env before deploying these functions, or every post is held and every fix check fails.
- Sibling cards: `app/confirm/[reportId]/page.tsx` (US35), `components/fix/*` (US39) and `convex/lib/screening.ts` (US34) changed here. Rebase them onto US31, or the "Claude" copy comes back or conflicts.
- Pre-existing spec staleness outside this card: §1.1.3 line 124 says refusal holds and 429 retries, but callers retry every error once, then hold. Also lines ~558/560 ("Opus 5.5 low", "Groq Whisper turbo"), Next steps #2 (`ANTHROPIC_API_KEY`), and §4.2.1's debug-line text ("Groq and Claude append JSON").
- Non-blocking: no request timeout on `geminiClient()` (tracked in §8); ~12 code comments still say "Claude" (none on screen); Flash-Lite's free-tier per-minute and per-day limits aren't recorded.

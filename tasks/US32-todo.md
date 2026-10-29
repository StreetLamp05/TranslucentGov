# US32: Transcribe posted and intake videos with Gemini (#3)

Spec §1.1.4 (retcon 2026-10-28). Parent F9 (#1). Builds on US31 (`convex/lib/gemini.ts`).

Batch rules from the dispatcher (2026-10-28): one review round; don't touch `.env.example`
(David owns it); US34 moves `convex/lib/clipLimit.ts` and `convex/lib/screening.ts` to
`server/lib/`, so keep importing `./clipLimit` and leave those two files alone.

## Plan
- [ ] `convex/lib/transcribe.ts`: same exports and `transcribe(blob, contentType, fileName?)`
      signature (both callers unchanged; the Groq-only `apiKey` param goes, the key comes from
      `geminiClient()`).
  - Inline `inlineData` when the clip is small enough for a 20 MB request after base64,
    otherwise upload with `files.upload`, poll until ACTIVE, reference by URI, delete after.
  - `callGeminiJSON` with a `{ segments: [{start,end,text}] }` schema, so the client, safety
    settings, finish-reason checks and error kinds are US31's. `text` is the segments joined.
  - Silent clip → `{ text: "", segments: [] }`. Bad segment numbers → `GeminiError("bad_output")`.
  - Files API failures go through `geminiRequestError`.
- [ ] `convex/lib/transcribe.test.ts`: rewrite with `@google/genai` mocked (inline path, Files
      API path incl. polling + delete, silent clip, 2-arg signature, unsupported format, 429).
- [ ] `scripts/try-transcribe.ts <fixture>`: transcribe one file and print the transcript.
- [ ] Remove Groq: `scripts/convex-env.sh`, `scripts/check-client-bundle.sh` (+ its test),
      `convex/screening.ts` dead Groq retry-after branch (+ tests), user-facing intake text,
      README, stale code comments.
- [ ] Verify: `npm test`, `npm run build`, `npm run lint`, `npx tsc --noEmit`, a real
      transcription of generated narrated / near-silent / over-inline-limit clips, and that
      the Convex (V8-runtime) bundle for `videoIntake.ts` still deploys with the SDK in it.

## Progress (2026-10-28)
- [x] transcribe.ts on Gemini (inline ≤14 MB, Files API above, deleted after); `gemini.ts` gained `blobToBase64`.
- [x] transcribe.test.ts rewritten with `@google/genai` mocked (11 tests).
- [x] try-transcribe.ts takes clip paths. Real run on generated clips: narrated mp4/webm inline (correct text),
      near-silent → `{text:"",segments:[]}`, 20 MB mp4 via Files API (correct text).
- [x] Groq removed from convex-env.sh, check-client-bundle.sh (+test), screening.ts retry branch (+tests),
      intake page text, README, comments. Left on purpose: `.env.example` (dispatcher rule),
      `hackathon.md` and `scripts/fixtures/labels.json` (historical records).
- [x] npm test (717 pass), tsc, lint, build pass.
- [x] Local Convex push (`npx convex dev --once`, this worktree's own local deployment) and a real
      run of `videoIntake.transcribeVideo` on it. The first run proved the default (V8) runtime
      can't do the SDK's Files API upload ("Not implemented: set host for URL"); it aborts the
      action and leaves the entry stuck on "transcribing". Fix: new "use node"
      `convex/videoIntakeTranscribe.ts` (`transcribeStored` internal action); `transcribeVideo`
      keeps its args/return and calls it via `ctx.runAction`. After the fix, narrated mp4,
      near-silent mp4 and a 20 MB mp4 (Files API) all end `complete` with correct transcripts.
      Screening was already "use node", so its path is unaffected.
- [x] After the fix: tsc, lint, npm test (717/717), build pass.

## Review (one round, new single-reviewer flow) — RUN-CARD-VERDICT: CLEAN
All in-scope ACs verified with proof (live Files API run, Gemini file list empty afterwards; targeted
tests 108/108; tsc + eslint). No blocking findings.

### Review fixes
- Segments are sorted by start time after normalization (test updated).
- Tests added: FAILED file state (throws `api`, still deletes), a failing delete is swallowed.
- The delete comment no longer reads as a privacy guarantee (points at §1.1.3's free-tier terms).
- After fixes: transcribe tests 13/13, npm test 719/719, tsc, eslint pass.

### Left for David (Decide)
1. RECITATION finish reason (e.g. a car radio playing lyrics) → `bad_output` → the post is held as
   "screening failed" after the retry. Option: treat RECITATION during transcription as an empty transcript.
2. Spec §1.1.4 has no build-decisions block (14 MB inline threshold, Files API + delete, the
   V8/"use node" split, two free-tier Gemini calls per video post) and no privacy note: the
   whole clip incl. the resident's voice now goes to Google under the unpaid terms in §1.1.3.
3. Non-blocking/follow-up: intake failure text through `ctx.runAction` is unverified (may carry an
   "Uncaught GeminiError:" prefix, admin page only); `text` is space-joined (odd for CJK);
   `scripts/fixtures/labels.json` still has unused `groqAudioOnlyTest` entries; the local Convex
   deployment still has a stale GROQ_API_KEY (unused); older spec sections (§2, §4.1.1, §4.2.1, §8,
   runbook) and README's Claude lines still predate the Gemini switch.

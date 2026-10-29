# GovTok — Design Decisions

Source of truth for design decisions made during the pre-build design pass.
Updated incrementally as decisions are locked in.
## Session state / handoff
*Update after every locked decision so a fresh session can resume from this block alone.*
- **✅ Triage dashboard design COMPLETE (2026-10-28, M1).** Must-haves only (user call): §2.1.4, §3.1.3, §5.5.1, §5.5.2 and §6.1.2 are locked, the sweep is clean, and the nice-to-haves are in §8. Cards pushed: F10 #13, US42 #14, US43 #15, US45 #17 (US44 #16 closed: the migration keeps API shapes, so no separate port). Building US42.
- **Status (M0):** ✅ **SPEC COMPLETE (Level 2, 2026-10-24).** Every item for tonight's build is decided, and the consistency sweep is resolved. No forward references are open. One known gap (2026-10-25): slurs aren't yet in US12's title rule (§4.2.1).
- **Last completed:** retcons for text descriptions, photo slideshow posts and the private Me page (§4.1.1, §5.4.1). Build decisions from US25 are recorded in §6.1.1, §6.2.1 and §8 (2026-10-25).
- **City switch (2026-10-25, US25, user decision):** the Cal Hacks demo runs as **San Francisco**, live at the Palace of Fine Arts. This reverses §6.1.1's rejected "Bay Area as a second city". `ACTIVE_CITY` in `convex/lib/city.ts` sets the routing (§2.1.2), the Claude prompts, the map, `DEMO_POINT` and the seed presets. ~~Oct 30 flips it back to Mableton.~~ **Retcon (2026-10-28, user decision): Oct 30 stays San Francisco, with the existing SF data kept.** See §6.1.1 "City profile".
- **M1 stack switch (2026-10-28, user decision):** this repo, TranslucentGov, is a fork of GovTok aimed at the **Georgia 311 Challenge Demo Day** (Fri 2026-10-30, 9am ET, Morehouse). Mableton Mayor Michael Owens and the judges attend, and top projects may go to the city for a pilot. AI moves to **Gemini** (§1.1.3, §1.1.4), and the backend moves from Convex to a **self-hosted docker-compose stack** of Postgres, MinIO, a pg-boss worker, Next.js and Caddy (§1.1.1). Other sections that say "Convex action / query / storage / scheduler" now mean worker job / route handler / MinIO / pg-boss; the behavior they describe is unchanged.
- **Next up:** build M1. The cards are F9 + US31–US41 on Project #19 (draft: `.planning/M1-issues.json`). Cut line: if US40 (remove Convex) hasn't merged by Thu 2026-10-29 evening ET, demo on Convex + Gemini.
- **Moved to server (2026-10-24):** work continues on `miraii` at `~/projects/GovTok` (moved from `~/GovTok` 2026-10-24; symlink left behind), using `claude --remote-control` inside tmux. The original conversation was on the laptop; this doc plus memory is the only carried-over context.
- **Context the doc doesn't hold:**
  - Cal Hacks submissions are due Sunday morning, 2 people.
  - Prize targets are in Scope.
  - Oct 30 is Mableton demo day.
  - Keep the pass time-boxed to decisions that block tonight's build.

## Working agreement
- Update the Session state / handoff block after every decision, the same way HireHarbor's doc does.
- Less is more. Every feature has to earn its demo time. The demo should run about 45s so the rest of the pitch goes to impact and story.
- Keep it concise; length isn't thoroughness.
- One decision at a time, with a recommendation, not a menu.
- **Hackathon-simple over production-grade.** Use no third-party auth or setup-heavy services unless they earn demo time. Choose the DB-only or one-call option, and record the production version in §8.
- **UI entries are directional (2026-10-24).** §5 sets content and behavior only. The partner turns them into wireframes with Claude Cowork after this pass, so don't lock layout details.
- **Cal Hacks first (2026-10-24).** When the best hackathon product and the best fit for Mableton conflict, pick the hackathon and note the Mableton adaptation in §8 for after Sunday.

## Scope
- **Pitch:** A TikTok-style feed for Mableton, GA. Residents film a problem, and anyone can scroll what's been reported and watch the proof-of-fix video when it's resolved. A map shows how many people reported the same problem in the same spot.
- **Core problem:**
  - Residents can't see what their government does. Fixes happen out of sight, so trust doesn't grow even when the work gets done. The user's premise: NYC Mayor Mamdani's administration (which has an Office of Mass Engagement and does TikTok-native outreach) fixed about as many potholes as the previous one but has much higher approval. *(Needs a source before it goes in the pitch.)*
  - Mableton specifically: incorporated in 2022, with services split with Cobb County, and the split is still changing.
    - The city took zoning and code enforcement in Mar 2025, then sanitation, business licenses and permits in mid-2025.
    - Police is moving from Cobb to a city department.
    - Roads and stormwater stay with Cobb through 2034.
    - Residents don't know who handles what. The only online reporting channel found was a code-violation form.
  - Today's channels are slow or costly: hold times on the phone, days waiting for an email reply, or a whole day lost to a public meeting with limited speaking time.
- **Primary users:**
  - **Posters:** residents who film a problem with the rear camera, a finger pointing at it. No selfie or face needed.
  - **Scrollers:** residents who browse the feed and map. This is the larger group.
  - **Fixers:** city staff and the contractors the city pays. They upload proof-of-fix media to close a report.
  - **City staff and leadership:** see where reports cluster.
  - **Scale:**
    - Cal Hacks demo: sample videos recorded around California.
    - Mableton test week: 10–20 residents, tens of reports.
    - Pilot: the City of Mableton (Georgia's 12th-largest city).
- **Constraints:**
  - Cal Hacks 13.0 is this weekend. Submissions are due Sun Oct 25, 2026 in the morning, about 18 hours after this scope was written (Sat 4:40pm ET). Target prizes:
    - Anthropic, "Claude for Public Benefit." Claude has to be used meaningfully both to build the product and inside it, and there has to be a plan for measuring impact.
    - Microsoft, "Built for the Real World."
    - Cal Hacks, Best People-First Hack.
  - Georgia 311 Challenge demo day is Fri Oct 30, 2026 at Morehouse College, judged by Mayor Michael Owens. Top projects may get a city pilot. The challenge prompt: "Help Mableton residents find services, understand city decisions, and make their voices heard."
  - It's a new repo (github.com/StreetLamp05/GovTok), separate from GlassGov. All code is written at Cal Hacks or after.
  - The city can require proof-of-fix only from its own staff and contractors. Cobb County and utility crews are outside its control.
  - Team: 2. Budget: free tiers and hackathon credits.
- **v1 =** a resident films a problem, and it shows up in the feed and on the map with who's responsible. Neighbors can "me too" it. When it's fixed, the proof-of-fix video appears on the same card.
  - **Post:** record a short video (or photos) in the browser with the rear camera. Location defaults to the phone but can be selected on a map.
  - **Feed:** vertical full-screen scroll. Each card shows the problem, who's responsible (city / Cobb / utility), status, and days open. Resolved cards show the fix after the original.
  - **Me too:** one tap adds you to an existing problem instead of creating a duplicate.
  - **Map:** report and "me too" counts clustered by location.
  - **Proof to close:** a report can only be closed with proof-of-fix video or photos. No commentary, and no workers shown. Model: a dealership's inspection walk-around video that shows brake and tire tread depth.
  - **Screening:** Claude checks every post before it goes public for faces, license plates, disputes between neighbors, and emergencies.
- **Non-goals (v1):**
  - Native iOS or Android app (mobile web only).
  - Reporting by text message.
  - Integration with Cobb County's or the city's work-order systems.
  - Voice line.
  - Council or budget features.
  - Comments, DMs, follower graph, public profiles. (A private "Me" page is allowed, §5.4.1.)
  - Personalized feed ranking.

### Scope addendum
- ~~**2026-10-24: video only.**~~ *Retconned the same day, see below.* Removed "(or photos)" from Post and "or photos" from Proof to close.
- **2026-10-24 (retcon): posts are a video OR a photo slideshow; fixes stay video only.** The user wants TikTok photo mode for residents who prefer it. A slideshow is 1–10 photos swiped sideways. Proof of fix stays video only, because the walk-around is the trust anchor (§4.3.1). (§4.1.1)
- **2026-10-24: optional text description on posts** (up to 280 characters), so residents can explain in text if they want. (§4.1.1, §4.2.1)
- **2026-10-25: manual post location.** GPS remains the default, but a resident can choose a map pin instead, including when location permission is unavailable. The selected pin drives both the nearby-report check and the submitted report; it is a user-provided location, not a verified GPS claim. (§4.1.1, §4.1.2, §7.1.1)
- **2026-10-24: private "Me" page.** The non-goal "public profiles" still holds. A private page tied to the device token shows your own posts and their results, plus fixes on things you reported or me-too'd. It's important for the demo, because it closes the loop. (§5.4.1)
- **2026-10-24: tax framing.** Mableton residents are frustrated right now because the city just added a property tax. GovTok lets them **see their tax dollars at work**: every verified fix is visible proof of where the money goes. Use this as a pitch angle, especially on Oct 30. *(Get the date and millage figure before it goes in the pitch.)* (§6.2.1)
- **2026-10-24: clips keep audio**, which gets transcribed (§1.1.3, §1.1.4). Proof-of-fix commentary is still out of scope (§4.3.1).
- **2026-10-28: government triage dashboard (M1, Oct 30).** Each government group gets a page with the reports routed to it, so every group can own its issues and leadership can see who has what. Decided at Level 0 (user):
  - **Groups = the routing table's `agency` values** (§2.1.2), e.g. Mableton Sanitation, Code Enforcement, Cobb DOT, Georgia Power. No new org chart. Agencies that won't log in (Cobb, utilities) still get a page, and that is part of the accountability pitch.
  - **Ownership is a filtered view, not a claim.** No "acknowledged / in progress" status. A group owns its issues by seeing them and closing them through the existing verified fix (§4.3.1). §2.1.3's rejection stands.
  - **Audience:** city staff and the Mayor at M1 demo day.
  - This reverses §5.2.1's "no separate dashboard" (retconned there). (§5.5)

---

## 1. Tech stack & infra

### 1.1 Platform

**1.1.1 App stack — self-hosted docker compose: Next.js + Postgres + MinIO + pg-boss** *(retcon 2026-10-28, M1, user decision; replaces Vercel + Convex)*
- One `docker-compose.yml` runs the whole app on a single server. For Oct 30 that's a friend's homelab (SSH access, on a UPS), reached over HTTPS through Cloudflare Tunnel or a port-forward (US41). A small city IT team can run it themselves, which is the pilot story for the Georgia 311 Challenge (top projects "may be delivered to the city for a potential pilot").
  - `app`: Next.js (App Router), `output: "standalone"`. Route handlers under `app/api/` replace Convex queries and mutations. Server code lives in `server/`.
  - `postgres`: the database, through Drizzle ORM. Migrations are in `drizzle/`.
  - `minio`: S3-compatible file storage for videos and photos.
  - `worker`: pg-boss jobs (queued on the same Postgres). These replace Convex actions, `scheduler.runAfter`, and the daily cron. Screening, fix verification, transcription and purge run here, so the Gemini key never reaches the browser.
  - `caddy`: HTTPS in front of the app. It must be HTTPS because phones only allow camera access on HTTPS sites. Locally it uses `tls internal`, and on the server a real domain.
- Uploads: the browser PUTs to a presigned MinIO URL and then saves the object key. Videos are read through presigned GET URLs. Clips stay small (§4.1.1).
  - (2026-10-28, US33, user decision) Presigned URLs carry the object key, so keys are public now. An `uploads` table records who asked for each key, and a report or fix may only save keys its caller uploaded (`isUploadedBy`). The ports that save keys (US35 posts and retake, US38 fixes, US39 seed and intake) must call it. That alone proves only that the caller uploaded the key, not that no other report uses it, so each port also refuses (400) a key another report or fix already references (US35 does this for posts and retake, inside the saving transaction). Together the two checks close the §8 "retake deletes shared files" risk on the M1 stack. The app reaches MinIO as its own user, limited to the bucket and `<bucket>-*` worktree buckets, never the root user.
- Live updates: interval polling replaces Convex subscriptions. The hook is `useLive`, which also refetches on window focus and right after a mutation. Status screens (Checking…, fix verdict) poll about every 2s, and the feed and map about every 10s.
- Location queries: bounding-box filters in SQL. No PostGIS needed at Mableton's scale.
- Tests: server tests run on PGlite (in-process Postgres) with the Drizzle migrations, so worktrees and CI need no Docker. Each worktree gets its own database and bucket in the shared local stack.
- Rationale: Cal Hacks is over, so Convex's prize no longer matters. A city pilot needs a stack the city can own, with no per-developer SaaS. Every part is a common open-source building block.
- Rejected:
  - Keep Convex: fastest path to Oct 30, but city IT can't easily self-host it. It stays as the fallback until US40 merges (cut line).
  - Supabase self-hosted: realtime built in, but about 10 containers and still no job runner.
  - PocketBase: the smallest footprint, but SQLite plus a niche framework is a harder sell for a city pilot.
  - Vercel frontend + self-hosted DB: two deploy targets, and it isn't fully self-hostable.
- Cost: one machine (the homelab for the demo). Storage and bandwidth are whatever it has. No per-seat fees.
- *(Superseded 2026-10-28: Next.js on Vercel (Hobby) + Convex for the database, file storage, live queries and Claude-calling actions, chosen for the fewest moving parts at Cal Hacks and a shot at Convex's $5k prize.)*

**1.1.2 Map library — Google Maps**
- Google Maps JavaScript API, wrapped with `@vis.gl/react-google-maps`. Clustering comes from `@googlemaps/markerclusterer`.
- Street names for cards come from reverse geocoding (Geocoding API) on the same key. Run it once per report in the screening job (§1.1.1) and store the result.
  - (2026-10-25, US13) The street is the `route` component's short name ("Floyd Rd"), never a house number, because it's public (§7.1.1). A retry or rescreen reuses a stored street. If geocoding fails, the report has no street and screening carries on.
- Setup: a Google Cloud billing account with a card on file. One browser key restricted to the app's domain and localhost. Reverse geocoding runs server-side with a second key restricted by API.
- Rationale: a nod to Google at the Oct 30 event, a polished look on phones, and one account for both the map and the address.
- Rejected:
  - Mapbox: kept as the fallback if no one can get a card on Google Cloud.
  - Leaflet + OSM: looks dated, and OSM's public tiles aren't meant for a pilot.
- Cost: since March 2025 each SKU gets about 10k free calls a month (Dynamic Maps loads, Geocoding). Cal Hacks and the test week stay well under that.

**1.1.3 AI model and input — Gemini (Flash-Lite, free tier), frames + transcript** *(retcon 2026-10-28, M1, user decision; replaces Claude Opus 5.5)*
- Elsewhere in this doc, "Claude" as the screening or fix-check model now means Gemini. "Claude Cowork" (wireframes) and Claude as the build tool are unchanged.
- One Gemini call per post, run in the screening worker job (§1.1.1), through `@google/genai` with structured output (`responseSchema`). The model comes from `GEMINI_MODEL`, defaulting to `gemini-3.5-flash-lite`, and the key from `GEMINI_API_KEY`, in server env only. It does two jobs:
  - Screening (the policy is §4.2.1).
  - Filling in the card: category and a short title. The owner is looked up from the category in a fixed table (§2.1.2), not chosen by the model.
  - The same call shape checks proof-of-fix (§4.3.1).
- The `callGeminiJSON` wrapper keeps the old contract and the error kinds the callers branch on. Safety blocks map to `refusal` (which holds the report), 429 to `rate_limited` (retried), and the rest to `max_tokens` / `bad_output` / `api`.
- Rationale: Gemini gives a Google-native story for a GDG audience, and one vendor covers screening, fix checks and transcription (§1.1.4). The eval scripts (`scripts/eval-screening.ts`, `scripts/eval-fix.ts`) were meant to show no regression on face/plate holds and emergency cases before the switch counts as done. That part is an accepted gap (user decision, 2026-10-28): no such cases exist yet, so the switch shipped on the `pass`-case eval below.
- **Build decisions (2026-10-28, US31):**
  - Model: `gemini-3.5-flash-lite` on the free tier (user decision: no billing). The key's project has no Pro quota (the free-tier limit for `gemini-3.1-pro` is 0), and `gemini-3.7-flash` is capped at 20 requests a day. Tradeoff: the Gemini API terms for unpaid services let Google use API input and output to improve its products, say "human reviewers may read, annotate, and process your API input and output", and say "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Residents' frames and transcripts can hold exactly that. Paid terms apply only when the key's Cloud project has an active billing account, so moving to paid terms means enabling billing on that project. Changing `GEMINI_MODEL` alone doesn't change the data terms (it can switch back to a Pro model once billing is on).
  - Eval (`scripts/eval-screening.ts`, 13 production reports with a stored `pass` verdict): Claude Opus 5.5 13/13, `gemini-3.5-flash-lite` 12/13. The miss held a pothole post as `retake` for a parked car's blurry, partly legible plate, so it errs strict. Known gaps: no face/plate, emergency, mute or reject cases, and `scripts/eval-fix.ts` has no before/after pairs.
  - `thinkingLevel: LOW`, Gemini 3's counterpart to Claude's effort `low`. `GEMINI_MODEL` has to be a Gemini 3 model, because 2.5 models reject the setting.
  - Safety filters: every harm category the Gemini API accepts is set to `OFF`, so a fire or crash post reaches the screening prompt and shows Call 911 (§4.2.1) instead of being blocked into "screening failed". The prompt is still the only screen. Blocks the settings can't turn off (PROHIBITED_CONTENT, SPII, BLOCKLIST, IMAGE_SAFETY) still map to `refusal` and end in "screening failed" after the retry. `HARM_CATEGORY_CIVIC_INTEGRITY` is deprecated in the SDK but still accepted; drop it if the API starts rejecting it.
  - Error kinds: Claude's `bad_stop` folded into `bad_output` (any finish reason other than STOP, MAX_TOKENS or a safety block).
  - A 429's wait comes from `RetryInfo.retryDelay`, capped at 60 s. A daily-quota 429 asks for hours, and the poster is on "Checking…"; a second failure holds the report as usual.
  - Image types: JPEG, PNG and WebP. GIF is dropped (not a Gemini input type; frames are JPEGs anyway).
- 📌 **Deferred (§8)**: Gemini takes video and audio directly, so the browser frames plus a separate transcript could become a single clip upload. M1 keeps frames + transcript to avoid changing the posting flow before Oct 30.
- *(Superseded 2026-10-28: Claude Opus 5.5 at effort `low` in a Convex action. The original reasoning and costs follow; the input list still applies.)*
- Input:
  - About 6 evenly spaced frames. The browser grabs them with a canvas, 1280px or less on the long edge.
  - The transcript of the clip's audio (engine: §1.1.4). Videos only.
  - For slideshows: the photos themselves, instead of frames and a transcript (retcon, §4.1.1).
  - The optional text description (§4.1.1).
  - The reverse-geocoded street (§1.1.2).
- The Messages API takes no video and no audio input (it accepts only text, images and PDFs). That's why both frames and a transcript are needed.
- Audio is **kept** in the published clip. This is the user's call (2026-10-24): the hackathon pitch comes first, and narration ("this has been here since June") makes stronger cards. Making it fit Mableton can happen after Cal Hacks.
- Cost: about 8k input tokens per post, roughly $0.035 on Opus 5.5 ($4 / $20 per 1M tokens). 1,000 posts cost about $35.
  - (2026-10-25) A 10-photo slideshow comes to about 16k input tokens (~$0.065), and a fix check against a 10-photo original about 26k (~$0.10). Fine at demo scale.
- Rationale: Opus has the best vision, and missing a face or plate is the expensive failure. A cheaper model saves only cents at this scale. Screening is async (the post is "pending" until it clears), so latency doesn't matter much.
- Rejected:
  - Sonnet 5.5 (~$0.018 per post): close in quality, but the savings are negligible.
  - Haiku 5.5 (~$0.001 per post): weakest at background faces and plates.
  - Silent clips: they'd need no transcription and make screening complete, but the user prefers narrated clips for the hackathon.
- 📌 **Forward reference (§4.2.1)**: audio is now published, so screening also has to cover the transcript: spoken names, addresses, neighbor disputes, slurs. Decide what happens on a flag (mute, reject, or hold).
- 📌 **Forward reference (§5.1.1)**: the transcript can double as burned-in captions on the card.
- 📌 **Forward reference (§4.3.1)**: proof-of-fix is "no commentary" (Scope). Decide whether fix clips are muted or narration is just ignored.

**1.1.4 Speech-to-text engine — Gemini** *(retcon 2026-10-28, M1, user decision; replaces Groq Whisper)*
- The same Gemini client as §1.1.3 transcribes the clip's audio: inline for small clips, through the Files API for larger ones. It returns the same transcript-plus-segments shape the report stores today. It runs in the screening job for posted videos, and in an intake job for `/admin/video-intake`. `GROQ_API_KEY` is gone.
- `MAX_CLIP_BYTES` stays at 25,000,000 as the product limit (§4.1.1), even though Groq's file cap no longer applies.
- The transcript is still untrusted and possibly empty, same as before.
- Rationale: one vendor and one key, the Google story for Oct 30, and the "Google STT, revisit for Oct 30" note below, resolved.
- *(Superseded 2026-10-28: Groq Whisper large-v3-turbo. The original details follow.)*
- Videos only; slideshows skip this step (§4.1.1). Transcription runs in the same Convex action as the Claude call (§1.1.3). The action reads the clip from Convex storage and POSTs it to Groq's OpenAI-compatible transcription endpoint (`whisper-large-v3-turbo`, `verbose_json` for segment timestamps). The transcript and its segments are saved on the report.
- Groq accepts the browser's webm/mp4 directly, so there's no ffmpeg step. The free-tier file limit is about 25 MB, and clips stay well under it (§4.1.1).
  - (2026-10-25, US8) One limit everywhere: `MAX_CLIP_BYTES = 25,000,000` bytes (`convex/lib/clipLimit.ts`), used by posts, the admin intake and transcription. It's 25,000,000 rather than 25 MiB so a clip that passes our checks can't fail at Groq, whichever unit Groq means.
- Whisper can invent text on near-silent clips ("Thanks for watching"). Claude's prompt treats the transcript as untrusted and possibly empty.
- Cost: about $0.04 per hour of audio, billed at a 10s minimum per request. Effectively free at every scale we plan for.
- Key: `GROQ_API_KEY`, kept in Convex env only.
- Rejected:
  - Deepgram Nova-3 ($200 credit): the fallback if Groq rate limits bite.
  - Google STT V2: more auth setup, and the free tier is unclear. Revisit for the Oct 30 version (§8).
  - Browser Web Speech: only works live, flaky on iOS, and the transcript isn't tied to the file.

---

## 2. Data model

### 2.1 Reports

**2.1.1 Report shape — one report = one original clip; me-toos are taps**
- `reports`: one per problem. Fields:
  - `residentId` (the poster; never public, §7.1.1).
  - `mediaType: video | photos` (retcon, §4.1.1). `description` (optional, up to 280 characters).
  - Original media: `clipStorageId` (videos), `frameStorageIds[]` (about 6 frame JPEGs for videos, or the 1–10 photos for slideshows; reused by §4.3.1), `transcript`, `segments` (videos).
  - Location: `lat`, `lng`, `street`.
  - `category`, plus `owner` and `agency` from the §2.1.2 table, stored when screening sets the category (2026-10-25, US8: they're unknown while the report is `pending`). `title`, `status` (§2.1.3).
  - Screening: `verdict`, `reason`, `audioMuted` (§4.2.1).
  - `isSample` (§6.1.1).
  - `meTooCount`, `lastActivityAt` (feed order, §5.1.2), `revealViews` (§6.2.1).
  - Fix fields, inline: `fixStorageId`, `fixedAt`, `fixedBy`, `fixedByKind` (`fixer | resident`; added by §4.3.2). One fix per report (§4.3.1).
- `meToos`: `{reportId, residentId, createdAt}`, unique per (report, resident). No media.
- `residents {token, createdAt}` (§3.1.1). `fixers {name, org, passcode, token}` (§3.1.2). The fixer `token` is issued when the passcode is checked.
- **Build-plan additions (2026-10-24):**
  - `fixAttempts {reportId, byKind, byId, clipStorageId, frameStorageIds[], lat, lng, status: checking|verified|not_fixed|retake|failed|superseded, reason, createdAt}`. A fix waits here while Claude checks it, and carries Claude's reason back for a retake (§4.3.1).
  - `fixedByOrg` on reports, so the card can name the fixer's org (§3.1.2).
  - `createdAt` is an explicit field (not `_creationTime`), so samples can be backdated (§6.1.1).
  - (2026-10-25, US14) `screeningError` (the last Groq or Claude error on a "screening failed" hold, shown only to the poster) and `screeningRetries` (Try again taps used), both on reports (§4.2.1).
- When the duplicate check finds a match while someone is posting (§4.1.2), they're steered to me-too and their clip is discarded.
- The map count is `1 + meTooCount` (§5.2.1).
- Rationale: matches Scope's "one tap" exactly. Two tables. The before/after reveal stays a simple pair: original, then fix (§5.1.1).
- Rejected: a problem with many clips (`issues` → `posts`). Richer evidence, but it needs a merge flow and a UI for several clips on one card, with no payoff in the demo.

**2.1.2 Categories and routing — Claude picks the category, a fixed table picks the owner**
- Claude chooses one `category` (§1.1.3). The owner comes from a fixed lookup in code: `owner` is one of `city | cobb | utility | unknown`, plus a display `agency` string. Claude never chooses the owner.

| Category | Owner | Agency shown on card |
|---|---|---|
| `pothole` (road damage) | cobb | Cobb DOT |
| `signal_sign` (traffic signal / sign) | cobb | Cobb DOT |
| `drainage` (flooding / stormwater) | cobb | Cobb Water System (stormwater) |
| `water_leak` (leak / main break) | cobb | Cobb Water System ⚠️ |
| `streetlight` | utility | Georgia Power ⚠️ |
| `trash_missed` | city | Mableton Sanitation |
| `code_violation` (illegal dumping / overgrown lot / code issue) | city | Mableton Code Enforcement |
| `other` | unknown | "Routing unclear" |

- Rationale: the "who's responsible" label is the core of the story, and a wrong label recreates the confusion GovTok exists to fix. A fixed table is predictable, auditable and easy to correct. The road and stormwater rows follow Scope (they stay with Cobb through 2034). Sanitation and code enforcement moved to the city in 2025.
- Rejected: Claude assigning the owner freely. It's flexible, but it will sometimes be confidently wrong.
- ⚠️ **Verify when the product is near finished:** the whole table, especially streetlights (assumed Georgia Power) and water mains (assumed Cobb Water System). Ask the Mableton teammate, or check city and county sites. Tracked in §8 under "Before ship."
- **San Francisco table (2026-10-25, US25, Cal Hacks only, see §6.1.1 "City profile"):** pothole and code_violation → city / SF Public Works, signal_sign → city / SFMTA, drainage → city / SFPUC (sewer & stormwater), water_leak → city / SFPUC Water, streetlight → utility / PG&E / SFPUC Streetlights ⚠️, trash_missed → utility / Recology, other → unknown. SF is a combined city and county, so no category uses the `cobb` owner value. The stored owner values are unchanged, and only the chip labels differ ("City of SF").

**2.1.3 Status lifecycle — pending → open | held; open → fixed**
- `status` is one of `pending | held | open | fixed`.
  - `pending`: screening is running (§1.1.3). Only the poster sees it ("Checking…", and on their Me page, §5.4.1).
  - `held`: screening flagged it. Not public. Handling is in §4.2.1.
  - `open`: public. Days open = now − `createdAt`.
  - `fixed`: a proof-of-fix is attached (§4.3.1). The counter freezes at `fixedAt`, and the card shows the before/after (§5.1.1).
- Transitions are one-way, except `held` → `open` if a flag is cleared by hand (§4.2.1), and `held` → `pending` on a retake, a Try again after "screening failed", or an operator `rescreen` (§4.2.1).
- The feed and map show only `open` and `fixed`.
- Reports owned by Cobb or a utility stay `open` until a neighbor or fixer verifies a fix (§4.3.2). Until then, the growing counter is part of the accountability story.
- Rejected:
  - "In progress / acknowledged": no work-order integration, so a fixer would tap it by hand. It's an extra flow and easy to game.
  - "Reopened": real, but not the v1 story. 📌 Deferred (§8).
- ✓ Recorded (2026-10-28) — the triage dashboard (§5.5) doesn't add a claim status. Ownership is a filtered view, and the verified fix is the only state change (Scope addendum 2026-10-28).

**2.1.4 Group key — derived from the category through the active routing table (added 2026-10-28, M1)**
- A report's triage group (§5.5) is `ACTIVE_CITY.routing[category].agency` (§2.1.2), computed when the dashboard query runs. No new field and no backfill.
- Categories that share an agency share a group (e.g. Mableton's `pothole` + `signal_sign` → Cobb DOT).
- `other` reports form their own **"Routing unclear"** group. It's shown, not hidden, because it's an honest gap to show the Mayor.
- Only `open` / `fixed` reports are grouped (§2.1.3). `pending` / `held` never appear.
- Implementation note: the public card shows the stored `agency` (§2.1.1), so after a table correction the card and the dashboard can disagree. Fix it either by deriving the card's agency the same way or by rescreening. That's an implementation-time judgment call.
- Rationale: the routing table has unverified rows (§8 "Before ship"). Deriving the group means a corrected row moves every past report to the right group automatically, and the table stays the single source of truth.
- Rejected:
  - The stored `agency` string: reports keep a stale group after a table correction.
  - A stable `agencyId` on reports and fixers: survives renames, but needs a schema field and a backfill, which is too much for M1.

---

## 3. Identity & roles

### 3.1 Identity & roles

**3.1.1 Resident identity — device token in the DB (no auth provider)**
- On first visit the browser generates a random UUID and stores it in `localStorage` (wrapped in try/catch; if storage fails, generate a fresh token for this session).
- A Convex mutation upserts `residents {token, createdAt}`.
- Post and me-too mutations take the token, and the server resolves it to `residentId`. `meToos` uniqueness is per (report, resident), per §2.1.1.
- No login screen, no password, no third party.
- Known weaknesses, accepted for the hackathon: anyone holding a token can act as that resident, and clearing storage makes a new resident, which can inflate me-too counts.
- Rationale: the user's call (2026-10-24). Hackathon mode. Third-party auth is setup pain with no payoff on stage, and the Scope rules out profiles, so the ID is internal only.
- Rejected:
  - Convex Auth anonymous sessions: beta library, more setup.
  - Google sign-in: OAuth consent screen setup, plus a tap during the demo.
  - Phone SMS code: needs a paid vendor and adds the most friction.
- 📌 Deferred (§8): real resident identity for the pilot (Google sign-in or phone), so me-too counts can be trusted.

**3.1.2 Fixer access — a passcode per fixer, DB-only**
- `fixers {name, org, passcode, token}`, seeded by hand (e.g. "Mableton Sanitation / 4821"). `token` is issued at the first passcode check and reused after that.
- A hidden `/fix` route asks for the passcode once. A Convex mutation checks it server-side and returns a fixer token, which the browser stores in `localStorage` (screen: §5.3.1).
- The fix mutation refuses any request without a valid fixer token. Any fixer can close any `open` report.
- The fixed card shows the fixer's **org** ("Fixed by Mableton Sanitation"), never a person's name (Scope: "no workers shown").
- Prize check (2026-10-24): none of the target tracks scores auth. Microsoft's "path from prototype to production" is answered by a pitch line instead: "Pilot: residents sign in with Google or phone, and city staff use the city's single sign-on." The only auth prize is MLH Auth0 (headphones), not worth the setup.
- Known weaknesses, accepted for the hackathon (2026-10-25, US21): there's no limit on passcode guesses, and a passcode is revoked only by deleting its fixer row in the Convex dashboard (re-seeding a fixer under a new passcode leaves the old one working).
- 📌 **Forward reference (§4.3.2)**: whether fixers are limited to reports their org owns (city staff can't close Cobb reports).
- 📌 Deferred (§8): city single sign-on for fixers in the pilot, and a limit on passcode guesses.

**3.1.3 Dashboard access — public read-only page, unlinked (added 2026-10-28, M1)**
- The triage dashboard (§5.5) needs no login and has no tab-bar entry, like `/fix` (§5.3.1). Anyone with the URL can open it.
- It shows only fields public cards already show (§7.1.1), built on the same public-report shape (`convex/lib/publicReport.ts`). No poster, no tokens, no `pending` / `held` reports, and no transcript or captions for `audioMuted` reports.
- It has no write actions. Closing a report still goes through `/fix` and its passcode (§3.1.2), or "Is it fixed?" (§4.3.2).
- Rationale: ownership is view-only (Scope addendum 2026-10-28), so a login would protect nothing. A public per-department queue is also on-pitch: residents can see what each agency has open.
- Rejected:
  - Fixer passcode + `org` → group: a login that guards nothing. Org strings must match agency strings exactly, and Cobb and the utilities have no fixer rows.
  - A shared staff passcode: only worth it if staff saw private data (held posts), which is the deferred moderation queue (§8).
- Known trade-off: it works as a public per-department scoreboard in front of the Mayor. The user accepted this; it's the accountability pitch.

---

## 4. Core workflows

### 4.1 Posting

**4.1.1 Capture — in-page recorder, 720p, 20s cap (retconned from video only to video or photo slideshow for posts)**
- `getUserMedia({video: {facingMode: "environment", height: 720}, audio: true})` feeds `MediaRecorder` at about 1.5 Mbps, which comes to roughly 4 MB per clip.
- Recording stops automatically at 20s.
- Prefer `video/mp4` when `MediaRecorder.isTypeSupported` (Safari, Chrome 126+), otherwise webm.
- Grab about 6 frames from the live `<video>` element during recording with a canvas, 1280px or less (§1.1.3), so nothing has to be decoded afterward.
- Fallback when `getUserMedia` is unavailable: `<input type="file" accept="video/*" capture="environment">`. Treat it as best-effort, since the size and length can't be controlled.
- **Frames from a file** (sweep, 2026-10-24): for any clip not recorded live, load the blob into a hidden `<video>`, seek to 6 evenly spaced times, and grab each frame with a canvas. Used by the native-camera fallback and by demo-mode uploads (§6.1.1).
- ~~**Video only**, for both posts and fixes.~~
- **Retcon (2026-10-24):** a post is a **video or a photo slideshow** of 1–10 photos, picked from the camera or gallery (`<input type="file" accept="image/*" multiple>`) and resized in the browser to 1280px or less on the long edge. **Fixes stay video only** (§4.3.1). Reason: the user wants TikTok photo mode as an option.
  - (2026-10-25) Photo EXIF GPS is stripped during re-encoding (and iOS Safari often removes it from library picks anyway). The report uses the selected post location, which defaults to the phone but can be set on a map.
  - (2026-10-25) A photo the browser can't read is left out of the pick, with a note, instead of failing the whole pick. HEIC isn't decoded where the browser can't (Android and desktop Chrome); the message names the format. iOS Safari reads HEIC.
- **Capture screen and uploads** (2026-10-25, US14, user request):
  - Posts use a full-screen camera laid out like TikTok's: a ✕ top-left, a round shutter, VIDEO · PHOTO tabs under it, and Upload bottom-left. Video records the 20 s clip above. Photo snaps stills from the same live camera (1280 px or less, no EXIF), up to 10, with a strip to remove any, then Next. Upload adds photos from the library, up to 10 in all. A retake opens the same camera in the post's format only (§4.2.1). Fixes keep the plain recorder (§4.3.1).
  - Upload in Video mode is **always available, not only in demo mode** (better for testing and the demo). A clip that isn't MP4/WebM (a new iPhone's `.mov`, often HEVC or 4K) or is over 25 MB is converted in the browser: played in a hidden `<video>`, drawn to a canvas at 1280 px or less on the long edge, and re-recorded with the same MediaRecorder settings as a live clip, audio included, cut at 20 s. It runs in real time, so a 20 s clip takes about 20 s ("Converting your video… 45%"). An MP4 or WebM under 25 MB passes through as it is, unless it runs over 20.5 s: then it's converted too, which cuts it to 20 s, so the 20 s cap and Claude's frame spacing hold for uploads (user decision, 2026-10-25). The length is read after the tap, so on iOS such a clip may convert without sound.
  - The conversion runs wherever a clip comes from a file, not just on posts: the fix flow's camera-app fallback and demo upload, `/admin/video-intake` ("Converting your clip… N%" there) and `/admin/seed`. A fix `.mov` used to pass through, since fixes aren't transcribed; converting it also makes the reveal play on Android. Fix clips convert without sound, so a converted fix clip is silent where it's stored (§4.3.1).
  - If the browser won't start the audio (iOS can stop counting the tap once the library picker closes), the clip is converted without sound rather than not at all, and an empty result is an error. Closing the camera cancels a conversion in progress.
  - An uploaded clip, like a slideshow, is pinned to the selected post location, which defaults to the phone.
  - **Location (2026-10-25):** GPS is the default pin. Before the nearby-report check, the resident can choose **Choose location on map**, tap to place a pin, and confirm it. The map starts at the current (or simulated demo) location when available, otherwise the active city's center. Manual selection works without GPS permission and overrides subsequent location refreshes; the same confirmed coordinates drive the 50 m nearby check (§4.1.2) and `createReport`. No address search or city boundary is required.
  - Photo mode doesn't use the microphone, so a denied mic still leaves the Photo shutter working; Video reopens the camera with sound.
  - In demo mode the full-screen camera repeats the "Demo mode: location simulated" banner (§6.1.1).
  - Rejected: ffmpeg in a Convex action (no binary, and it would download the whole clip) and ffmpeg.wasm (megabytes of download, and far slower than real time on a phone).
- **Optional description** (2026-10-24): a text field of up to 280 characters on every post, video or slideshow. It goes into the Claude call (§1.1.3) and is screened (§4.2.1).
- Storage: about 1 GB free in Convex works out to roughly 250 clips (§8 covers pilot-scale hosting).
- Rationale: controls size, length and format, which keeps clips under the Groq file limit (§1.1.4) and the Convex 2-min upload timeout (§1.1.1), and makes them play on iOS and Android.
- Rejected: native camera only. Zero code, but iPhones save 4K HEVC `.mov` files (~60 MB for 20s) that break the Groq limit, don't play on Android Chrome, and can't be length-capped.
- Context: a production GovTok would be a native mobile app with native capture. It's mobile web for now, because no Apple developer account is available (Scope non-goal). 📌 Deferred (§8).

**4.1.2 Duplicate check — location-only check before recording, 50 m**
- When the resident confirms their location (GPS by default or a manually selected map pin, §4.1.1), the app queries `open` reports within about 50 m (bounding box, §1.1.1).
- If there are matches, it shows "Is it one of these?" with up to 3 nearest cards (thumbnail, title, days open), each with a **Me too** button, plus "No, it's new," which opens the camera.
- If nothing is nearby, it goes straight to the camera (§4.1.1).
- Me too creates a `meToos` row (§2.1.1). No clip is recorded.
- Build-plan defaults (2026-10-24): Me too on your own post does nothing, and the button is hidden on your own posts and on fixed cards.
- No automatic merge after screening: a later post at the same spot with the same category stays a separate report.
- Rationale: location is known before recording, while category is known only after Claude runs. Checking up front means no clip gets recorded and thrown away, and it's a demo beat ("the app already knows about this pothole"). A manually selected pin is trusted the same as GPS for this check; the reporter is responsible for choosing the problem's location.
- Rejected:
  - Matching on category after screening: the clip is already recorded, and an automatic merge can join two different problems.
  - Both checks: two flows for a 45s demo.

### 4.2 Screening

**4.2.1 Screening — one verdict, automatic actions, no human queue**
- The Claude call (§1.1.3) returns a `verdict` (`pass | mute | retake | emergency | reject`) and a short `reason`, along with category and title (§2.1.2).

| Verdict | Triggers | What happens |
|---|---|---|
| `pass` | Nothing found | `open` |
| `mute` | Visuals OK; transcript or description has names, addresses, phone numbers or slurs | `open`, `audioMuted: true`: plays muted, no unmute, no captions, description hidden |
| `retake` | Identifiable face or readable license plate | `held`; poster sees the reason and can record again |
| `emergency` | Fire, downed power line, gas smell, crash, person in danger | `held`; full-screen **Call 911** (`tel:911`) shown immediately |
| `reject` | Not a public-space problem: neighbor dispute aimed at a private person or home, spam, off-topic | `held`, with the reason |

- The poster stays on "Checking…" until the verdict arrives, so the emergency screen shows within seconds.
- **Where the poster sees the result:** live on the "Checking…" screen, and afterwards on their private Me page (§5.4.1).
- **Precedence** when several verdicts apply: `emergency` > `retake` > `reject` > `mute` > `pass`.
  - Exception (2026-10-25, US12): a post with no public-space problem at all (a selfie, off-topic content) is `reject` even when a face or plate is visible, because a retake makes no sense when there's nothing to film. `emergency` still wins.
  - `mute` "addresses" (2026-10-25, US12) means an address tied to a person: where someone lives or works ("John lives at 412 Elm St"). The address or street of the problem itself isn't private, since the location is public anyway (§7.1.1).
  - `reject` needs neither the frames nor the transcript/description to show a problem. A problem that's hard to see in about 6 frames but clearly described (a dark streetlight at dusk, a gas smell) isn't rejected, since held posts are purged after 7 days (§7.1.1).
- **Failure:** if Groq or Claude errors, retry once, then `held` with reason "screening failed."
- **Retake:** the new recording replaces the clip on the **same report**, which goes `held` → `pending` (§2.1.3).
- **Screening failed** (2026-10-24): the poster gets a Try again button that re-runs screening (`held` → `pending`).
- **The poster's result screens** (locked 2026-10-25, US14):
  - Retake is the same format: a video post is re-recorded as a video, a slideshow re-picked as photos. The server refuses a switch. The new files go straight to screening, with no preview step, and the description is kept as it was (it can't be edited).
  - The old files are deleted as soon as the retake is saved, not left for the 7-day purge (§7.1.1), along with the old screening result (category, title, owner, agency, transcript, mute). A retake that reuses an old file is refused.
  - Try again is capped at 2 taps per report (`MAX_SCREENING_RETRIES`); a retake resets the count. After that the poster sees "We still couldn't check this post", a hint to post again (as photos, or filmed in GovTok), and Post another. Reason: some files always fail (iPhone `.mov`, §8), and each tap is a Groq and Claude run.
  - "Post another" shows on Posted, reject, "couldn't find this post", and "screening failed" once the cap is reached. A retake hold never offers it, since a new post would leave this one held instead of replacing its clip. Emergency has "Back to the feed" instead, and "screening failed" has only Try again until the cap.
  - A retake or Try again keeps the original `createdAt`, so days open (§2.1.3) count from the first post, including time spent held. Same as a hand `release`.
  - Debug line, through Oct 30: every held screen shows the raw verdict and reason in small type, and a "screening failed" hold shows what failed (`screeningError`). The stored error is only its first line, cut before any vendor response body (Groq and Claude append JSON that can carry org IDs and rate-limit usage), so a poster sees e.g. "Groq transcription failed (429). Retry after 7 seconds." It stays on screen for both demos. 📌 Removal is tracked in §8.
- `held` → `open` only by hand, in the Convex dashboard. No moderation UI (§8).
  - (2026-10-25, US13) The operator tools are `npx convex run screeningDb:release` and `screeningDb:rescreen`.
    - `release` refuses a report with no category or title (rescreen it instead). A `retake`, `emergency` or `reject` report also needs `"force": true`, because precedence means its audio and text were never checked for `mute`. Releasing bumps `lastActivityAt` (§5.1.2).
    - `rescreen` re-runs screening on a `held` report, or on a `pending` one whose screening died (an action that crashes never retries). Only an operator can rescreen a `pending` report; §2.1.3 lists the `held` → `pending` case. A duplicate run is safe, because a result only lands while the report is still `pending` with the same media.
  - (2026-10-25, US13) "Screening failed" also clears the earlier result (category, title, owner, agency, mute), so a report retaken after a verdict can't be released with the old verdict's fields.
- No blurring: Claude can't give per-frame boxes for a whole video, and re-encoding is too heavy for tonight.
- The mute is a playback flag only. The stored file keeps its audio. 📌 Deferred (§8): strip audio server-side for the pilot.
- **Titles never repeat what a `mute` hides** (locked 2026-10-25, found in the US20 review): Claude writes the public `title` from the same transcript and description that a `mute` hides, so the screening prompt keeps titles free of anything that would trigger `mute`. Titles show on feed cards and as map marker tooltips. US12's title rule already bans names, addresses, house numbers, plates, phone numbers and the street. **Open gap:** slurs aren't in that rule yet.
- Rationale: every outcome resolves without a human, since no one staffs a queue on Sunday morning. Each verdict maps to exactly one action.
- Rejected: hold every flag for human review. Simpler, but held posts would just sit unreviewed.

### 4.3 Resolution

**4.3.1 Proof of fix — geofence + silent clip + Claude before/after check**
- **Geofence:** the fixer's GPS must be within 50 m of the report (the same radius as §4.1.2). Otherwise recording is disabled.
- **Silent capture:** fix clips use the §4.1.1 recorder with `audio: false`. "No commentary" (Scope) is enforced at the source, with no transcription.
- **Claude check:** one Claude call (§1.1.3 model) gets the original report's frames and the fix clip's frames. It returns `verified | not_fixed | retake` and a reason. It asks:
  - Is it the same spot?
  - Is the problem visibly resolved?
  - Any identifiable faces or readable plates? This applies §4.2.1's screening, so no workers are shown.
- On `verified`, set `status: fixed`, `fixStorageId`, `fixedAt`, `fixedBy`, `fixedByKind` and bump `lastActivityAt` (§2.1.1, §2.1.3, §5.1.2). On anything else, show the reason to the fixer, who can retake.
- **Verdict details** (2026-10-25, US22):
  - Precedence: `not_fixed` > `retake` > `verified`. A clip that doesn't show the fix is never published, so a face in it doesn't matter (like §4.2.1's selfie exception).
  - Claude also gets the report's category and title (the title is treated as untrusted data).
  - If Claude errors twice, the attempt is `failed` with "We couldn't check this clip. Try recording it again." An attempt whose report was closed by another fix is `superseded`.
  - Problems that only show at night (a dark streetlight) stay strict: if the repair can't be seen in the clip, the verdict is `not_fixed` and the reason asks for a clip filmed after dark with the light on. §4.2.1 lets such reports through on description alone, so without this they could never be verified from a daytime clip.
  - Reasons are capped at 100 characters in code, on top of the prompt asking for brevity.
- Rationale: the city doesn't declare a fix; Claude checks the footage. This is the trust anchor and the strongest Claude-in-product moment for the Anthropic track. Model: the dealership walk-around video (Scope).
- Rejected: accepting any clip from a valid fixer. Simpler, but it reduces the story to "trust the city."
- Resolves §1.1.3's forward reference: fix clips are muted at capture.

**4.3.2 Proof for problems the city doesn't own — neighbors confirm through the same pipeline**
- Open reports whose owner is `cobb | utility | unknown` (§2.1.2) show an **"Is it fixed?"** button to any resident. It runs the exact §4.3.1 pipeline: 50 m geofence, silent clip, Claude's before/after check.
- City-owned reports (`owner: city`) can be closed only by a fixer (§3.1.2).
- Fixers are **not** limited to their own org's reports. A city crew can close a Cobb report it sees fixed. This settles §3.1.2's forward reference.
- Card label: "Fix confirmed by a neighbor · Cobb DOT" when closed by a resident, "Fixed by Mableton Sanitation" when closed by a fixer.
- Data: `fixedBy` holds either a fixer ID or a resident ID, plus `fixedByKind: fixer | resident` (an addition to §2.1.1).
- Known weaknesses, accepted for the hackathon (2026-10-25, US23):
  - The 50 m check, in the client and again in `submitFix`, trusts the coordinates the phone sends. Report locations are public (§7.1.1), so anyone can claim to be at one. Demo mode relies on exactly this (§6.1.1). What actually gates a fix is Claude's same-spot, problem-resolved check (§4.3.1), not the geofence.
  - There's no limit on fix attempts, and each one is a Claude call.
- Rationale: most reports (roads, stormwater, water, streetlights) aren't the city's. Without this, the most relatable reveal (a pothole) could never happen. It reuses the §4.3.1 code with one extra entry point, and it shows the community holding the county to account. The weak resident identity (§3.1.1) is acceptable because the geofence and Claude's check gate the result, not the identity.
- Rejected:
  - Never closing reports the city doesn't own: a pointed story, but potholes could never show a fix.
  - Only city fixers can close everything: depends on staff happening to drive by.

---

## 5. Surfaces

### 5.1 Feed

**5.1.1 Card layout and before/after reveal — directional; the partner's wireframes own the details**
- *Directional only.* The partner will produce wireframes with Claude Cowork, and those own layout, sizing and motion. This entry fixes only the content and the reveal behavior.
- Card content, following TikTok conventions:
  - Title, street, an owner chip colored by owner (§2.1.2, with the agency name), and status ("Open · N days" / "Fixed in N days").
  - Me too with its count.
  - "Is it fixed?" on open cards the city doesn't own (§4.3.2).
  - An "on map" pin that opens the map at this report (§5.2.1).
  - Captions from transcript segments, except when `audioMuted` (§4.2.1).
- Slideshow posts swipe sideways through their photos. The description shows under the title (hidden when `audioMuted`).
- Sound: phone browsers only autoplay video muted, so the first tap anywhere turns sound on for the session.
- **Reveal (fixed cards):** play the original, then a ~0.7s stamp ("FIXED · N days · <who fixed it>"), then the fix clip, and loop the pair.
  - Build details (2026-10-25, US19): under one day the stamp reads "FIXED · same day", matching the status chip (§6.1.1). A photo post shows its slideshow for 4 s before the stamp. An original clip that fails to load holds on its poster for 4 s, then the stamp and fix still play. A fixed report with no playable fix clip loops original → stamp → original. The fix clip is always muted. 📌 Follow-up (M1): the mockup's "Before / After · proof of fix" chip.
- Rejected:
  - Split screen: halves too narrow on a 9:16 phone.
  - Swipe sideways between before and after: a hidden gesture judges would miss.

**5.1.2 Feed order — most recent activity first**
- Sort by `lastActivityAt`, descending. It's set at creation and bumped by each me-too and by the fix (§2.1.1). One Convex index.
  - (2026-10-25, US13) It's also bumped when a report goes public (screening passes, or a held report is released), so a fresh post tops the feed. Samples are never bumped this way, so they keep their backdated order (§6.1.1).
- Only `open` and `fixed` reports appear (§2.1.3). No personalization (Scope non-goal).
- Rationale: a fresh fix jumps to the top, so reveals get seen (§5.1.1), and problems piling up me-toos rise.
- Build-plan default (2026-10-24): the order is snapshotted when the feed mounts. Counts update live, but cards don't reorder under the user's finger; reopening the feed re-sorts it.

### 5.2 Map

**5.2.1 Map — clustered counts, status colors, linked both ways with the feed (directional) (retconned from "no separate dashboard" to a per-agency triage dashboard)**
- Google Maps with clustered markers (§1.1.2), showing `open` and `fixed` reports. A marker's number is `1 + meTooCount`, and a cluster sums its markers.
- Markers are colored by status (open vs fixed). One **Open / Fixed** toggle.
- Tapping a marker opens the feed at that card (`/?report=<id>`). Each card has an "on map" pin that goes back (§5.1.1).
- ~~City leadership uses the same map. There's no separate dashboard.~~
- **Retcon (2026-10-28):** government groups get a triage dashboard (§5.5), one queue per routing-table agency. The public map is unchanged, and leadership can still use it. Reason: the user wants each group to take ownership of its own issues, which the shared map doesn't support.

### 5.3 Fixer screen

**5.3.1 Fixer screen — nearest-first list → record fix (directional)**
- `/fix` asks for the passcode once (§3.1.2). Then it lists `open` reports nearest first: thumbnail, title, owner chip, days open, me-too count. All owners are listed (§4.3.2).
- Tap a report to watch the original, then **Record fix**, which enables only within 50 m. Then "Checking…", then `verified` or a retake with Claude's reason (§4.3.1).
- Neighbors confirming fixes reuse the same capture and check screens, reached from "Is it fixed?" on a card (§4.3.2).
  - Route (2026-10-25, US23): "Is it fixed?" opens `/confirm/<reportId>`, which shows the report's thumbnail, title and owner chip above the same capture screen. It has no tab bar, like `/fix`.

### 5.4 Me page

**5.4.1 Private Me page (added 2026-10-24, directional)**
- A tab visible only to its owner, keyed by the device token (§3.1.1). No display name, no public URL. The Scope non-goal "public profiles" still holds.
- **My posts:** every report you posted, with live status: Checking… / retake or reject with Claude's reason / Call 911 / "screening failed" with Try again (§4.2.1) / open (days, me-toos) / fixed. A held retake has a **Retake** button (§4.2.1).
- **My me-toos:** reports you me-too'd, with status.
- Fixed items in either list are highlighted, with the reveal (§5.1.1). On stage: "the pothole I posted just got fixed."
- Rationale: the user wants results visible, which matters for the demo. Keeping it private avoids exposing which blocks someone films, usually their own (§7.1.1).
- Rejected: public profiles with display names. They leak which blocks a resident films, and they're a Scope non-goal.

### 5.5 Triage dashboard (added 2026-10-28, M1)

**5.5.1 Shape — overview of all groups + one page per group (directional)**
- `/gov` (public, unlinked, §3.1.3) lists **every** agency in the active routing table (§2.1.2), including those with 0 reports. Groups come from §2.1.4.
  - Each row: agency name, owner chip (§2.1.2 owner labels), open count, fixed count.
  - Sorted by open count, descending. **"Routing unclear"** always sits last, whatever its count.
- Tapping a group opens `/gov/<agency-slug>`, that group's queue (§5.5.2). The slug comes from the agency string, since there's no stored id (§2.1.4).
- Counts are `open` / `fixed` reports only (§2.1.3). They update live: through Convex subscriptions on the Convex build, and by `useLive` polling about every 10 s on the Postgres stack, like the feed and map (§1.1.1). *(Corrected 2026-10-28: Oct 30 runs on Postgres; US44 ports the queries.)*
- Rationale: the overview is the Mayor's "who has what", and the group page is a department's "what's mine". Listing empty agencies is honest and keeps the list stable during the demo.
- Rejected:
  - One page with group filter chips: no comparison across groups at a glance.
  - Per-group pages only: nobody sees the whole picture.

**5.5.2 A group's queue — community-ranked open list + recently fixed (directional)**
- `/gov/<slug>` shows the group's reports (§2.1.4) in two sections:
  - **Open:** sorted by `1 + meTooCount`, descending, with the **newest** `createdAt` first on a tie.
    - **Retcon (2026-10-28, user decision, from the US43 review):** ties were oldest first. A live post has 0 me-toos and is the newest report, so oldest-first put it at the bottom of its agency's list, possibly off-screen during the ~8 s stage beat (§6.1.2). Newest-first puts it at the top of its 0-me-too peers. Me-toos still lead the order.
  - **Recently fixed:** sorted by `fixedAt`, newest first. All fixed reports at M1 scale; a cap is an implementation-time call.
- Row content follows the fixer list (§5.3.1): thumbnail, title, street, days open ("Fixed in N days" for fixed rows, §2.1.3) and me-too count. Public fields only (§3.1.3).
- Tapping a row opens the feed card at `/?report=<id>` (the §5.2.1 deep link), which has the video, the reveal and "on map". No new detail screen.
- Rationale: "your residents ranked this list" uses the signal no 311 form has, and it's the line for the Mayor. Days open still shows on every row. The fixed section shows ownership as results, not as claims (Scope addendum 2026-10-28).
- Rejected:
  - Oldest first: a single-reporter item outranks a pothole 40 neighbors flagged.
  - Me-toos × days: an order nobody can explain on stage.

---

## 6. Demo & impact

### 6.1 Demo

**6.1.1 California sample videos — Sample badge + demo location mode**
- Seeded reports have `isSample: true`, are placed at plausible coordinates in the active city, and show a **"Sample · filmed in California"** badge on the card.
- `?demo=<city id>` swaps the phone's GPS for a fixed point next to the seeds and shows a **"Demo mode: location simulated"** banner. Posting defaults to that point, but a manually selected pin overrides it; the duplicate check (§4.1.2) and the fix geofence (§4.3.1) use their respective selected/current points.
- **City profile** (2026-10-25, US25, user decision; supersedes the Mableton placement for Cal Hacks):
  - Everything runs in San Francisco, where the team and the samples are, and the demo is live at the Palace of Fine Arts.
  - `ACTIVE_CITY` (`convex/lib/city.ts`) is `SAN_FRANCISCO`. It sets the routing table (§2.1.2), "residents of San Francisco, California" in both Claude prompts, the map's default center (Civic Center) and title, and the seed presets (SF street corners).
  - `DEMO_POINT` is on Baker St beside the Palace lagoon, with `?demo=sf`. The pothole preset is 28 m from it and the before/after spot 39 m.
  - ~~Oct 30 sets `ACTIVE_CITY = MABLETON`, which restores the Mableton table, prompts and center, Clay Rd SW as `DEMO_POINT`, and `?demo=mableton`.~~
  - **Retcon (2026-10-28, user decision):** Oct 30 also runs as `SAN_FRANCISCO`, with the SF reports already in the database left as they are. No city flip and no data wipe. Reason: the user wants to demo the SF data. This also avoids leftover SF reports being regrouped under Mableton agencies on `/gov`, since reports have no city field and groups come from the active table (§2.1.4). The Mableton profile stays in code as a one-line switch for the pilot.
  - Stage consequence: nearly every SF category is city-owned, so neighbors can't confirm fixes (§4.3.2, unchanged), and the live before/after is filmed by a fixer through `/fix` ("Fixed by SF Public Works").
  - Pitch: GovTok is built for Mableton (Scope), and both demos show it running for San Francisco. For Oct 30: "switching it to Mableton is one config line: the routing table, prompts and map."
- Stage flow:
  1. Walk up to a seeded pothole: "Is it one of these?" → Me too.
  2. Post a new clip live.
  3. Play a pre-filmed before/after pair of the same California spot. Claude verifies it, and the reveal plays (§5.1.1).
- Needs before/after pairs filmed at the same spot, so Claude's same-spot check passes honestly.
- **Seeding** (sweep, 2026-10-24): an admin-only Convex action runs each sample clip through the real pipeline (transcription, then screening, §1.1.3/§1.1.4/§4.2.1), so Claude really did screen the seeds.
  - Build details (2026-10-25, US25):
    - `/admin/seed` calls `convex/seed.ts`, which checks `ADMIN_PASSCODE` on every call. The raw passcode is sent each time, with no session token and no limit on guesses (see §8).
    - A sample is inserted with `isSample: true` from the start, not after screening. That way going public skips the feed bump (§5.1.2) and the purge skips it (§7.1.1).
    - One batch's screenings run 10 s apart.
    - Seeded video clips must reach the server as MP4 or WebM, because transcription can't read QuickTime. (2026-10-25, US14) The seed page now converts a `.mov` (or a clip over 25 MB or 20.5 s) as soon as it's picked, inside that tap so iPhone keeps the sound; fix clips convert without sound (§4.3.1).
    - A sample's fix clip is filed as a fix attempt only once its report is `open`. If the report is held, the clip is dropped.
    - That attempt uses the report's own location, so the 50 m fix check (§4.3.1) is skipped on purpose. The real `verifyFix` still checks it.
    - A neighbor fix gets a throwaway resident and follows §4.3.2 (never on city-owned reports).
    - A backdated `fixedAt` is applied after the fix is verified. `lastActivityAt` becomes the later of the seeded value and `fixedAt`.
    - In each city profile, the open-pothole preset is nearer `DEMO_POINT` than the before/after spot, so the duplicate check offers the pothole first.
- **Backdating** (2026-10-24): samples may get backdated `createdAt` / `lastActivityAt` / `fixedAt`, so cards read "Open · 23 days" rather than "Open · today". This is acceptable only because the Sample badge labels them.
  - Under one day, feed cards read "Open · today" / "Fixed same day", following the mockup (2026-10-25, US17). The fixer screens still say "0 days".
- **Seed ownership** (2026-10-24): a seeded report can be assigned to the demo phone's resident token, so its Me page shows "the pothole I posted just got fixed" (§5.4.1).
- **Demo-mode upload** (sweep, 2026-10-24): with `?demo=mableton`, capture screens show an "Upload clip" button. Frames come from the file (§4.1.1). Uploaded fix clips always play muted (§4.3.1's "no commentary").
  - (2026-10-25, US14) Posts now have Upload in every mode, not just demo mode, and `.mov` clips are converted (§4.1.1). Fix capture still shows "Upload clip" only in demo mode. Seeding samples still goes through `/admin/seed` (US25), which places them in Mableton with the Sample badge.
- Rationale: the whole flow runs live on stage in Berkeley, the routing and map stay Mableton, and everything simulated is labeled on screen. That matters for the Anthropic track's "real problem" criterion and for the Mayor on Oct 30.
  - Which samples (2026-10-25, US25): the phone owns the before/after spot, so the Me-page beat is the fix Claude just verified on stage. It also owns one pre-fixed, backdated sample, as the fallback if the live check fails.
- **Fix clip audio** (2026-10-25, US25): the player always mutes fix clips, but an uploaded file keeps its audio track in storage. For the demo, the runbook converts every after clip without audio (`ffmpeg -an`), so it's silent at the source as §4.3.1 requires. Uploads by anyone else are deferred (§8).
- **Demo-mode upload** (sweep, 2026-10-24): in demo mode, capture screens show an "Upload clip" button. Frames come from the file (§4.1.1). Uploaded fix clips always play muted (§4.3.1's "no commentary").
- Rationale (2026-10-24, before the city profile): the whole flow runs live on stage in Berkeley, the routing and map stay Mableton, and everything simulated is labeled on screen. That matters for the Anthropic track's "real problem" criterion and for the Mayor on Oct 30.
- Rejected:
  - Samples at their real California locations: Berkeley potholes routed to "Cobb DOT."
  - The Bay Area as a second city: a second routing table, and it weakens the "named community" pitch. *(Reversed for Cal Hacks on 2026-10-25: see "City profile" above.)*
- 📌 Deferred (§8): replace the samples with the Mableton teammate's real footage and turn demo mode off for Oct 30.

**6.1.2 M1 stage beat — one ~8s dashboard beat after the live post (added 2026-10-28)**
- On Oct 30 (`ACTIVE_CITY = SAN_FRANCISCO`, retcon 2026-10-28, see §6.1.1), right after the live post clears screening (§6.1.1 step 2), switch to `/gov`, tap the agency the post was routed to, and show the new report in that group's queue (§5.5.2).
- Line: "Gemini tagged it, the table routed it, SF Public Works owns it." (Say Claude if the Gemini switch, §1.1.3, hasn't shipped.)
- The live post must be a **city-owned category** in the SF table (§2.1.2), so the group on screen is a city department, not a utility. Best is `pothole` or `code_violation`, which go to SF Public Works. Avoid `trash_missed` (Recology, a utility) and `streetlight` (PG&E / SFPUC).
  - **Retcon (2026-10-28):** this originally named the Mableton categories (`trash_missed` or `code_violation`, "Code Enforcement owns it") for a Mableton profile. Oct 30 now stays San Francisco (§6.1.1).
- Upgrade if the stage has two displays: keep `/gov/<slug>` up on a laptop for the whole demo so every beat updates it live. Same build, no extra seconds.
- Rationale: it shows the exact feature (tag → route → ownership) inside the 45s budget (Working agreement) and needs only one projector.
- Rejected:
  - A second screen as the plan: depends on the venue and splits the audience's attention.
  - A slide only: least convincing.

### 6.2 Impact

**6.2.1 Impact metric — a trust survey before and after, plus counters from existing data**
- **Headline:** a before-and-after survey of the 10–20 test-week residents (Google Form, no app code), two questions on a 1–5 scale:
  1. "How much do you believe reported problems in Mableton get fixed?"
  2. "How much do you feel your property taxes are being put to good use?" (tax framing, see Scope addendum)
- **Supporting, from stored data:**
  - **Days to a verified fix:** median, and the share fixed within 30 days, by owner (city / Cobb / utility), from `createdAt` and `fixedAt`. Shows which agency is slow.
  - **Views per fix reveal:** a `revealViews` counter on the report, incremented once per card view per session when the "FIXED" stamp first plays (§5.1.1), not on each loop. Shows whether fixes are actually seen, which is the premise.
    - *(Clarified 2026-10-25, US19:)* once per report per browser session (sessionStorage), counted from the feed only. Me-page reveals (§5.4.1) count only if US24 opts in. *(2026-10-25, US24: not counted.)*
  - **Me-toos as a share of (reports + me-toos):** a proxy for duplicate calls avoided. *(Denominator clarified 2026-10-25, US26.)*
- **For Cal Hacks:** there's no real data yet, so the pitch shows the plan plus the live counters from the demo. One stats query; no dashboard screen.
  - (2026-10-28) The M1 triage dashboard (§5.5) shows only open and fixed counts per group. These impact metrics stay off it; per-group days-to-fix is deferred (§8).
  - (2026-10-25, US25) The counters include the seeded samples. Their dates are backdated by hand, so the slide labels them "from the demo (sample data)", the same way the Sample badge labels the cards. Oct 30 runs `excludeSamples` (US26).
- Rationale: the premise is that visible fixes build trust (Scope), so the headline measures trust, and the counters show the mechanism (fixes happen, and people see them). It answers the Anthropic track's impact plan and Microsoft's "measurable usefulness."
- Rejected: an in-app trust question shown on first visit and after a week. More responses, but a new screen and timing logic. 📌 Deferred (§8).

---

## 7. Privacy

### 7.1 Privacy

**7.1.1 What's public — exact location, no poster identity; held clips purged after 7 days**
- **Location:** exact lat/lng and street are public. Fixers need them, and the 50 m checks depend on them (§4.1.2, §4.3.1). A slideshow or an uploaded clip is pinned to the selected post location (§4.1.1), which defaults to the phone's location but may be manually chosen and is not independently verified.
- **Never public:** no query returns the poster, the me-too list, resident tokens or fixer tokens. The one exception is the Me page (§5.4.1): a query keyed by your own token returns only your own posts and me-toos. Only counts and the fixer's org (§3.1.2) are public.
- **Muted reports:** for `audioMuted` reports (§4.2.1), queries never return the transcript or captions.
- **Retention:**
  - `held` clips (retake / reject / emergency / screening failed; never public) are deleted after 7 days by a Convex cron. The report row and its me-toos go too (2026-10-24). Unverified fix-attempt clips older than 7 days are also deleted.
    - (2026-10-25) Age runs from the newest file upload, so a retake (§4.2.1) restarts the 7 days. Samples (§6.1.1) are never purged, because their `createdAt` is backdated.
  - Published reports (`open` / `fixed`) are kept indefinitely; the public record is the point.
- Rejected:
  - Blurring locations to street level: breaks fixer navigation and the 50 m checks.
  - Expiring published clips: erases the accountability record.

---

## 8. Deferred decisions (record, don't decide)

**Before ship (verify when the product is near finished):**
- Routing table §2.1.2: confirm every owner and agency, especially streetlights (Georgia Power?) and water mains (Cobb Water System?)

**Before Oct 30 (second pass):**
- Reporting by text message (Scope non-goal for Cal Hacks)
- Spanish UI and posts
- Video hosting at pilot scale (free-tier bandwidth)
- Database read bandwidth of the live map query (2026-10-25, accepted for M0): `mapReports` (§5.2.1) reads every public report in full (~1.5–2 KB each, mostly transcript and segments) and re-runs on every write to an open or fixed report while anyone has the map open: posts clearing screening, me-toos, fixes, and reveal-view counts (§6.2.1, one write per viewer per session per fixed card, so ~50 people scrolling past 5 fixed cards add ~250 re-runs). The feed query has the same shape but wasn't measured here. Convex caches it across viewers. At 100 reports that is ~200 KB per re-run, or ~5,000 re-runs in the 1 GiB/month free tier. Revisit when the Convex dashboard shows database bandwidth above ~50% of the free tier, or above ~500 public reports. Options then: move transcript/segments/description into their own table, or keep a slim map-pin table
- Reveal-view counter abuse (2026-10-25, accepted for M0): `recordRevealView` (§6.2.1) takes no token, so a script looping over public report IDs can inflate `revealViews`. Each call is also a write that re-runs the feed and map queries for every viewer (see the bandwidth item above). A resident token wouldn't stop it, since tokens are made on the client (§3.1.1). Options then: a per-resident server-side dedup table, or a rate limit.
- Staff moderation queue for flagged posts (until then, `held` is released by hand in the Convex dashboard, §4.2.1)
- Strip audio server-side from `mute`-verdict clips (§4.2.1)
- Onboarding real fixers (city staff, contractors) with the city
- Mableton test-week logistics
- In-app trust question shown on first visit and after a week (§6.2.1)
- Replace the California samples with real Mableton footage, set `ACTIVE_CITY = MABLETON`, and turn demo mode off (§6.1.1). *(2026-10-28: moved past Oct 30; the Oct 30 demo stays San Francisco with the SF data.)*
- Verify the San Francisco routing rows if the SF profile is kept after Cal Hacks, especially streetlights (SFPUC vs PG&E) and code enforcement (Public Works vs Building Inspection) (§2.1.2)
- Native mobile app with native capture (needs an Apple developer account) (§4.1.1)
- City single sign-on for fixers (§3.1.2)
- A limit on fixer passcode guesses (§3.1.2)
- A limit on proof-of-fix attempts per person and report, since each is a Claude call, plus a geofence that doesn't trust client-sent coordinates (§4.3.2)
- Real resident identity for the pilot (Google sign-in or phone) so me-too counts can be trusted (§3.1.1)
- Reopening a fixed report when the fix didn't hold (§2.1.3)
- Speech-to-text on Google STT for the Google-hosted Oct 30 event (optional)
- Audio in clips for the Mableton pilot (privacy of narration and bystander voices; consider silent clips plus a text note)
- Reports stuck in `pending` (2026-10-25, US13; manual for M0 via `rescreen`, §4.2.1): if Groq or Gemini hangs until the action times out, no retry is scheduled, and the purge only removes `held` reports. Options: request timeouts in `transcribe` / `callGeminiJSON`, or a cron that holds stale `pending` reports as "screening failed"
- iPhone `video/quicktime` clips (native-camera fallback, demo upload) always end "screening failed", because `transcribe` (US11) accepts only mp4/webm. Filed on US11. (2026-10-25, US14) Every in-app path now converts a `.mov` to MP4/WebM in the browser first (posts, fixes, `/admin/video-intake`, and `/admin/seed` via `normalizeClip`, §4.1.1)
- Retake deletes files another report might share (2026-10-25, US14, accepted for M0): `retakeReport` deletes the old clip and frames right away, and `createReport` doesn't check who uploaded a file or whether another report uses it. Someone holding another report's storage ID could post it, get a `retake`, and retake to delete it (purge already allows this after 7 days). Low risk, since no query returns another report's storage IDs: public reports carry file URLs only (`convex/lib/publicReport.ts`). Options then: check uploads belong to the poster, or skip files another report references (needs an index)
- Triage dashboard nice-to-haves (2026-10-28, cut from M1, §5.5): a group sends back a report Claude categorized wrong (re-tag → re-route); per-group stats beyond counts (median days to verified fix, share fixed in 30 days, from §6.2.1); row actions beyond a single tap (watch inline, open on map, record fix)
- Remove the held-post debug line (raw verdict, reason and `screeningError` on the poster's screens, §4.2.1) after Mableton demo day (Oct 30). It stays on for the Cal Hacks and Oct 30 demos

---

## Design queue

### Level 2 (tonight: blocks the Cal Hacks build)
**1.1 Platform**
- ~~1.1.1 App stack (frontend, data, file storage, hosting)~~ ✓ *(Next.js + Convex)*
- ~~1.1.2 Map library~~ ✓ *(Google Maps)*
- ~~1.1.3 Claude: model, and what it receives (frames vs video)~~ ✓ *(Opus 5.5 low; frames + transcript)*
- ~~1.1.4 Speech-to-text engine~~ ✓ *(Groq Whisper turbo)*

**2.1 Reports**
- ~~2.1.1 Report shape (one report, many "me too"s)~~ ✓ *(one clip + me-too taps)*
- ~~2.1.2 Categories and who handles each (Mableton routing table)~~ ✓ *(fixed table, 8 categories)*
- ~~2.1.3 Status lifecycle~~ ✓ *(pending/held/open/fixed)*

**3.1 Identity & roles**
- ~~3.1.1 Resident identity (posting, "me too")~~ ✓ *(device token in DB)*
- ~~3.1.2 Fixer access (who can close a report)~~ ✓ *(passcode per fixer)*

**4.1 Posting**
- ~~4.1.1 Capture (in-page recorder vs native camera, length, resolution)~~ ✓ *(in-page recorder, 720p, 20s; posts are a video or a photo slideshow; GPS-default or manual map pin; fixes video only)*
- ~~4.1.2 Duplicate check when posting~~ ✓ *(selected-location pre-check, 50 m)*

**4.2 Screening**
- ~~4.2.1 What Claude checks, and what happens when something is flagged (incl. emergencies)~~ ✓ *(verdict → automatic action)*

**4.3 Resolution**
- ~~4.3.1 What counts as proof of fix~~ ✓ *(geofence + silent + Claude before/after)*
- ~~4.3.2 Proof for problems the city doesn't own (Cobb, utilities)~~ ✓ *(neighbors confirm, same pipeline)*

**5.1 Feed**
- ~~5.1.1 Card layout and the before/after reveal~~ ✓ *(directional; sequential reveal)*
- ~~5.1.2 Feed order~~ ✓ *(last activity)*

**5.2 Map**
- ~~5.2.1 What the map shows; map ↔ feed link~~ ✓ *(clusters, status colors, two-way link)*

**5.3 Fixer screen**
- ~~5.3.1 Minimal fixer flow~~ ✓ *(nearest-first list → record)*

**5.4 Me page**
- ~~5.4.1 Private Me page~~ ✓ *(added 2026-10-24)*

**6.1 Demo**
- ~~6.1.1 Where the California sample videos appear~~ ✓ *(Sample badge + demo location mode)*

**6.2 Impact**
- ~~6.2.1 Impact metric for the Anthropic submission~~ ✓ *(trust survey + counters)*

**7.1 Privacy**
- ~~7.1.1 What's public: location precision, retention~~ ✓ *(exact location, no poster identity, held purged after 7d)*

### Level 2 (M1: triage dashboard, added 2026-10-28; must-haves only, user call)
**2.1 Reports**
- ~~2.1.4 Group key: how a report maps to a group, including unrouted `other` reports *(absorbed 2.1.5)*~~ ✓ *(derived from category via the active table; "Routing unclear" is its own group)*

**3.1 Identity & roles**
- ~~3.1.3 Dashboard access: who can open it, how their group is chosen, and what they see beyond the public card *(absorbed 7.1.2)*~~ ✓ *(public read-only, unlinked, public fields only)*

**5.5 Triage dashboard**
- ~~5.5.1 Shape: Mayor overview + per-group pages or per-group only, the route, and the open/fixed counts per group *(absorbed the counts from 5.5.5)*~~ ✓ *(`/gov` overview of all agencies + `/gov/<slug>` per group)*
- ~~5.5.2 A group's queue: row contents, default sort, and where tapping a row goes *(absorbed 5.5.3)*~~ ✓ *(open by me-toos, then recently fixed; tap → feed card)*

**6.1 Demo**
- ~~6.1.2 M1 stage beat: where the dashboard appears on Oct 30~~ ✓ *(one ~8s beat after the live post; city-owned category)*

*Cut to §8 (nice-to-have):* ~~5.5.3 Row actions~~ (folded into a single tap target), ~~5.5.4 Mis-tagged reports~~, ~~5.5.5 Per-group stats~~ beyond counts.

---

## Next steps (build)
1. **Scaffold:** Next.js App Router + Convex. Deploy to Vercel immediately so camera access works over HTTPS (§1.1.1).
2. **Keys:** Google Maps browser key + Geocoding key (§1.1.2), `ANTHROPIC_API_KEY` and `GROQ_API_KEY` in Convex env (§1.1.3, §1.1.4).
3. **Schema:** `reports`, `meToos`, `residents`, `fixers`, `fixAttempts` (§2.1.1). Indexes: `lastActivityAt` for the feed (the one index of §5.1.2; the query filters to `open` / `fixed`), and `status`+`lat` for bounding-box queries.
4. **Pipeline:** upload → frames, transcript or photos → one Claude call (structured JSON) → verdict → status (§1.1.3, §4.2.1). Then the fix check (§4.3.1).
5. **Surfaces** (partner, from wireframes): feed + reveal (§5.1), map (§5.2), `/fix` (§5.3), Me page (§5.4), capture screens (§4.1).
6. **Demo:** seed action + `?demo=mableton` (§6.1.1). Film the before/after pairs.
7. **Before ship:** verify the routing table (§8), and source the Mamdani claim and the tax figures before they go in the pitch (Scope).

**Partner handoff (wireframes in Claude Cowork):** read Scope, Scope addendum, §4.1 (capture: video / slideshow / description / duplicate check), §4.2.1 (Checking… and verdict screens, incl. Call 911), §5.1–§5.5, §6.1.1 (Sample badge, demo banner). §5 entries are directional: content and behavior are fixed, layout is the partner's call.

**Triage dashboard (M1, design locked 2026-10-28):** §2.1.4 (group key), §3.1.3 (access), §5.5.1–§5.5.2 (surfaces), §6.1.2 (stage beat). Next: generate M1 cards per CLAUDE.md into `.planning/M1-issues.json` for review. Then build: one Convex query grouping public reports by `routing[category].agency`, then `/gov` and `/gov/<slug>`.

# US46: Tap a feed video to pause and resume it (issue #30, spec §5.1.1)

## Plan
- [x] Feed.tsx: first click only unlocks sound (keeps playing); later clicks on the active video toggle pause/resume.
- [x] Buttons/links never toggle (closest("button, a, ...")); cards with no video or fix clip ignore taps.
- [x] components/feed/PausedIcon.tsx: centered play icon over the active card while paused.
- [x] Swiping clears the pause (new card plays; returning resumes). audioMuted rule untouched.
- [x] Fixed reveals: pause stops the original and fix clip; a `play` guard re-pauses what the reveal's timers start; resume picks the fix clip in its phase, else the original.
- [x] Tests: tests/components/feed/FeedTap.test.tsx
- [x] npm test (1212), tsc, lint, build pass.

## Notes
- The reveal's stamp (0.7s) and a slideshow's 4s hold timers keep running while paused (RevealPlayer untouched, outside this card's files).

## Review (one round)
RUN-CARD-VERDICT: NEEDS_INPUT — fixed-card pause (AC5) is unreliable without a RevealPlayer change
- H1: on a paused fixed card, RevealPlayer's window click handler resumes the original on every tap (even button taps); Feed's play guard re-pauses, and the AbortError path in RevealPlayer's play() can leave the original muted.
- H2: pausing during the 0.7s stamp lets the fix phase's play() get re-paused (AbortError -> back()), restarting the loop at the original; resume then skips the fix clip.
- M1: `tapped` flips on any first click (even a button) and does not know about a swipe/keydown unlock; the first video tap after those is swallowed as the "first tap".
- M2: pause is keyed on the active index; a live reorder could keep a different report paused.
- Tests gap: fixed-reveal case untested; "stray tap-resume" test title overclaims.
Decide: add a small `paused` signal (prop or context) to RevealPlayer.tsx (outside this card's file list), so the reveal pauses its own timers/clips and ignores taps while paused. Then Feed's play guard can be dropped.

## Review fixes (decided by the dispatcher)
- RevealPlayer.tsx: `RevealPausedContext`; stamp and slideshow-hold timers freeze and resume with the time left; the window tap handler ignores taps while paused.
- Feed.tsx: provides the context; the 'play' capture guard is removed; a button tap no longer uses up the first tap.
- Tests: RevealPlayer pause tests (stamp, hold, tap) + FeedTap fixed-card tests (mid-original, mid-stamp, mid-fix, button tap while paused, button doesn't use up first tap).
- Merged origin/main (US40, US47) with --no-commit; convex/_generated/api.d.ts removal staged. Gate after merge: vitest 902 pass, tsc, lint, build OK. No second review round (per dispatcher).
RUN-CARD-VERDICT: CLEAN

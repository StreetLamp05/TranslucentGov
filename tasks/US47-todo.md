# US47: captions at top
- [x] Move caption band to `top-[calc(env(safe-area-inset-top,0px)+78px)]`, line-clamp-3 (CardOverlay.tsx only)
- [x] New test tests/components/feed/CardOverlayCaption.test.tsx (CardOverlay.test.tsx untouched, US40 edits it)
- [x] npm test (1209 pass), build, lint, tsc --noEmit: all green
- [x] review-card: CLEAN, no blocking findings

## Review
Single reviewer, both lenses pass. Notes (no action): env(safe-area-inset-top) is 0 without viewport-fit=cover (same as TabBar/CameraCapture); 78px/right-20 are tuned to Slideshow's dots (66px) and counter (right-3.5), documented in a comment.
## Review fixes
None needed.

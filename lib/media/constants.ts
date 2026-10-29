// Capture limits (§4.1.1): 720p at about 1.5 Mbps for 20 s comes to roughly 4 MB per clip,
// well under the 25 MB clip limit (§1.1.4) and the upload time a phone connection allows.
export const MAX_RECORD_MS = 20_000;
// Stop stays disabled this long after Record, so a double tap can't make an empty clip.
export const MIN_RECORD_MS = 1_000;
export const VIDEO_BITS_PER_SECOND = 1_500_000;
export const AUDIO_BITS_PER_SECOND = 64_000;

// Frames for Claude (§1.1.3): about 6 evenly spaced, 1280 px or less on the long edge.
// Frame 0 doubles as the thumbnail and poster.
export const FRAME_COUNT = 6;
export const FRAME_MAX_EDGE = 1280;
export const FRAME_JPEG_QUALITY = 0.8;
// The live preview is sampled this often while recording; pickEvenly keeps FRAME_COUNT of them.
export const FRAME_SAMPLE_MS = 500;

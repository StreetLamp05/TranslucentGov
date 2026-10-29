// Post limits (§4.1.1), shared by createReport and the post screen. No imports, so the client
// can use them without bundling server code.
export const MAX_DESCRIPTION_LENGTH = 280;
// Must be at least FRAME_COUNT in lib/media/constants.ts (the posts tests check).
export const MAX_VIDEO_FRAMES = 6;
export const MAX_PHOTOS = 10;
// For MAX_CLIP_BYTES (server/lib/clipLimit.ts). In-page clips come to about 4 MB, but a
// camera-app file can be anything.
export const CLIP_TOO_BIG = "That clip is over 25 MB. Try a shorter one.";

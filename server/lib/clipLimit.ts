// The one clip-size limit (§1.1.4): Groq's free-tier file limit, used by posts, the admin
// intake and transcription. 25,000,000 bytes rather than 25 MiB, so a clip that passes here
// is under Groq's limit whichever one Groq means. No imports, so client code can use it.
export const MAX_CLIP_BYTES = 25_000_000;

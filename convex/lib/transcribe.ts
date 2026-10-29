import { MAX_CLIP_BYTES } from "../../server/lib/clipLimit";

declare const process: { env: { GROQ_API_KEY?: string } };

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type Transcription = {
  text: string;
  segments: TranscriptSegment[];
};

function extensionFor(contentType: string): "mp4" | "webm" {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "video/mp4") return "mp4";
  if (type === "video/webm") return "webm";
  throw new Error("Only MP4 and WebM videos can be transcribed.");
}

function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  if (typeof value !== "object" || value === null) return false;
  const segment = value as Record<string, unknown>;
  return (
    typeof segment.start === "number" &&
    Number.isFinite(segment.start) &&
    typeof segment.end === "number" &&
    Number.isFinite(segment.end) &&
    typeof segment.text === "string"
  );
}

export async function transcribe(
  blob: Blob,
  contentType: string,
  fileName = `audio.${extensionFor(contentType)}`,
  apiKey = process.env.GROQ_API_KEY,
): Promise<Transcription> {
  const extension = extensionFor(contentType);
  if (blob.size === 0) throw new Error("The uploaded video is empty.");
  if (blob.size > MAX_CLIP_BYTES) throw new Error("Videos must be 25 MB or smaller.");
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in the Convex environment.");

  const form = new FormData();
  form.append("file", blob, `${fileName.replace(/\.[^.]*$/, "")}.${extension}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    const retryAfter = response.headers.get("retry-after");
    const retryMessage = retryAfter ? ` Retry after ${retryAfter} seconds.` : "";
    throw new Error(`Groq transcription failed (${response.status}).${retryMessage} ${detail}`.trim());
  }

  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) {
    throw new Error("Groq returned an invalid transcription response.");
  }

  const payload = result as Record<string, unknown>;
  if (typeof payload.text !== "string") {
    throw new Error("Groq returned a response without transcript text.");
  }

  const segments = payload.segments;
  const normalizedSegments: TranscriptSegment[] = [];
  if (segments !== undefined) {
    if (!Array.isArray(segments)) {
      throw new Error("Groq returned invalid transcript segments.");
    }
    for (const segment of segments) {
      if (!isTranscriptSegment(segment)) {
        throw new Error("Groq returned invalid transcript segments.");
      }
      normalizedSegments.push({
        start: segment.start,
        end: segment.end,
        text: segment.text,
      });
    }
  }

  return { text: payload.text, segments: normalizedSegments };
}

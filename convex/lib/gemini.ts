import {
  ApiError,
  BlockedReason,
  FinishReason,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  type GenerateContentResponse,
  type Part,
  type SafetySetting,
  type Schema,
} from "@google/genai";

// The one Gemini call shape (§1.1.3), shared by screening (US12/US13) and proof-of-fix (US22).
// Transcription (US32) reuses the client and the error kinds. Server-only: import it from
// Convex actions, never from app/ or lib/, so GEMINI_API_KEY stays in Convex env.

// Flash-Lite runs on the free tier; Pro has no free quota (§1.1.3). GEMINI_MODEL has to be a
// Gemini 3 model: the call sets `thinkingLevel`, which 2.5 models reject with a 400, so every
// report would be held as "screening failed".
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

// Room for low-level thinking plus a short JSON answer. Gemini counts thinking tokens
// against this limit.
const MAX_OUTPUT_TOKENS = 16000;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";
export type ImageInput = { mediaType: ImageMediaType; data: string }; // data is base64

export type GeminiErrorKind = "refusal" | "max_tokens" | "bad_output" | "rate_limited" | "api";

// Every failure throws this. Callers retry once (§4.2.1), waiting `retryAfterMs` when it's set.
export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiErrorKind,
    message: string,
    readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GeminiError";
  }
}

// Inline base64, not URLs: local Convex storage URLs point at localhost, which Google can't fetch.
export function imageBlock({ mediaType, data }: ImageInput): Part {
  return { inlineData: { mimeType: mediaType, data } };
}

const IMAGE_MEDIA_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

// btoa rather than Buffer, so this also works outside "use node" files.
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// For a blob from `ctx.storage.get`. Frames from the browser canvas are JPEGs (§1.1.3).
export async function blobToImage(blob: Blob): Promise<ImageInput> {
  const mediaType = IMAGE_MEDIA_TYPES.includes(blob.type) ? (blob.type as ImageMediaType) : "image/jpeg";
  return { mediaType, data: await blobToBase64(blob) };
}

// `attempts: 1` is the initial call only: the pipeline owns the single retry, so SDK retries
// would stack on top of it.
// Without a key the SDK falls back to Google Cloud default credentials and fails with an error
// that never mentions GEMINI_API_KEY, so name it here.
export function geminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("api", "GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

// A daily-quota 429 asks for a retry hours later, while the poster waits on "Checking…".
// Retry within a minute instead and let a second failure hold the report (§4.2.1).
export const MAX_RETRY_DELAY_MS = 60_000;

// A 429's body carries `google.rpc.RetryInfo` with a delay like "7s" or "0.5s". ApiError's
// message is that body as JSON.
function parseRetryDelay(message: string): number | undefined {
  const delay = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(message)?.[1];
  return delay === undefined ? undefined : Math.min(Number(delay) * 1000, MAX_RETRY_DELAY_MS);
}

// Maps a thrown request error to a GeminiError, for every Gemini call (generateContent, Files API).
export function geminiRequestError(error: unknown): GeminiError {
  if (error instanceof GeminiError) return error;
  if (error instanceof ApiError && error.status === 429) {
    return new GeminiError("rate_limited", `Gemini rate limited: ${error.message}`, parseRetryDelay(error.message), {
      cause: error,
    });
  }
  const detail = error instanceof ApiError ? `${error.status}: ${error.message}` : String(error);
  return new GeminiError("api", `Gemini request failed (${detail})`, undefined, { cause: error });
}

// Every harm filter the Gemini API accepts, turned off (the IMAGE_* categories are Vertex-only).
// A fire, crash or downed line can trip DANGEROUS_CONTENT, and a block ends in "screening
// failed"; the screening prompt has to see those posts to show Call 911 (§4.2.1).
export const SAFETY_SETTINGS: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
  HarmCategory.HARM_CATEGORY_JAILBREAK,
].map((category) => ({ category, threshold: HarmBlockThreshold.OFF }));

// Finish reasons that mean the answer was blocked rather than finished.
const BLOCKED_FINISH: readonly string[] = [
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
];

export async function callGeminiJSON({
  system,
  content,
  schema,
}: {
  system: string;
  content: Part[];
  schema: Schema;
}): Promise<unknown> {
  let response: GenerateContentResponse;
  try {
    response = await geminiClient().models.generateContent({
      model: geminiModel(),
      contents: [{ role: "user", parts: content }],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Gemini 3's counterpart to Claude's effort "low".
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        safetySettings: SAFETY_SETTINGS,
      },
    });
  } catch (error) {
    throw geminiRequestError(error);
  }

  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason && blockReason !== BlockedReason.BLOCKED_REASON_UNSPECIFIED) {
    throw new GeminiError("refusal", `Gemini blocked the prompt (reason: ${blockReason})`);
  }
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && BLOCKED_FINISH.includes(finishReason)) {
    throw new GeminiError("refusal", `Gemini blocked the response (reason: ${finishReason})`);
  }
  if (finishReason === FinishReason.MAX_TOKENS) {
    throw new GeminiError("max_tokens", "Gemini hit maxOutputTokens before finishing its JSON");
  }
  if (finishReason !== FinishReason.STOP) {
    throw new GeminiError("bad_output", `Unexpected Gemini finishReason: ${finishReason ?? "none"}`);
  }

  try {
    return JSON.parse(response.text ?? "");
  } catch (error) {
    throw new GeminiError("bad_output", "Gemini returned text that isn't JSON", undefined, { cause: error });
  }
}

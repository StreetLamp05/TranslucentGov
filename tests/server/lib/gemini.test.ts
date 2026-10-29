import { ApiError, Type } from "@google/genai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  blobToImage,
  callGeminiJSON,
  DEFAULT_GEMINI_MODEL,
  GeminiError,
  geminiRequestError,
  imageBlock,
  MAX_RETRY_DELAY_MS,
  SAFETY_SETTINGS,
} from "../../../server/lib/gemini";

const { generateContent, construct } = vi.hoisted(() => ({ generateContent: vi.fn(), construct: vi.fn() }));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class FakeGoogleGenAI {
    models = { generateContent };
    constructor(options: unknown) {
      construct(options);
    }
  }
  return { ...actual, GoogleGenAI: FakeGoogleGenAI };
});

const SCHEMA = { type: Type.OBJECT, required: ["ok"], properties: { ok: { type: Type.BOOLEAN } } };
const CONTENT = [{ text: "hi" }];

function reply(text: string | undefined, finishReason = "STOP", extra: object = {}) {
  return { candidates: [{ finishReason }], text, ...extra };
}

async function callError() {
  return callGeminiJSON({ system: "s", content: CONTENT, schema: SCHEMA }).then(
    () => expect.unreachable("expected callGeminiJSON to throw"),
    (error: unknown) => error as GeminiError,
  );
}

// The body Gemini sends with a 429, which ApiError carries as its message.
function rateLimited(retryDelay?: string) {
  const details = retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : [];
  const body = { error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED", details } };
  return new ApiError({ message: JSON.stringify(body), status: 429 });
}

beforeEach(() => {
  generateContent.mockReset();
  construct.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL", "gemini-test-model");
});
afterEach(() => vi.unstubAllEnvs());

describe("callGeminiJSON", () => {
  test("sends the configured model with the system prompt, parts and responseSchema", async () => {
    generateContent.mockResolvedValue(reply('{"ok":true}'));
    await expect(callGeminiJSON({ system: "sys", content: CONTENT, schema: SCHEMA })).resolves.toEqual({ ok: true });

    // attempts 1 means no SDK retries: the pipeline owns the single retry.
    expect(construct).toHaveBeenCalledWith({ apiKey: "test-key", httpOptions: { retryOptions: { attempts: 1 } } });
    expect(generateContent.mock.calls[0][0]).toMatchObject({
      model: "gemini-test-model",
      contents: [{ role: "user", parts: CONTENT }],
      config: {
        systemInstruction: "sys",
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        maxOutputTokens: 16000,
        thinkingConfig: { thinkingLevel: "LOW" },
        safetySettings: SAFETY_SETTINGS,
      },
    });
  });

  test("turns off every harm filter the Gemini API accepts, so emergency posts reach the prompt", async () => {
    generateContent.mockResolvedValue(reply("{}"));
    await callGeminiJSON({ system: "s", content: CONTENT, schema: SCHEMA });
    const settings = generateContent.mock.calls[0][0].config.safetySettings;
    expect(settings).toEqual(
      [
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
        "HARM_CATEGORY_CIVIC_INTEGRITY",
        "HARM_CATEGORY_JAILBREAK",
      ].map((category) => ({ category, threshold: "OFF" })),
    );
  });

  test("defaults the model when GEMINI_MODEL is unset", async () => {
    vi.stubEnv("GEMINI_MODEL", "");
    generateContent.mockResolvedValue(reply("{}"));
    await callGeminiJSON({ system: "s", content: CONTENT, schema: SCHEMA });
    expect(generateContent.mock.calls[0][0].model).toBe(DEFAULT_GEMINI_MODEL);
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
  });

  test("a missing GEMINI_API_KEY throws api naming the key, without calling Gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const error = await callError();
    expect(error.kind).toBe("api");
    expect(error.message).toContain("GEMINI_API_KEY");
    expect(construct).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  test("a blocked prompt throws refusal", async () => {
    generateContent.mockResolvedValue({ promptFeedback: { blockReason: "SAFETY" }, candidates: undefined, text: undefined });
    const error = await callError();
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.kind).toBe("refusal");
    expect(error.message).toContain("SAFETY");
  });

  test.each(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"])(
    "a response blocked with %s throws refusal",
    async (finishReason) => {
      generateContent.mockResolvedValue(reply(undefined, finishReason));
      const error = await callError();
      expect(error.kind).toBe("refusal");
      expect(error.message).toContain(finishReason);
    },
  );

  test("MAX_TOKENS throws max_tokens", async () => {
    generateContent.mockResolvedValue(reply('{"ok":', "MAX_TOKENS"));
    expect((await callError()).kind).toBe("max_tokens");
  });

  test.each(["RECITATION", "OTHER", undefined])("finish reason %s throws bad_output", async (finishReason) => {
    generateContent.mockResolvedValue({ candidates: [{ finishReason }], text: '{"ok":true}' });
    expect((await callError()).kind).toBe("bad_output");
  });

  test("no candidates at all throws bad_output", async () => {
    generateContent.mockResolvedValue({ candidates: [], text: undefined });
    expect((await callError()).kind).toBe("bad_output");
  });

  test.each(["not json", undefined])("text %j that isn't JSON throws bad_output", async (text) => {
    generateContent.mockResolvedValue(reply(text));
    expect((await callError()).kind).toBe("bad_output");
  });

  test("a 429 surfaces RetryInfo's delay in milliseconds", async () => {
    generateContent.mockRejectedValue(rateLimited("7s"));
    const error = await callError();
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterMs).toBe(7000);
  });

  test("a 429 keeps a fractional delay", async () => {
    generateContent.mockRejectedValue(rateLimited("0.5s"));
    expect((await callError()).retryAfterMs).toBe(500);
  });

  test("a daily-quota 429's hours-long delay is capped, so the poster isn't left on Checking…", async () => {
    generateContent.mockRejectedValue(rateLimited("21093s"));
    expect((await callError()).retryAfterMs).toBe(MAX_RETRY_DELAY_MS);
  });

  test("a 429 without RetryInfo leaves the delay to the caller", async () => {
    generateContent.mockRejectedValue(rateLimited());
    const error = await callError();
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterMs).toBeUndefined();
  });

  test("other API errors throw api with the status first, before the vendor's JSON", async () => {
    const cause = new ApiError({ message: '{"error":{"code":500,"message":"Internal"}}', status: 500 });
    generateContent.mockRejectedValue(cause);
    const error = await callError();
    expect(error.kind).toBe("api");
    expect(error.message).toMatch(/^Gemini request failed \(500: \{/);
    expect(error.retryAfterMs).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  test("a network error throws api with the cause", async () => {
    const cause = new Error("socket hang up");
    generateContent.mockRejectedValue(cause);
    const error = await callError();
    expect(error.kind).toBe("api");
    expect(error.cause).toBe(cause);
  });
});

describe("geminiRequestError", () => {
  test("passes a GeminiError through unchanged", () => {
    const error = new GeminiError("bad_output", "x");
    expect(geminiRequestError(error)).toBe(error);
  });
});

describe("images", () => {
  test("imageBlock is an inline base64 part", () => {
    expect(imageBlock({ mediaType: "image/png", data: "AAAA" })).toEqual({ inlineData: { mimeType: "image/png", data: "AAAA" } });
  });

  test("blobToImage base64-encodes the blob and keeps its image type", async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    const image = await blobToImage(new Blob([bytes], { type: "image/png" }));
    expect(image.mediaType).toBe("image/png");
    expect(Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  test("blobToImage treats an untyped blob as a JPEG frame", async () => {
    expect((await blobToImage(new Blob([new Uint8Array([1, 2, 3])]))).mediaType).toBe("image/jpeg");
  });
});

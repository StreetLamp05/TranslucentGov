import { ApiError, FileState } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "./gemini";
import { FILE_POLL_MS, FILE_READY_TIMEOUT_MS, MAX_INLINE_BYTES, transcribe, TRANSCRIPT_SCHEMA } from "./transcribe";

const { generateContent, upload, get, remove } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  upload: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class FakeGoogleGenAI {
    models = { generateContent };
    files = { upload, get, delete: remove };
  }
  return { ...actual, GoogleGenAI: FakeGoogleGenAI };
});

function answer(segments: unknown) {
  return { candidates: [{ finishReason: "STOP" }], text: JSON.stringify({ segments }) };
}

function request() {
  return generateContent.mock.calls[0][0] as {
    contents: { parts: { inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string; mimeType: string } }[] }[];
    config: { responseSchema: unknown };
  };
}

// Over the inline limit, under MAX_CLIP_BYTES.
const bigClip = () => new Blob([new Uint8Array(MAX_INLINE_BYTES + 1)], { type: "video/mp4" });
const uploaded = (state: FileState) => ({
  name: "files/abc",
  uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
  mimeType: "video/mp4",
  state,
});

beforeEach(() => {
  for (const mock of [generateContent, upload, get, remove]) mock.mockReset();
  remove.mockResolvedValue({});
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("transcribe", () => {
  it("sends a small clip inline and returns text with timestamped segments", async () => {
    generateContent.mockResolvedValue(
      answer([
        { start: 0.2, end: 1.4, text: " There is a pothole here. " },
        { start: 1.5, end: 3, text: "It's been here since June." },
      ]),
    );

    const result = await transcribe(new Blob(["video bytes"], { type: "video/mp4" }), "video/mp4", "clip.mp4");

    expect(result).toEqual({
      text: "There is a pothole here. It's been here since June.",
      segments: [
        { start: 0.2, end: 1.4, text: "There is a pothole here." },
        { start: 1.5, end: 3, text: "It's been here since June." },
      ],
    });
    const { contents, config } = request();
    expect(contents[0].parts[0].inlineData).toEqual({ mimeType: "video/mp4", data: btoa("video bytes") });
    expect(config.responseSchema).toBe(TRANSCRIPT_SCHEMA);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a clip over the inline limit through the Files API, waits for it, then deletes it", async () => {
    vi.useFakeTimers();
    upload.mockResolvedValue(uploaded(FileState.PROCESSING));
    get.mockResolvedValueOnce(uploaded(FileState.PROCESSING)).mockResolvedValueOnce(uploaded(FileState.ACTIVE));
    generateContent.mockResolvedValue(answer([{ start: 0, end: 2, text: "Streetlight is out." }]));

    const result = transcribe(bigClip(), "video/mp4; codecs=avc1", "big.mp4");
    await vi.advanceTimersByTimeAsync(FILE_POLL_MS * 2);

    await expect(result).resolves.toEqual({
      text: "Streetlight is out.",
      segments: [{ start: 0, end: 2, text: "Streetlight is out." }],
    });
    expect(upload).toHaveBeenCalledWith({
      file: expect.any(Blob),
      config: { mimeType: "video/mp4", displayName: "big.mp4" },
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(request().contents[0].parts[0].fileData).toEqual({
      fileUri: uploaded(FileState.ACTIVE).uri,
      mimeType: "video/mp4",
    });
    expect(remove).toHaveBeenCalledWith({ name: "files/abc" });
  });

  it("deletes the uploaded file when transcription fails", async () => {
    upload.mockResolvedValue(uploaded(FileState.ACTIVE));
    generateContent.mockResolvedValue({ candidates: [{ finishReason: "MAX_TOKENS" }], text: "{" });

    await expect(transcribe(bigClip(), "video/mp4")).rejects.toMatchObject({ kind: "max_tokens" });
    expect(remove).toHaveBeenCalledWith({ name: "files/abc" });
  });

  it("gives up on a file that never finishes processing", async () => {
    vi.useFakeTimers();
    upload.mockResolvedValue(uploaded(FileState.PROCESSING));
    get.mockResolvedValue(uploaded(FileState.PROCESSING));

    const result = transcribe(bigClip(), "video/mp4").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(FILE_READY_TIMEOUT_MS + FILE_POLL_MS);

    expect(await result).toMatchObject({ kind: "api", message: "Gemini took too long to process the video" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it("fails on a file Gemini couldn't process, and still deletes it", async () => {
    upload.mockResolvedValue({ ...uploaded(FileState.FAILED), error: { message: "unsupported codec" } });

    await expect(transcribe(bigClip(), "video/mp4")).rejects.toMatchObject({
      kind: "api",
      message: "Gemini couldn't process the video (unsupported codec)",
    });
    expect(generateContent).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ name: "files/abc" });
  });

  it("still returns the transcript when deleting the file fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    upload.mockResolvedValue(uploaded(FileState.ACTIVE));
    remove.mockRejectedValue(new Error("delete failed"));
    generateContent.mockResolvedValue(answer([{ start: 0, end: 1, text: "Hello." }]));

    await expect(transcribe(bigClip(), "video/mp4")).resolves.toMatchObject({ text: "Hello." });
  });

  it("maps a failed upload to a GeminiError with the 429's retry delay", async () => {
    const details = [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" }];
    upload.mockRejectedValue(
      new ApiError({ message: JSON.stringify({ error: { code: 429, details } }), status: 429 }),
    );

    const error = await transcribe(bigClip(), "video/mp4").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error).toMatchObject({ kind: "rate_limited", retryAfterMs: 7000 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("returns an empty transcript for a silent clip", async () => {
    generateContent.mockResolvedValue(answer([]));

    await expect(transcribe(new Blob(["silent video"]), "video/webm", "near-silent.webm")).resolves.toEqual({
      text: "",
      segments: [],
    });
  });

  it("drops blank segments, keeps start ≤ end and sorts by start", async () => {
    generateContent.mockResolvedValue(
      answer([
        { start: 3, end: 2.5, text: "Bye." },
        { start: -0.1, end: 1, text: "Hello." },
        { start: 1, end: 1.2, text: "  " },
      ]),
    );

    await expect(transcribe(new Blob(["video"]), "video/mp4")).resolves.toEqual({
      text: "Hello. Bye.",
      segments: [
        { start: 0, end: 1, text: "Hello." },
        { start: 3, end: 3, text: "Bye." },
      ],
    });
  });

  it("rejects malformed segments as bad_output", async () => {
    generateContent.mockResolvedValue(answer([{ start: "0", end: 1, text: "Hi" }]));

    await expect(transcribe(new Blob(["video"]), "video/mp4")).rejects.toMatchObject({ kind: "bad_output" });
  });

  it("supports the two-argument caller signature (screening)", async () => {
    generateContent.mockResolvedValue(answer([{ start: 0, end: 1, text: "Hello." }]));

    await expect(transcribe(new Blob(["video"]), "video/webm")).resolves.toMatchObject({ text: "Hello." });
    expect(request().contents[0].parts[0].inlineData?.mimeType).toBe("video/webm");
  });

  it("names GEMINI_API_KEY when it isn't set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(transcribe(new Blob(["video"]), "video/mp4")).rejects.toMatchObject({
      kind: "api",
      message: "GEMINI_API_KEY is not set",
    });
  });

  it("rejects unsupported, empty and oversized videos before calling Gemini", async () => {
    await expect(transcribe(new Blob(["video"]), "video/quicktime", "clip.mov")).rejects.toThrow(
      "Only MP4 and WebM videos can be transcribed.",
    );
    await expect(transcribe(new Blob([]), "video/mp4")).rejects.toThrow("The uploaded video is empty.");
    await expect(transcribe(new Blob([new Uint8Array(25_000_001)]), "video/mp4")).rejects.toThrow(
      "Videos must be 25 MB or smaller.",
    );
    expect(generateContent).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

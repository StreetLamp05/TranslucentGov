import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/server/lib/gemini";
import { translateSegments, TRANSLATE_SCHEMA } from "@/server/lib/translateSegments";

const { callGeminiJSON } = vi.hoisted(() => ({ callGeminiJSON: vi.fn() }));
vi.mock("@/server/lib/gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/lib/gemini")>()),
  callGeminiJSON,
}));

const SEGMENTS = [
  { start: 0, end: 1.5, text: "There is a pothole." },
  { start: 2, end: 4, text: "It is on Floyd Rd." },
];

beforeEach(() => callGeminiJSON.mockReset());

describe("translateSegments", () => {
  it("makes one call with just the lines, and keeps the original timings", async () => {
    callGeminiJSON.mockResolvedValue({ texts: [" Hay un bache. ", "Está en Floyd Rd."] });

    await expect(translateSegments(SEGMENTS)).resolves.toEqual([
      { start: 0, end: 1.5, text: "Hay un bache." },
      { start: 2, end: 4, text: "Está en Floyd Rd." },
    ]);

    expect(callGeminiJSON).toHaveBeenCalledTimes(1);
    const call = callGeminiJSON.mock.calls[0][0];
    expect(call.schema).toBe(TRANSLATE_SCHEMA);
    expect(call.content).toEqual([{ text: JSON.stringify(["There is a pothole.", "It is on Floyd Rd."]) }]);
  });

  it("rejects an answer with a different number of lines", async () => {
    callGeminiJSON.mockResolvedValue({ texts: ["Hay un bache."] });
    await expect(translateSegments(SEGMENTS)).rejects.toMatchObject({ kind: "bad_output" });
  });

  it("rejects an answer that isn't strings", async () => {
    callGeminiJSON.mockResolvedValue({ texts: ["Hay un bache.", 2] });
    await expect(translateSegments(SEGMENTS)).rejects.toBeInstanceOf(GeminiError);
  });
});

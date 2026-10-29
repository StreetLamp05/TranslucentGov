import { describe, expect, test } from "vitest";
import { MAX_SCREENING_ERROR_LENGTH, SCREENING_FAILED_REASON, screeningErrorSummary } from "../../../convex/lib/screening";

test("the screening-failed reason is the §4.2.1 string", () => {
  expect(SCREENING_FAILED_REASON).toBe("screening failed");
});

// What a "screening failed" poster sees in the debug line (US14): no vendor response bodies.
describe("screeningErrorSummary", () => {
  test.each([
    [
      "a plain-text error drops the response body after it (org ID, usage)",
      'Transcription failed (429). Retry after 7 seconds. {"error":{"message":"Rate limit reached in organization org_01abc: Limit 7200, Used 7190"}}',
      "Transcription failed (429). Retry after 7 seconds.",
    ],
    [
      "a Gemini API error drops the SDK's JSON and closes the bracket",
      'Gemini request failed (500: {"error":{"code":500,"message":"Internal error","status":"INTERNAL"}})',
      "Gemini request failed (500)",
    ],
    [
      "a Gemini rate limit drops the RetryInfo body",
      'Gemini rate limited: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"7s"}]}}',
      "Gemini rate limited",
    ],
    [
      "a Claude API error drops the SDK's JSON and closes the bracket",
      'Claude request failed (500: 500 {"type":"error","error":{"type":"api_error"},"request_id":"req_123"})',
      "Claude request failed (500: 500)",
    ],
    ["a Claude rate limit keeps the status", 'Claude rate limited: 429 {"type":"error"}', "Claude rate limited: 429"],
    ["a plain message is unchanged", "Only MP4 and WebM videos can be transcribed.", "Only MP4 and WebM videos can be transcribed."],
    ["only the first line is kept", "line one\nline two", "line one"],
    ["nothing left means unknown", '{"only":"json"}', "unknown error"],
  ])("%s", (_, message, expected) => {
    expect(screeningErrorSummary(message)).toBe(expected);
    expect(screeningErrorSummary(message)).not.toMatch(/org_|request_id|Used/);
  });

  test(`caps the length at ${MAX_SCREENING_ERROR_LENGTH}`, () => {
    expect(screeningErrorSummary("x".repeat(2000))).toHaveLength(MAX_SCREENING_ERROR_LENGTH);
  });
});

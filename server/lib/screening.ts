// The `reason` on a report that's held because Groq or Gemini failed twice (§4.2.1).
// US13 writes it; the poster's Try again button (US14, US24) matches on it.
export const SCREENING_FAILED_REASON = "screening failed";

// Try again taps per report after "screening failed" (§4.2.1). A retake resets the count.
export const MAX_SCREENING_RETRIES = 2;

// How much of the error a "screening failed" hold keeps for the poster's debug line (US14).
export const MAX_SCREENING_ERROR_LENGTH = 500;

// The error, trimmed to what a poster may see: its first line, cut before any response body
// (Groq and the Gemini SDK append the vendor's JSON, which can carry org IDs and rate-limit
// usage). Enough to tell Groq from Gemini and a 429 from a 500.
export function screeningErrorSummary(message: string): string {
  let summary = message.split("\n")[0];
  const body = summary.search(/[{[]/);
  if (body !== -1) summary = summary.slice(0, body);
  summary = summary.trim().replace(/[\s:,(]+$/, "");
  if ((summary.match(/\(/g) ?? []).length > (summary.match(/\)/g) ?? []).length) summary += ")";
  return summary.slice(0, MAX_SCREENING_ERROR_LENGTH) || "unknown error";
}

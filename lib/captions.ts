import type { Locale } from "@/lib/i18n/locale";
import type { PublicReport } from "@/server/lib/publicReport";

export type CaptionSegment = NonNullable<PublicReport["segments"]>[number];

/**
 * The caption on screen at `time` seconds into the clip (§5.1.1): the segment with
 * `start <= time < end`, or null in a gap, before the first or after the last. If segments
 * overlap, the later one wins, since it's the one that just started.
 */
export function captionAt(segments: readonly CaptionSegment[] | undefined, time: number): string | null {
  let text: string | null = null;
  for (const segment of segments ?? []) {
    const trimmed = segment.text.trim();
    if (trimmed && segment.start <= time && time < segment.end) text = trimmed;
  }
  return text;
}

/**
 * The segments to caption a report in `locale` (US48): the Spanish ones when ES is chosen, and
 * the original when a report has none (older than US48, or Gemini sent none). Muted reports
 * have none (§4.2.1).
 */
export function captionSegments(
  report: Pick<PublicReport, "audioMuted" | "segments" | "segmentsEs">,
  locale: Locale,
): readonly CaptionSegment[] | undefined {
  if (report.audioMuted) return undefined;
  return locale === "es" && report.segmentsEs?.length ? report.segmentsEs : report.segments;
}

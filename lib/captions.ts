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

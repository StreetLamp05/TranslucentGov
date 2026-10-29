import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { videoIntake } from "../db/schema";
import { transcribe } from "../lib/transcribe";
import { readObject } from "../storage";

// Transcribes an admin intake video with Gemini (§1.1.4). Enqueued as `transcribeVideo { id }` by
// saveUpload (server/videoIntake.ts). Any failure is saved on the entry, which the page shows;
// there's no retry (server/jobs.ts), so the entry stays `failed`.

export const TRANSCRIBE_VIDEO = "transcribeVideo";
export type TranscribeVideoPayload = { id: string };

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

export async function transcribeVideo({ id }: TranscribeVideoPayload): Promise<void> {
  // One run at a time per entry: the update only matches an entry nobody has claimed.
  const [entry] = await db
    .update(videoIntake)
    .set({ status: "transcribing", error: null, updatedAt: Date.now() })
    .where(and(eq(videoIntake.id, id), inArray(videoIntake.status, ["uploaded", "failed"])))
    .returning();
  if (!entry) {
    console.warn(`transcribeVideo: ${id} is missing or already being transcribed`);
    return;
  }

  try {
    const bytes = await readObject(entry.storageId);
    const blob = new Blob([bytes as BlobPart], { type: entry.contentType });
    const result = await transcribe(blob, entry.contentType, entry.fileName);
    await db
      .update(videoIntake)
      .set({ status: "complete", transcript: result.text, segments: result.segments, error: null, updatedAt: Date.now() })
      .where(eq(videoIntake.id, id));
  } catch (error) {
    console.error(`transcribeVideo: ${id} failed:`, error);
    await db
      .update(videoIntake)
      .set({ status: "failed", error: cleanError(error), updatedAt: Date.now() })
      .where(eq(videoIntake.id, id));
  }
}

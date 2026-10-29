"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { transcribe, type Transcription } from "./lib/transcribe";

// The Gemini SDK's Files API upload (clips over MAX_INLINE_BYTES) only runs on Node: the
// default runtime aborts the whole action with "Not implemented: set host for URL", which
// skips videoIntake's failure handling and leaves the entry stuck on "transcribing". So
// `videoIntake.transcribeVideo` keeps its signature and hands the Gemini call to this.
export const transcribeStored = internalAction({
  args: { storageId: v.id("_storage"), contentType: v.string(), fileName: v.string() },
  handler: async (ctx, { storageId, contentType, fileName }): Promise<Transcription> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("The uploaded video could not be found in Convex storage.");
    return await transcribe(blob, contentType, fileName);
  },
});

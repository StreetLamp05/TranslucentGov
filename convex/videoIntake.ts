import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { MAX_CLIP_BYTES } from "./lib/clipLimit";
import type { Transcription } from "./lib/transcribe";
import { validateVideoMetadata } from "./lib/videoIntakeValidation";

const INTAKE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

export const generateUploadUrl = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await ctx.runQuery(internal.videoIntakeDb.requireAdminSession, { token: sessionToken });
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveUpload = mutation({
  args: {
    sessionToken: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.videoIntakeDb.requireAdminSession, { token: args.sessionToken });
    const storedFile = await ctx.db.system.get(args.storageId);
    if (!storedFile) {
      throw new Error("Uploaded video size does not match the validated file size.");
    }
    let contentType: string;
    try {
      contentType = validateVideoMetadata(args.contentType, args.fileSize);
      if (storedFile.size !== args.fileSize || storedFile.size > MAX_CLIP_BYTES) {
        throw new Error("Uploaded video size does not match the validated file size.");
      }
    } catch (error) {
      await ctx.storage.delete(args.storageId);
      throw error;
    }

    const now = Date.now();
    const id = await ctx.db.insert("videoIntake", {
      storageId: args.storageId,
      fileName: args.fileName.trim().slice(0, 255) || `video.${contentType === "video/mp4" ? "mp4" : "webm"}`,
      contentType,
      fileSize: args.fileSize,
      status: "uploaded",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(INTAKE_RETENTION_MS, internal.videoIntake.purgeExpired, { id });
    return id;
  },
});

export const get = query({
  args: { id: v.id("videoIntake"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.videoIntakeDb.requireAdminSession, { token: args.sessionToken });
    return await ctx.db.get(args.id);
  },
});

export const listRecent = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await ctx.runQuery(internal.videoIntakeDb.requireAdminSession, { token: sessionToken });
    return await ctx.db.query("videoIntake").withIndex("by_created_at").order("desc").take(20);
  },
});

export const claimForTranscription = internalMutation({
  args: { id: v.id("videoIntake") },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.id);
    if (!entry || (entry.status !== "uploaded" && entry.status !== "failed")) return null;

    await ctx.db.patch(args.id, {
      status: "transcribing",
      error: undefined,
      updatedAt: Date.now(),
    });
    return entry;
  },
});

export const saveTranscript = internalMutation({
  args: {
    id: v.id("videoIntake"),
    transcript: v.string(),
    segments: v.array(v.object({ start: v.number(), end: v.number(), text: v.string() })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "complete",
      transcript: args.transcript,
      segments: args.segments,
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const saveFailure = internalMutation({
  args: { id: v.id("videoIntake"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
    });
  },
});

export const purgeExpired = internalMutation({
  args: { id: v.id("videoIntake") },
  handler: async (ctx, { id }) => {
    const entry = await ctx.db.get(id);
    if (!entry || entry.createdAt > Date.now() - INTAKE_RETENTION_MS) return;
    await ctx.storage.delete(entry.storageId);
    await ctx.db.delete(id);
  },
});

export const transcribeVideo = action({
  args: { id: v.id("videoIntake"), sessionToken: v.string() },
  handler: async (ctx, args): Promise<Transcription> => {
    await ctx.runQuery(internal.videoIntakeDb.requireAdminSession, { token: args.sessionToken });
    const entry = await ctx.runMutation(internal.videoIntake.claimForTranscription, { id: args.id });
    if (!entry) throw new Error("This video is missing or is already being transcribed.");

    try {
      // On Node, for the Gemini Files API (convex/videoIntakeTranscribe.ts).
      const result: Transcription = await ctx.runAction(internal.videoIntakeTranscribe.transcribeStored, {
        storageId: entry.storageId,
        contentType: entry.contentType,
        fileName: entry.fileName,
      });
      await ctx.runMutation(internal.videoIntake.saveTranscript, {
        id: args.id,
        transcript: result.text,
        segments: result.segments,
      });
      return result;
    } catch (error) {
      await ctx.runMutation(internal.videoIntake.saveFailure, {
        id: args.id,
        error: cleanError(error),
      });
      throw error;
    }
  },
});

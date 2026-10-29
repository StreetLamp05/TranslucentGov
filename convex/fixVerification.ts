"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { blobToImage, GeminiError } from "./lib/gemini";
import { checkFix } from "./lib/fixPrompt";

// Wait before the retry when Gemini didn't send a retry delay.
export const RETRY_DELAY_MS = 1000;
export const FAILED_REASON = "We couldn't check this clip. Try recording it again.";

async function loadImages(ctx: ActionCtx, storageIds: Id<"_storage">[]) {
  return Promise.all(
    storageIds.map(async (id) => {
      const blob = await ctx.storage.get(id);
      if (!blob) throw new Error(`Fix check: file ${id} is missing from storage`);
      return blobToImage(blob);
    }),
  );
}

// Signature from US5; mutations live in fixVerificationDb.ts, because a "use node" file can
// only contain actions. The proof-of-fix check (§4.3.1): the original's images go in as BEFORE,
// the fix clip's frames as AFTER, and Gemini's verdict closes the report or goes back to the
// person filming.
export const verifyFix = internalAction({
  // `attempt` counts tries: omitted or 0 is the first, and a retry reschedules with attempt + 1.
  args: { attemptId: v.id("fixAttempts"), attempt: v.optional(v.number()) },
  handler: async (ctx, { attemptId, attempt = 0 }) => {
    // beginCheck sits inside the try too, so a transient failure there still ends in a retry
    // or `failed` instead of leaving the attempt on "Checking…".
    try {
      const check = await ctx.runMutation(internal.fixVerificationDb.beginCheck, { attemptId });
      if (!check) return;

      const [before, after] = await Promise.all([
        loadImages(ctx, check.beforeStorageIds),
        loadImages(ctx, check.afterStorageIds),
      ]);
      const { verdict, reason } = await checkFix({
        before,
        beforeKind: check.beforeKind,
        after,
        category: check.category,
        title: check.title,
      });
      await ctx.runMutation(internal.fixVerificationDb.applyFixVerdict, { attemptId, verdict, reason });
    } catch (error) {
      console.error(`verifyFix: attempt ${attempt} on ${attemptId} failed:`, error);
      if (attempt < 1) {
        const delay = error instanceof GeminiError ? (error.retryAfterMs ?? RETRY_DELAY_MS) : RETRY_DELAY_MS;
        await ctx.scheduler.runAfter(delay, internal.fixVerification.verifyFix, { attemptId, attempt: attempt + 1 });
      } else {
        await ctx.runMutation(internal.fixVerificationDb.markFailed, { attemptId, reason: FAILED_REASON });
      }
    }
  },
});

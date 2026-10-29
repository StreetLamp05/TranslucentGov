"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { isAdminPasscode } from "../server/lib/adminPasscode";
import { ADMIN_SESSION_MS } from "../server/lib/auth";

export const login = action({
  args: { passcode: v.string() },
  handler: async (ctx, { passcode }) => {
    if (!isAdminPasscode(passcode)) {
      throw new Error("Invalid admin passcode.");
    }

    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const expiresAt = Date.now() + ADMIN_SESSION_MS;
    await ctx.runMutation(internal.videoIntakeDb.createAdminSession, { token, expiresAt });
    return { token, expiresAt };
  },
});

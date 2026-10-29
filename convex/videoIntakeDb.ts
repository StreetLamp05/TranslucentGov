import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { ADMIN_LOGIN_REQUIRED, ADMIN_SESSION_EXPIRED } from "../server/lib/auth";

export const createAdminSession = internalMutation({
  args: { token: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("videoIntakeAdminSessions", args);
    await ctx.scheduler.runAfter(
      Math.max(0, args.expiresAt - Date.now()),
      internal.videoIntakeDb.purgeAdminSession,
      { id },
    );
    return id;
  },
});

export const requireAdminSession = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token) throw new ConvexError(ADMIN_LOGIN_REQUIRED);
    const session = await ctx.db
      .query("videoIntakeAdminSessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!session || session.expiresAt <= Date.now()) {
      throw new ConvexError(ADMIN_SESSION_EXPIRED);
    }
    return true;
  },
});

export const purgeAdminSession = internalMutation({
  args: { id: v.id("videoIntakeAdminSessions") },
  handler: async (ctx, { id }) => {
    const session = await ctx.db.get(id);
    if (session && session.expiresAt <= Date.now()) await ctx.db.delete(id);
  },
});

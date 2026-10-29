import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  cleanToken,
  INVALID_FIXER_TOKEN,
  MISSING_DEVICE_TOKEN,
  MISSING_FIXER_TOKEN,
} from "../../server/lib/auth";

// Device-token identity (§3.1.1) and fixer tokens (§3.1.2). No auth provider.
// server/auth.ts is the same lookups on Postgres.

// Mutations: resolves the device token to a resident, creating one on first use.
export async function getOrCreateResident(ctx: MutationCtx, token: string): Promise<Id<"residents">> {
  const clean = cleanToken(token);
  if (!clean) throw new ConvexError(MISSING_DEVICE_TOKEN);
  const existing = await ctx.db
    .query("residents")
    .withIndex("by_token", (q) => q.eq("token", clean))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("residents", { token: clean, createdAt: Date.now() });
}

// Queries can't write, so an unknown or empty token is just "no resident yet".
export async function findResident(ctx: QueryCtx, token: string): Promise<Id<"residents"> | null> {
  const clean = cleanToken(token);
  if (!clean) return null;
  const resident = await ctx.db
    .query("residents")
    .withIndex("by_token", (q) => q.eq("token", clean))
    .unique();
  return resident?._id ?? null;
}

export async function requireFixer(ctx: QueryCtx, fixerToken: string): Promise<Doc<"fixers">> {
  const clean = cleanToken(fixerToken);
  if (!clean) throw new ConvexError(MISSING_FIXER_TOKEN);
  const fixer = await ctx.db
    .query("fixers")
    .withIndex("by_token", (q) => q.eq("token", clean))
    .unique();
  if (!fixer) throw new ConvexError(INVALID_FIXER_TOKEN);
  return fixer;
}

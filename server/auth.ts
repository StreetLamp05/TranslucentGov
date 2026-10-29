import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { fixers, residents, videoIntakeAdminSessions, type Fixer } from "./db/schema";
import {
  ADMIN_LOGIN_REQUIRED,
  ADMIN_SESSION_EXPIRED,
  ADMIN_SESSION_MS,
  cleanToken,
  INVALID_FIXER_TOKEN,
  MISSING_DEVICE_TOKEN,
  MISSING_FIXER_TOKEN,
} from "./lib/auth";
import { UserError } from "./lib/errors";

// Device-token identity (§3.1.1), fixer tokens (§3.1.2) and admin sessions, on Postgres: the
// same lookups and messages as M0's auth helpers and requireAdminSession. Route handlers
// reach them through `ctx.caller` (server/http.ts). A missing or bad credential is a 401.

/** Writes: resolves the device token to a resident, creating one on first use. */
export async function getOrCreateResident(token: string | null | undefined): Promise<string> {
  const clean = cleanToken(token);
  if (!clean) throw new UserError(MISSING_DEVICE_TOKEN, 401);
  // The unique index settles two first requests racing to create the same resident.
  await db.insert(residents).values({ token: clean, createdAt: Date.now() }).onConflictDoNothing();
  const [resident] = await db.select({ id: residents.id }).from(residents).where(eq(residents.token, clean));
  return resident.id;
}

/** Reads don't create residents, so an unknown or empty token is just "no resident yet". */
export async function findResident(token: string | null | undefined): Promise<string | null> {
  const clean = cleanToken(token);
  if (!clean) return null;
  const [resident] = await db.select({ id: residents.id }).from(residents).where(eq(residents.token, clean));
  return resident?.id ?? null;
}

export async function requireFixer(token: string | null | undefined): Promise<Fixer> {
  const clean = cleanToken(token);
  if (!clean) throw new UserError(MISSING_FIXER_TOKEN, 401);
  const [fixer] = await db.select().from(fixers).where(eq(fixers.token, clean));
  if (!fixer) throw new UserError(INVALID_FIXER_TOKEN, 401);
  return fixer;
}

/**
 * Throws unless `token` is an unexpired admin session from the admin login. The session slides:
 * each successful call pushes its expiry to ADMIN_SESSION_MS from now, so only that long idle
 * logs the admin out (M0's seed page sent the passcode on every call and never expired).
 */
export async function requireAdminSession(token: string | null | undefined): Promise<void> {
  const clean = cleanToken(token);
  if (!clean) throw new UserError(ADMIN_LOGIN_REQUIRED, 401);
  const now = Date.now();
  const extended = await db
    .update(videoIntakeAdminSessions)
    .set({ expiresAt: now + ADMIN_SESSION_MS })
    .where(and(eq(videoIntakeAdminSessions.token, clean), gt(videoIntakeAdminSessions.expiresAt, now)))
    .returning({ id: videoIntakeAdminSessions.id });
  if (extended.length === 0) throw new UserError(ADMIN_SESSION_EXPIRED, 401);
}

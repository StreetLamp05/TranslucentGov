// The parts of identity (§3.1) that need no database: token cleanup, secret comparison and the
// messages callers see. The lookups are server/auth.ts on Postgres and M0's auth helpers, so
// both backends answer a bad token the same way. The admin passcode check is
// server/lib/adminPasscode.ts.

export const MISSING_DEVICE_TOKEN = "Missing device token";
export const MISSING_FIXER_TOKEN = "Missing fixer token";
export const INVALID_FIXER_TOKEN = "Invalid fixer token";
export const ADMIN_LOGIN_REQUIRED = "Admin login required.";
export const ADMIN_SESSION_EXPIRED = "Admin session expired. Sign in again.";

/** How long an admin session from the video-intake login lasts. */
export const ADMIN_SESSION_MS = 30 * 60 * 1000;

export function cleanToken(token: string | null | undefined): string {
  return (token ?? "").trim();
}

/** Constant-time string comparison, for passcodes. */
export function sameSecret(candidate: string, configured: string): boolean {
  if (candidate.length !== configured.length) return false;
  let difference = 0;
  for (let i = 0; i < candidate.length; i++) {
    difference |= candidate.charCodeAt(i) ^ configured.charCodeAt(i);
  }
  return difference === 0;
}


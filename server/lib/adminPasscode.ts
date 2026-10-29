import { sameSecret } from "./auth";

// The admin passcode check (seed, video-intake login). Kept apart from server/lib/auth.ts, which
// every route handler imports through server/http.ts: only the admin routes should carry the
// ADMIN_PASSCODE name into the Next build (scripts/check-client-bundle.sh).

/** Whether `candidate` is ADMIN_PASSCODE. Always false when no passcode is configured. */
export function isAdminPasscode(candidate: string): boolean {
  const configured = process.env.ADMIN_PASSCODE;
  return !!configured && sameSecret(candidate, configured);
}

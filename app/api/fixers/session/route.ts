import { route } from "@/server/http";
import { fixerSession } from "@/server/fixers";
import { UserError } from "@/server/lib/errors";

// GET → { org }, or null when the token is missing or no longer valid, so the /fix screen asks
// for the passcode again instead of failing.
export const GET = route(async (_req, { caller }) => {
  try {
    return fixerSession(await caller.fixer());
  } catch (error) {
    if (error instanceof UserError && error.status === 401) return null;
    throw error;
  }
});

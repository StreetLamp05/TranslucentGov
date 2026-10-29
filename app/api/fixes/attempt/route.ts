import { route, searchArgs } from "@/server/http";
import { findBy, myFixAttempt } from "@/server/fixes";

// GET ?attemptId&as → { reportId, status, reason }, or null unless the caller submitted it.
export const GET = route(async (req, { caller }) => {
  const args = searchArgs(req);
  const attemptId = args.string("attemptId");
  return myFixAttempt(await findBy(caller, args.optionalString("as")), attemptId);
});

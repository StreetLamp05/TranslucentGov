import { readBody } from "@/server/body";
import { parseId, route } from "@/server/http";
import { retryScreening } from "@/server/retake";

// Try again after "screening failed" (§4.2.1).
export const POST = route(async (req, { caller }) => {
  const { reportId } = await readBody(req);
  await retryScreening(await caller.resident(), parseId(reportId));
});

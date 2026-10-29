import { readBody } from "@/server/body";
import { parseId, route } from "@/server/http";
import { mediaFrom } from "@/server/posts";
import { retakeReport } from "@/server/retake";

// retakeReport (§4.2.1): new files replace the held report's.
export const POST = route(async (req, { caller }) => {
  const body = await readBody(req);
  await retakeReport(await caller.resident(), parseId(body.reportId), mediaFrom(body));
});

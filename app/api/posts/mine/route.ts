import { parseId, route, searchArgs } from "@/server/http";
import { myReport } from "@/server/posts";

// The poster's own report for the Checking… screen; null for anyone else's, or a bad id.
export const GET = route(async (req, { caller }) => {
  const reportId = parseId(searchArgs(req).string("reportId"));
  return myReport(await caller.findResident(), reportId);
});

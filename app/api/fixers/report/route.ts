import { route, searchArgs } from "@/server/http";
import { fixerReport } from "@/server/fixers";

// GET ?reportId → the public report, still returned once fixed; null if it isn't public.
export const GET = route(async (req, { caller }) => {
  const reportId = searchArgs(req).string("reportId");
  await caller.fixer();
  return fixerReport(reportId);
});

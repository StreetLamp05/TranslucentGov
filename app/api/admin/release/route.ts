import { readBody } from "@/server/body";
import { releaseReport } from "@/server/admin";
import { route } from "@/server/http";

// POST { reportId, force? }: publishes a held report by hand (§4.2.1).
export const POST = route(async (req, { caller }) => {
  await caller.requireAdmin();
  const { reportId, force } = await readBody(req);
  await releaseReport(reportId, force);
});

import { readBody } from "@/server/body";
import { rescreenReport } from "@/server/admin";
import { route } from "@/server/http";

// POST { reportId }: screens a held or stuck-pending report again (§4.2.1).
export const POST = route(async (req, { caller }) => {
  await caller.requireAdmin();
  const { reportId } = await readBody(req);
  await rescreenReport(reportId);
});

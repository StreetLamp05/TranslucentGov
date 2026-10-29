import { route } from "@/server/http";
import { openReportsForFixer } from "@/server/fixers";

// GET → every open report, through the public projection (§4.3.2, §7.1.1).
export const GET = route(async (_req, { caller }) => {
  await caller.fixer();
  return openReportsForFixer();
});

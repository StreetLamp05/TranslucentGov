import { meToo } from "@/server/meToos";
import { readBody } from "@/server/body";
import { parseId, route } from "@/server/http";

export const POST = route(async (req, { caller }) => {
  const { reportId } = await readBody(req);
  return meToo(await caller.resident(), parseId(reportId));
});

import { readJson, route } from "@/server/http";
import { resolveBy, submitFix, type SubmitFixInput } from "@/server/fixes";

// POST { as, reportId, clipStorageId, frameStorageIds, lat, lng } → the attempt's id (§4.3.1).
export const POST = route(async (req, { caller }) => {
  const { as, ...input } = await readJson<SubmitFixInput & { as?: unknown }>(req);
  return submitFix(await resolveBy(caller, as), input);
});

import { readJson, route } from "@/server/http";
import { createProofUploadUrl, resolveBy } from "@/server/fixes";

// POST { as, contentType } → { key, url }: PUT the file to `url` with that Content-Type, then
// send `key` to POST /api/fixes.
export const POST = route(async (req, { caller }) => {
  const { as, contentType } = await readJson<{ as?: unknown; contentType?: unknown }>(req);
  return createProofUploadUrl(await resolveBy(caller, as), contentType);
});

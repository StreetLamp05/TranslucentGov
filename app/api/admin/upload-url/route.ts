import { readBody } from "@/server/body";
import { createAdminUploadUrl } from "@/server/admin";
import { route } from "@/server/http";

// POST { contentType } → { key, url }: a presigned MinIO PUT for a seed sample or an intake video.
export const POST = route(async (req, { caller }) => {
  await caller.requireAdmin();
  const { contentType } = await readBody(req);
  return createAdminUploadUrl(contentType);
});

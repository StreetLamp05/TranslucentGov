import { generateUploadUrl } from "@/server/files";
import { readBody } from "@/server/body";
import { route } from "@/server/http";

// A presigned MinIO PUT URL and the key to save afterwards (§1.1.1).
export const POST = route(async (req, { caller }) => {
  const { contentType, as } = await readBody(req);
  return generateUploadUrl(caller, { contentType, as });
});

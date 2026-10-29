import { readBody } from "@/server/body";
import { route, searchArgs } from "@/server/http";
import { getIntake, listRecentIntake, saveUpload } from "@/server/videoIntake";

// GET ?id → one intake entry (null if unknown); GET without id → the 20 newest.
export const GET = route(async (req, { caller }) => {
  await caller.requireAdmin();
  const id = searchArgs(req).optionalString("id");
  return id === undefined ? listRecentIntake() : getIntake(id);
});

// POST { key, fileName, contentType, fileSize } → the entry's id. Queues the Gemini transcription.
export const POST = route(async (req, { caller }) => {
  await caller.requireAdmin();
  const { key, fileName, contentType, fileSize } = await readBody(req);
  return saveUpload({ key, fileName, contentType, fileSize });
});

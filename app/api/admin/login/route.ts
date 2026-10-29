import { readBody } from "@/server/body";
import { adminLogin } from "@/server/admin";
import { route } from "@/server/http";

// POST { passcode } → { token, expiresAt }: an admin session for /admin/seed and
// /admin/video-intake, sent back as the x-admin-session header (lib/data/api.ts).
export const POST = route(async (req) => {
  const { passcode } = await readBody(req);
  return adminLogin(passcode);
});

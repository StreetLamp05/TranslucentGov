import { readJson, route } from "@/server/http";
import { fixerLogin } from "@/server/fixers";

// POST { passcode } → { token, org } (§3.1.2).
export const POST = route(async (req) => {
  const { passcode } = await readJson<{ passcode?: unknown }>(req);
  return fixerLogin(typeof passcode === "string" ? passcode : "");
});

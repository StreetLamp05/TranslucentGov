import { readBody } from "@/server/body";
import { route } from "@/server/http";
import { listFixers, seedFixersFromBody } from "@/server/seed";

// GET → [{ id, name, org }] for the seed page's "filmed by" picker (§3.1.2).
export const GET = route(async (_req, { caller }) => {
  await caller.requireAdmin();
  return listFixers();
});

// POST { fixers: [{ name, org, passcode }] } → { inserted, updated }. Replaces M0's
// `npx convex run fixers:seed`; running it again updates names and orgs.
export const POST = route(async (req, { caller }) => {
  await caller.requireAdmin();
  const { fixers } = await readBody(req);
  return seedFixersFromBody(fixers);
});

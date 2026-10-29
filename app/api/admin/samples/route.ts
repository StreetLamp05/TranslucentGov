import { readBody } from "@/server/body";
import { route } from "@/server/http";
import { listSamples, seedSamples } from "@/server/seed";

// GET → every sample with its screening and fix progress, newest first (§6.1.1).
export const GET = route(async (_req, { caller }) => {
  await caller.requireAdmin();
  return listSamples();
});

// POST { samples: [...] } → the new reports' ids. Safe to send twice (server/seed.ts).
export const POST = route(async (req, { caller }) => {
  await caller.requireAdmin();
  const { samples } = await readBody(req);
  return seedSamples(samples);
});

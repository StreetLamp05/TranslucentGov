import { route } from "@/server/http";
import { myMeToos } from "@/server/me";

export const GET = route(async (_req, { caller }) => myMeToos(await caller.findResident()));

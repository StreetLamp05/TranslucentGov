import { route, searchArgs } from "@/server/http";
import { myRelation } from "@/server/relation";

// Which of these reports the caller posted or already me-too'd (§5.1.1).
export const GET = route(async (req, { caller }) =>
  myRelation(await caller.findResident(), searchArgs(req).list("reportIds")),
);

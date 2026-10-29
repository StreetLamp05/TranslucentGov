import { route } from "@/server/http";
import { myReports } from "@/server/me";

export const GET = route(async (_req, { caller }) => myReports(await caller.findResident()));

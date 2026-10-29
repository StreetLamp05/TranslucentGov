import { route } from "@/server/http";
import { triageGroups } from "@/server/triage";

export const GET = route(() => triageGroups());

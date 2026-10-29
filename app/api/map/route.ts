import { route } from "@/server/http";
import { mapReports } from "@/server/map";

export const GET = route(() => mapReports());

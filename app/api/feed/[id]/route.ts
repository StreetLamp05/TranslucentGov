import { reportById } from "@/server/feed";
import { parseId, route } from "@/server/http";

// A deep link's report (§5.1.1): null unless it's open or fixed.
export const GET = route<{ id: string }>((_req, { params }) => reportById(parseId(params.id)));

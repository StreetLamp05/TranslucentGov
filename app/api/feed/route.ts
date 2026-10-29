import { feed } from "@/server/feed";
import { route } from "@/server/http";

export const GET = route(() => feed());

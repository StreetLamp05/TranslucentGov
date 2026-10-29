import { route } from "@/server/http";
import { triageQueueFor } from "@/server/triage";

// One agency's queue (§5.5.2): null for an unknown slug.
export const GET = route<{ slug: string }>((_req, { params }) => triageQueueFor(params.slug));

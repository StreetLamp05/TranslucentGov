import { parseId, readJson, route } from "@/server/http";
import { recordRevealView } from "@/server/reveal";

export const POST = route(async (req) => {
  // Valid JSON can still be null or a number, so don't destructure it.
  const body = await readJson<{ reportId?: unknown } | null>(req);
  await recordRevealView(parseId(body?.reportId));
});

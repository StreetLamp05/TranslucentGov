import { readJson } from "./http";
import { UserError } from "./lib/errors";

/**
 * A POST's body as an object. `readJson` accepts any valid JSON, but `null`, a number or an
 * array has no fields to read, so those are a 400 here instead of a TypeError (a 500).
 */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await readJson(req);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new UserError("The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

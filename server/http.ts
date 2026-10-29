import { unstable_rethrow } from "next/navigation";
import { ADMIN_SESSION_HEADER, FIXER_TOKEN_HEADER, RESIDENT_TOKEN_HEADER } from "@/lib/data/headers";
import { findResident, getOrCreateResident, requireAdminSession, requireFixer } from "./auth";
import type { Fixer } from "./db/schema";
import { UserError } from "./lib/errors";

// The shared wrapper for route handlers under app/api/ (§1.1.1), which replace M0's queries and
// mutations. A handler returns plain data and gets the caller's identity from `ctx.caller`:
//
//   // app/api/me-too/route.ts
//   export const POST = route(async (req, { caller }) => {
//     const { reportId } = await readJson<{ reportId: string }>(req);
//     return meToo(await caller.resident(), reportId);
//   });
//
// The result is sent as JSON (undefined as null; a Response passes through untouched). A thrown
// UserError becomes `{ error: message }` with its status, which lib/data/api.ts surfaces as
// ApiError#data. Anything else is logged and sent as a bare 500, as M0 hid every error but its
// user-facing ones, so database and SDK messages stay on the server.

/** Who is calling, from the identity headers lib/data/api.ts sends. Each lookup runs at most once. */
export type Caller = {
  /** Reads: the device's resident, or null if it has none yet. Never creates one. */
  findResident(): Promise<string | null>;
  /** Writes: the device's resident, created on first use. 401 without a device token. */
  resident(): Promise<string>;
  /**
   * The logged-in fixer. 401 without a valid fixer token. The row holds the passcode and token,
   * so return only what's public (the org, §3.1.2), never the row itself.
   */
  fixer(): Promise<Fixer>;
  /** Throws a 401 unless the caller has an unexpired admin session. */
  requireAdmin(): Promise<void>;
};

export function callerFrom(req: Request): Caller {
  const header = (name: string) => req.headers.get(name);
  const once = <T>(load: () => Promise<T>) => {
    let result: Promise<T> | undefined;
    return () => (result ??= load());
  };
  return {
    findResident: once(() => findResident(header(RESIDENT_TOKEN_HEADER))),
    resident: once(() => getOrCreateResident(header(RESIDENT_TOKEN_HEADER))),
    fixer: once(() => requireFixer(header(FIXER_TOKEN_HEADER))),
    requireAdmin: once(() => requireAdminSession(header(ADMIN_SESSION_HEADER))),
  };
}

export type RouteContext<P> = { caller: Caller; params: P };
export type RouteHandler<P> = (req: Request, ctx: RouteContext<P>) => unknown;

/** Wraps a handler for export as GET, POST, …. `P` is the route's dynamic segments. */
export function route<P extends Record<string, string | string[]> = Record<string, never>>(handler: RouteHandler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const result = await handler(req, { caller: callerFrom(req), params: await ctx.params });
      return result instanceof Response ? result : json(result ?? null);
    } catch (error) {
      // Next's redirect() and notFound() work by throwing; let Next handle those.
      unstable_rethrow(error);
      return errorResponse(error);
    }
  };
}

/** A JSON response that is never cached: every read is live (§1.1.1). */
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof UserError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: "Server Error" }, 500);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is a UUID, the shape of every row id. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * `value` as a row id, or null when it can't be one. Postgres rejects a malformed UUID with an
 * error (a 500 here), where M0's normalizeId returned null, so check ids from a URL or body
 * with this before querying: `/confirm/garbage` should read "not found", not fail.
 */
export function parseId(value: unknown): string | null {
  return isUuid(value) ? value : null;
}

/**
 * Typed reads of a GET's search params, as lib/data/api.ts `query` sends them: every value is a
 * string, and an array is the key repeated. A missing or malformed required value is a 400.
 */
export function searchArgs(req: Request) {
  const params = new URL(req.url).searchParams;
  const missing = (name: string) => new UserError(`Missing ${name}.`);
  return {
    /** The value, or undefined when absent. */
    optionalString(name: string): string | undefined {
      return params.get(name) ?? undefined;
    },
    string(name: string): string {
      const value = params.get(name);
      if (value === null) throw missing(name);
      return value;
    },
    int(name: string): number {
      const value = params.get(name);
      if (value === null) throw missing(name);
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new UserError(`${name} must be a whole number.`);
      }
      return Number(value);
    },
    /** Every value of a repeated key; empty when absent. */
    list(name: string): string[] {
      return params.getAll(name);
    },
  };
}

/** The request's JSON body. A 400 if it isn't JSON. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new UserError("The request body isn't valid JSON.");
  }
}

import { getFixerToken } from "@/lib/hooks/useFixerToken";
import { getResidentToken } from "@/lib/hooks/useResidentToken";
import { ADMIN_SESSION_HEADER, FIXER_TOKEN_HEADER, RESIDENT_TOKEN_HEADER } from "./headers";

// The browser's side of the route handlers under app/api/ (§1.1.1), standing in for the M0
// client. Every call carries the caller's identity as headers, from the same places the M0
// calls read it: the device token (§3.1.1), the fixer token when logged in (§3.1.2), and the
// admin session from the video-intake login. server/http.ts reads them back.
//
//   const report = await query<OwnerReport>("/api/posts/mine", { reportId });
//   await mutate("/api/me-too", { reportId });
//
// Reads are GETs with their args as search params; writes are POSTs with a JSON body. Every
// `mutate` tells useLive (lib/data/useLive.ts) to refetch, as M0 queries reran after a write.

/**
 * A failed call. `data` is the server's message when it's meant for the user (a UserError,
 * like M0's error `data`), so `err instanceof ApiError && typeof err.data === "string"`
 * replaces the M0 error checks. It's undefined for a server fault or a network failure.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly data: string | undefined;

  constructor(status: number, data: string | undefined) {
    super(data ?? (status ? `Request failed (${status})` : "Network error"));
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// The intake page keeps its session in memory only (it lasts 30 minutes), so it hands it over here.
let adminSession: string | null = null;

/** Sends `token` as the admin session on every call; null stops sending one. */
export function setAdminSession(token: string | null): void {
  adminSession = token;
}

function identityHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const headers: Record<string, string> = { [RESIDENT_TOKEN_HEADER]: getResidentToken() };
  const fixerToken = getFixerToken();
  if (fixerToken) headers[FIXER_TOKEN_HEADER] = fixerToken;
  if (adminSession) headers[ADMIN_SESSION_HEADER] = adminSession;
  return headers;
}

export type QueryArgs = Record<string, string | number | boolean | readonly (string | number)[] | null | undefined>;

/** `path` with `args` as search params. Arrays repeat the key; null and undefined are left out. */
export function withArgs(path: string, args: QueryArgs = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: { ...identityHeaders(), ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, undefined);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = (body as { error?: unknown } | undefined)?.error;
    // A 5xx message is only ever the generic "Server Error", which is no use to a user.
    throw new ApiError(response.status, response.status < 500 && typeof message === "string" ? message : undefined);
  }
  return body as T;
}

/** A read: GET `path` with `args` as search params. */
export function query<T>(path: string, args?: QueryArgs, init: { signal?: AbortSignal } = {}): Promise<T> {
  return call<T>(withArgs(path, args), { method: "GET", signal: init.signal });
}

const listeners = new Set<() => void>();

/** Called after every `mutate` settles. Returns the unsubscribe. */
export function subscribeToMutations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A write: POST (or `method`) `body` as JSON to `path`. Live queries refetch once it settles,
 * failed or not, since a failure can still mean the write landed (a dropped response).
 */
export async function mutate<T = unknown>(
  path: string,
  body: unknown = {},
  { method = "POST" }: { method?: "POST" | "PUT" | "PATCH" | "DELETE" } = {},
): Promise<T> {
  try {
    return await call<T>(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    for (const listener of [...listeners]) listener();
  }
}

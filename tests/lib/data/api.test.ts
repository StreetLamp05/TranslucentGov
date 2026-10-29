// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, mutate, query, setAdminSession, subscribeToMutations, withArgs } from "@/lib/data/api";
import { ADMIN_SESSION_HEADER, FIXER_TOKEN_HEADER, RESIDENT_TOKEN_HEADER } from "@/lib/data/headers";
import { clearFixerToken, setFixerToken } from "@/lib/hooks/useFixerToken";
import { getResidentToken } from "@/lib/hooks/useResidentToken";

// The client half of the route handlers (§1.1.1): identity headers (§3.1) and error mapping.

const fetchMock = vi.fn<typeof fetch>();

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), init: init!, headers: new Headers(init!.headers) };
}

beforeEach(() => {
  localStorage.clear();
  clearFixerToken();
  setAdminSession(null);
  fetchMock.mockReset().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("identity headers", () => {
  test("every call sends the device token, the same one the app stores", async () => {
    await query("/api/feed");
    expect(lastRequest().headers.get(RESIDENT_TOKEN_HEADER)).toBe(getResidentToken());

    await mutate("/api/me-too", { reportId: "r1" });
    expect(lastRequest().headers.get(RESIDENT_TOKEN_HEADER)).toBe(getResidentToken());
  });

  test("the fixer token goes along only while a fixer is logged in", async () => {
    await query("/api/fixers/session");
    expect(lastRequest().headers.has(FIXER_TOKEN_HEADER)).toBe(false);

    setFixerToken("fixer-abc");
    await query("/api/fixers/session");
    expect(lastRequest().headers.get(FIXER_TOKEN_HEADER)).toBe("fixer-abc");

    clearFixerToken();
    await query("/api/fixers/session");
    expect(lastRequest().headers.has(FIXER_TOKEN_HEADER)).toBe(false);
  });

  test("the admin session goes along once the intake page sets it", async () => {
    await mutate("/api/admin/intake", {});
    expect(lastRequest().headers.has(ADMIN_SESSION_HEADER)).toBe(false);

    setAdminSession("session-123");
    await mutate("/api/admin/intake", {});
    expect(lastRequest().headers.get(ADMIN_SESSION_HEADER)).toBe("session-123");
  });
});

describe("query", () => {
  test("is an uncached GET with its args as search params", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ _id: "r1" }]));
    const result = await query("/api/relation", { reportIds: ["r1", "r2"], near: true, skip: undefined });

    const { url, init } = lastRequest();
    expect(url).toBe("/api/relation?reportIds=r1&reportIds=r2&near=true");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(result).toEqual([{ _id: "r1" }]);
  });

  test("withArgs leaves the path alone without args", () => {
    expect(withArgs("/api/feed")).toBe("/api/feed");
    expect(withArgs("/api/feed", { a: null })).toBe("/api/feed");
  });

  test("returns null as null (a missing report), not an error", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(null));
    await expect(query("/api/feed/report", { id: "x" })).resolves.toBeNull();
  });
});

describe("mutate", () => {
  test("POSTs its body as JSON and returns the result", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ reportId: "r9" }));
    const result = await mutate("/api/posts", { mediaType: "video" });

    const { url, init, headers } = lastRequest();
    expect(url).toBe("/api/posts");
    expect(init.method).toBe("POST");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ mediaType: "video" });
    expect(result).toEqual({ reportId: "r9" });
  });

  test("tells subscribers once it settles, whether it worked or not", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToMutations(listener);
    await mutate("/api/a", {});
    expect(listener).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(Response.json({ error: "No" }, { status: 400 }));
    await mutate("/api/a", {}).catch(() => {});
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await mutate("/api/a", {});
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("errors", () => {
  test("a user-facing error carries its message as data, like ConvexError", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "That clip is over 25 MB." }, { status: 400 }));
    const error = await mutate("/api/posts", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).data).toBe("That clip is over 25 MB.");
  });

  test("a 401 from a bad fixer token is user-facing too", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Invalid fixer token" }, { status: 401 }));
    const error = (await query("/api/fixers/open").catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(401);
    expect(error.data).toBe("Invalid fixer token");
  });

  test("a server fault has no data, so screens show their own fallback", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Server Error" }, { status: 500 }));
    const error = (await query("/api/feed").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.data).toBeUndefined();
  });

  test("a network failure is an ApiError with status 0 and no data", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = (await query("/api/feed").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.data).toBeUndefined();
  });

  test("an aborted read rethrows the abort, so useLive can ignore it", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const error = await query("/api/feed", {}, { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe("AbortError");
  });
});

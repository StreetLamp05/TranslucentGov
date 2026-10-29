import { vi } from "vitest";
import { POST as loginRoute } from "@/app/api/admin/login/route";
import { POST as uploadUrlRoute } from "@/app/api/admin/upload-url/route";
import { ADMIN_SESSION_HEADER } from "@/lib/data/headers";
import { api } from "./api";
import { putTestObject } from "./fakes";

// Helpers for the admin routes under app/api/admin/ (seed, video intake, operator tools).

export const ADMIN_PASSCODE = "seed-admin-passcode";

/** Logs in with the right passcode and returns the session token. */
export async function loginAdmin(): Promise<string> {
  vi.stubEnv("ADMIN_PASSCODE", ADMIN_PASSCODE);
  const { status, body } = await api(loginRoute, { body: { passcode: ADMIN_PASSCODE } });
  if (status !== 200) throw new Error(`admin login failed: ${JSON.stringify(body)}`);
  return (body as { token: string }).token;
}

/** Calls an admin route handler with a session token. */
export function adminApi(
  token: string | null,
  handler: unknown,
  options: { method?: string; path?: string; body?: unknown } = {},
) {
  return api(handler, { ...options, headers: token ? { [ADMIN_SESSION_HEADER]: token } : {} });
}

/** The admin page's upload: asks for a key, then "PUTs" the bytes to MinIO. */
export async function adminUpload(token: string, contentType: string, bytes: Uint8Array | string = "x"): Promise<string> {
  const { status, body } = await adminApi(token, uploadUrlRoute, { body: { contentType } });
  if (status !== 200) throw new Error(`admin upload url failed: ${JSON.stringify(body)}`);
  const { key } = body as { key: string };
  putTestObject(key, bytes, contentType);
  return key;
}

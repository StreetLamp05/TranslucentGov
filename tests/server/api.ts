import { eq } from "drizzle-orm";
import { RESIDENT_TOKEN_HEADER } from "@/lib/data/headers";
import { db } from "@/server/db";
import { reports, residents, type Report } from "@/server/db/schema";
import { POST as filesRoute } from "@/app/api/files/route";
import { putTestObject } from "./fakes";

// Helpers for tests that drive the route handlers under app/api/ the way the browser does.

type Handler = (req: Request, ctx: { params: Promise<Record<string, never>> }) => Promise<Response>;

/** Calls a route handler with a resident's device token. */
export async function api(
  handler: unknown,
  {
    token,
    method = "POST",
    path = "/api/x",
    body,
    headers = {},
  }: { token?: string; method?: string; path?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (token !== undefined) (init.headers as Record<string, string>)[RESIDENT_TOKEN_HEADER] = token;
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await (handler as Handler)(new Request(`https://govtok.test${path}`, init), {
    params: Promise.resolve({}),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

/** The browser's upload: asks for a key as `token`'s resident, then "PUTs" the bytes to MinIO. */
export async function upload(token: string, contentType: string, bytes: Uint8Array | string = "x"): Promise<string> {
  const { status, body } = await api(filesRoute, { token, body: { contentType } });
  if (status !== 200) throw new Error(`upload url failed: ${JSON.stringify(body)}`);
  const { key } = body as { key: string };
  putTestObject(key, bytes, contentType);
  return key;
}

export const frames = (token: string, n: number) =>
  Promise.all(Array.from({ length: n }, (_, i) => upload(token, "image/jpeg", `frame ${i}`)));

export const AT = { lat: 33.8158, lng: -84.5825 };

export async function residentId(token: string): Promise<string> {
  const [row] = await db.select().from(residents).where(eq(residents.token, token));
  return row.id;
}

export async function reportRow(id: string): Promise<Report> {
  const [row] = await db.select().from(reports).where(eq(reports.id, id));
  return row;
}

/** Inserts a report directly, by `token`'s resident (created if needed). */
export async function insertReport(token: string, fields: Partial<typeof reports.$inferInsert> = {}): Promise<Report> {
  await db.insert(residents).values({ token, createdAt: 1 }).onConflictDoNothing();
  const now = Date.now();
  const [row] = await db
    .insert(reports)
    .values({
      residentId: await residentId(token),
      mediaType: "video",
      frameStorageIds: [],
      ...AT,
      status: "open",
      audioMuted: false,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: now,
      revealViews: 0,
      createdAt: now,
      ...fields,
    })
    .returning();
  return row;
}

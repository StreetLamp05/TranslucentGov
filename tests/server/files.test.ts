import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as filesRoute } from "@/app/api/files/route";
import { FIXER_TOKEN_HEADER } from "@/lib/data/headers";
import { db } from "@/server/db";
import { fixers, uploads } from "@/server/db/schema";
import { api, residentId } from "./api";

describe("POST /api/files (generateUploadUrl)", () => {
  it("returns a key and a presigned PUT URL for the public endpoint, recorded as the resident's", async () => {
    const { status, body } = await api(filesRoute, { token: "a", body: { contentType: "video/mp4" } });
    expect(status).toBe(200);
    const { key, url } = body as { key: string; url: string };
    expect(url).toContain(`https://govtok.test/govtok/${key}`);
    expect(url).toContain("X-Amz-Signature");
    const [row] = await db.select().from(uploads).where(eq(uploads.key, key));
    expect(row).toMatchObject({ uploaderKind: "resident", uploaderId: await residentId("a"), contentType: "video/mp4" });
  });

  it("only signs video and image types", async () => {
    for (const contentType of ["text/html", "application/pdf", "image", "video/mp4; charset=x", "", 3, undefined]) {
      const { status, body } = await api(filesRoute, { token: "a", body: { contentType } });
      expect([status, body]).toEqual([400, { error: "Only video and image files can be uploaded." }]);
    }
    expect((await api(filesRoute, { token: "a", body: { contentType: "image/jpeg" } })).status).toBe(200);
    expect(await db.select().from(uploads)).toHaveLength(1);
  });

  it("needs a device token, and creates the resident on a brand-new device", async () => {
    expect(await api(filesRoute, { body: { contentType: "video/mp4" } })).toEqual({
      status: 401,
      body: { error: "Missing device token" },
    });
    expect((await api(filesRoute, { token: "fresh", body: { contentType: "video/mp4" } })).status).toBe(200);
    expect(await residentId("fresh")).toBeTruthy();
  });

  it("uploads as a fixer only with a valid fixer token", async () => {
    const [fixer] = await db.insert(fixers).values({ name: "Pat", org: "Cobb DOT", passcode: "p", token: "fixer-token" }).returning();
    const as = { contentType: "video/mp4", as: "fixer" };

    const { status, body } = await api(filesRoute, { headers: { [FIXER_TOKEN_HEADER]: "fixer-token" }, body: as });
    expect(status).toBe(200);
    const [row] = await db.select().from(uploads).where(eq(uploads.key, (body as { key: string }).key));
    expect(row).toMatchObject({ uploaderKind: "fixer", uploaderId: fixer.id });

    expect((await api(filesRoute, { token: "a", body: as })).body).toEqual({ error: "Missing fixer token" });
    expect((await api(filesRoute, { headers: { [FIXER_TOKEN_HEADER]: "wrong" }, body: as })).body).toEqual({
      error: "Invalid fixer token",
    });
  });
});

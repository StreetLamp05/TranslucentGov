import { describe, expect, it } from "vitest";
import { POST as meTooRoute } from "@/app/api/me-too/route";
import { api, insertReport, reportRow } from "./api";

const meToo = (token: string | undefined, reportId: unknown) => api(meTooRoute, { token, body: { reportId } });

describe("POST /api/me-too (meToo)", () => {
  it("adds one me-too, increments the count, and bumps lastActivityAt only once", async () => {
    const report = await insertReport("poster", { lastActivityAt: 5 });

    expect(await meToo("neighbor", report.id)).toEqual({ status: 200, body: { added: true } });
    const after = await reportRow(report.id);
    expect(after.meTooCount).toBe(1);
    expect(after.lastActivityAt).toBeGreaterThan(5);

    expect(await meToo("neighbor", report.id)).toEqual({ status: 200, body: { added: false } });
    expect(await reportRow(report.id)).toMatchObject({ meTooCount: 1, lastActivityAt: after.lastActivityAt });

    await meToo("second", report.id);
    expect((await reportRow(report.id)).meTooCount).toBe(2);
  });

  it("counts two taps at once from one device once", async () => {
    const report = await insertReport("poster");
    const results = await Promise.all([meToo("neighbor", report.id), meToo("neighbor", report.id), meToo("neighbor", report.id)]);
    expect(results.filter(({ body }) => (body as { added: boolean }).added)).toHaveLength(1);
    expect((await reportRow(report.id)).meTooCount).toBe(1);
  });

  it("does nothing on your own open report and rejects a fixed or held one", async () => {
    const open = await insertReport("poster");
    expect(await meToo("poster", open.id)).toEqual({ status: 200, body: { added: false } });
    expect((await reportRow(open.id)).meTooCount).toBe(0);

    const fixed = await insertReport("poster", { status: "fixed" });
    expect(await meToo("neighbor", fixed.id)).toEqual({ status: 400, body: { error: "You can only me-too an open report" } });
    const held = await insertReport("poster", { status: "held" });
    expect((await meToo("neighbor", held.id)).status).toBe(400);
  });

  it("rejects a missing token, an unknown report and a junk id without a 500", async () => {
    const report = await insertReport("poster");
    expect(await meToo(undefined, report.id)).toEqual({ status: 401, body: { error: "Missing device token" } });
    expect(await meToo("neighbor", crypto.randomUUID())).toEqual({ status: 400, body: { error: "Report not found" } });
    for (const junk of ["garbage", "", 7, null, undefined, {}]) {
      expect(await meToo("neighbor", junk)).toEqual({ status: 400, body: { error: "Report not found" } });
    }
  });
});

describe("a body that isn't a JSON object", () => {
  it("is a 400 on every POST route, never a 500", async () => {
    const routes = [
      (await import("@/app/api/me-too/route")).POST,
      (await import("@/app/api/posts/route")).POST,
      (await import("@/app/api/files/route")).POST,
      (await import("@/app/api/retake/route")).POST,
      (await import("@/app/api/retake/retry/route")).POST,
    ];
    for (const handler of routes) {
      for (const body of [null, 7, "text", [1]]) {
        expect(await api(handler, { token: "a", body })).toEqual({
          status: 400,
          body: { error: "The request body must be a JSON object." },
        });
      }
    }
  });
});

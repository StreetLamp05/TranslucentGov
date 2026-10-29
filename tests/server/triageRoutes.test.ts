import { describe, expect, it } from "vitest";
import { GET as overview } from "@/app/api/triage/overview/route";
import { GET as queue } from "@/app/api/triage/[slug]/route";
import { ROUTING } from "@/server/lib/routing";
import { agencySlug } from "@/server/lib/triageGroups";
import { insertReport, insertResident } from "./reports";

const call = <P,>(handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>, url: string, params: P) =>
  handler(new Request(url), { params: Promise.resolve(params) });

describe("/api/triage", () => {
  it("serves the overview, and a queue that picks up a newly approved report", async () => {
    const resident = await insertResident();
    const slug = agencySlug(ROUTING.pothole.agency);
    const before = await call(queue, `http://x/api/triage/${slug}`, { slug });
    expect((await before.json()).open).toEqual([]);

    await insertReport(resident.id, { title: "Fresh" });
    const after = await (await call(queue, `http://x/api/triage/${slug}`, { slug })).json();
    expect(after.open.map((r: { title: string }) => r.title)).toEqual(["Fresh"]);

    const groups = await (await call(overview, "http://x/api/triage/overview", {})).json();
    expect(groups.find((g: { slug: string }) => g.slug === slug).open).toBe(1);
  });

  it("answers null for an unknown slug, uncached", async () => {
    const res = await call(queue, "http://x/api/triage/nope", { slug: "nope" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toBeNull();
  });
});

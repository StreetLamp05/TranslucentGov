import { describe, expect, it } from "vitest";
import { GET as relationRoute } from "@/app/api/relation/route";
import { POST as meTooRoute } from "@/app/api/me-too/route";
import { api, insertReport } from "./api";

const relation = (token: string | undefined, ids: string[]) =>
  api(relationRoute, { token, method: "GET", path: `/api/relation?${ids.map((id) => `reportIds=${id}`).join("&")}` });

describe("GET /api/relation (myRelation)", () => {
  it("returns only the caller's own posts and me-toos, never another resident's", async () => {
    const mine = await insertReport("me");
    const theirs = await insertReport("other");
    const tapped = await insertReport("other");
    const untouched = await insertReport("other");
    await api(meTooRoute, { token: "me", body: { reportId: tapped.id } });
    await api(meTooRoute, { token: "other2", body: { reportId: untouched.id } });

    const ids = [mine.id, theirs.id, tapped.id, untouched.id];
    expect(await relation("me", ids)).toEqual({ status: 200, body: { mine: [mine.id], meTooed: [tapped.id] } });
    expect((await relation("other", ids)).body).toEqual({ mine: [theirs.id, tapped.id, untouched.id], meTooed: [] });
  });

  it("gets nothing for an unknown or missing token, no ids, or junk ids", async () => {
    const report = await insertReport("me");
    const nothing = { status: 200, body: { mine: [], meTooed: [] } };
    expect(await relation("stranger", [report.id])).toEqual(nothing);
    expect(await relation(undefined, [report.id])).toEqual(nothing);
    expect(await relation("me", [])).toEqual(nothing);
    expect((await relation("me", ["garbage", report.id, "", crypto.randomUUID()])).body).toEqual({
      mine: [report.id],
      meTooed: [],
    });
  });

  it("looks at no more than 50 ids and ignores repeats", async () => {
    const report = await insertReport("me");
    const ids = [report.id, report.id, ...Array.from({ length: 60 }, () => crypto.randomUUID())];
    expect((await relation("me", ids)).body).toEqual({ mine: [report.id], meTooed: [] });
    const late = [...Array.from({ length: 50 }, () => crypto.randomUUID()), report.id];
    expect((await relation("me", late)).body).toEqual({ mine: [], meTooed: [] });
  });
});

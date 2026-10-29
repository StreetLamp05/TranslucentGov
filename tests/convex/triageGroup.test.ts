import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { ROUTING, type Category } from "../../convex/lib/routing";
import { agencySlug } from "../../convex/lib/triageGroups";
import schema from "../../convex/schema";
import { modules } from "./setup";

const ROW_FIELDS = [
  "_id",
  "category",
  "createdAt",
  "isSample",
  "meTooCount",
  "status",
  "street",
  "thumbnailUrl",
  "title",
];

test("queue returns the group's open and fixed reports, ranked, as allowlisted rows", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const residentId = await ctx.db.insert("residents", { token: "poster", createdAt: 1 });
    const fixerId = await ctx.db.insert("fixers", { name: "Dana", org: "SF Public Works", passcode: "4821" });
    const clip = await ctx.storage.store(new Blob(["clip"], { type: "video/mp4" }));
    const frame = await ctx.storage.store(new Blob(["frame"], { type: "image/jpeg" }));
    const insert = (
      status: Doc<"reports">["status"],
      category: Category,
      meTooCount: number,
      createdAt: number,
      extra: Partial<Doc<"reports">> = {},
    ) =>
      ctx.db.insert("reports", {
        residentId,
        mediaType: "video",
        description: "Call me at 555-0100",
        clipStorageId: clip,
        frameStorageIds: [frame],
        transcript: "John at 412 Elm St keeps dumping here.",
        segments: [{ start: 0, end: 3, text: "John at 412 Elm St keeps dumping here." }],
        lat: 37.8,
        lng: -122.44,
        street: "Baker St",
        category,
        owner: "city",
        agency: "Stale Agency Name",
        title: `${status} ${category} ${meTooCount}`,
        status,
        audioMuted: true,
        isSample: false,
        meTooCount,
        lastActivityAt: 10,
        revealViews: 0,
        createdAt,
        ...extra,
      });
    return {
      openFew: await insert("open", "pothole", 1, 5),
      openMany: await insert("open", "pothole", 7, 9),
      fixed: await insert("fixed", "pothole", 2, 1, {
        fixStorageId: clip,
        fixedAt: 20,
        fixedBy: fixerId,
        fixedByKind: "fixer",
        fixedByOrg: "SF Public Works",
      }),
      pending: await insert("pending", "pothole", 0, 1),
      held: await insert("held", "pothole", 0, 1),
      otherAgency: await insert("open", "trash_missed", 0, 1),
      // Not muted, so publicReport would show its transcript; the queue still must not.
      unmuted: await insert("open", "pothole", 3, 7, { audioMuted: false }),
      unrouted: await insert("open", "other", 0, 1),
    };
  });

  const queue = await t.query(api.triageGroup.queue, { slug: agencySlug(ROUTING.pothole.agency) });

  expect(queue?.agency).toBe(ROUTING.pothole.agency);
  // trash_missed is another agency in both city tables, and other is Routing unclear.
  expect(queue?.open.map((r) => r._id)).toEqual([ids.openMany, ids.unmuted, ids.openFew]);
  expect(queue?.fixed.map((r) => r._id)).toEqual([ids.fixed]);
  // Muted or not, and with a poster and fixer, no transcript, description, resident or fixer leaks.
  for (const row of [...queue!.open, ...queue!.fixed]) {
    const expected = row.status === "fixed" ? [...ROW_FIELDS, "fixedAt"].sort() : ROW_FIELDS;
    expect(Object.keys(row).filter((k) => (row as Record<string, unknown>)[k] !== undefined).sort()).toEqual(expected);
    expect(row.thumbnailUrl).toEqual(expect.any(String));
  }
});

test("an unknown slug returns null", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.triageGroup.queue, { slug: "no-such-agency" })).toBeNull();
});

test("other reports appear under Routing unclear through the query", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const residentId = await ctx.db.insert("residents", { token: "poster", createdAt: 1 });
    const frame = await ctx.storage.store(new Blob(["frame"], { type: "image/jpeg" }));
    return await ctx.db.insert("reports", {
      residentId,
      mediaType: "photos",
      frameStorageIds: [frame],
      lat: 37.8,
      lng: -122.44,
      category: "other",
      title: "Something odd",
      status: "open",
      audioMuted: false,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
    });
  });
  const queue = await t.query(api.triageGroup.queue, { slug: agencySlug(ROUTING.other.agency) });
  expect(queue?.agency).toBe("Routing unclear");
  expect(queue?.open.map((r) => r._id)).toEqual([id]);
});

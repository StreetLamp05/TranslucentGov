import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { ROUTING, type Category } from "../../convex/lib/routing";
import schema from "../../convex/schema";
import { modules } from "./setup";

test("overview counts only open and fixed reports, by their category's agency, and returns no report fields", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const residentId = await ctx.db.insert("residents", { token: "poster", createdAt: 1 });
    const clip = await ctx.storage.store(new Blob(["clip"], { type: "video/mp4" }));
    const insert = (status: Doc<"reports">["status"], category: Category) =>
      ctx.db.insert("reports", {
        residentId,
        mediaType: "video",
        clipStorageId: clip,
        frameStorageIds: [clip],
        transcript: "This has been here since June.",
        lat: 33.8187,
        lng: -84.5824,
        street: "Floyd Rd SW",
        category,
        // A stale stored agency: the group comes from the routing table, not this (§2.1.4).
        owner: "cobb",
        agency: "Stale Agency Name",
        title: `A ${status} ${category}`,
        status,
        audioMuted: false,
        isSample: false,
        meTooCount: 3,
        lastActivityAt: 10,
        revealViews: 0,
        createdAt: 1,
      });
    await insert("open", "pothole");
    await insert("open", "pothole");
    await insert("fixed", "pothole");
    await insert("open", "trash_missed");
    await insert("pending", "trash_missed");
    await insert("held", "trash_missed");
    await insert("held", "pothole");
  });

  const groups = await t.query(api.triage.overview, {});

  for (const group of groups) {
    expect(Object.keys(group).sort()).toEqual(["agency", "fixed", "open", "owner", "slug"]);
  }
  expect(groups.find((g) => g.agency === "Stale Agency Name")).toBeUndefined();
  const byAgency = (agency: string) => groups.find((g) => g.agency === agency);
  const pothole = ROUTING.pothole.agency;
  const trash = ROUTING.trash_missed.agency;
  if (pothole === trash) {
    expect(byAgency(pothole)).toMatchObject({ open: 3, fixed: 1 });
  } else {
    expect(byAgency(pothole)).toMatchObject({ open: 2, fixed: 1 });
    expect(byAgency(trash)).toMatchObject({ open: 1, fixed: 0 });
  }
  expect(groups.at(-1)).toMatchObject({ agency: "Routing unclear", open: 0, fixed: 0 });
});

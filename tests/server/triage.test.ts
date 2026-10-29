import { describe, expect, it } from "vitest";
import { fixers } from "@/server/db/schema";
import { db } from "@/server/db";
import { ROUTING } from "@/server/lib/routing";
import { agencySlug } from "@/server/lib/triageGroups";
import { triageGroups, triageQueueFor } from "@/server/triage";
import { insertReport, insertResident } from "./reports";

const ROW_FIELDS = ["_id", "category", "createdAt", "isSample", "meTooCount", "status", "street", "thumbnailUrl", "title"];

describe("triageGroups", () => {
  it("counts only open and fixed reports by their category's agency, and returns no report fields", async () => {
    const resident = await insertResident("poster");
    // A stale stored agency: the group comes from the routing table, not this (§2.1.4).
    const stale = { owner: "cobb", agency: "Stale Agency Name" } as const;
    await insertReport(resident.id, { ...stale });
    await insertReport(resident.id, { ...stale });
    await insertReport(resident.id, { ...stale, status: "fixed" });
    await insertReport(resident.id, { ...stale, category: "trash_missed" });
    await insertReport(resident.id, { ...stale, category: "trash_missed", status: "pending" });
    await insertReport(resident.id, { ...stale, category: "trash_missed", status: "held" });
    await insertReport(resident.id, { ...stale, status: "held" });

    const groups = await triageGroups();

    for (const group of groups) expect(Object.keys(group).sort()).toEqual(["agency", "fixed", "open", "owner", "slug"]);
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

  it("is every agency at zero when nothing is public", async () => {
    const resident = await insertResident();
    await insertReport(resident.id, { status: "held" });
    const groups = await triageGroups();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.open === 0 && g.fixed === 0)).toBe(true);
  });
});

describe("triageQueueFor", () => {
  it("returns the group's open and fixed reports, ranked, as allowlisted rows", async () => {
    const resident = await insertResident("poster");
    const [fixer] = await db.insert(fixers).values({ name: "Dana", org: "SF Public Works", passcode: "4821" }).returning();
    const insert = (status: "open" | "fixed" | "pending" | "held", meTooCount: number, createdAt: number, extra = {}) =>
      insertReport(resident.id, {
        description: "Call me at 555-0100",
        transcript: "John at 412 Elm St keeps dumping here.",
        owner: "city",
        agency: "Stale Agency Name",
        status,
        meTooCount,
        createdAt,
        title: `${status} ${meTooCount}`,
        ...extra,
      });
    const openFew = await insert("open", 1, 5);
    const openMany = await insert("open", 7, 9);
    const fixed = await insert("fixed", 2, 1, {
      fixStorageId: "fix-key",
      fixedAt: 20,
      fixedBy: fixer.id,
      fixedByKind: "fixer",
      fixedByOrg: "SF Public Works",
    });
    await insert("pending", 0, 1);
    await insert("held", 0, 1);
    await insert("open", 0, 1, { category: "trash_missed" });
    // Not muted, so publicReport would show its transcript; the queue still must not.
    const unmuted = await insert("open", 3, 7, { audioMuted: false });
    await insert("open", 0, 1, { category: "other" });

    const queue = await triageQueueFor(agencySlug(ROUTING.pothole.agency));

    expect(queue?.agency).toBe(ROUTING.pothole.agency);
    expect(queue?.open.map((r) => r._id)).toEqual([openMany.id, unmuted.id, openFew.id]);
    expect(queue?.fixed.map((r) => r._id)).toEqual([fixed.id]);
    for (const row of [...queue!.open, ...queue!.fixed]) {
      const expected = row.status === "fixed" ? [...ROW_FIELDS, "fixedAt"].sort() : ROW_FIELDS;
      expect(Object.keys(row).sort()).toEqual(expected);
      expect(row.thumbnailUrl).toMatch(/^https?:\/\/.*frame-key/);
    }
    expect(JSON.stringify(queue)).not.toMatch(/John|555-0100|poster|Dana|clip-key|fix-key/);
  });

  it("lists fixed reports newest fix first", async () => {
    const resident = await insertResident();
    const older = await insertReport(resident.id, { status: "fixed", fixedAt: 10 });
    const newer = await insertReport(resident.id, { status: "fixed", fixedAt: 30 });
    const middle = await insertReport(resident.id, { status: "fixed", fixedAt: 20 });
    const queue = await triageQueueFor(agencySlug(ROUTING.pothole.agency));
    expect(queue?.fixed.map((r) => r._id)).toEqual([newer.id, middle.id, older.id]);
  });

  it("returns null for an unknown slug", async () => {
    expect(await triageQueueFor("no-such-agency")).toBeNull();
  });

  it("lists other reports under Routing unclear, and a report with no category too", async () => {
    const resident = await insertResident();
    const other = await insertReport(resident.id, { category: "other", title: "Something odd" });
    const uncategorized = await insertReport(resident.id, { category: null, title: null });
    const queue = await triageQueueFor(agencySlug(ROUTING.other.agency));
    expect(queue?.agency).toBe("Routing unclear");
    expect(queue?.open.map((r) => r._id).sort()).toEqual([other.id, uncategorized.id].sort());
    expect(Object.keys(queue!.open.find((r) => r._id === uncategorized.id)!)).not.toContain("title");
  });

  it("gives a report without frames a null thumbnail", async () => {
    const resident = await insertResident();
    await insertReport(resident.id, { frameStorageIds: [] });
    const queue = await triageQueueFor(agencySlug(ROUTING.pothole.agency));
    expect(queue?.open[0].thumbnailUrl).toBeNull();
  });
});

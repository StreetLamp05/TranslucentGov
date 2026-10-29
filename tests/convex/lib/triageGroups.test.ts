import { describe, expect, test } from "vitest";
import { MABLETON, SAN_FRANCISCO } from "../../../server/lib/city";
import { CATEGORIES, type Category } from "../../../server/lib/routing";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  agencyForSlug,
  agencyGroups,
  agencySlug,
  groupFor,
  triageOverview,
  triageQueue,
  type QueueRow,
} from "../../../convex/lib/triageGroups";

const CITIES = { sf: SAN_FRANCISCO, mableton: MABLETON };

describe.each(Object.entries(CITIES))("%s routing table", (_, city) => {
  const distinct = [...new Set(CATEGORIES.map((c) => city.routing[c].agency))];

  test("the overview lists each distinct agency exactly once, including ones with no reports", () => {
    const groups = triageOverview(city.routing, []);
    expect(groups.map((g) => g.agency).sort()).toEqual([...distinct].sort());
    for (const group of groups) expect([group.open, group.fixed]).toEqual([0, 0]);
  });

  test("Routing unclear is last even with the most open reports; the rest are by open count", () => {
    const rows = (category: Category, n: number) =>
      Array.from({ length: n }, () => ({ category, status: "open" as const }));
    const groups = triageOverview(city.routing, [
      ...rows("other", 9),
      ...rows("streetlight", 2),
      ...rows("trash_missed", 5),
    ]);
    expect(groups.at(-1)).toMatchObject({ agency: "Routing unclear", open: 9 });
    const opens = groups.slice(0, -1).map((g) => g.open);
    expect(opens).toEqual([...opens].sort((a, b) => b - a));
    expect(groups[0].agency).toBe(city.routing.trash_missed.agency);
  });

  // A group carries one owner chip, so an agency split across owners would silently take
  // the first one's (review finding, US42).
  test("every agency has a single owner", () => {
    for (const agency of distinct) {
      const owners = new Set(CATEGORIES.filter((c) => city.routing[c].agency === agency).map((c) => city.routing[c].owner));
      expect(owners.size, agency).toBe(1);
    }
  });

  test("slugs are URL-safe and unique across the table", () => {
    const slugs = distinct.map(agencySlug);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("an open and a fixed report count toward their category's agency", () => {
    const groups = triageOverview(city.routing, [
      { category: "pothole", status: "open" },
      { category: "pothole", status: "fixed" },
    ]);
    expect(groups.find((g) => g.agency === city.routing.pothole.agency)).toMatchObject({ open: 1, fixed: 1 });
  });
});

test("slugs stay unique across both city profiles", () => {
  const agencies = new Set(
    Object.values(CITIES).flatMap((city) => CATEGORIES.map((c) => city.routing[c].agency)),
  );
  const slugs = [...agencies].map(agencySlug);
  expect(new Set(slugs).size).toBe(slugs.length);
  expect(agencySlug("PG&E / SFPUC Streetlights")).toBe("pg-and-e-sfpuc-streetlights");
  expect(agencySlug("SFPUC (sewer & stormwater)")).toBe("sfpuc-sewer-and-stormwater");
});

test("categories that share an agency share one group", () => {
  const cobbDot = agencyGroups(MABLETON.routing).find((g) => g.agency === "Cobb DOT");
  expect(cobbDot).toMatchObject({ owner: "cobb", slug: "cobb-dot", categories: ["pothole", "signal_sign"] });
});

test("the group comes from the table passed in, not a stored agency; a missing category is other", () => {
  expect(groupFor(MABLETON.routing, "trash_missed")).toBe("Mableton Sanitation");
  expect(groupFor(SAN_FRANCISCO.routing, "trash_missed")).toBe("Recology");
  expect(groupFor(MABLETON.routing, undefined)).toBe("Routing unclear");
});

describe("triageQueue", () => {
  const row = (id: string, overrides: Partial<QueueRow>): QueueRow => ({
    _id: id as Id<"reports">,
    title: id,
    category: "trash_missed",
    status: "open",
    meTooCount: 0,
    createdAt: 1,
    isSample: false,
    thumbnailUrl: null,
    ...overrides,
  });

  test("open rows rank by me-toos, the newer first on a tie; fixed rows newest fix first", () => {
    const queue = triageQueue(MABLETON.routing, "mableton-sanitation", [
      row("few", { meTooCount: 1, createdAt: 5 }),
      row("many", { meTooCount: 9, createdAt: 9 }),
      row("tie-newer", { meTooCount: 4, createdAt: 8 }),
      row("tie-older", { meTooCount: 4, createdAt: 2 }),
      row("fixed-old", { status: "fixed", fixedAt: 10 }),
      row("fixed-new", { status: "fixed", fixedAt: 30 }),
    ]);
    expect(queue?.open.map((r) => r._id)).toEqual(["many", "tie-newer", "tie-older", "few"]);
    expect(queue?.fixed.map((r) => r._id)).toEqual(["fixed-new", "fixed-old"]);
    expect(queue).toMatchObject({ agency: "Mableton Sanitation", owner: "city" });
  });

  test("rows whose category maps to another agency are left out", () => {
    const queue = triageQueue(MABLETON.routing, "cobb-dot", [
      row("pothole", { category: "pothole" }),
      row("signal", { category: "signal_sign" }),
      row("trash", { category: "trash_missed" }),
    ]);
    expect(queue?.open.map((r) => r._id).sort()).toEqual(["pothole", "signal"]);
  });

  test("other reports appear under the Routing unclear slug", () => {
    const queue = triageQueue(SAN_FRANCISCO.routing, "routing-unclear", [
      row("other", { category: "other" }),
      row("pothole", { category: "pothole" }),
    ]);
    expect(queue?.open.map((r) => r._id)).toEqual(["other"]);
  });

  test("an unknown slug returns null", () => {
    expect(triageQueue(MABLETON.routing, "no-such-agency", [])).toBeNull();
    expect(agencyForSlug(MABLETON.routing, "recology")).toBeNull();
    expect(agencyForSlug(SAN_FRANCISCO.routing, "recology")?.agency).toBe("Recology");
  });
});

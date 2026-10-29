import { describe, expect, test } from "vitest";
import { MABLETON, SAN_FRANCISCO } from "../../../convex/lib/city";
import { CATEGORIES, type Category } from "../../../convex/lib/routing";
import { agencyGroups, agencySlug, groupFor, triageOverview } from "../../../convex/lib/triageGroups";

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

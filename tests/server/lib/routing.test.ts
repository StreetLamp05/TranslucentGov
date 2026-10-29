import { describe, expect, test } from "vitest";
import { ACTIVE_CITY, MABLETON, SAN_FRANCISCO } from "../../../server/lib/city";
import { CATEGORIES, OWNER_CHIP, OWNERS, routeCategory } from "../../../server/lib/routing";

// Each city's §2.1.2 table, restated by hand so a typo in a profile fails here.
const TABLES = {
  sf: {
    pothole: ["city", "SF Public Works"],
    signal_sign: ["city", "SFMTA"],
    drainage: ["city", "SFPUC (sewer & stormwater)"],
    water_leak: ["city", "SFPUC Water"],
    streetlight: ["utility", "PG&E / SFPUC Streetlights"],
    trash_missed: ["utility", "Recology"],
    code_violation: ["city", "SF Public Works"],
    other: ["unknown", "Routing unclear"],
  },
  mableton: {
    pothole: ["cobb", "Cobb DOT"],
    signal_sign: ["cobb", "Cobb DOT"],
    drainage: ["cobb", "Cobb Water System (stormwater)"],
    water_leak: ["cobb", "Cobb Water System"],
    streetlight: ["utility", "Georgia Power"],
    trash_missed: ["city", "Mableton Sanitation"],
    code_violation: ["city", "Mableton Code Enforcement"],
    other: ["unknown", "Routing unclear"],
  },
} as const;
const SPEC_TABLE = TABLES[ACTIVE_CITY.id as keyof typeof TABLES];

test("Cal Hacks runs as San Francisco (flip ACTIVE_CITY to MABLETON for Oct 30)", () => {
  expect(ACTIVE_CITY).toBe(SAN_FRANCISCO);
});

test.each([SAN_FRANCISCO, MABLETON])("$name's routing matches its restated table", (city) => {
  const table = TABLES[city.id as keyof typeof TABLES];
  expect(Object.fromEntries(Object.entries(city.routing).map(([c, r]) => [c, [r.owner, r.agency]]))).toEqual(table);
});

describe("routeCategory", () => {
  test("the category list is exactly the §2.1.2 table", () => {
    expect([...CATEGORIES].sort()).toEqual(Object.keys(SPEC_TABLE).sort());
  });

  test.each(Object.entries(SPEC_TABLE))("%s routes to its §2.1.2 owner and agency", (category, [owner, agency]) => {
    expect(routeCategory(category)).toEqual({ category, owner, agency });
  });

  test.each(["", "graffiti", "POTHOLE", "toString"])("unknown category %j routes to other", (category) => {
    expect(routeCategory(category)).toEqual({ category: "other", owner: "unknown", agency: "Routing unclear" });
  });

  test("every owner has a chip color and the active city's label", () => {
    for (const owner of OWNERS) {
      expect(OWNER_CHIP[owner].bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(OWNER_CHIP[owner].label).toBe(ACTIVE_CITY.ownerLabels[owner]);
    }
  });
});

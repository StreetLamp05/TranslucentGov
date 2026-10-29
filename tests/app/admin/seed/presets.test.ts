import { describe, expect, test } from "vitest";
import { PRESETS, PRESETS_BY_CITY } from "../../../../app/admin/seed/presets";
import { ACTIVE_CITY, MABLETON, SAN_FRANCISCO } from "../../../../server/lib/city";
import { haversineMeters, NEARBY_METERS } from "../../../../server/lib/geo";
import { DEMO_POINT } from "../../../../lib/demo";

// The stage flow (§6.1.1) needs the demo point next to a seeded pothole (duplicate check,
// §4.1.2) and the before/after spot (fix geofence, §4.3.1), in every city profile.

test("DEMO_POINT and the presets are the active city's", () => {
  expect(DEMO_POINT).toEqual(ACTIVE_CITY.demoPoint);
  expect(PRESETS).toBe(PRESETS_BY_CITY[ACTIVE_CITY.id]);
});

test("Cal Hacks: DEMO_POINT is by the Palace of Fine Arts", () => {
  expect(haversineMeters(DEMO_POINT, { lat: 37.8029, lng: -122.4484 })).toBeLessThan(200);
});

describe.each([SAN_FRANCISCO, MABLETON])("$name", (city) => {
  const presets = PRESETS_BY_CITY[city.id];
  const near = (stage: string) => Math.min(...presets.filter((p) => p.stage === stage).map((p) => haversineMeters(city.demoPoint, p)));

  test("the demo point is off the town-center placeholder US6 set", () => {
    expect(city.demoPoint).not.toEqual({ lat: 33.8158, lng: -84.5825 });
  });

  test("the demo point is within 50 m of an open-pothole preset and the before/after spot", () => {
    expect(near("pothole")).toBeLessThanOrEqual(NEARBY_METERS);
    expect(near("beforeAfter")).toBeLessThanOrEqual(NEARBY_METERS);
  });

  test("the pothole is nearer than the before/after spot, so the duplicate check offers it first", () => {
    expect(near("pothole")).toBeLessThan(near("beforeAfter"));
  });

  test("the other presets spread across town, away from the stage spots", () => {
    const spread = presets.filter((p) => !p.stage);
    expect(spread.length).toBeGreaterThanOrEqual(6);
    for (const p of spread) expect(haversineMeters(city.demoPoint, p)).toBeGreaterThan(NEARBY_METERS);
  });
});

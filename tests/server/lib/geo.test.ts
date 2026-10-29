import { describe, expect, test } from "vitest";
import { boundingBox, haversineMeters, inBox, NEARBY_METERS } from "../../../server/lib/geo";

// Mableton, GA (~33.8°N).
const MABLETON = { lat: 33.8187, lng: -84.5824 };
const METERS_PER_DEGREE_LAT = 111_195;

// A point `meters` north or east of `p`, computed independently of geo.ts.
const north = (p: typeof MABLETON, meters: number) => ({ lat: p.lat + meters / METERS_PER_DEGREE_LAT, lng: p.lng });
const east = (p: typeof MABLETON, meters: number) => ({
  lat: p.lat,
  lng: p.lng + meters / (METERS_PER_DEGREE_LAT * Math.cos((p.lat * Math.PI) / 180)),
});

describe("geo at Mableton's latitude", () => {
  test("NEARBY_METERS is 50", () => {
    expect(NEARBY_METERS).toBe(50);
  });

  test.each([
    ["north", north],
    ["east", east],
  ])("haversine: 40 m %s is inside 50 m, 60 m is outside", (_dir, move) => {
    const near = haversineMeters(MABLETON, move(MABLETON, 40));
    const far = haversineMeters(MABLETON, move(MABLETON, 60));
    expect(near).toBeCloseTo(40, 0);
    expect(far).toBeCloseTo(60, 0);
    expect(near).toBeLessThanOrEqual(NEARBY_METERS);
    expect(far).toBeGreaterThan(NEARBY_METERS);
  });

  test.each([
    ["north", north],
    ["east", east],
  ])("bbox: 40 m %s is inside the 50 m box, 60 m is outside", (_dir, move) => {
    const box = boundingBox(MABLETON, NEARBY_METERS);
    expect(inBox(move(MABLETON, 40), box)).toBe(true);
    expect(inBox(move(MABLETON, 60), box)).toBe(false);
    expect(inBox(move(MABLETON, -40), box)).toBe(true);
    expect(inBox(move(MABLETON, -60), box)).toBe(false);
  });

  test.each([
    ["north", north],
    ["east", east],
  ])("bbox edge is at 50 m %s, corrected for latitude (49 m in, 51 m out)", (_dir, move) => {
    const box = boundingBox(MABLETON, NEARBY_METERS);
    expect(inBox(move(MABLETON, 49), box)).toBe(true);
    expect(inBox(move(MABLETON, 51), box)).toBe(false);
  });

  test("the box contains the whole circle (a 49 m diagonal point is inside)", () => {
    const box = boundingBox(MABLETON, NEARBY_METERS);
    const diagonal = east(north(MABLETON, 49 / Math.SQRT2), 49 / Math.SQRT2);
    expect(haversineMeters(MABLETON, diagonal)).toBeLessThan(NEARBY_METERS);
    expect(inBox(diagonal, box)).toBe(true);
  });
});

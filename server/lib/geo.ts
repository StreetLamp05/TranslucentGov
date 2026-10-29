// Distance helpers for the 50 m checks: duplicate check (§4.1.2) and fix geofence (§4.3.1).
// Queries narrow with a bounding box (§1.1.1), then confirm with haversine.

export const NEARBY_METERS = 50;

const EARTH_RADIUS_METERS = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export type Point = { lat: number; lng: number };
export type BoundingBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

export function haversineMeters(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The smallest lat/lng box that contains every point within `radiusMeters` of `center`.
// Its corners reach past the radius, so confirm matches with haversineMeters.
export function boundingBox(center: Point, radiusMeters: number): BoundingBox {
  const dLat = toDegrees(radiusMeters / EARTH_RADIUS_METERS);
  const dLng = toDegrees(radiusMeters / (EARTH_RADIUS_METERS * Math.cos(toRadians(center.lat))));
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

export function inBox(point: Point, box: BoundingBox): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lng >= box.minLng &&
    point.lng <= box.maxLng
  );
}

import { ACTIVE_CITY } from "../server/lib/city";

// Demo location mode (§6.1.1): `?demo=<city id>` (`?demo=sf`) swaps the phone's GPS for DEMO_POINT.
export const DEMO_PARAM = "demo";
export const DEMO_VALUE = ACTIVE_CITY.id;

export type LatLng = { lat: number; lng: number };

// A public street next to the venue (server/lib/city.ts). The seeded open pothole and the
// before/after spot sit within 50 m of it (app/admin/seed/presets.ts), so the duplicate check
// (§4.1.2) and the fix geofence (§4.3.1) find them on stage.
export const DEMO_POINT: LatLng = ACTIVE_CITY.demoPoint;

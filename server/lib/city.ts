import type { Point } from "./geo";
import type { Category, Owner } from "./routing";

// The city GovTok runs as (2026-10-25). Cal Hacks is demoed live in San Francisco at the
// Palace of Fine Arts, so routing, prompts, the map and the demo point are San Francisco's.
// Mableton demo day (Oct 30) flips ACTIVE_CITY back to MABLETON. The stored `owner` values
// stay the same in both, so no migration is needed. No server imports, so client code can use it.

export type City = {
  id: string; // also the `?demo=` value (lib/demo.ts)
  name: string; // "Problems in San Francisco"
  place: string; // "residents of San Francisco, California" in the Claude prompts
  center: { lat: number; lng: number }; // the map's default center
  demoPoint: Point; // demo mode's simulated location (§6.1.1)
  routing: Record<Category, { owner: Owner; agency: string }>; // §2.1.2
  ownerLabels: Record<Owner, string>; // owner chip text
};

export const SAN_FRANCISCO: City = {
  id: "sf",
  name: "San Francisco",
  place: "San Francisco, California",
  // Civic Center.
  center: { lat: 37.7793, lng: -122.4193 },
  // Baker St beside the Palace of Fine Arts lagoon, a public street outside the venue.
  demoPoint: { lat: 37.803, lng: -122.44687 },
  // San Francisco is a combined city and county, so nearly everything is the city's. ⚠️ The
  // streetlight and code-enforcement rows are approximate: SFPUC and PG&E split streetlights,
  // and Building Inspection handles code issues other than dumping.
  routing: {
    pothole: { owner: "city", agency: "SF Public Works" },
    signal_sign: { owner: "city", agency: "SFMTA" },
    drainage: { owner: "city", agency: "SFPUC (sewer & stormwater)" },
    water_leak: { owner: "city", agency: "SFPUC Water" },
    streetlight: { owner: "utility", agency: "PG&E / SFPUC Streetlights" },
    trash_missed: { owner: "utility", agency: "Recology" },
    code_violation: { owner: "city", agency: "SF Public Works" },
    other: { owner: "unknown", agency: "Routing unclear" },
  },
  // No SF category routes to the county slot.
  ownerLabels: { city: "City of SF", cobb: "County", utility: "Utility", unknown: "Not routed" },
};

export const MABLETON: City = {
  id: "mableton",
  name: "Mableton",
  place: "Mableton, Georgia",
  // Mableton's published center point, 33°48′57″N 84°34′57″W.
  center: { lat: 33.8158, lng: -84.5825 },
  // Clay Road SW beside the South Cobb Regional Library.
  demoPoint: { lat: 33.8253, lng: -84.5765 },
  // ⚠️ Streetlight and water rows are unverified (§8 "Before ship", US28).
  routing: {
    pothole: { owner: "cobb", agency: "Cobb DOT" },
    signal_sign: { owner: "cobb", agency: "Cobb DOT" },
    drainage: { owner: "cobb", agency: "Cobb Water System (stormwater)" },
    water_leak: { owner: "cobb", agency: "Cobb Water System" },
    streetlight: { owner: "utility", agency: "Georgia Power" },
    trash_missed: { owner: "city", agency: "Mableton Sanitation" },
    code_violation: { owner: "city", agency: "Mableton Code Enforcement" },
    other: { owner: "unknown", agency: "Routing unclear" },
  },
  ownerLabels: { city: "City of Mableton", cobb: "Cobb County", utility: "Utility", unknown: "Not routed" },
};

export const ACTIVE_CITY: City = SAN_FRANCISCO;

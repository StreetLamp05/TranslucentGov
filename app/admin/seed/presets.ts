import { ACTIVE_CITY } from "../../../server/lib/city";
import type { LatLng } from "../../../lib/demo";

// Where samples can be placed (§6.1.1): spots on public roads in the active city
// (server/lib/city.ts), from OpenStreetMap. In each list the first two are within 50 m of
// that city's demo point, for the stage flow's me-too and before/after beats
// (tests/app/admin/seed/presets.test.ts checks). The pothole is the nearer one, so the
// duplicate check (nearest first) offers it first. The rest spread across town for the map.
export type Preset = LatLng & { label: string; stage?: "pothole" | "beforeAfter" };

export const PRESETS_BY_CITY: Record<string, Preset[]> = {
  // Around the Palace of Fine Arts (Baker St), then SF street corners (bus stops, so the curb is public).
  sf: [
    { label: "Stage: open pothole, Baker St by the Palace", lat: 37.80275, lng: -122.44682, stage: "pothole" },
    { label: "Stage: before/after spot, Baker St at the lagoon", lat: 37.80335, lng: -122.44695, stage: "beforeAfter" },
    { label: "Chestnut St & Fillmore St, Marina", lat: 37.80094, lng: -122.43603 },
    { label: "Polk St & Washington St, Polk Gulch", lat: 37.79357, lng: -122.42122 },
    { label: "Divisadero St & Hayes St, Western Addition", lat: 37.77519, lng: -122.43774 },
    { label: "Haight St & Masonic Ave, Haight", lat: 37.77024, lng: -122.44574 },
    { label: "Geary Blvd & Arguello Blvd, Richmond", lat: 37.78138, lng: -122.45949 },
    { label: "9th Ave & Irving St, Inner Sunset", lat: 37.76339, lng: -122.46631 },
    { label: "Valencia St & 18th St, Mission", lat: 37.76177, lng: -122.42186 },
    { label: "Folsom St & 7th St, SoMa", lat: 37.77689, lng: -122.40762 },
    { label: "3rd St & Palou Ave, Bayview", lat: 37.73429, lng: -122.39071 },
  ],
  // Clay Rd SW by the South Cobb Regional Library, then named roads across Mableton.
  mableton: [
    { label: "Stage: open pothole, Clay Rd SW at Floyd Rd", lat: 33.8252, lng: -84.5762, stage: "pothole" },
    { label: "Stage: before/after spot, Clay Rd SW by the library", lat: 33.8254, lng: -84.5769, stage: "beforeAfter" },
    { label: "Floyd Rd SW, north of Clay Rd", lat: 33.8272, lng: -84.5757 },
    { label: "Mableton Pkwy, downtown", lat: 33.8178, lng: -84.5759 },
    { label: "Old Bankhead Hwy SW", lat: 33.8187, lng: -84.5831 },
    { label: "Old Alabama Rd SW, Lakeside", lat: 33.8092, lng: -84.5772 },
    { label: "Veterans Memorial Hwy SW, Leland", lat: 33.812, lng: -84.555 },
    { label: "Mableton Pkwy, Hillcrest Valley", lat: 33.787, lng: -84.546 },
    { label: "Floyd Rd, Blue Ridge Manor", lat: 33.861, lng: -84.5942 },
    { label: "Austell Rd", lat: 33.8526, lng: -84.6045 },
  ],
};

export const PRESETS: Preset[] = PRESETS_BY_CITY[ACTIVE_CITY.id];

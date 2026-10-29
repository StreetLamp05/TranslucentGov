import { ACTIVE_CITY } from "./city";

// §2.1.2: Claude picks the category; this fixed table picks the owner. Claude never
// chooses the owner. The table is the active city's (server/lib/city.ts).

export const CATEGORIES = [
  "pothole",
  "signal_sign",
  "drainage",
  "water_leak",
  "streetlight",
  "trash_missed",
  "code_violation",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const OWNERS = ["city", "cobb", "utility", "unknown"] as const;
export type Owner = (typeof OWNERS)[number];

export const ROUTING: Record<Category, { owner: Owner; agency: string }> = ACTIVE_CITY.routing;

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

// Any category string Claude returns that isn't in the table falls back to `other`.
export function routeCategory(category: string): { category: Category; owner: Owner; agency: string } {
  const known = isCategory(category) ? category : "other";
  return { category: known, ...ROUTING[known] };
}

// Owner chip colors, from the UI prototype's ownerMeta (spec/UI_mockups). Labels are the active city's.
const labels = ACTIVE_CITY.ownerLabels;
export const OWNER_CHIP: Record<Owner, { label: string; dot: string; bg: string; fg: string }> = {
  city: { label: labels.city, dot: "#2DD4BF", bg: "#E3F5F2", fg: "#0F5E56" },
  cobb: { label: labels.cobb, dot: "#60A5FA", bg: "#E7EFFD", fg: "#1E429F" },
  utility: { label: labels.utility, dot: "#FBBF24", bg: "#FDF3DC", fg: "#7A4306" },
  unknown: { label: labels.unknown, dot: "#CBD5E1", bg: "#EDF0F3", fg: "#46505C" },
};

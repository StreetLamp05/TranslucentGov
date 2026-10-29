import type { Id } from "../_generated/dataModel";
import { CATEGORIES, type Category, type Owner } from "./routing";

// The triage dashboard's groups (§5.5). A report's group is its category's agency in the
// active routing table, worked out at query time rather than read from the stored `agency`,
// so a corrected table row moves every past report with it (§2.1.4). The table is passed in
// so both city profiles can be tested. No server imports (only the `Id` type), so client
// code can use it. The Postgres port (US44) swaps that type when `convex/` goes away.

export type RoutingTable = Record<Category, { owner: Owner; agency: string }>;

export type AgencyGroup = { agency: string; owner: Owner; slug: string; categories: Category[] };

// What /gov shows per group: no report fields, only the group and its counts (§3.1.3).
export type TriageGroup = { agency: string; owner: Owner; slug: string; open: number; fixed: number };

// A URL-safe, stable slug from the agency's display name: "PG&E / SFPUC Streetlights" →
// "pg-and-e-sfpuc-streetlights". There's no stored agency id (§2.1.4), so the name is the key.
export function agencySlug(agency: string): string {
  return agency
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Each distinct agency once, in table order. Categories that share an agency share a group
// (Mableton's pothole and signal_sign are both Cobb DOT).
export function agencyGroups(routing: RoutingTable): AgencyGroup[] {
  const groups = new Map<string, AgencyGroup>();
  for (const category of CATEGORIES) {
    const { agency, owner } = routing[category];
    const group = groups.get(agency);
    if (group) group.categories.push(category);
    else groups.set(agency, { agency, owner, slug: agencySlug(agency), categories: [category] });
  }
  return [...groups.values()];
}

// A public report always has a category (release refuses one without, §4.2.1); a missing one
// counts as `other`, the same fallback routeCategory uses.
export function groupFor(routing: RoutingTable, category: Category | undefined): string {
  return routing[category ?? "other"].agency;
}

// Every agency, including those with no reports, sorted by open count, descending. Ties keep
// table order. "Routing unclear" (`other`) always sits last, whatever its count (§5.5.1).
export function triageOverview(
  routing: RoutingTable,
  rows: readonly { category?: Category; status: "open" | "fixed" }[],
): TriageGroup[] {
  const counts = new Map(agencyGroups(routing).map((g) => [g.agency, { open: 0, fixed: 0 }]));
  for (const row of rows) {
    const count = counts.get(groupFor(routing, row.category))!;
    count[row.status] += 1;
  }
  const unrouted = routing.other.agency;
  return agencyGroups(routing)
    .map(({ agency, owner, slug }) => ({ agency, owner, slug, ...counts.get(agency)! }))
    .sort((a, b) => Number(a.agency === unrouted) - Number(b.agency === unrouted) || b.open - a.open);
}

export function agencyForSlug(routing: RoutingTable, slug: string): AgencyGroup | null {
  return agencyGroups(routing).find((g) => g.slug === slug) ?? null;
}

// One row of a group's queue (§5.5.2). An allowlist like the map's: no transcript, segments,
// description, poster, tokens or fixer identity (§3.1.3, §7.1.1).
export type QueueRow = {
  _id: Id<"reports">;
  title?: string;
  street?: string;
  category?: Category;
  status: "open" | "fixed";
  meTooCount: number;
  createdAt: number;
  fixedAt?: number;
  isSample: boolean;
  thumbnailUrl: string | null;
};

export type TriageQueue = { agency: string; owner: Owner; open: QueueRow[]; fixed: QueueRow[] };

// A group's queue, or null for a slug that isn't an agency in this table. Open reports are
// ranked by how many neighbors flagged them (1 + me-toos), the oldest first on a tie; fixed
// ones newest first, so ownership shows as results (§5.5.2).
export function triageQueue(routing: RoutingTable, slug: string, rows: readonly QueueRow[]): TriageQueue | null {
  const group = agencyForSlug(routing, slug);
  if (!group) return null;
  const mine = rows.filter((row) => groupFor(routing, row.category) === group.agency);
  return {
    agency: group.agency,
    owner: group.owner,
    open: mine
      .filter((row) => row.status === "open")
      .sort((a, b) => b.meTooCount - a.meTooCount || a.createdAt - b.createdAt),
    fixed: mine.filter((row) => row.status === "fixed").sort((a, b) => (b.fixedAt ?? 0) - (a.fixedAt ?? 0)),
  };
}

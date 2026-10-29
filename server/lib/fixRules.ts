import type { Owner } from "./routing";

// Who may film a proof of fix (§4.3.2). Fixers can close any open report; neighbors only
// those the city doesn't own, since city-owned reports close through a city crew. Shared by
// submitFix and the card's "Is it fixed?" button. No server imports, so client code can use it.
export function neighborCanConfirm(report: { status: string; owner?: Owner }): boolean {
  return report.status === "open" && report.owner !== undefined && report.owner !== "city";
}

export const CITY_ONLY = "Only a city crew can mark this report fixed.";

// Rounded up, so 50.3 m reads "51 m" rather than a distance that looks in range.
export function tooFarMessage(meters: number, radius: number): string {
  return `Get within ${radius} m (you're ${Math.ceil(meters)} m away)`;
}

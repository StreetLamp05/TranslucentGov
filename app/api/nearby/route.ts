import { route, searchArgs } from "@/server/http";
import { UserError } from "@/server/lib/errors";
import { nearbyOpen } from "@/server/nearby";

const coordinate = (value: string) => (value.trim() === "" ? NaN : Number(value));

// The duplicate check (§4.1.2): open reports within 50 m of the confirmed location.
export const GET = route(async (req, { caller }) => {
  const args = searchArgs(req);
  const lat = coordinate(args.string("lat"));
  const lng = coordinate(args.string("lng"));
  if (Number.isNaN(lat) || Number.isNaN(lng)) throw new UserError("That location isn't valid.");
  return nearbyOpen(await caller.findResident(), lat, lng);
});

import { readBody } from "@/server/body";
import { route } from "@/server/http";
import { createReport, mediaFrom } from "@/server/posts";

// createReport (§4.1.1): the files are already in MinIO, this saves the report and queues screening.
export const POST = route(async (req, { caller }) => {
  const body = await readBody(req);
  const residentId = await caller.resident();
  return createReport(residentId, { ...mediaFrom(body), description: body.description, lat: body.lat, lng: body.lng });
});

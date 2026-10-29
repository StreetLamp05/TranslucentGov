import { db } from "@/server/db";
import { reports, residents, type Report } from "@/server/db/schema";

// Report rows for the tests under tests/server/ (feed, map, me, reveal, stats).

export async function insertResident(token: string = crypto.randomUUID()) {
  const [resident] = await db.insert(residents).values({ token, createdAt: 1 }).returning();
  return resident;
}

/** A public-ready video report by default; `overrides` change any column. */
export async function insertReport(
  residentId: string,
  overrides: Partial<typeof reports.$inferInsert> = {},
): Promise<Report> {
  const [row] = await db
    .insert(reports)
    .values({
      residentId,
      mediaType: "video",
      description: "Cars swerve around it",
      clipStorageId: "clip-key",
      frameStorageIds: ["frame-key"],
      transcript: "This pothole's been here since June.",
      segments: [{ start: 0, end: 3, text: "This pothole's been here since June." }],
      lat: 33.8187,
      lng: -84.5824,
      street: "Floyd Rd SW",
      category: "pothole",
      owner: "cobb",
      agency: "Cobb DOT",
      title: "Pothole",
      status: "open",
      audioMuted: false,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
      ...overrides,
    })
    .returning();
  return row;
}

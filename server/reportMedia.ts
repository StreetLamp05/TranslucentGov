import { eq } from "drizzle-orm";
import { db } from "./db";
import { fixers } from "./db/schema";
import type { ReportMedia } from "./lib/publicReport";
import { getDownloadUrl } from "./storage";

// Media for the public projection (server/lib/publicReport.ts) on Postgres: presigned MinIO
// GET URLs and fixer orgs. Pass it with reportDoc(row):
//   publicReport(reportMedia, reportDoc(row))
export const reportMedia: ReportMedia = {
  url: (key) => getDownloadUrl(key),
  fixerOrg: async (fixerId) => {
    const [fixer] = await db.select({ org: fixers.org }).from(fixers).where(eq(fixers.id, fixerId));
    return fixer?.org;
  },
};

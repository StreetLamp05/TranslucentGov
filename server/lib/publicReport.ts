import type { Report, Segment } from "../db/schema";
import type { Category, Owner } from "./routing";

// The single public projection of a report (§7.1.1). Every public read returns reports
// through this. It's an allowlist, so a field added to `reports` stays private until it's
// added here: residentId, fixedBy, fixedByOrg, verdict and reason are never returned.
// ownerReport is the poster's own view (Me page, Checking… screen, §5.4.1): the same
// fields plus verdict, reason and the screening-failure details, for any status, and only for the poster.
//
// It works on either backend. A report is a ReportDoc, the document shape the browser has
// always read (`_id`, `_creationTime`, absent fields undefined); `reportDoc` turns a Postgres
// row into one. ReportMedia supplies media URLs and fixer orgs (server/reportMedia.ts on
// Postgres, convex/lib/publicReport.ts on Convex).

export type ReportStatus = Report["status"];

export type ReportDoc = {
  _id: string;
  _creationTime: number;
  residentId: string;
  mediaType: Report["mediaType"];
  description?: string;
  clipStorageId?: string;
  frameStorageIds: string[];
  transcript?: string;
  segments?: Segment[];
  lat: number;
  lng: number;
  street?: string;
  category?: Category;
  owner?: Owner;
  agency?: string;
  title?: string;
  status: ReportStatus;
  verdict?: NonNullable<Report["verdict"]>;
  reason?: string;
  screeningError?: string;
  screeningRetries?: number;
  audioMuted: boolean;
  isSample: boolean;
  meTooCount: number;
  lastActivityAt: number;
  revealViews: number;
  createdAt: number;
  fixStorageId?: string;
  fixedAt?: number;
  fixedBy?: string;
  fixedByKind?: NonNullable<Report["fixedByKind"]>;
  fixedByOrg?: string;
};

/** Where projected reports get their media URLs and fixer orgs. */
export type ReportMedia = {
  url(key: string): Promise<string | null> | string | null;
  /** The fixer's org, or undefined if the fixer is gone. */
  fixerOrg(fixerId: string): Promise<string | undefined>;
};

/** A Postgres row in the document shape: `_id` and `_creationTime`, nulls as absent fields. */
export function reportDoc(row: Report): ReportDoc {
  const doc: Record<string, unknown> = { _id: row.id, _creationTime: row.creationTime };
  for (const [field, value] of Object.entries(row)) {
    if (field !== "id" && field !== "creationTime" && value !== null) doc[field] = value;
  }
  return doc as ReportDoc;
}

export const PUBLIC_STATUSES = ["open", "fixed"] as const satisfies readonly ReportStatus[];
export type PublicStatus = (typeof PUBLIC_STATUSES)[number];

// Only open and fixed reports are public; pending and held never are (§2.1.3).
export function isPublicStatus(status: ReportStatus): status is PublicStatus {
  return (PUBLIC_STATUSES as readonly string[]).includes(status);
}

type ProjectedReport<R extends ReportDoc> = Pick<
  R,
  | "_id"
  | "_creationTime"
  | "mediaType"
  | "lat"
  | "lng"
  | "street"
  | "category"
  | "owner"
  | "agency"
  | "title"
  | "status"
  | "audioMuted"
  | "isSample"
  | "meTooCount"
  | "lastActivityAt"
  | "revealViews"
  | "createdAt"
  | "fixedAt"
  | "fixedByKind"
> &
  // Omitted when audioMuted (§4.2.1).
  Partial<Pick<R, "description" | "transcript" | "segments">> & {
    clipUrl: string | null;
    frameUrls: (string | null)[];
    fixUrl: string | null;
    // The fixer's org, or "neighbor" for a resident (§4.3.2). Undefined until fixed.
    fixedByLabel?: string;
  };

// Generic over the report type so Convex keeps its Id-typed `_id` (convex/lib/publicReport.ts).
export type PublicReport<R extends ReportDoc = ReportDoc> = Omit<ProjectedReport<R>, "status"> & {
  status: PublicStatus;
};
export type OwnerReport<R extends ReportDoc = ReportDoc> = ProjectedReport<R> &
  Pick<R, "verdict" | "reason" | "screeningError" | "screeningRetries">;

// For a report fetched by ID: null unless it exists and is public.
export async function publicReportOrNull<R extends ReportDoc>(
  media: ReportMedia,
  report: R | null,
): Promise<PublicReport<R> | null> {
  return report && isPublicStatus(report.status) ? await publicReport(media, report) : null;
}

// Throws on a pending or held report, so a query that forgets its status filter fails
// loudly instead of publishing a held clip.
export async function publicReport<R extends ReportDoc>(media: ReportMedia, report: R): Promise<PublicReport<R>> {
  const status = report.status;
  if (!isPublicStatus(status)) {
    throw new Error(`publicReport: report ${report._id} is ${status}, not public`);
  }
  return { ...(await project(media, report)), status };
}

// Throws unless `residentId` posted the report, so one resident can never read another's
// verdict, reason or held clip. Me-toos aren't the caller's posts: use publicReport for those.
export async function ownerReport<R extends ReportDoc>(
  media: ReportMedia,
  report: R,
  residentId: string,
): Promise<OwnerReport<R>> {
  if (report.residentId !== residentId) {
    throw new Error(`ownerReport: report ${report._id} isn't this resident's`);
  }
  return {
    ...(await project(media, report)),
    verdict: report.verdict,
    reason: report.reason,
    screeningError: report.screeningError,
    screeningRetries: report.screeningRetries,
  };
}

const urlOf = async (media: ReportMedia, key: string | undefined) => (key ? await media.url(key) : null);

async function project<R extends ReportDoc>(media: ReportMedia, report: R): Promise<ProjectedReport<R>> {
  const [clipUrl, frameUrls, fixUrl, fixedByLabel] = await Promise.all([
    urlOf(media, report.clipStorageId),
    Promise.all(report.frameStorageIds.map((key) => urlOf(media, key))),
    urlOf(media, report.fixStorageId),
    fixedByLabelOf(media, report),
  ]);

  return {
    _id: report._id,
    _creationTime: report._creationTime,
    mediaType: report.mediaType,
    lat: report.lat,
    lng: report.lng,
    street: report.street,
    category: report.category,
    owner: report.owner,
    agency: report.agency,
    title: report.title,
    status: report.status,
    audioMuted: report.audioMuted,
    isSample: report.isSample,
    meTooCount: report.meTooCount,
    lastActivityAt: report.lastActivityAt,
    revealViews: report.revealViews,
    createdAt: report.createdAt,
    fixedAt: report.fixedAt,
    fixedByKind: report.fixedByKind,
    // Muted reports never return what was said or written (§4.2.1, §7.1.1).
    ...(report.audioMuted
      ? {}
      : { description: report.description, transcript: report.transcript, segments: report.segments }),
    clipUrl,
    frameUrls,
    fixUrl,
    fixedByLabel,
  } as ProjectedReport<R>;
}

// Shown only if a fixer's fix has no org recorded and the fixer row is gone.
export const UNKNOWN_FIXER_LABEL = "a city crew";

async function fixedByLabelOf(media: ReportMedia, report: ReportDoc): Promise<string | undefined> {
  if (report.fixedByKind === "resident") return "neighbor";
  if (report.fixedByKind !== "fixer") return undefined;
  if (report.fixedByOrg) return report.fixedByOrg;
  // The org is public (§3.1.2); only the fixer's identity isn't, and that never leaves here.
  const org = report.fixedBy ? await media.fixerOrg(report.fixedBy) : undefined;
  return org ?? UNKNOWN_FIXER_LABEL;
}

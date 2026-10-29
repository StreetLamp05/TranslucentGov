import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import * as shared from "../../server/lib/publicReport";

// The public projection (server/lib/publicReport.ts) on Convex: storage URLs and fixer orgs
// come from `ctx`. The types keep Convex's Id-typed `_id` for the screens still on Convex;
// a ported screen imports PublicReport / OwnerReport from server/lib/publicReport instead.

export { isPublicStatus, PUBLIC_STATUSES, UNKNOWN_FIXER_LABEL, type PublicStatus } from "../../server/lib/publicReport";
export type PublicReport = shared.PublicReport<Doc<"reports">>;
export type OwnerReport = shared.OwnerReport<Doc<"reports">>;

function media(ctx: QueryCtx): shared.ReportMedia {
  return {
    url: (key) => ctx.storage.getUrl(key as Id<"_storage">),
    fixerOrg: async (fixerId) => {
      const fixer = await ctx.db.get(fixerId as Id<"fixers">);
      return fixer && "org" in fixer ? fixer.org : undefined;
    },
  };
}

export function publicReportOrNull(ctx: QueryCtx, report: Doc<"reports"> | null): Promise<PublicReport | null> {
  return shared.publicReportOrNull(media(ctx), report);
}

export function publicReport(ctx: QueryCtx, report: Doc<"reports">): Promise<PublicReport> {
  return shared.publicReport(media(ctx), report);
}

export function ownerReport(
  ctx: QueryCtx,
  report: Doc<"reports">,
  residentId: Id<"residents">,
): Promise<OwnerReport> {
  return shared.ownerReport(media(ctx), report, residentId);
}

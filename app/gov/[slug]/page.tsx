"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import AgencyQueue from "@/components/gov/AgencyQueue";
import { query } from "@/lib/data/api";
import { useLive } from "@/lib/data/useLive";
import { useT } from "@/lib/i18n/I18nProvider";
import type { TriageQueue } from "@/server/lib/triageGroups";

// One agency's queue on the triage dashboard (§5.5.2). Public and read-only, no tab bar
// (§3.1.3). Updates live by polling (§1.1.1).
export default function GovGroupPage() {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const queue = useLive(`triage:${slug}`, (signal) =>
    query<TriageQueue | null>(`/api/triage/${encodeURIComponent(slug)}`, {}, { signal }),
  );

  return (
    <main className="mx-auto min-h-dvh max-w-md p-4">
      <Link href="/gov" className="text-sm font-semibold text-[#46505C]">
        {t("gov.back")}
      </Link>
      {queue === undefined ? (
        <p className="py-12 text-center text-sm text-[#46505C]">{t("gov.loading")}</p>
      ) : queue === null ? (
        <p className="py-12 text-center text-sm text-[#46505C]">
          {t("gov.noSuchGroup")}{" "}
          <Link href="/gov" className="font-semibold underline">
            {t("gov.seeAll")}
          </Link>
        </p>
      ) : (
        <AgencyQueue queue={queue} />
      )}
    </main>
  );
}

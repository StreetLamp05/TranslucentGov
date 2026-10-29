"use client";

import AgencyList from "@/components/gov/AgencyList";
import { query } from "@/lib/data/api";
import { useLive } from "@/lib/data/useLive";
import { useT } from "@/lib/i18n/I18nProvider";
import { ACTIVE_CITY } from "@/server/lib/city";
import type { TriageGroup } from "@/server/lib/triageGroups";

// The triage dashboard (§5.5.1): public, read-only and unlinked, with no tab bar, like /fix
// (§3.1.3). Counts update live by polling (§1.1.1).
export default function GovPage() {
  const t = useT();
  const groups = useLive("triage:overview", (signal) =>
    query<TriageGroup[]>("/api/triage/overview", {}, { signal }),
  );

  return (
    <main className="mx-auto min-h-dvh max-w-md p-4">
      <h1 className="mt-4 text-2xl font-extrabold">{t("gov.title")}</h1>
      {/* Neutral copy: the counts include seeded samples, which aren't residents' (§6.1.1). */}
      <p className="mb-4 text-sm text-[#46505C]">
        {t("gov.intro", { city: ACTIVE_CITY.name })}
      </p>
      {groups === undefined ? (
        <p className="py-12 text-center text-sm text-[#46505C]">{t("gov.loading")}</p>
      ) : (
        <AgencyList groups={groups} />
      )}
    </main>
  );
}

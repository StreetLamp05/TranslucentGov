"use client";

import { useQuery } from "convex/react";
import AgencyList from "@/components/gov/AgencyList";
import { api } from "@/convex/_generated/api";
import { ACTIVE_CITY } from "@/server/lib/city";

// The triage dashboard (§5.5.1): public, read-only and unlinked, with no tab bar, like /fix
// (§3.1.3). Counts update live through the Convex subscription.
export default function GovPage() {
  const groups = useQuery(api.triage.overview, {});

  return (
    <main className="mx-auto min-h-dvh max-w-md p-4">
      <h1 className="mt-4 text-2xl font-extrabold">Who has what</h1>
      {/* Neutral copy: the counts include seeded samples, which aren't residents' (§6.1.1). */}
      <p className="mb-4 text-sm text-[#46505C]">
        Public reports in {ACTIVE_CITY.name}, grouped by the agency responsible.
      </p>
      {groups === undefined ? (
        <p className="py-12 text-center text-sm text-[#46505C]">Loading…</p>
      ) : (
        <AgencyList groups={groups} />
      )}
    </main>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import AgencyQueue from "@/components/gov/AgencyQueue";
import { query } from "@/lib/data/api";
import { useLive } from "@/lib/data/useLive";
import type { TriageQueue } from "@/server/lib/triageGroups";

// One agency's queue on the triage dashboard (§5.5.2). Public and read-only, no tab bar
// (§3.1.3). Updates live by polling (§1.1.1).
export default function GovGroupPage() {
  const { slug } = useParams<{ slug: string }>();
  const queue = useLive(`triage:${slug}`, (signal) =>
    query<TriageQueue | null>(`/api/triage/${encodeURIComponent(slug)}`, {}, { signal }),
  );

  return (
    <main className="mx-auto min-h-dvh max-w-md p-4">
      <Link href="/gov" className="text-sm font-semibold text-[#46505C]">
        ← All agencies
      </Link>
      {queue === undefined ? (
        <p className="py-12 text-center text-sm text-[#46505C]">Loading…</p>
      ) : queue === null ? (
        <p className="py-12 text-center text-sm text-[#46505C]">
          No such group.{" "}
          <Link href="/gov" className="font-semibold underline">
            See all agencies
          </Link>
        </p>
      ) : (
        <AgencyQueue queue={queue} />
      )}
    </main>
  );
}

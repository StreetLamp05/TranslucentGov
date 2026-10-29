"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AgencyQueue from "@/components/gov/AgencyQueue";
import { api } from "@/convex/_generated/api";

// One agency's queue on the triage dashboard (§5.5.2). Public and read-only, no tab bar
// (§3.1.3). Updates live through the Convex subscription.
export default function GovGroupPage() {
  const { slug } = useParams<{ slug: string }>();
  const queue = useQuery(api.triageGroup.queue, { slug });

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

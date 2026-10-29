"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import FixCapture from "@/components/fix/FixCapture";
import { OwnerChip } from "@/components/fix/FixerList";
import { api } from "@/convex/_generated/api";
import { CITY_ONLY, neighborCanConfirm } from "@/server/lib/fixRules";
import { useResidentToken } from "@/lib/hooks/useResidentToken";

// "Is it fixed?" from a feed card (§4.3.2): a neighbor films the proof of fix for a report the
// city doesn't own, through the same capture and check screens as a fixer (§5.3.1).
export default function ConfirmFixPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const token = useResidentToken();
  const report = useQuery(api.feed.reportById, { id: reportId });
  const [started, setStarted] = useState(false);

  if (report === undefined || !token) return <Message text="Loading…" />;
  if (report === null) return <Message text="This report doesn't exist." />;

  const poster = report.frameUrls[0];
  let body;
  if (neighborCanConfirm(report) || started) {
    // Kept up once started, so Claude's verdict stays on screen after the report turns fixed.
    body = <FixCapture report={report} auth={{ residentToken: token }} onStart={() => setStarted(true)} />;
  } else {
    body = (
      <p className="mt-6 rounded-xl bg-[#E3F5F2] py-3 text-center font-bold text-[#0F5E56]">
        {report.status === "fixed" ? "This report is already fixed." : CITY_ONLY}
      </p>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md p-4">
      <BackLink reportId={report._id} />
      <h1 className="text-2xl font-extrabold">Is it fixed?</h1>
      <p className="text-sm text-[#46505C]">
        Stand where the original was filmed and record a short clip. We compare it with the original.
      </p>
      <div className="mt-4 flex gap-3">
        {poster && (
          // Convex storage URLs, so next/image's remote config doesn't apply.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="The original report" className="h-28 w-20 shrink-0 rounded-lg bg-black object-cover" />
        )}
        <div className="flex flex-col gap-1">
          <p className="font-bold">{report.title ?? "Untitled report"}</p>
          {report.street && <p className="text-sm text-[#46505C]">{report.street}</p>}
          <div>
            <OwnerChip report={report} />
          </div>
        </div>
      </div>
      {body}
    </main>
  );
}

function BackLink({ reportId }: { reportId?: string }) {
  return (
    <Link href={reportId ? `/?report=${reportId}` : "/"} className="mb-3 inline-block text-sm font-semibold text-[#46505C]">
      ← Back to the feed
    </Link>
  );
}

function Message({ text }: { text: string }) {
  return (
    <main className="mx-auto min-h-dvh max-w-md p-4">
      <BackLink />
      <p className="py-12 text-center text-sm text-[#46505C]">{text}</p>
    </main>
  );
}

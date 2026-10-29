"use client";

import Link from "next/link";
import { useState } from "react";
import { statusText } from "@/components/feed/CardOverlay";
import { useT } from "@/lib/i18n/I18nProvider";
import { OWNER_CHIP } from "@/server/lib/routing";
import type { QueueRow, TriageQueue } from "@/server/lib/triageGroups";

// One agency's queue (§5.5.2): open reports ranked by neighbors (as the query returns them),
// then recently fixed. Rows follow the fixer list (§5.3.1) and open the feed card (§5.2.1).
export default function AgencyQueue({ queue }: { queue: TriageQueue }) {
  const t = useT();
  const [now] = useState(() => Date.now());
  const chip = OWNER_CHIP[queue.owner];
  return (
    <>
      <h1 className="mt-4 text-2xl font-extrabold">{queue.agency}</h1>
      <span
        className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
        style={{ background: chip.bg, color: chip.fg }}
      >
        <span className="size-2 rounded-full" style={{ background: chip.dot }} />
        {chip.label}
      </span>
      <Section
        title={t("gov.queue.open")}
        note={t("gov.queue.openNote")}
        rows={queue.open}
        now={now}
        empty={t("gov.queue.openEmpty")}
      />
      <Section title={t("gov.queue.fixed")} rows={queue.fixed} now={now} empty={t("gov.queue.fixedEmpty")} />
    </>
  );
}

function Section({
  title,
  note,
  rows,
  now,
  empty,
}: {
  title: string;
  note?: string;
  rows: readonly QueueRow[];
  now: number;
  empty: string;
}) {
  const t = useT();
  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="text-lg font-bold">
        {title} <span className="text-[#46505C]">· {rows.length}</span>
      </h2>
      {note && <p className="mb-2 text-xs text-[#46505C]">{note}</p>}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-[#46505C]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[#E2E6EA] overflow-hidden rounded-2xl bg-white">
          {rows.map((row) => (
            <li key={row._id}>
              <Link href={`/?report=${row._id}`} className="flex gap-3 p-3 active:bg-[#F4F6F8]">
                <Thumbnail url={row.thumbnailUrl} />
                <div className="min-w-0 flex-1">
                  {row.isSample && (
                    <span className="rounded-md bg-[#EDF0F3] px-1.5 py-0.5 text-[11px] font-bold text-[#46505C]">
                      {t("gov.queue.sample")}
                    </span>
                  )}
                  <p className="truncate font-bold">{row.title ?? t("gov.queue.untitled")}</p>
                  {row.street && <p className="truncate text-xs text-[#46505C]">{row.street}</p>}
                  <p className="mt-1 text-xs text-[#46505C]">
                    {statusText(row, now, t)} · {t("gov.queue.meToo", { count: row.meTooCount })}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Thumbnail({ url }: { url: string | null }) {
  if (!url) return <div className="size-16 shrink-0 rounded-lg bg-[#E2E6EA]" />;
  // Presigned MinIO URLs, so next/image's remote config doesn't apply.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="size-16 shrink-0 rounded-lg object-cover" />;
}

import Link from "next/link";
import { OWNER_CHIP } from "@/server/lib/routing";
import type { TriageGroup } from "@/server/lib/triageGroups";

// /gov's overview (§5.5.1): every agency with its open and fixed counts, in the order the
// query returns (most open first, "Routing unclear" last). Each row opens that group's queue.
export default function AgencyList({ groups }: { groups: readonly TriageGroup[] }) {
  return (
    <ul className="divide-y divide-[#E2E6EA] overflow-hidden rounded-2xl bg-white">
      {groups.map((group) => {
        const chip = OWNER_CHIP[group.owner];
        return (
          <li key={group.slug}>
            <Link href={`/gov/${group.slug}`} className="flex items-center gap-3 p-4 active:bg-[#F4F6F8]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{group.agency}</p>
                <span
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ background: chip.bg, color: chip.fg }}
                >
                  <span className="size-2 rounded-full" style={{ background: chip.dot }} />
                  {chip.label}
                </span>
              </div>
              <Count label="open" value={group.open} />
              <Count label="fixed" value={group.fixed} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <p className="w-14 shrink-0 text-center" data-testid={`${label}-count`}>
      <span className="block text-xl font-extrabold">{value}</span>
      <span className="block text-xs text-[#46505C]">{label}</span>
    </p>
  );
}

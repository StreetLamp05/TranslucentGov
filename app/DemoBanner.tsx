"use client";

import { useT } from "@/lib/i18n/I18nProvider";
import { useDemoMode } from "@/lib/hooks/useDemoMode";

// Every simulated thing is labeled on screen (§6.1.1).
export default function DemoBanner() {
  const t = useT();
  if (!useDemoMode()) return null;
  return (
    <div
      role="note"
      className="sticky top-0 z-50 flex h-[26px] items-center justify-center bg-[#FDE68A] text-xs font-bold text-[#713F12]"
    >
      {t("common.demoBanner")}
    </div>
  );
}

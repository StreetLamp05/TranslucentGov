import { translate } from "@/lib/i18n/dictionary";
import type { TFunction } from "@/lib/i18n/I18nProvider";

const DAY_MS = 86_400_000;

// Whole days from `from` to `to` (§2.1.3: days open = now − createdAt), never negative.
export function daysOpen(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

// "1 day" / "3 days" in the chosen language: pass the `t` from useT() (lib/i18n).
export function daysLabel(days: number, t: TFunction = (key, vars) => translate("en", key, vars)): string {
  return days === 1 ? t("common.dayOne") : t("common.dayOther", { count: days });
}

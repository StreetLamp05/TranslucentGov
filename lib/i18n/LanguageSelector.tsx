"use client";

import { LOCALES, type Locale } from "./locale";
import { useI18n } from "./I18nProvider";

// What each language is called in that language, so a resident who can't read the current one
// can still find theirs. Not in the dictionary: they never change.
const NAMES: Record<Locale, { short: string; full: string }> = {
  en: { short: "EN", full: "English" },
  es: { short: "ES", full: "Español" },
};

/** The EN / ES switch (US48). `tone` picks the colors for a dark (the feed's video) or light page. */
export default function LanguageSelector({ tone = "light", className = "" }: { tone?: "dark" | "light"; className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const dark = tone === "dark";
  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={`inline-flex h-7 items-center rounded-full border p-0.5 text-[11px] font-extrabold ${
        dark ? "border-white/30 bg-[rgba(10,18,30,.62)] text-white" : "border-[#D8DCCB] bg-white text-[#18382F]"
      } ${className}`}
    >
      {LOCALES.map((code) => {
        const selected = code === locale;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={selected}
            aria-label={NAMES[code].full}
            onClick={() => setLocale(code)}
            className={`h-6 min-w-8 rounded-full px-2 transition-colors ${
              selected ? (dark ? "bg-white text-[#18382F]" : "bg-[#173F35] text-white") : dark ? "text-white/70" : "text-[#5A6B63]"
            }`}
          >
            {NAMES[code].short}
          </button>
        );
      })}
    </div>
  );
}

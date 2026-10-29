"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { translate, type MessageKey, type Vars } from "./dictionary";
import { DEFAULT_LOCALE, getLocale, setLocale, subscribeLocale, type Locale } from "./locale";

export type TFunction = (key: MessageKey, vars?: Vars) => string;
type I18n = { locale: Locale; setLocale: (locale: Locale) => void; t: TFunction };

const englishT: TFunction = (key, vars) => translate(DEFAULT_LOCALE, key, vars);

// Without a provider (a component under test) everything reads as English.
const I18nContext = createContext<I18n>({ locale: DEFAULT_LOCALE, setLocale, t: englishT });

/** Wraps the app (app/layout.tsx): hands every component the language and `t`. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => DEFAULT_LOCALE);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const t = useCallback<TFunction>((key, vars) => translate(locale, key, vars), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The language, its setter and `t`. */
export const useI18n = () => useContext(I18nContext);
/** Just `t(key, vars)`: the string in the chosen language. */
export const useT = () => useContext(I18nContext).t;
export const useLocale = () => useContext(I18nContext).locale;

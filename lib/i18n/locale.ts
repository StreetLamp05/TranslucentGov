// The language store (US48). English or Spanish, remembered on the device in localStorage.
// Read through useSyncExternalStore (lib/i18n/I18nProvider.tsx), so the server render and the
// first client render are both English and the saved choice swaps in after hydration.

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "govtok.locale";

export function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly unknown[]).includes(value);
}

const listeners = new Set<() => void>();

// localStorage can throw (blocked site data, private windows) or hold something odd: English then.
export function readLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

// Unsaved, the choice still lasts until reload.
let unsaved: Locale | null = null;

export function getLocale(): Locale {
  return unsaved ?? readLocale();
}

export function setLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    unsaved = null;
  } catch {
    unsaved = locale;
  }
  listeners.forEach((listener) => listener());
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Test hook: forget the in-memory fallback. */
export function resetLocaleStore(): void {
  unsaved = null;
}

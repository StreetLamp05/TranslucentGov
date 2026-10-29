// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getLocale, LOCALE_STORAGE_KEY, resetLocaleStore, setLocale, subscribeLocale } from "@/lib/i18n/locale";

beforeEach(() => {
  localStorage.clear();
  resetLocaleStore();
});
afterEach(() => vi.restoreAllMocks());

describe("locale store", () => {
  test("starts in English", () => {
    expect(getLocale()).toBe("en");
  });

  test("remembers the choice on the device", () => {
    setLocale("es");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
    expect(getLocale()).toBe("es");
  });

  test("tells subscribers, and stops after unsubscribing", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    setLocale("es");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("falls back to English when the saved value is junk", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(getLocale()).toBe("en");
  });

  test("falls back to English when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getLocale()).toBe("en");
  });

  test("still switches for this visit when localStorage can't save", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setLocale("es");
    expect(getLocale()).toBe("es");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { I18nProvider, useT } from "@/lib/i18n/I18nProvider";
import LanguageSelector from "@/lib/i18n/LanguageSelector";
import { LOCALE_STORAGE_KEY, resetLocaleStore } from "@/lib/i18n/locale";

function Sample() {
  const t = useT();
  return (
    <>
      <LanguageSelector />
      <p data-testid="sample">{t("common.tab.feed")}</p>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  resetLocaleStore();
});
afterEach(cleanup);

describe("LanguageSelector", () => {
  test("switches the strings, marks the choice, remembers it and sets <html lang>", () => {
    render(
      <I18nProvider>
        <Sample />
      </I18nProvider>,
    );
    expect(screen.getByTestId("sample").textContent).toBe("Feed");
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Español" }));

    expect(screen.getByTestId("sample").textContent).toBe("Inicio");
    expect(screen.getByRole("button", { name: "Español" }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });

  test("opens in the saved language", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "es");
    render(
      <I18nProvider>
        <Sample />
      </I18nProvider>,
    );
    expect(screen.getByTestId("sample").textContent).toBe("Inicio");
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import AgencyList from "../../../components/gov/AgencyList";
import AgencyQueue from "../../../components/gov/AgencyQueue";
import { I18nProvider } from "../../../lib/i18n/I18nProvider";
import { resetLocaleStore, setLocale } from "../../../lib/i18n/locale";
import type { TriageGroup, TriageQueue } from "../../../server/lib/triageGroups";

beforeEach(() => {
  localStorage.clear();
  resetLocaleStore();
  setLocale("es");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resetLocaleStore();
});

test("the agency overview labels its counts in Spanish and keeps the agency name", () => {
  const groups: TriageGroup[] = [{ agency: "Cobb DOT", owner: "cobb", slug: "cobb-dot", open: 3, fixed: 1 }];
  render(
    <I18nProvider>
      <AgencyList groups={groups} />
    </I18nProvider>,
  );
  expect(screen.getByText("Cobb DOT")).toBeTruthy();
  expect(screen.getByTestId("open-count").textContent).toBe("3abiertos");
  expect(screen.getByTestId("fixed-count").textContent).toBe("1arreglados");
});

test("an agency queue is in Spanish, down to the days and the me-too count", () => {
  const queue: TriageQueue = {
    agency: "Cobb DOT",
    owner: "cobb",
    open: [
      { _id: "a", title: undefined, status: "open", meTooCount: 4, createdAt: Date.now() - 3 * 86_400_000, isSample: true, thumbnailUrl: null },
    ],
    fixed: [],
  };
  render(
    <I18nProvider>
      <AgencyQueue queue={queue} />
    </I18nProvider>,
  );
  expect(screen.getByText("Abiertos")).toBeTruthy();
  expect(screen.getByText("Arreglados recientemente")).toBeTruthy();
  expect(screen.getByText("Aún no hay nada arreglado.")).toBeTruthy();
  expect(screen.getByText("Muestra · grabado en California")).toBeTruthy();
  expect(screen.getByText("Reporte sin título")).toBeTruthy();
  expect(screen.getByText("Abierto · 3 días · 4 yo también")).toBeTruthy();
});

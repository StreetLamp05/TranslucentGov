// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import FixCapture from "../../../components/fix/FixCapture";
import FixerList from "../../../components/fix/FixerList";
import { I18nProvider } from "../../../lib/i18n/I18nProvider";
import { resetLocaleStore, setLocale } from "../../../lib/i18n/locale";
import type { PublicReport } from "../../../server/lib/publicReport";

const state = vi.hoisted(() => ({
  location: { status: "loading" } as { status: string; point?: { lat: number; lng: number } },
}));
vi.mock("../../../lib/hooks/useCurrentLocation", () => ({
  useCurrentLocation: () => ({ ...state.location, refresh: () => {} }),
}));
vi.mock("../../../lib/data/useLive", () => ({ LIVE_STATUS_MS: 1, useLive: () => undefined }));
vi.mock("../../../components/capture/VideoRecorder", () => ({ default: () => null }));

const REPORT = { _id: "report-1", lat: 33.8158, lng: -84.5825, status: "open" as const };

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

test("Record fix is in Spanish, with the distance sentence", () => {
  state.location = { status: "ready", point: { lat: REPORT.lat + 0.001, lng: REPORT.lng } };
  render(
    <I18nProvider>
      <FixCapture report={REPORT} auth={{ fixerToken: "t" }} />
    </I18nProvider>,
  );
  expect(screen.getByRole("button", { name: "Grabar arreglo" })).toBeTruthy();
  expect(screen.getByText(/^Acércate a menos de 50 m \(estás a 11\d m\)$/)).toBeTruthy();
});

test("a denied location explains itself in Spanish", () => {
  state.location = { status: "denied" };
  render(
    <I18nProvider>
      <FixCapture report={REPORT} auth={{ fixerToken: "t" }} />
    </I18nProvider>,
  );
  expect(screen.getByText("La ubicación está desactivada para GovTok")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Inténtalo de nuevo" })).toBeTruthy();
});

test("the fixer list is in Spanish and leaves the report title and agency alone", () => {
  state.location = { status: "error" };
  const report = {
    _id: "r1",
    owner: "cobb",
    agency: "Cobb DOT",
    title: null,
    status: "open",
    meTooCount: 2,
    createdAt: Date.now() - 2 * 86_400_000,
    frameUrls: [],
  } as unknown as PublicReport;
  render(
    <I18nProvider>
      <FixerList reports={[report]} />
    </I18nProvider>,
  );
  expect(screen.getByText("La ubicación no está disponible, así que la lista no está ordenada por distancia.")).toBeTruthy();
  expect(screen.getByText("Reporte sin título")).toBeTruthy();
  expect(screen.getByText("Cobb DOT")).toBeTruthy();
  expect(screen.getByText("Abierto · 2 días · 2 yo también")).toBeTruthy();
});

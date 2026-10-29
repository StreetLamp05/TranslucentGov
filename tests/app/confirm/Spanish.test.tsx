// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../../../lib/i18n/I18nProvider";
import { resetLocaleStore, setLocale } from "../../../lib/i18n/locale";

const state = vi.hoisted(() => ({ report: undefined as unknown }));

vi.mock("next/navigation", () => ({ useParams: () => ({ reportId: "r1" }) }));
vi.mock("../../../lib/hooks/useResidentToken", () => ({ useResidentToken: () => "token-a" }));
vi.mock("../../../lib/data/api", () => ({ query: async () => null }));
vi.mock("../../../lib/data/useLive", () => ({ useLive: () => state.report }));
vi.mock("../../../components/fix/FixCapture", () => ({ default: () => <p>capture</p> }));

const { default: ConfirmFixPage } = await import("../../../app/confirm/[reportId]/page");

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

const renderPage = () =>
  render(
    <I18nProvider>
      <ConfirmFixPage />
    </I18nProvider>,
  );

test("the confirm page is in Spanish while loading", () => {
  state.report = undefined;
  renderPage();
  expect(screen.getByText("Cargando…")).toBeTruthy();
  expect(screen.getByText("← Volver al inicio")).toBeTruthy();
});

test("a city-owned report says only a city crew can close it, in Spanish", () => {
  state.report = { _id: "r1", lat: 1, lng: 1, status: "open", owner: "city", agency: "Mableton Sanitation", title: "Pothole", frameUrls: ["https://x.test/a.jpg"] };
  renderPage();
  expect(screen.getByRole("heading", { name: "¿Ya está arreglado?" })).toBeTruthy();
  expect(screen.getByText("Solo una cuadrilla de la ciudad puede marcar este reporte como arreglado.")).toBeTruthy();
  expect(screen.getByAltText("El reporte original")).toBeTruthy();
  expect(screen.getByText("Pothole")).toBeTruthy();
});

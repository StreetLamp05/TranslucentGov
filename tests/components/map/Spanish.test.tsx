// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../../../lib/i18n/I18nProvider";
import { resetLocaleStore, setLocale } from "../../../lib/i18n/locale";
import type { MapReport } from "../../../server/map";

vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => children,
  Map: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AdvancedMarker: ({ title, children }: { title: string; children: ReactNode }) => (
    <button type="button" data-marker title={title}>
      {children}
    </button>
  ),
  useMap: () => null,
}));
vi.mock("@googlemaps/markerclusterer", () => ({ MarkerClusterer: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

let reports: MapReport[] | undefined;
vi.mock("../../../lib/data/useLive", () => ({ useLive: () => reports }));

const { default: MapScreen } = await import("../../../components/map/MapScreen");
const { default: LocationPicker } = await import("../../../components/map/LocationPicker");

const report = (id: string, status: MapReport["status"], meTooCount: number) =>
  ({ _id: id, lat: 33.8, lng: -84.58, status, meTooCount, title: id, category: "pothole" }) as MapReport;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAP_ID", "test-map-id");
  localStorage.clear();
  resetLocaleStore();
  setLocale("es");
  reports = [report("A", "open", 2), report("B", "fixed", 0)];
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
  resetLocaleStore();
});

test("the Map tab reads in Spanish", () => {
  render(
    <I18nProvider>
      <MapScreen />
    </I18nProvider>,
  );

  expect(screen.getByText("1 abiertos · 1 arreglados · 4 personas reportando")).toBeTruthy();
  expect(screen.getByRole("group", { name: "Filtrar por estado" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Arreglados · 1" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Leyenda" }).textContent).toContain("Mixto");
  expect(screen.getByTitle("A. 3 personas lo reportaron.")).toBeTruthy();
  expect(screen.getByTitle("B. Arreglado. 1 persona lo reportó.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Arreglados · 1" }));
  expect(screen.queryByTitle("A. 3 personas lo reportaron.")).toBeNull();
});

test("the location picker reads in Spanish", () => {
  render(
    <I18nProvider>
      <LocationPicker initialPoint={{ lat: 33.8, lng: -84.5 }} onConfirm={vi.fn()} onCancel={vi.fn()} />
    </I18nProvider>,
  );

  expect(screen.getByRole("heading", { name: "Elige la ubicación del problema" })).toBeTruthy();
  expect(screen.getByText("Pin seleccionado: 33.80000, -84.50000")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Atrás" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Usar este pin" })).toBeTruthy();
});

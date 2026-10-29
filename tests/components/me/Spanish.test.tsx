// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import MePageContent from "@/components/me/MePage";
import MeReportCard, { reportStatusText } from "@/components/me/MeReportCard";
import { translate } from "@/lib/i18n/dictionary";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { resetLocaleStore, setLocale } from "@/lib/i18n/locale";
import type { OwnerReport } from "@/server/lib/publicReport";

const state = vi.hoisted(() => ({ reports: [] as unknown, meToos: [] as unknown }));
vi.mock("@/lib/data/useLive", () => ({
  useLive: (key: string | null) => {
    if (key === null) return undefined;
    return key.startsWith("me:reports:") ? state.reports : state.meToos;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/useResidentToken", () => ({ useResidentToken: () => "resident-token" }));

const NOW = 10 * 86_400_000;
const es = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("es", key, vars);

function report(fields: Partial<OwnerReport> = {}): OwnerReport {
  return {
    _id: "report-1" as OwnerReport["_id"],
    _creationTime: 1,
    mediaType: "video",
    lat: 33.8,
    lng: -84.5,
    title: "Bache en Main",
    status: "open",
    audioMuted: false,
    isSample: false,
    meTooCount: 2,
    lastActivityAt: 1,
    revealViews: 0,
    createdAt: NOW - 2 * 86_400_000,
    clipUrl: null,
    frameUrls: [],
    fixUrl: null,
    ...fields,
  };
}

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

test("the Me page reads in Spanish and the selector switches back to English", () => {
  render(
    <I18nProvider>
      <MePageContent />
    </I18nProvider>,
  );

  expect(screen.getByRole("heading", { name: "Tu perfil" })).toBeTruthy();
  expect(screen.getByText("Privado en este dispositivo")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Tu impacto" })).getByText("Reportes")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Publicar un problema" })).toBeTruthy();
  expect(screen.getByText("Cuando te sumes a un reporte abierto, aparecerá aquí.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("heading", { name: "Your profile" })).toBeTruthy();
});

test("a report card reads in Spanish", () => {
  render(
    <I18nProvider>
      <MeReportCard report={report()} now={NOW} />
    </I18nProvider>,
  );

  expect(screen.getByText("Abierto · 2 días")).toBeTruthy();
  expect(screen.getByText("Publicado · 2 «yo también»")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Ver reporte" })).toBeTruthy();
});

test("a fixed card and the status text read in Spanish", () => {
  const fixed = report({ status: "fixed", fixedAt: NOW - 86_400_000 });
  render(
    <I18nProvider>
      <MeReportCard report={fixed} now={NOW} />
    </I18nProvider>,
  );

  expect(screen.getByText("Este reporte ya se arregló.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ver el arreglo" })).toBeTruthy();
  expect(screen.getByText("Resuelto hace 1 día")).toBeTruthy();
  expect(reportStatusText(fixed, NOW, es)).toBe("Arreglado en 1 día");
  expect(reportStatusText(report({ status: "pending" }), NOW, es)).toBe("Revisando…");
});

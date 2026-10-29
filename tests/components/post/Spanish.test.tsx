// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import NearbyCheck, { type NearbyReport } from "../../../components/post/NearbyCheck";
import { Retake, ScreeningFailed } from "../../../components/post/CheckingScreen";
import { I18nProvider } from "../../../lib/i18n/I18nProvider";
import { resetLocaleStore, setLocale } from "../../../lib/i18n/locale";
import type { OwnerReport } from "../../../server/lib/publicReport";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

test("the nearby check reads in Spanish and keeps the resident's own title", () => {
  const nearby = {
    report: { _id: "r1", title: "Bache en Main", street: "Main St", frameUrls: [], createdAt: 1 },
    distanceMeters: 12,
    isMine: false,
  } as unknown as NearbyReport;
  render(
    <I18nProvider>
      <NearbyCheck reports={[nearby]} now={2 * 86_400_000 + 1} onContinue={vi.fn()} />
    </I18nProvider>,
  );
  expect(screen.getByRole("heading", { name: "¿Es uno de estos?" })).toBeTruthy();
  expect(screen.getByText("Abierto hace 2 días · a 12 m")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Yo también" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "No, es nuevo" })).toBeTruthy();
  expect(screen.getByText("Bache en Main")).toBeTruthy();
});

test("the held-post screens read in Spanish", () => {
  const report = { _id: "r1", mediaType: "video", reason: null, screeningRetries: 0 } as unknown as OwnerReport;
  render(
    <I18nProvider>
      <ScreeningFailed token="t" report={report} />
      <Retake token="t" report={report} />
    </I18nProvider>,
  );
  expect(screen.getByRole("heading", { name: "No pudimos revisar esta publicación" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Por favor, graba de nuevo" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Repetir" })).toBeTruthy();
});

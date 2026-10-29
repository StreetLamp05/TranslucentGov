// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CardActions from "../../../components/feed/CardActions";
import CardOverlay, { fixedLine, statusText } from "../../../components/feed/CardOverlay";
import Feed from "../../../components/feed/Feed";
import { stampText } from "../../../components/RevealPlayer";
import { I18nProvider } from "../../../lib/i18n/I18nProvider";
import { resetLocaleStore, setLocale } from "../../../lib/i18n/locale";
import { translate } from "../../../lib/i18n/dictionary";
import type { PublicReport } from "../../../server/lib/publicReport";

const DAY_MS = 86_400_000;
const feed: { reports: PublicReport[] | undefined } = { reports: undefined };
vi.mock("../../../lib/data/useLive", () => ({
  useLive: (key: string | null) => (key === "feed" ? feed.reports : undefined),
}));

function report(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    _id: "r1",
    _creationTime: 0,
    mediaType: "video",
    lat: 33.8187,
    lng: -84.5824,
    owner: "cobb",
    agency: "Cobb DOT",
    title: "Deep pothole",
    status: "open",
    audioMuted: false,
    isSample: true,
    meTooCount: 0,
    lastActivityAt: 0,
    revealViews: 0,
    createdAt: Date.now() - 3 * DAY_MS,
    clipUrl: null,
    frameUrls: [],
    fixUrl: null,
    ...overrides,
  } as PublicReport;
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
  feed.reports = undefined;
});

describe("feed in Spanish", () => {
  test("the card overlay and actions are in Spanish", () => {
    const slot = { active: true, near: true, video: null };
    render(
      <I18nProvider>
        <CardOverlay report={report({ audioMuted: true })} {...slot} />
        <CardActions report={report()} {...slot} />
      </I18nProvider>,
    );
    expect(screen.getByTestId("status").textContent).toBe("Abierto · 3 días");
    expect(screen.getByText("Muestra · grabado en California")).toBeTruthy();
    expect(screen.getByLabelText("Mostrar en el mapa")).toBeTruthy();
    expect(screen.getByText("En el mapa")).toBeTruthy();
    expect(screen.getByText("Audio silenciado por la revisión · sin subtítulos")).toBeTruthy();
    expect(screen.getAllByText("¿Ya se arregló?").length).toBeGreaterThan(0);
  });

  test("the pure helpers take a translator and default to English", () => {
    const es = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("es", key, vars);
    const fixed = report({ status: "fixed", fixedAt: Date.now() - DAY_MS, fixedByKind: "fixer", fixedByLabel: "Mableton Sanitation" });
    expect(statusText(fixed, Date.now(), es)).toBe("Arreglado en 2 días");
    expect(statusText(fixed, Date.now())).toBe("Fixed in 2 days");
    expect(fixedLine(fixed, es)).toBe("Arreglado por Mableton Sanitation");
    expect(stampText(fixed, es)).toBe("ARREGLADO · 2 días · Arreglado por Mableton Sanitation");
  });

  test("the feed's loading and empty states are in Spanish and carry the language switch", () => {
    const view = render(
      <I18nProvider>
        <Feed />
      </I18nProvider>,
    );
    expect(screen.getByText("Cargando…")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Idioma" })).toBeTruthy();
    view.unmount();

    feed.reports = [];
    render(
      <I18nProvider>
        <Feed />
      </I18nProvider>,
    );
    expect(screen.getByText("Todavía no hay publicaciones. Publica el primer problema.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText("Nothing on the feed yet. Post the first problem.")).toBeTruthy();
  });
});

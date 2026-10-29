// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import MePageContent from "@/components/me/MePage";
import type { OwnerReport, PublicReport } from "@/server/lib/publicReport";

const state = vi.hoisted(() => ({
  reports: undefined as unknown,
  meToos: undefined as unknown,
}));

// Two polled reads (US37), keyed by the device token; no token is no key.
vi.mock("@/lib/data/useLive", () => ({
  useLive: (key: string | null) => {
    if (key === null) return undefined;
    return key.startsWith("me:reports:") ? state.reports : state.meToos;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/useResidentToken", () => ({ useResidentToken: () => "resident-token" }));
vi.mock("@/components/me/MeReportCard", () => ({
  default: ({ report }: { report: OwnerReport | PublicReport }) => <div>{report.title}</div>,
}));

function ownerReport(fields: Partial<OwnerReport>): OwnerReport {
  return {
    _id: "mine",
    _creationTime: 1,
    mediaType: "video",
    lat: 37.7694,
    lng: -122.4862,
    status: "open",
    audioMuted: false,
    isSample: false,
    meTooCount: 0,
    lastActivityAt: 10,
    revealViews: 0,
    createdAt: 10,
    clipUrl: null,
    frameUrls: [],
    fixUrl: null,
    verdict: "pass",
    ...fields,
  };
}

function publicReport(fields: Partial<PublicReport>): PublicReport {
  return {
    _id: "supported",
    _creationTime: 2,
    mediaType: "video",
    lat: 37.7694,
    lng: -122.4862,
    status: "fixed",
    audioMuted: false,
    isSample: false,
    meTooCount: 2,
    lastActivityAt: 20,
    revealViews: 0,
    createdAt: 20,
    clipUrl: null,
    frameUrls: [],
    fixUrl: null,
    ...fields,
  };
}

beforeEach(() => {
  state.reports = undefined;
  state.meToos = undefined;
});
afterEach(cleanup);

describe("MePage", () => {
  test("shows an anonymous private profile, live activity totals, and both activity lists", () => {
    state.reports = [ownerReport({ title: "Broken streetlight" })];
    state.meToos = [{ createdAt: 20, report: publicReport({ title: "Pothole by the park" }) }];

    render(<MePageContent />);

    expect(screen.getByRole("heading", { name: "Your profile" })).toBeTruthy();
    expect(screen.getByText("Private to this device")).toBeTruthy();
    expect(screen.getByText("Helping make the neighborhood better.")).toBeTruthy();
    expect(screen.queryByText("Alex Kim")).toBeNull();
    expect(screen.getByText("Broken streetlight")).toBeTruthy();
    expect(screen.getByText("Pothole by the park")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Your impact" })).getAllByText("1")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "Problems you supported" })).toBeTruthy();
  });

  test("shows loading until both private lists have arrived", () => {
    state.reports = [];

    render(<MePageContent />);

    expect(screen.getByRole("status").textContent).toMatch(/Loading your activity/);
    expect(screen.queryByRole("region", { name: "Your requests" })).toBeNull();
  });

  test("offers a post action when the resident has no reports", () => {
    state.reports = [];
    state.meToos = [];

    render(<MePageContent />);

    expect(screen.getByText(/Your first report starts here/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post a problem" })).toBeTruthy();
    expect(screen.getByText("When you join an open report, it will show up here.")).toBeTruthy();
  });
});

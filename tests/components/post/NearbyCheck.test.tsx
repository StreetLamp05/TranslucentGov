// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "../../../lib/data/api";
import type { NearbyReport } from "../../../components/post/NearbyCheck";
import type { PublicReport } from "../../../server/lib/publicReport";

const state = vi.hoisted(() => ({
  meToo: vi.fn(),
  push: vi.fn(),
}));

vi.mock("../../../lib/data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/data/api")>()),
  mutate: (path: string, body: unknown) => state.meToo(path, body),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));

const { default: NearbyCheck } = await import("../../../components/post/NearbyCheck");

function nearby(overrides: Partial<NearbyReport> = {}): NearbyReport {
  const report: PublicReport = {
    _id: "report-1",
    _creationTime: 1,
    mediaType: "video",
    lat: 33.8187,
    lng: -84.5824,
    title: "Pothole on Main",
    street: "Main St",
    status: "open",
    audioMuted: false,
    isSample: false,
    meTooCount: 2,
    lastActivityAt: 1,
    revealViews: 0,
    createdAt: 1,
    clipUrl: null,
    frameUrls: ["https://files.test/frame.jpg"],
    fixUrl: null,
  };
  return { report, distanceMeters: 12, isMine: false, ...overrides };
}

beforeEach(() => {
  state.meToo.mockReset().mockResolvedValue({ added: true });
  state.push.mockReset();
});
afterEach(cleanup);

test("a Me too posts to /api/me-too and opens the matched report", async () => {
  render(<NearbyCheck reports={[nearby()]} now={2 * 86_400_000 + 1} onContinue={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "Is it one of these?" })).toBeTruthy();
  expect(screen.getByText("2 days open · 12 m away")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Me too" })));
  expect(state.meToo).toHaveBeenCalledWith("/api/me-too", { reportId: "report-1" });
  expect(state.push).toHaveBeenCalledWith("/?report=report-1");
});

test("does not offer Me too on the resident's own report", () => {
  render(<NearbyCheck reports={[nearby({ isMine: true })]} now={1} onContinue={vi.fn()} />);
  expect(screen.getByText("Your report")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Me too" })).toBeNull();
});

test("shows the server's message when the Me too is refused", async () => {
  state.meToo.mockRejectedValue(new ApiError(400, "You can only me-too an open report"));
  render(<NearbyCheck reports={[nearby()]} now={1} onContinue={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Me too" })));
  expect(screen.getByRole("alert").textContent).toBe("You can only me-too an open report");
  expect(state.push).not.toHaveBeenCalled();
});

test("shows mutation errors and preserves the nearby choices", async () => {
  state.meToo.mockRejectedValue(new Error("network error"));
  render(<NearbyCheck reports={[nearby()]} now={1} onContinue={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Me too" })));
  expect(screen.getByRole("alert").textContent).toBe("Couldn't add your me-too. Try again.");
  expect(screen.getByText("Pothole on Main")).toBeTruthy();
});

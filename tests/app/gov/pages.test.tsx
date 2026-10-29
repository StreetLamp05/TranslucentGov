// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TriageGroup, TriageQueue } from "../../../server/lib/triageGroups";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "cobb-dot" }) }));
const query = vi.fn();
vi.mock("../../../lib/data/api", () => ({ query, subscribeToMutations: () => () => {} }));

const { default: GovPage } = await import("../../../app/gov/page");
const { default: GovGroupPage } = await import("../../../app/gov/[slug]/page");

beforeEach(() => {
  vi.useFakeTimers();
  query.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const group = (open: number): TriageGroup => ({ agency: "Cobb DOT", owner: "cobb", slug: "cobb-dot", open, fixed: 0 });
const queueWith = (titles: string[]): TriageQueue => ({
  agency: "Cobb DOT",
  owner: "cobb",
  open: titles.map((title, i) => ({
    _id: `r${i}`,
    title,
    status: "open",
    meTooCount: 0,
    createdAt: 1,
    isSample: false,
    thumbnailUrl: null,
  })),
  fixed: [],
});

test("/gov polls the overview and shows a newly approved report's count without a refresh", async () => {
  query.mockResolvedValueOnce([group(1)]).mockResolvedValue([group(2)]);
  render(<GovPage />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(query.mock.calls[0][0]).toBe("/api/triage/overview");
  expect(screen.getByTestId("open-count").textContent).toBe("1open");
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByTestId("open-count").textContent).toBe("2open");
});

test("/gov/<slug> polls the queue and shows a newly approved report without a refresh", async () => {
  query.mockResolvedValueOnce(queueWith(["First"])).mockResolvedValue(queueWith(["First", "Second"]));
  render(<GovGroupPage />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(query.mock.calls[0][0]).toBe("/api/triage/cobb-dot");
  expect(screen.queryByText("Second")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByText("Second")).toBeTruthy();
});

test("/gov/<slug> says so for an unknown group", async () => {
  query.mockResolvedValue(null);
  render(<GovGroupPage />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText(/No such group/)).toBeTruthy();
});

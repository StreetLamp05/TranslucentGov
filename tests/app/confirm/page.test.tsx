// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PublicReport } from "../../../server/lib/publicReport";

const state = vi.hoisted(() => ({
  report: undefined as unknown,
  queries: [] as { path: string; args: unknown }[],
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ reportId: "11111111-1111-4111-8111-111111111111" }) }));
vi.mock("../../../lib/hooks/useResidentToken", () => ({ useResidentToken: () => "token-a" }));
vi.mock("../../../lib/data/api", () => ({
  query: async (path: string, args: unknown) => {
    state.queries.push({ path, args });
  },
}));
vi.mock("../../../lib/data/useLive", () => ({
  useLive: (key: string | null, fetcher: (signal: AbortSignal) => Promise<unknown>) => {
    if (key === null) return undefined;
    void fetcher(new AbortController().signal);
    return state.report;
  },
}));
vi.mock("../../../components/fix/FixCapture", () => ({
  default: ({ report, auth }: { report: { _id: string }; auth: unknown }) => (
    <p data-testid="fix-capture">{`${report._id} ${JSON.stringify(auth)}`}</p>
  ),
}));

const { default: ConfirmFixPage } = await import("../../../app/confirm/[reportId]/page");

const ID = "11111111-1111-4111-8111-111111111111";
const report = (fields: Partial<PublicReport>) =>
  ({ _id: ID, lat: 1, lng: 1, status: "open", owner: "cobb", agency: "Cobb DOT", title: "Pothole", frameUrls: [], ...fields }) as PublicReport;

beforeEach(() => {
  state.report = undefined;
  state.queries = [];
});
afterEach(cleanup);

test("loads the report from /api/feed/<id> and hands the Postgres id to FixCapture", () => {
  state.report = report({});
  render(<ConfirmFixPage />);
  expect(state.queries[0]).toEqual({ path: `/api/feed/${ID}`, args: undefined });
  expect(screen.getByRole("heading", { name: "Is it fixed?" })).toBeTruthy();
  expect(screen.getByTestId("fix-capture").textContent).toBe(`${ID} {"residentToken":"token-a"}`);
});

test("shows Loading… while it loads and says so when the report doesn't exist", () => {
  const view = render(<ConfirmFixPage />);
  expect(screen.getByText("Loading…")).toBeTruthy();
  state.report = null;
  view.rerender(<ConfirmFixPage />);
  expect(screen.getByText("This report doesn't exist.")).toBeTruthy();
});

test("a fixed report says it is already fixed instead of opening the camera", () => {
  state.report = report({ status: "fixed" });
  render(<ConfirmFixPage />);
  expect(screen.getByText("This report is already fixed.")).toBeTruthy();
  expect(screen.queryByTestId("fix-capture")).toBeNull();
});

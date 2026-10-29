// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CheckingScreen from "../../../components/post/CheckingScreen";
import { RESIDENT_TOKEN_HEADER } from "../../../lib/data/headers";

// Checking… (§4.2.1) on the real useLive and the real api client, with only fetch faked: the
// verdict has to appear by itself, without a refresh.

vi.mock("../../../lib/hooks/useResidentToken", () => ({
  useResidentToken: () => "token-a",
  getResidentToken: () => "token-a",
}));
vi.mock("../../../lib/hooks/useFixerToken", () => ({ getFixerToken: () => null }));

const REPORT = {
  _id: "11111111-1111-4111-8111-111111111111",
  _creationTime: 1,
  mediaType: "video",
  lat: 1,
  lng: 1,
  audioMuted: false,
  isSample: false,
  meTooCount: 0,
  lastActivityAt: 1,
  revealViews: 0,
  createdAt: 1,
  clipUrl: null,
  frameUrls: [],
  fixUrl: null,
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const respond = (body: unknown) => fetchMock.mockImplementation(async () => Response.json(body));
const heading = () => screen.getAllByRole("heading")[0].textContent;

test("polls /api/posts/mine every 2s with the device token, and shows the verdict when it lands", async () => {
  respond({ ...REPORT, status: "pending" });
  render(<CheckingScreen reportId={REPORT._id} onPostAnother={vi.fn()} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

  expect(heading()).toBe("Checking…");
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`/api/posts/mine?reportId=${REPORT._id}`);
  expect(init.headers[RESIDENT_TOKEN_HEADER]).toBe("token-a");

  // Screening finishes on the server; no refresh, no user action.
  respond({ ...REPORT, status: "open", verdict: "pass", title: "Pothole on Floyd Rd", agency: "Cobb DOT" });
  const calls = fetchMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_900);
  });
  expect(fetchMock.mock.calls.length).toBe(calls);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(fetchMock.mock.calls.length).toBe(calls + 1);
  expect(heading()).toBe("Posted");
  expect(screen.getByText("Pothole on Floyd Rd · Cobb DOT")).toBeTruthy();
});

test("a failed poll keeps Checking… and the next one lands the verdict", async () => {
  respond({ ...REPORT, status: "pending" });
  render(<CheckingScreen reportId={REPORT._id} onPostAnother={vi.fn()} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

  fetchMock.mockRejectedValueOnce(new TypeError("offline"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(heading()).toBe("Checking…");

  respond({ ...REPORT, status: "held", verdict: "reject", reason: "Not a public-space problem." });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(heading()).toBe("We can't post this");
});

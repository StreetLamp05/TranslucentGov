// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RecordedClip } from "../../../components/capture/VideoRecorder";
import FixCapture from "../../../components/fix/FixCapture";
import { ApiError } from "../../../lib/data/api";
import type { LocationState } from "../../../lib/hooks/useCurrentLocation";

const REPORT = { _id: "report-1", lat: 33.8158, lng: -84.5825, status: "open" as const };
const FIXED = { ...REPORT, status: "fixed" as const };
// ~111 m per 0.001° of latitude.
const metersNorth = (m: number) => ({ lat: REPORT.lat + m / 111_000, lng: REPORT.lng });

const state = vi.hoisted(() => ({
  location: { status: "loading" } as LocationState,
  refresh: vi.fn(),
  mutate: vi.fn(),
  attempt: undefined as unknown,
  liveKeys: [] as (string | null)[],
  intervals: [] as (number | undefined)[],
  fetches: [] as unknown[][],
  uploads: [] as { blob: Blob; as: string; kind: string }[],
  clip: null as RecordedClip | null,
}));

// The attempt poll: useLive hands back the faked verdict, and its fetcher is run once to see
// which route and arguments it reads.
vi.mock("../../../lib/data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/data/api")>()),
  mutate: (...args: unknown[]) => state.mutate(...args),
  query: (...args: unknown[]) => {
    state.fetches.push(args);
    return Promise.resolve(null);
  },
}));
vi.mock("../../../lib/data/useLive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/data/useLive")>()),
  useLive: (key: string | null, fetcher: (signal: AbortSignal) => unknown, options?: { intervalMs?: number }) => {
    state.liveKeys.push(key);
    state.intervals.push(options?.intervalMs);
    void fetcher(new AbortController().signal);
    return state.attempt;
  },
}));
vi.mock("../../../lib/hooks/useCurrentLocation", () => ({
  useCurrentLocation: () => ({ ...state.location, refresh: state.refresh }),
}));
vi.mock("../../../components/fix/uploadProof", () => ({
  uploadProof: vi.fn(async (blob: Blob, as: string, kind: string) => {
    state.uploads.push({ blob, as, kind });
    return `storage-${state.uploads.length}`;
  }),
}));
// The recorder (US7) is tested on its own; here it hands back a clip on a tap.
const recorderProps: { audio: boolean; autoOpen?: boolean }[] = [];
vi.mock("../../../components/capture/VideoRecorder", () => ({
  default: (props: { audio: boolean; autoOpen?: boolean; onDone: (clip: RecordedClip) => void }) => {
    recorderProps.push(props);
    return <button onClick={() => props.onDone(state.clip ?? CLIP)}>fake record</button>;
  },
}));

const CLIP: RecordedClip = {
  blob: new Blob(["clip"], { type: "video/mp4" }),
  mimeType: "video/mp4",
  frames: [new Blob(["f0"], { type: "image/jpeg" }), new Blob(["f1"], { type: "image/jpeg" })],
};

const at = (m: number): LocationState => ({ status: "ready", point: metersNorth(m), accuracy: 8, simulated: false });
const recordButton = () => screen.getByRole("button", { name: "Record fix" }) as HTMLButtonElement;

beforeEach(() => {
  state.location = at(10);
  state.refresh.mockReset();
  state.mutate.mockReset().mockResolvedValue("attempt-1");
  state.attempt = undefined;
  state.liveKeys = [];
  state.intervals = [];
  state.fetches = [];
  state.uploads = [];
  state.clip = null;
  recorderProps.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function recordAndSend() {
  fireEvent.click(recordButton());
  await act(async () => fireEvent.click(screen.getByText("fake record")));
}

describe("FixCapture geofence", () => {
  test("Record fix is disabled beyond 50 m and says how far away you are", () => {
    state.location = at(120);
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    expect(recordButton().disabled).toBe(true);
    expect(screen.getByText(/^Get within 50 m \(you're 12\d m away\)$/)).toBeTruthy();
    fireEvent.click(recordButton());
    expect(recorderProps).toHaveLength(0);
  });

  test("Record fix is enabled within 50 m and opens a silent recorder", () => {
    const onStart = vi.fn();
    state.location = at(40);
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} onStart={onStart} />);
    expect(recordButton().disabled).toBe(false);
    expect(screen.queryByText(/Get within/)).toBeNull();
    fireEvent.click(recordButton());
    expect(onStart).toHaveBeenCalledOnce();
    expect(recorderProps.at(-1)).toMatchObject({ audio: false, autoOpen: true });
  });

  test("enables once you walk into range", () => {
    state.location = at(80);
    const { rerender } = render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    expect(recordButton().disabled).toBe(true);
    state.location = at(30);
    rerender(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    expect(recordButton().disabled).toBe(false);
  });

  test("keeps asking for a new location every few seconds, in range or not, until the clip is sent", async () => {
    vi.useFakeTimers();
    state.location = at(80);
    const { rerender } = render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    state.location = at(30);
    rerender(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(state.refresh).toHaveBeenCalledTimes(2);
    fireEvent.click(recordButton());
    act(() => vi.advanceTimersByTime(5000));
    expect(state.refresh).toHaveBeenCalledTimes(3);
    await act(async () => fireEvent.click(screen.getByText("fake record")));
    act(() => vi.advanceTimersByTime(20_000));
    expect(state.refresh).toHaveBeenCalledTimes(3);
  });

  test("without a location there's no Record fix, and Try again asks again", () => {
    state.location = { status: "denied" };
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    expect(screen.queryByRole("button", { name: "Record fix" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refresh).toHaveBeenCalled();
  });
});

describe("FixCapture submit and result", () => {
  test("a fixer's clip and frames upload as a fixer, then /api/fixes gets the filming location", async () => {
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    expect(state.uploads.map((u) => u.blob)).toEqual([CLIP.blob, ...CLIP.frames]);
    expect(state.uploads.map((u) => u.kind)).toEqual(["video", "image", "image"]);
    expect(state.uploads.every((u) => u.as === "fixer")).toBe(true);
    expect(state.mutate).toHaveBeenCalledWith("/api/fixes", {
      as: "fixer",
      reportId: "report-1",
      clipStorageId: "storage-1",
      frameStorageIds: ["storage-2", "storage-3"],
      ...metersNorth(10),
    });
    // The tokens ride on the identity headers, never in the body.
    expect(JSON.stringify(state.mutate.mock.calls[0][1])).not.toContain("fx\"");
    expect(state.liveKeys.at(-1)).toBe("fix-attempt:attempt-1");
    expect(state.fetches.at(-1)).toEqual(["/api/fixes/attempt", { attemptId: "attempt-1", as: "fixer" }, expect.anything()]);
    expect(screen.getByText("Checking…")).toBeTruthy();
  });

  test("a neighbor uploads and submits as a resident", async () => {
    render(<FixCapture report={REPORT} auth={{ residentToken: "rt" }} />);
    await recordAndSend();
    expect(state.uploads.every((u) => u.as === "resident")).toBe(true);
    expect(state.mutate.mock.calls[0][1]).toMatchObject({ as: "resident" });
    expect(state.fetches.at(-1)?.[1]).toEqual({ attemptId: "attempt-1", as: "resident" });
  });

  test("polls the attempt every 2 s, so the verdict shows without a refresh", async () => {
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    expect(state.intervals.at(-1)).toBe(2000);
  });

  test("verified links to the report in the feed", async () => {
    state.attempt = { reportId: "report-1", status: "verified" };
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    expect(screen.getByText("Fix verified")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See it in the feed" }).getAttribute("href")).toBe("/?report=report-1");
  });

  test.each([
    ["not_fixed", "Not fixed yet"],
    ["retake", "Try another take"],
    ["failed", "We couldn't check this clip"],
  ])("%s shows Claude's reason and Try again goes back to Record fix", async (status, title) => {
    state.attempt = { reportId: "report-1", status, reason: "The pothole is still there." };
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText("The pothole is still there.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(recordButton().disabled).toBe(false);
  });

  test("superseded (no reason) says the report was already fixed", async () => {
    state.attempt = { reportId: "report-1", status: "superseded" };
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    expect(screen.getByText("This report was already marked fixed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a server refusal goes back to Record fix with its message", async () => {
    state.mutate.mockRejectedValue(new ApiError(400, "Get within 50 m (you're 51 m away)."));
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    expect(screen.getByRole("alert").textContent).toBe("Get within 50 m (you're 51 m away).");
    expect(recordButton()).toBeTruthy();
  });

  test("a clip finished after walking out of range is refused before uploading", async () => {
    const { rerender } = render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    fireEvent.click(recordButton());
    state.location = at(200);
    rerender(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await act(async () => fireEvent.click(screen.getByText("fake record")));
    expect(state.uploads).toHaveLength(0);
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/^Get within 50 m \(you're 20\d m away\)\.$/);
  });

  test("the submit gets the latest position, not the one from when the page opened", async () => {
    const { rerender } = render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    fireEvent.click(recordButton());
    state.location = at(25);
    rerender(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await act(async () => fireEvent.click(screen.getByText("fake record")));
    expect(state.mutate.mock.calls[0][1]).toMatchObject(metersNorth(25));
  });

  test("a report closed by someone else while you're on Record fix says so instead", () => {
    const { rerender } = render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    rerender(<FixCapture report={FIXED} auth={{ fixerToken: "fx" }} />);
    expect(screen.getByText("This report was already marked fixed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record fix" })).toBeNull();
    expect(screen.getByRole("link", { name: "See it in the feed" }).getAttribute("href")).toBe("/?report=report-1");
  });

  test("a report closed by someone else mid-recording closes the recorder", () => {
    const { rerender } = render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    fireEvent.click(recordButton());
    expect(screen.getByText("fake record")).toBeTruthy();
    rerender(<FixCapture report={FIXED} auth={{ fixerToken: "fx" }} />);
    expect(screen.queryByText("fake record")).toBeNull();
    expect(screen.getByText("This report was already marked fixed.")).toBeTruthy();
  });

  test("Try again after a not_fixed verdict on a report someone else just closed shows it's fixed", async () => {
    state.attempt = { reportId: "report-1", status: "not_fixed", reason: "Still there." };
    const { rerender } = render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    rerender(<FixCapture report={FIXED} auth={{ fixerToken: "fx" }} />);
    expect(screen.getByText("Still there.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("This report was already marked fixed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record fix" })).toBeNull();
  });

  test("your own verified fix keeps its verdict screen after the report turns fixed", async () => {
    state.attempt = { reportId: "report-1", status: "verified" };
    const { rerender } = render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    rerender(<FixCapture report={FIXED} auth={{ fixerToken: "fx" }} />);
    expect(screen.getByText("Fix verified")).toBeTruthy();
  });

  test("an oversized clip is refused before uploading", async () => {
    state.clip = { ...CLIP, blob: { size: 26_000_000, type: "video/mp4" } as Blob };
    render(<FixCapture report={REPORT} auth={{ fixerToken: "fx" }} />);
    await recordAndSend();
    expect(state.uploads).toHaveLength(0);
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/over 25 MB/);
  });
});

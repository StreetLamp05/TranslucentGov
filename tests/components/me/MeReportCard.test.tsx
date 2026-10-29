// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import type { CaptureMode } from "../../../components/capture/CameraCapture";
import type { RecordedClip } from "../../../lib/hooks/useClipRecorder";
import type { OwnerReport } from "../../../server/lib/publicReport";
import MeReportCard, { reportStatusText } from "../../../components/me/MeReportCard";
import { MAX_SCREENING_RETRIES, SCREENING_FAILED_REASON } from "../../../server/lib/screening";

const NOW = 10 * 86_400_000;

const state = vi.hoisted(() => ({
  mutations: {} as Record<string, Mock<(body: unknown) => unknown>>,
  uploads: [] as Blob[],
}));

// Retake and ScreeningFailed (components/post/CheckingScreen.tsx) call the route handlers (US35).
vi.mock("../../../lib/data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/data/api")>()),
  mutate: async (path: string, body: unknown) => (state.mutations[path] ??= vi.fn())(body),
}));
vi.mock("../../../lib/upload", () => ({
  uploadMedia: vi.fn(async (blob: Blob) => {
    state.uploads.push(blob);
    return `storage-${state.uploads.length}`;
  }),
}));

type CameraCaptureProps = {
  modes: CaptureMode[];
  onVideo: (clip: RecordedClip) => void;
  onPhotos: (photos: Blob[]) => void;
  onClose: () => void;
};
const RETAKE_CLIP: RecordedClip = {
  blob: new Blob(["retake"], { type: "video/mp4" }),
  mimeType: "video/mp4",
  frames: [new Blob(["frame"], { type: "image/jpeg" })],
};
vi.mock("../../../components/capture/CameraCapture", () => ({
  default: (props: CameraCaptureProps) => (
    <div role="dialog" aria-label="Camera">
      <button onClick={() => props.onVideo(RETAKE_CLIP)}>fake retake record</button>
      <button onClick={() => props.onPhotos([RETAKE_CLIP.blob])}>fake retake photos</button>
      <button onClick={props.onClose}>fake close camera</button>
    </div>
  ),
}));

function report(overrides: Partial<OwnerReport> = {}): OwnerReport {
  return {
    _id: "report-1" as OwnerReport["_id"],
    _creationTime: 1,
    mediaType: "video",
    lat: 33.8,
    lng: -84.5,
    title: "Pothole on Main",
    status: "open",
    audioMuted: false,
    isSample: false,
    meTooCount: 2,
    lastActivityAt: 1,
    revealViews: 0,
    createdAt: NOW - 2 * 86_400_000,
    fixedAt: undefined,
    fixedByKind: undefined,
    clipUrl: null,
    frameUrls: [],
    fixUrl: null,
    verdict: undefined,
    reason: undefined,
    ...overrides,
  };
}

afterEach(cleanup);
beforeEach(() => {
  state.mutations = {};
  state.uploads = [];
});

describe("reportStatusText", () => {
  test.each([
    [report({ status: "pending" }), "Checking…"],
    [report({ status: "held", verdict: "retake", reason: "Cover the plate" }), "Retake needed"],
    [report({ status: "held", verdict: "reject", reason: "Not a public-space problem" }), "Not posted"],
    [report({ status: "held", verdict: "emergency" }), "Emergency"],
    [report({ status: "held", reason: "screening failed" }), "Screening failed"],
    [report({ status: "open" }), "Open · 2 days"],
    [report({ status: "fixed", fixedAt: NOW - 86_400_000 }), "Fixed in 1 day"],
    // Same-day wording matches the feed chip and the reveal stamp ("FIXED · same day").
    [report({ status: "open", createdAt: NOW - 1000 }), "Open · today"],
    [report({ status: "fixed", createdAt: NOW - 1000, fixedAt: NOW }), "Fixed same day"],
    [report({ status: "fixed", fixedAt: undefined }), "Fixed"],
  ])("labels %s as %s", (fixture, expected) => {
    expect(reportStatusText(fixture, NOW)).toBe(expected);
  });
});

test("renders held status reasons and an emergency call link", () => {
  const { rerender } = render(
    <MeReportCard report={report({ status: "held", verdict: "retake", reason: "Cover the plate" })} now={NOW} />,
  );
  expect(screen.getByText("Cover the plate")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retake" }).hasAttribute("disabled")).toBe(true);

  rerender(<MeReportCard report={report({ status: "held", reason: "screening failed" })} now={NOW} />);
  expect(screen.getByRole("button", { name: "Try again" }).hasAttribute("disabled")).toBe(true);

  rerender(<MeReportCard report={report({ status: "held", verdict: "emergency" })} now={NOW} />);
  expect(screen.getByRole("link", { name: "Call 911" }).getAttribute("href")).toBe("tel:911");
});

test("every held card shows the raw verdict and reason (§4.2.1)", () => {
  const { rerender } = render(
    <MeReportCard report={report({ status: "held", verdict: "reject", reason: "Not a public-space problem" })} now={NOW} />,
  );
  expect(screen.getByTestId("hold-debug").textContent).toBe("held: reject · Not a public-space problem");

  rerender(<MeReportCard report={report({ status: "held", verdict: "emergency", reason: "Fire" })} now={NOW} />);
  expect(screen.getByTestId("hold-debug").textContent).toBe("held: emergency · Fire");

  rerender(<MeReportCard report={report({ status: "open" })} now={NOW} />);
  expect(screen.queryByTestId("hold-debug")).toBeNull();
});

test("a sample report carries the Sample badge (§6.1.1)", () => {
  const { rerender } = render(<MeReportCard report={report({ status: "fixed", fixedAt: NOW, isSample: true })} now={NOW} />);
  expect(screen.getByText("Sample · filmed in California")).toBeTruthy();

  rerender(<MeReportCard report={report({ status: "fixed", fixedAt: NOW })} now={NOW} />);
  expect(screen.queryByText("Sample · filmed in California")).toBeNull();
});

test("the Me page retake flow records replacement media and calls retakeReport", async () => {
  const retakeReport = vi.fn().mockResolvedValue(undefined);
  state.mutations["/api/retake"] = retakeReport;
  const view = render(
    <MeReportCard
      report={report({ status: "held", verdict: "retake", reason: "Cover the plate" })}
      now={NOW}
      token="resident-a"
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Retake" }));
  expect(screen.getByRole("dialog", { name: "Camera" })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "fake retake record" })));

  expect(state.uploads).toEqual([RETAKE_CLIP.blob, RETAKE_CLIP.frames[0]]);
  expect(retakeReport).toHaveBeenCalledWith({
    reportId: "report-1",
    mediaType: "video",
    clipStorageId: "storage-1",
    frameStorageIds: ["storage-2"],
  });

  view.rerender(<MeReportCard report={report({ status: "pending" })} now={NOW} token="resident-a" />);
  expect(screen.getByText("Checking…")).toBeTruthy();
});

test("the Me page retries a failed screening and returns to Checking…", async () => {
  const retryScreening = vi.fn().mockResolvedValue(undefined);
  state.mutations["/api/retake/retry"] = retryScreening;
  const view = render(
    <MeReportCard
      report={report({ status: "held", reason: SCREENING_FAILED_REASON, screeningRetries: 0 })}
      now={NOW}
      token="resident-a"
    />,
  );

  const button = screen.getByRole("button", { name: "Try again" });
  expect(button.hasAttribute("disabled")).toBe(false);
  await act(async () => fireEvent.click(button));
  expect(retryScreening).toHaveBeenCalledWith({ reportId: "report-1" });

  view.rerender(<MeReportCard report={report({ status: "pending" })} now={NOW} token="resident-a" />);
  expect(screen.getByText("Checking…")).toBeTruthy();
});

test("the Me page lets the resident start another post after screening retries are exhausted", () => {
  const onPostAnother = vi.fn();
  render(
    <MeReportCard
      report={report({
        status: "held",
        reason: SCREENING_FAILED_REASON,
        screeningRetries: MAX_SCREENING_RETRIES,
      })}
      now={NOW}
      token="resident-a"
      onPostAnother={onPostAnother}
    />,
  );

  expect(screen.getByRole("heading", { name: "We still couldn't check this post" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Post another" }));
  expect(onPostAnother).toHaveBeenCalledOnce();
});

test("highlights fixed reports and shows open counts without revealing muted speech", () => {
  const { rerender } = render(<MeReportCard report={report({ status: "fixed" })} now={NOW} />);
  expect(screen.getByText("This report has been fixed.")).toBeTruthy();
  expect(document.querySelector('[data-status="fixed"]')?.className).toContain("ring-2");

  rerender(<MeReportCard report={report({ audioMuted: true })} now={NOW} />);
  expect(screen.getByText("Audio muted for privacy · 2 me-toos")).toBeTruthy();
});

describe("each status from a fixture report", () => {
  test("pending shows Checking… and no actions or link", () => {
    render(<MeReportCard report={report({ status: "pending" })} now={NOW} />);
    expect(screen.getByText("Checking…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("reject shows Claude's reason with no retake, retry or link", () => {
    render(<MeReportCard report={report({ status: "held", verdict: "reject", reason: "Not a public-space problem" })} now={NOW} />);
    expect(screen.getByText("Not posted")).toBeTruthy();
    expect(screen.getByText("Not a public-space problem")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("open shows days, me-toos and a link to the feed", () => {
    render(<MeReportCard report={report({ status: "open" })} now={NOW} />);
    expect(screen.getByText("Open · 2 days")).toBeTruthy();
    expect(screen.getByText("Posted · 2 me-toos")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View report" }).getAttribute("href")).toBe("/?report=report-1");
  });

  test("a fixed me-too is highlighted and can play the reveal too", () => {
    render(<MeReportCard report={report({ status: "fixed", fixedAt: NOW })} now={NOW} isMeToo />);
    expect(document.querySelector('[data-status="fixed"]')?.className).toContain("ring-2");
    expect(screen.getByRole("button", { name: "Play the fix" })).toBeTruthy();
  });

  test("a me-too'd report says so", () => {
    render(<MeReportCard report={report({ status: "open", meTooCount: 1 })} now={NOW} isMeToo />);
    expect(screen.getByText("You me-too'd this · 1 me-too")).toBeTruthy();
  });

  test("fixed is highlighted and a tap plays the reveal with a muted fix clip", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    render(
      <MeReportCard
        report={report({
          status: "fixed",
          fixedAt: NOW - 86_400_000,
          fixedByKind: "fixer",
          fixedByLabel: "Mableton Sanitation",
          clipUrl: "https://files.test/r1.mp4",
          fixUrl: "https://files.test/r1-fix.mp4",
        })}
        now={NOW}
      />,
    );
    expect(document.querySelector('[data-status="fixed"]')?.className).toContain("ring-2");
    expect(screen.queryByTestId("me-reveal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play the fix" }));
    expect(screen.getByTestId("me-reveal")).toBeTruthy();
    const fix = screen.getByTestId("fix-clip") as HTMLVideoElement;
    expect(fix.muted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Hide the fix" }));
    expect(screen.queryByTestId("me-reveal")).toBeNull();
    vi.restoreAllMocks();
  });
});

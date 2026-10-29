// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CaptureMode } from "../../../components/capture/CameraCapture";
import type { RecordedClip } from "../../../lib/hooks/useClipRecorder";
import CheckingScreen, { Retake, ScreeningFailed } from "../../../components/post/CheckingScreen";
import type { Id } from "../../../convex/_generated/dataModel";
import type { OwnerReport } from "../../../convex/lib/publicReport";
import { MAX_SCREENING_RETRIES, SCREENING_FAILED_REASON } from "../../../server/lib/screening";

const state = vi.hoisted(() => ({
  report: undefined as unknown,
  queryArgs: [] as unknown[],
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  uploads: [] as Blob[],
}));

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    state.queryArgs.push(args);
    return args === "skip" ? undefined : state.report;
  },
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    return (state.mutations[name] ??= vi.fn());
  },
}));
vi.mock("../../../lib/hooks/useResidentToken", () => ({ useResidentToken: () => "token-a" }));
vi.mock("../../../lib/upload", () => ({
  uploadFile: vi.fn(async (blob: Blob) => {
    state.uploads.push(blob);
    return `storage-${state.uploads.length}`;
  }),
}));
// The camera is tested on its own (tests/components/capture/CameraCapture.test.tsx); here it
// hands back a clip or photos on a tap.
type CameraProps = {
  modes: CaptureMode[];
  hints?: Partial<Record<CaptureMode, string>>;
  onVideo: (clip: RecordedClip) => void;
  onPhotos: (photos: Blob[]) => void;
  onClose: () => void;
};
const cameraProps: CameraProps[] = [];
vi.mock("../../../components/capture/CameraCapture", () => ({
  default: (props: CameraProps) => {
    cameraProps.push(props);
    return (
      <>
        <button onClick={() => props.onVideo(CLIP)}>fake record</button>
        <button onClick={() => props.onPhotos(PHOTOS)}>fake pick</button>
        <button onClick={props.onClose}>fake close</button>
      </>
    );
  },
}));

const CLIP: RecordedClip = {
  blob: new Blob(["clip"], { type: "video/mp4" }),
  mimeType: "video/mp4",
  frames: Array.from({ length: 6 }, (_, i) => new Blob([`frame ${i}`], { type: "image/jpeg" })),
};
const PHOTOS = Array.from({ length: 2 }, (_, i) => new Blob([`photo ${i}`], { type: "image/jpeg" }));

const REPORT_ID = "report-1" as Id<"reports">;

// What myReport returns for the poster (OwnerReport), trimmed to what the screen reads.
function fixture(fields: Partial<OwnerReport>): OwnerReport {
  return {
    _id: REPORT_ID,
    _creationTime: 1,
    mediaType: "video",
    lat: 33.8158,
    lng: -84.5825,
    status: "held",
    audioMuted: false,
    isSample: false,
    meTooCount: 0,
    lastActivityAt: 1,
    revealViews: 0,
    createdAt: 1,
    clipUrl: "https://example/clip",
    frameUrls: [],
    fixUrl: null,
    ...fields,
  };
}

const retakeReport = () => (state.mutations["retake:retakeReport"] ??= vi.fn());
const retryScreening = () => (state.mutations["retake:retryScreening"] ??= vi.fn());

const onPostAnother = vi.fn();
function show(report: unknown) {
  state.report = report;
  return render(<CheckingScreen reportId={REPORT_ID} onPostAnother={onPostAnother} />);
}
const heading = () => screen.getAllByRole("heading")[0].textContent;
const button = (name: string) => screen.queryByRole("button", { name });
const debugLine = () => screen.queryByTestId("hold-debug")?.textContent;

beforeEach(() => {
  state.report = undefined;
  state.queryArgs = [];
  state.mutations = {};
  state.uploads = [];
  cameraProps.length = 0;
  onPostAnother.mockReset();
});
afterEach(cleanup);

describe("CheckingScreen", () => {
  test("subscribes to the poster's report and shows Checking… while it loads or is pending", () => {
    const view = show(undefined);
    expect(heading()).toBe("Checking…");
    expect(state.queryArgs.at(-1)).toEqual({ token: "token-a", reportId: REPORT_ID });
    state.report = fixture({ status: "pending" });
    view.rerender(<CheckingScreen reportId={REPORT_ID} onPostAnother={onPostAnother} />);
    expect(heading()).toBe("Checking…");
  });

  test("a report that isn't the poster's (null) says it can't be found", () => {
    show(null);
    expect(heading()).toBe("We couldn't find this post");
  });

  describe("open", () => {
    test("says Posted, with title · agency, a feed link and Post another", () => {
      show(fixture({ status: "open", verdict: "pass", title: "Pothole on Floyd Rd", agency: "Cobb DOT" }));
      expect(heading()).toBe("Posted");
      expect(screen.getByText("Pothole on Floyd Rd · Cobb DOT")).toBeTruthy();
      expect(screen.getByRole("link", { name: "See it in the feed" }).getAttribute("href")).toBe("/?report=report-1");
      expect(screen.queryByRole("note")).toBeNull();
      expect(debugLine()).toBeUndefined();
      fireEvent.click(button("Post another")!);
      expect(onPostAnother).toHaveBeenCalled();
    });

    test("a muted video gets a note that it plays without sound and the description is hidden", () => {
      show(fixture({ status: "open", verdict: "mute", audioMuted: true, reason: "The audio names a neighbor." }));
      expect(heading()).toBe("Posted");
      const note = screen.getByRole("note").textContent;
      expect(note).toMatch(/without sound or captions, and any description is hidden/);
      expect(note).toMatch(/The audio names a neighbor\./);
      expect(screen.getByRole("link", { name: "See it in the feed" })).toBeTruthy();
    });

    test("a muted slideshow's note only mentions the description", () => {
      show(fixture({ status: "open", verdict: "mute", audioMuted: true, mediaType: "photos" }));
      const note = screen.getByRole("note").textContent;
      expect(note).toMatch(/any description is hidden/);
      expect(note).not.toMatch(/sound/);
    });
  });

  describe("held: emergency", () => {
    test("goes full screen with a Call 911 tel: link as soon as the verdict arrives", () => {
      const view = show(fixture({ status: "pending" }));
      state.report = fixture({ verdict: "emergency", reason: "A power line is down across the road." });
      view.rerender(<CheckingScreen reportId={REPORT_ID} onPostAnother={onPostAnother} />);

      const dialog = screen.getByRole("alertdialog");
      expect(dialog.className).toMatch(/fixed inset-0/);
      expect(screen.getByRole("link", { name: "Call 911" }).getAttribute("href")).toBe("tel:911");
      expect(screen.getByText("A power line is down across the road.")).toBeTruthy();
      expect(button("Post another")).toBeNull();
      expect(screen.getByRole("link", { name: "Back to the feed" }).getAttribute("href")).toBe("/");
      expect(debugLine()).toBe("held: emergency · A power line is down across the road.");
    });
  });

  describe("held: reject", () => {
    test("shows Claude's reason, and Post another starts over", () => {
      show(fixture({ verdict: "reject", reason: "This looks like a dispute with a neighbor, not a public-space problem." }));
      expect(heading()).toBe("We can't post this");
      expect(screen.getByText("This looks like a dispute with a neighbor, not a public-space problem.")).toBeTruthy();
      expect(button("Retake")).toBeNull();
      expect(debugLine()).toMatch(/^held: reject · This looks like a dispute/);
      fireEvent.click(button("Post another")!);
      expect(onPostAnother).toHaveBeenCalled();
    });
  });

  describe("held: retake", () => {
    test("shows the reason and a Retake button, and no Post another (§4.2.1)", () => {
      show(fixture({ verdict: "retake", reason: "A face is visible. Film again without people in frame." }));
      expect(heading()).toBe("Please record again");
      expect(screen.getByText("A face is visible. Film again without people in frame.")).toBeTruthy();
      expect(button("Retake")).toBeTruthy();
      expect(button("Post another")).toBeNull();
      expect(debugLine()).toMatch(/^held: retake · A face is visible/);
    });

    test("Retake records a new video with audio, uploads it and calls retakeReport", async () => {
      retakeReport().mockResolvedValue(null);
      show(fixture({ verdict: "retake", reason: "A plate is readable." }));
      fireEvent.click(button("Retake")!);
      // Video only, with the reason over the viewfinder.
      expect(cameraProps.at(-1)).toMatchObject({ modes: ["video"], hints: { video: "A plate is readable." } });
      await act(async () => fireEvent.click(screen.getByText("fake record")));

      expect(state.uploads).toHaveLength(7);
      expect(retakeReport()).toHaveBeenCalledTimes(1);
      const args = retakeReport().mock.calls[0][0];
      expect(args).toMatchObject({ token: "token-a", reportId: REPORT_ID, mediaType: "video" });
      expect([args.clipStorageId, ...args.frameStorageIds].sort()).toEqual(
        Array.from({ length: 7 }, (_, i) => `storage-${i + 1}`).sort(),
      );
      expect(args.frameStorageIds).toHaveLength(6);
    });

    test("a slideshow retakes with the photo picker and no clip", async () => {
      retakeReport().mockResolvedValue(null);
      show(fixture({ verdict: "retake", mediaType: "photos", reason: "A face is visible." }));
      expect(heading()).toBe("Please pick other photos");
      fireEvent.click(button("Retake")!);
      expect(cameraProps.at(-1)!.modes).toEqual(["photos"]);
      await act(async () => fireEvent.click(screen.getByText("fake pick")));

      expect(state.uploads).toEqual(PHOTOS);
      expect(retakeReport().mock.calls[0][0]).toEqual({
        token: "token-a",
        reportId: REPORT_ID,
        mediaType: "photos",
        clipStorageId: undefined,
        frameStorageIds: ["storage-1", "storage-2"],
      });
    });

    test("once retakeReport puts the report back to pending, the screen shows Checking… again", async () => {
      retakeReport().mockResolvedValue(null);
      const view = show(fixture({ verdict: "retake", reason: "A face is visible." }));
      fireEvent.click(button("Retake")!);
      await act(async () => fireEvent.click(screen.getByText("fake record")));
      state.report = fixture({ status: "pending" });
      view.rerender(<CheckingScreen reportId={REPORT_ID} onPostAnother={onPostAnother} />);
      expect(heading()).toBe("Checking…");
    });

    test("a server error shows its message on the reason screen, and Retake is offered again", async () => {
      retakeReport().mockRejectedValue(new ConvexError("This post can't be retaken."));
      show(fixture({ verdict: "retake", reason: "A face is visible." }));
      fireEvent.click(button("Retake")!);
      await act(async () => fireEvent.click(screen.getByText("fake record")));
      expect(screen.getByRole("alert").textContent).toBe("This post can't be retaken.");
      // Retake again clears the old error.
      fireEvent.click(button("Retake")!);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("fake record")).toBeTruthy();
    });

    test("a clip over 25 MB is refused before anything uploads", async () => {
      const big = new Blob(["clip"], { type: "video/mp4" });
      Object.defineProperty(big, "size", { value: 25_000_001 });
      const original = CLIP.blob;
      CLIP.blob = big;
      try {
        show(fixture({ verdict: "retake", reason: "A face is visible." }));
        fireEvent.click(button("Retake")!);
        await act(async () => fireEvent.click(screen.getByText("fake record")));
      } finally {
        CLIP.blob = original;
      }
      expect(screen.getByRole("alert").textContent).toBe("That clip is over 25 MB. Try a shorter one.");
      expect(state.uploads).toHaveLength(0);
      expect(retakeReport()).not.toHaveBeenCalled();
    });

    test("✕ on the camera goes back to the reason", () => {
      show(fixture({ verdict: "retake", reason: "A face is visible." }));
      fireEvent.click(button("Retake")!);
      fireEvent.click(screen.getByText("fake close"));
      expect(button("Retake")).toBeTruthy();
    });
  });

  describe("held: screening failed", () => {
    const failed = (fields: Partial<OwnerReport> = {}) =>
      fixture({ reason: SCREENING_FAILED_REASON, screeningError: "Groq transcription failed (500).", ...fields });

    test("says we couldn't check it, with Try again, the error in the debug line, and no Retake or Post another", () => {
      show(failed());
      expect(heading()).toBe("We couldn't check this post");
      expect(button("Try again")).toBeTruthy();
      expect(button("Retake")).toBeNull();
      expect(button("Post another")).toBeNull();
      expect(debugLine()).toBe("held: no verdict · Groq transcription failed (500).");
    });

    test(`after ${MAX_SCREENING_RETRIES} Try agains, it says so and offers Post another instead`, () => {
      show(failed({ screeningRetries: MAX_SCREENING_RETRIES }));
      expect(heading()).toBe("We still couldn't check this post");
      expect(screen.getByText(/maybe as photos/)).toBeTruthy();
      expect(button("Try again")).toBeNull();
      fireEvent.click(button("Post another")!);
      expect(onPostAnother).toHaveBeenCalled();
      expect(debugLine()).toMatch(/Groq transcription failed/);
    });

    test("one Try again left still shows the button", () => {
      show(failed({ screeningRetries: MAX_SCREENING_RETRIES - 1 }));
      expect(button("Try again")).toBeTruthy();
    });

    test("exported for the Me page: without onPostAnother, the capped screen has no Post another", () => {
      render(<ScreeningFailed token="token-a" report={failed({ screeningRetries: MAX_SCREENING_RETRIES })} />);
      expect(heading()).toBe("We still couldn't check this post");
      expect(button("Post another")).toBeNull();
    });


    test("Try again calls retryScreening for this report", async () => {
      retryScreening().mockResolvedValue(null);
      show(failed());
      await act(async () => fireEvent.click(button("Try again")!));
      expect(retryScreening()).toHaveBeenCalledWith({ token: "token-a", reportId: REPORT_ID });
    });

    test("a failed Try again shows an error and can be tapped again", async () => {
      retryScreening().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
      show(failed());
      await act(async () => fireEvent.click(button("Try again")!));
      expect(screen.getByRole("alert").textContent).toMatch(/couldn't start the check again/);
      await act(async () => fireEvent.click(button("Try again")!));
      expect(retryScreening()).toHaveBeenCalledTimes(2);
    });
  });

  describe("exports for the Me page (US24)", () => {
    test("Retake and ScreeningFailed render a <section> with no page wrapper, so a list row can hold them", () => {
      const retake = fixture({ verdict: "retake", reason: "A face is visible." });
      const failed = fixture({ reason: SCREENING_FAILED_REASON });
      for (const ui of [<Retake key="r" token="token-a" report={retake} />, <ScreeningFailed key="f" token="token-a" report={failed} />]) {
        const { container, unmount } = render(ui);
        expect(container.firstElementChild?.tagName).toBe("SECTION");
        expect(container.querySelector("main")).toBeNull();
        unmount();
      }
    });

    test("Retake's camera step stays inside the section too", () => {
      const { container } = render(<Retake token="token-a" report={fixture({ verdict: "retake", reason: "A face is visible." })} />);
      fireEvent.click(button("Retake")!);
      expect(container.firstElementChild?.tagName).toBe("SECTION");
      expect(screen.getByText("fake record")).toBeTruthy();
      expect(container.querySelector("main")).toBeNull();
    });
  });
});

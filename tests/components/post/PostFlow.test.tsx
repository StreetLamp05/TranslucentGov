// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as testingRender, screen } from "@testing-library/react";
import { ApiError } from "../../../lib/data/api";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CaptureMode } from "../../../components/capture/CameraCapture";
import type { RecordedClip } from "../../../lib/hooks/useClipRecorder";
import { DEMO_POINT } from "../../../lib/demo";
import PostFlow from "../../../components/post/PostFlow";
import type { LocationState } from "../../../lib/hooks/useCurrentLocation";

const state = vi.hoisted(() => ({
  location: { status: "ready", point: { lat: 33.8158, lng: -84.5825 }, accuracy: 8, simulated: false } as LocationState,
  refresh: vi.fn(),
  createReport: vi.fn(),
  push: vi.fn(),
  nearbyReports: [] as unknown,
  nearbyArgs: [] as unknown[],
  myReport: undefined as unknown,
  myReportArgs: [] as unknown[],
  uploads: [] as Blob[],
  liveKeys: [] as string[],
}));

// Identity rides in headers (lib/data/api.ts), so the calls carry no token. `useLive` is replaced
// by a synchronous stand-in that runs the fetcher once and returns the test's value for the key.
vi.mock("../../../lib/data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/data/api")>()),
  query: async (path: string, args: unknown) => {
    if (path === "/api/nearby") state.nearbyArgs.push(args);
    if (path === "/api/posts/mine") state.myReportArgs.push(args);
  },
  mutate: async (path: string, body: unknown) => {
    if (path === "/api/posts") return state.createReport(body);
    throw new Error(`unexpected mutate ${path}`);
  },
}));
vi.mock("../../../lib/data/useLive", () => ({
  LIVE_LIST_MS: 10_000,
  LIVE_STATUS_MS: 2_000,
  useLive: (key: string | null, fetcher: (signal: AbortSignal) => Promise<unknown>) => {
    if (key === null) return undefined;
    state.liveKeys.push(key);
    void fetcher(new AbortController().signal);
    return key.startsWith("nearby:") ? state.nearbyReports : state.myReport;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("../../../lib/hooks/useCurrentLocation", () => ({
  useCurrentLocation: () => ({ ...state.location, refresh: state.refresh }),
}));
vi.mock("../../../lib/hooks/useResidentToken", () => ({
  getResidentToken: () => "token-a",
  useResidentToken: () => "token-a",
}));
vi.mock("../../../lib/upload", () => ({
  uploadMedia: vi.fn(async (blob: Blob) => {
    state.uploads.push(blob);
    return `storage-${state.uploads.length}`;
  }),
}));
// The camera is tested on its own (tests/components/capture/CameraCapture.test.tsx); here it
// hands back a clip with 6 frames, or 3 photos, on a tap.
type CameraProps = {
  modes: CaptureMode[];
  initialMode?: CaptureMode;
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

const MANUAL_POINT = { lat: 37.78, lng: -122.42 };
type LocationPickerProps = {
  initialPoint: { lat: number; lng: number };
  onConfirm: (point: { lat: number; lng: number }) => void;
  onCancel: () => void;
};
vi.mock("../../../components/map/LocationPicker", () => ({
  default: (props: LocationPickerProps) => (
    <div>
      <p data-testid="picker-center">{`${props.initialPoint.lat},${props.initialPoint.lng}`}</p>
      <button onClick={() => props.onConfirm(MANUAL_POINT)}>select test pin</button>
      <button onClick={props.onCancel}>cancel map picker</button>
    </div>
  ),
}));

const PHOTOS = Array.from({ length: 3 }, (_, i) => new Blob([`photo ${i}`], { type: "image/jpeg" }));

const CLIP: RecordedClip = {
  blob: new Blob(["clip"], { type: "video/mp4" }),
  mimeType: "video/mp4",
  frames: Array.from({ length: 6 }, (_, i) => new Blob([`frame ${i}`], { type: "image/jpeg" })),
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  state.location = { status: "ready", point: { lat: 33.8158, lng: -84.5825 }, accuracy: 8, simulated: false };
  state.refresh.mockReset();
  state.createReport.mockReset().mockResolvedValue("report-1");
  state.nearbyReports = [];
  state.nearbyArgs = [];
  state.myReport = undefined;
  state.myReportArgs = [];
  state.uploads = [];
  state.liveKeys = [];
  state.push.mockReset();
  cameraProps.length = 0;
});
afterEach(cleanup);

function render(ui: ReactElement) {
  const view = testingRender(ui);
  if (ui.type === PostFlow && state.location.status === "ready") {
    fireEvent.click(screen.getByRole("button", { name: "Use this location" }));
  }
  return view;
}

async function recordAndSubmit(description?: string) {
  fireEvent.click(screen.getByText("fake record"));
  if (description !== undefined) {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: description } });
  }
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit" })));
}

describe("PostFlow", () => {
  test("GPS denial offers map selection and a retry without opening capture", () => {
    state.location = { status: "denied" };
    render(<PostFlow />);
    expect(screen.queryByText("fake record")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/permission denied/);
    expect(screen.getByRole("button", { name: "Choose location on map" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try GPS again" }));
    expect(state.refresh).toHaveBeenCalled();
  });

  test("a manual pin works without GPS and drives nearby lookup and report submission", async () => {
    state.location = { status: "denied" };
    const view = testingRender(<PostFlow />);

    fireEvent.click(screen.getByRole("button", { name: "Choose location on map" }));
    expect(screen.getByTestId("picker-center").textContent).toBe("37.7793,-122.4193");
    fireEvent.click(screen.getByRole("button", { name: "select test pin" }));

    expect(state.nearbyArgs.at(-1)).toEqual({
      lat: MANUAL_POINT.lat,
      lng: MANUAL_POINT.lng,
    });
    expect(screen.getByText("fake record")).toBeTruthy();
    fireEvent.click(screen.getByText("fake record"));
    expect(state.refresh).not.toHaveBeenCalled();
    state.location = { status: "ready", point: { lat: 33.7, lng: -84.4 }, accuracy: 3, simulated: false };
    view.rerender(<PostFlow />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit" })));

    expect(state.createReport.mock.calls[0][0]).toMatchObject({
      lat: MANUAL_POINT.lat,
      lng: MANUAL_POINT.lng,
    });
  });

  test("the simulated demo point remains the default location", () => {
    state.location = { status: "ready", point: DEMO_POINT, accuracy: null, simulated: true };
    render(<PostFlow />);
    expect(state.nearbyArgs.at(-1)).toEqual({
      lat: DEMO_POINT.lat,
      lng: DEMO_POINT.lng,
    });
  });

  test("canceling the map picker returns to the current location choice", () => {
    testingRender(<PostFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Choose location on map" }));
    fireEvent.click(screen.getByRole("button", { name: "cancel map picker" }));
    expect(screen.getByRole("button", { name: "Use this location" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this location" }));
    expect(screen.getByText("fake record")).toBeTruthy();
  });

  test("opens the full-screen camera with Video first and Photo second", () => {
    render(<PostFlow />);
    expect(cameraProps.at(-1)).toMatchObject({ modes: ["video", "photos"], initialMode: "video" });
    expect(cameraProps.at(-1)!.hints?.video).toMatch(/up to 20 seconds/);
    expect(cameraProps.at(-1)!.hints?.video).toMatch(/choose a pin first/);
  });

  test("✕ on the camera goes back to the feed", () => {
    render(<PostFlow />);
    fireEvent.click(screen.getByText("fake close"));
    expect(state.push).toHaveBeenCalledWith("/");
  });

  test("waits for nearby results before opening the camera, then goes straight to capture when none match", () => {
    state.nearbyReports = undefined;
    const view = render(<PostFlow />);
    expect(screen.queryByText("fake record")).toBeNull();
    expect(screen.getByText("Checking for nearby reports…")).toBeTruthy();
    expect(state.nearbyArgs.at(-1)).toEqual({
      lat: 33.8158,
      lng: -84.5825,
    });

    state.nearbyReports = [];
    view.rerender(<PostFlow />);
    expect(screen.getByText("fake record")).toBeTruthy();
  });

  test("shows nearby choices before camera capture and proceeds when none is selected", () => {
    state.nearbyReports = [
      {
        report: {
          _id: "nearby-report",
          _creationTime: 1,
          mediaType: "video",
          lat: 33.8159,
          lng: -84.5825,
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
          frameUrls: [],
          fixUrl: null,
        },
        distanceMeters: 12,
        isMine: false,
      },
    ];
    render(<PostFlow />);
    expect(screen.getByRole("heading", { name: "Is it one of these?" })).toBeTruthy();
    expect(screen.getByText("Pothole on Main")).toBeTruthy();
    expect(screen.queryByText("fake record")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No, it's new" }));
    expect(screen.getByText("fake record")).toBeTruthy();
  });

  test("rechecks nearby reports after choosing to post another", async () => {
    state.nearbyReports = [
      {
        report: {
          _id: "nearby-report",
          _creationTime: 1,
          mediaType: "video",
          lat: 33.8159,
          lng: -84.5825,
          title: "Pothole on Main",
          status: "open",
          audioMuted: false,
          isSample: false,
          meTooCount: 0,
          lastActivityAt: 1,
          revealViews: 0,
          createdAt: 1,
          clipUrl: null,
          frameUrls: [],
          fixUrl: null,
        },
        distanceMeters: 12,
        isMine: false,
      },
    ];
    state.myReport = { status: "open", title: "Pothole", agency: "Cobb DOT" };
    render(<PostFlow />);
    fireEvent.click(screen.getByRole("button", { name: "No, it's new" }));
    await recordAndSubmit();
    // US14's result screen ("Your post is live" was US8's interim one).
    expect(screen.getByRole("heading", { name: "Posted" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Post another" }));
    expect(screen.getByRole("heading", { name: "Is it one of these?" })).toBeTruthy();
  });

  test("the description has a live counter and stops at 280 characters", () => {
    render(<PostFlow />);
    fireEvent.click(screen.getByText("fake record"));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(280);
    expect(screen.getByText("0/280")).toBeTruthy();
    fireEvent.change(box, { target: { value: "Pothole" } });
    expect(screen.getByText("7/280")).toBeTruthy();
  });

  test("Submit uploads the clip and 6 frames, then creates the report at the phone's location", async () => {
    render(<PostFlow />);
    await recordAndSubmit("  Deep pothole  ");

    expect(state.uploads).toHaveLength(7);
    expect(state.uploads).toContain(CLIP.blob);
    expect(state.createReport).toHaveBeenCalledTimes(1);
    const args = state.createReport.mock.calls[0][0];
    expect(args).toMatchObject({
      mediaType: "video",
      description: "Deep pothole",
      lat: 33.8158,
      lng: -84.5825,
    });
    expect([args.clipStorageId, ...args.frameStorageIds].sort()).toEqual(
      ["storage-1", "storage-2", "storage-3", "storage-4", "storage-5", "storage-6", "storage-7"],
    );
    expect(args.frameStorageIds).toHaveLength(6);
    expect(screen.getByRole("heading").textContent).toBe("Checking…");
    expect(state.myReportArgs.at(-1)).toEqual({ reportId: "report-1" });
  });

  test("an empty description is sent as none", async () => {
    render(<PostFlow />);
    await recordAndSubmit("   ");
    expect(state.createReport.mock.calls[0][0].description).toBeUndefined();
  });

  test("keeps the confirmed location if GPS becomes unavailable after recording", async () => {
    const view = render(<PostFlow />);
    fireEvent.click(screen.getByText("fake record"));
    state.location = { status: "timeout" };
    view.rerender(<PostFlow />);

    const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => fireEvent.click(submit));
    expect(state.createReport.mock.calls[0][0]).toMatchObject({ lat: 33.8158, lng: -84.5825 });
  });

  test("keeps the confirmed location when a later GPS refresh finds a newer fix", async () => {
    const view = render(<PostFlow />);
    fireEvent.click(screen.getByText("fake record"));
    state.location = { status: "ready", point: { lat: 33.8161, lng: -84.5829 }, accuracy: 4, simulated: false };
    view.rerender(<PostFlow />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit" })));
    expect(state.createReport.mock.calls[0][0]).toMatchObject({ lat: 33.8158, lng: -84.5825 });
  });

  test("a clip over 25 MB is refused before anything uploads", async () => {
    const big = new Blob(["clip"], { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: 25_000_001 });
    const original = CLIP.blob;
    CLIP.blob = big;
    try {
      render(<PostFlow />);
      await recordAndSubmit();
    } finally {
      CLIP.blob = original;
    }
    expect(screen.getByRole("alert").textContent).toBe("That clip is over 25 MB. Try a shorter one.");
    expect(state.uploads).toHaveLength(0);
    expect(state.createReport).not.toHaveBeenCalled();
  });

  test("a server error shows its message and keeps the clip, so Submit works again", async () => {
    state.createReport.mockRejectedValueOnce(new ApiError(400, "An uploaded file is missing. Try posting again."));
    render(<PostFlow />);
    await recordAndSubmit();
    expect(screen.getByRole("alert").textContent).toBe("An uploaded file is missing. Try posting again.");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit" })));
    expect(state.createReport).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading").textContent).toBe("Checking…");
  });

  test("a failed upload shows a generic error and doesn't create a report", async () => {
    const { uploadMedia } = await import("../../../lib/upload");
    vi.mocked(uploadMedia).mockRejectedValueOnce(new Error("Upload failed (500)"));
    render(<PostFlow />);
    await recordAndSubmit();
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't send your post/);
    expect(state.createReport).not.toHaveBeenCalled();
  });

  test("Record again drops the clip and goes back to the recorder, keeping the description", () => {
    render(<PostFlow />);
    fireEvent.click(screen.getByText("fake record"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Streetlight out" } });
    fireEvent.click(screen.getByRole("button", { name: "Record again" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");

    fireEvent.click(screen.getByText("fake record"));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Streetlight out");
  });
});

describe("Checking… screen", () => {
  async function submitted() {
    const view = render(<PostFlow />);
    await recordAndSubmit();
    return view;
  }

  test("stays on Checking… while the report is pending", async () => {
    state.myReport = { _id: "report-1", status: "pending" };
    await submitted();
    expect(screen.getByRole("heading").textContent).toBe("Checking…");
  });

  // Each result screen is tested in CheckingScreen.test.tsx (US14). This checks the hand-off back to PostFlow.
  test("Post another on a rejected post starts over at the recorder", async () => {
    const view = await submitted();
    state.myReport = { _id: "report-1", status: "held", verdict: "reject", reason: "Not a public-space problem." };
    view.rerender(<PostFlow />);
    expect(screen.getByText("Not a public-space problem.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Post another" }));
    expect(screen.getByText("fake record")).toBeTruthy();
  });
});

describe("Photos", () => {
  // A URL per photo, as the browser gives, since the preview keys its images by URL.
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  });

  test("Photo mode explains that the current location is the default pin", () => {
    render(<PostFlow />);
    expect(cameraProps.at(-1)!.hints?.photos).toMatch(/current location unless you choose a pin first/);
  });

  test("the preview shows every photo and has the description box", () => {
    render(<PostFlow />);
    fireEvent.click(screen.getByText("fake pick"));
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual([
      "Photo 1 of 3",
      "Photo 2 of 3",
      "Photo 3 of 3",
    ]);
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(document.querySelector("video")).toBeNull();
  });

  test("Submit uploads each photo, then calls createReport with mediaType photos and no clip", async () => {
    render(<PostFlow />);
    fireEvent.click(screen.getByText("fake pick"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " Graffiti on the bridge " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit" })));

    expect(state.uploads).toEqual(PHOTOS);
    expect(state.createReport).toHaveBeenCalledTimes(1);
    const args = state.createReport.mock.calls[0][0];
    expect(args).toEqual({
      mediaType: "photos",
      frameStorageIds: ["storage-1", "storage-2", "storage-3"],
      description: "Graffiti on the bridge",
      lat: 33.8158,
      lng: -84.5825,
    });

    expect(args).not.toHaveProperty("clipStorageId");
    expect(screen.getByRole("heading").textContent).toBe("Checking…");
  });

  test("a manual pin is also used when submitting a photo post without GPS", async () => {
    state.location = { status: "unavailable" };
    testingRender(<PostFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Choose location on map" }));
    fireEvent.click(screen.getByRole("button", { name: "select test pin" }));
    fireEvent.click(screen.getByText("fake pick"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit" })));

    expect(state.createReport.mock.calls[0][0]).toMatchObject({
      mediaType: "photos",
      lat: MANUAL_POINT.lat,
      lng: MANUAL_POINT.lng,
    });
  });

  test("Pick again drops the photos and goes back to the picker, keeping the description", () => {
    render(<PostFlow />);
    fireEvent.click(screen.getByText("fake pick"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Broken bench" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick again" }));
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual(["blob:preview-1", "blob:preview-2", "blob:preview-3"]);
    // Back in the camera, in Photo mode.
    expect(cameraProps.at(-1)!.initialMode).toBe("photos");

    fireEvent.click(screen.getByText("fake pick"));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Broken bench");
  });

  test("a failed photo upload shows the generic error and doesn't create a report", async () => {
    const { uploadMedia } = await import("../../../lib/upload");
    vi.mocked(uploadMedia).mockRejectedValueOnce(new Error("Upload failed (500)"));
    render(<PostFlow />);
    fireEvent.click(screen.getByText("fake pick"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit" })));
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't send your post/);
    expect(state.createReport).not.toHaveBeenCalled();
  });
});

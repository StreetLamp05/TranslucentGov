// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import CardOverlay from "../../../components/feed/CardOverlay";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PublicReport } from "../../../convex/lib/publicReport";

const CLIP = "https://files.test/r1.mp4";

const report = {
  _id: "r1" as Id<"reports">,
  _creationTime: 0,
  mediaType: "video",
  owner: "cobb",
  title: "Deep pothole",
  status: "open",
  audioMuted: false,
  isSample: false,
  createdAt: Date.now(),
  segments: [{ start: 0, end: 2, text: "Deep pothole in the right lane." }],
  clipUrl: CLIP,
  frameUrls: [],
} as unknown as PublicReport;

afterEach(cleanup);

describe("caption placement", () => {
  test("sits in a top band below the safe area, wrapped to at most 3 lines, on a dark backing", () => {
    const video = document.createElement("video");
    video.setAttribute("src", CLIP);
    render(<CardOverlay report={report} active near video={video} />);
    act(() => {
      video.currentTime = 0.5;
      video.dispatchEvent(new Event("timeupdate"));
    });
    const band = screen.getByTestId("caption-band");
    expect(band.className).toContain("env(safe-area-inset-top");
    expect(band.className).not.toContain("top-[45%]");
    expect(band.className).toContain("right-20");
    expect(band.contains(screen.getByTestId("caption"))).toBe(true);
    expect(screen.getByTestId("caption").className).toContain("line-clamp-3");
    expect(screen.getByTestId("caption").className).toContain("bg-black/60");
  });
});

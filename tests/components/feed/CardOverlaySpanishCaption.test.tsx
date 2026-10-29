// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import CardOverlay from "../../../components/feed/CardOverlay";
import { I18nProvider } from "../../../lib/i18n/I18nProvider";
import { resetLocaleStore, setLocale } from "../../../lib/i18n/locale";
import type { PublicReport } from "../../../server/lib/publicReport";

const CLIP = "https://files.test/r1.mp4";

const base = {
  _id: "r1",
  _creationTime: 0,
  mediaType: "video",
  owner: "cobb",
  title: "Deep pothole",
  status: "open",
  audioMuted: false,
  isSample: false,
  createdAt: Date.now(),
  segments: [{ start: 0, end: 2, text: "Deep pothole in the right lane." }],
  segmentsEs: [{ start: 0, end: 2, text: "Bache profundo en el carril derecho." }],
  clipUrl: CLIP,
  frameUrls: [],
} as unknown as PublicReport;

// Renders the card at 0.5 s into its clip and returns the caption on screen.
function captionFor(report: PublicReport): string | null {
  const video = document.createElement("video");
  video.setAttribute("src", CLIP);
  render(
    <I18nProvider>
      <CardOverlay report={report} active near video={video} />
    </I18nProvider>,
  );
  act(() => {
    video.currentTime = 0.5;
    video.dispatchEvent(new Event("timeupdate"));
  });
  return screen.queryByTestId("caption")?.textContent ?? null;
}

beforeEach(() => {
  localStorage.clear();
  resetLocaleStore();
});
afterEach(cleanup);

describe("captions follow the chosen language", () => {
  test("English reads the original segments", () => {
    expect(captionFor(base)).toBe("Deep pothole in the right lane.");
  });

  test("Spanish reads segmentsEs", () => {
    setLocale("es");
    expect(captionFor(base)).toBe("Bache profundo en el carril derecho.");
  });

  test("Spanish falls back to the original when a report has no Spanish", () => {
    setLocale("es");
    expect(captionFor({ ...base, segmentsEs: undefined })).toBe("Deep pothole in the right lane.");
  });

  test("a muted report shows no caption in Spanish either", () => {
    setLocale("es");
    expect(captionFor({ ...base, audioMuted: true })).toBeNull();
  });
});

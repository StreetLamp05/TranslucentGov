import { expect, test } from "vitest";
import { MAX_PHOTOS } from "../../../server/lib/postLimits";
import { frameSize } from "../../../lib/media/frames";
import { isHeic, keepPhotos } from "../../../lib/media/photos";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

test("picking 12 keeps the first 10 and reports 2 cut", () => {
  expect(MAX_PHOTOS).toBe(10);
  expect(keepPhotos(range(12))).toEqual({ kept: range(10), cut: 2 });
});

test("10 or fewer are all kept, with nothing cut", () => {
  expect(keepPhotos(range(10))).toEqual({ kept: range(10), cut: 0 });
  expect(keepPhotos(range(1))).toEqual({ kept: [0], cut: 0 });
});

test("0 picked gives nothing to post", () => {
  expect(keepPhotos([])).toEqual({ kept: [], cut: 0 });
});

test("spots HEIC by type, or by file name when the type is missing", () => {
  expect(isHeic(new File([], "IMG_1.HEIC", { type: "image/heic" }))).toBe(true);
  expect(isHeic(new Blob([], { type: "image/heif" }))).toBe(true);
  expect(isHeic(new File([], "IMG_1.heic"))).toBe(true);
  expect(isHeic(new File([], "IMG_1.HEIF", { type: "" }))).toBe(true);
  expect(isHeic(new File([], "IMG_1.jpg", { type: "image/jpeg" }))).toBe(false);
  expect(isHeic(new Blob([], { type: "image/png" }))).toBe(false);
});

// photoToJpeg sizes its canvas with frameSize; tests/browser/media/photoToJpeg.test.ts checks real output.
test("the resize keeps the aspect ratio with the long edge at most 1280", () => {
  for (const [w, h] of [
    [4032, 3024],
    [3024, 4032],
    [4000, 1000],
    [1280, 1280],
  ]) {
    const out = frameSize(w, h);
    expect(Math.max(out.width, out.height)).toBe(1280);
    expect(out.width / out.height).toBeCloseTo(w / h, 2);
  }
  expect(frameSize(640, 480)).toEqual({ width: 640, height: 480 });
});

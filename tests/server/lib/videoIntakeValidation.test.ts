import { describe, expect, it } from "vitest";
import { validateVideoMetadata } from "@/server/lib/videoIntakeValidation";

describe("validateVideoMetadata", () => {
  it("allows supported video types and normalizes MIME parameters", () => {
    expect(validateVideoMetadata("video/mp4; codecs=h264", 1024)).toBe("video/mp4");
    expect(validateVideoMetadata("video/webm", 1024)).toBe("video/webm");
  });

  it("rejects unsupported formats and files outside the size limit", () => {
    expect(() => validateVideoMetadata("video/quicktime", 1024)).toThrow(
      "Only MP4 and WebM videos can be uploaded.",
    );
    expect(() => validateVideoMetadata("video/mp4", 0)).toThrow(
      "Videos must be larger than 0 bytes and 25 MB or smaller.",
    );
    expect(() => validateVideoMetadata("video/mp4", 26 * 1024 * 1024)).toThrow(
      "Videos must be larger than 0 bytes and 25 MB or smaller.",
    );
  });
});

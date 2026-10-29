import { MAX_PHOTOS } from "../../server/lib/postLimits";
import { FRAME_JPEG_QUALITY } from "./constants";
import { frameSize } from "./frames";

// Photos for a slideshow post (§4.1.1): 1–10 from the camera or gallery, each re-encoded in the
// browser as a JPEG of 1280 px or less on the long edge, the same as a video's frames (§1.1.3).

/** The first `MAX_PHOTOS` picked files, and how many past that were dropped. */
export function keepPhotos<T>(files: readonly T[]): { kept: T[]; cut: number } {
  return { kept: files.slice(0, MAX_PHOTOS), cut: Math.max(0, files.length - MAX_PHOTOS) };
}

/** HEIC/HEIF, which iOS Safari reads but Android and desktop Chrome can't. */
export function isHeic(file: Blob): boolean {
  if (/^image\/hei[cf]/.test(file.type)) return true;
  return file instanceof File && /\.hei[cf]$/i.test(file.name);
}

/**
 * A photo as an upright JPEG, 1280 px or less on the long edge. Browsers apply the EXIF
 * orientation when decoding an `<img>`, so a portrait iPhone photo is drawn the right way up.
 * Drawing to a canvas and re-encoding keeps no metadata, which strips EXIF (GPS included).
 */
export async function photoToJpeg(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const { width, height } = frameSize(img.naturalWidth, img.naturalHeight);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D isn't available.");
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the photo."))),
        "image/jpeg",
        FRAME_JPEG_QUALITY,
      ),
    );
  } finally {
    // iOS caps total canvas memory, so free each one before the next photo.
    canvas.width = 0;
    canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}

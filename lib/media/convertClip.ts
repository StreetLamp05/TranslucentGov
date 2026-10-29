import { MAX_CLIP_BYTES } from "../../server/lib/clipLimit";
import { AUDIO_BITS_PER_SECOND, MAX_RECORD_MS, VIDEO_BITS_PER_SECOND } from "./constants";
import { frameSize } from "./frames";
import { normalizeMimeType, pickMimeType } from "./mimeType";

// Uploaded clips (§4.1.1): a new iPhone saves .mov (often HEVC, often 4K) that transcription won't take
// (§1.1.4) and that can be well over 25 MB. The browser can decode it, so it's played in a hidden
// <video>, drawn to a canvas of 1280 px or less on the long edge, and re-recorded with the same
// MediaRecorder settings as a live clip. It runs in real time, so a 20 s clip takes about 20 s.

// The containers Gemini and every phone accept as they are.
const PASS_THROUGH_TYPES = ["video/mp4", "video/webm"];
const STALL_MS = 10_000;
const FPS = 30;
// How long to wait for the AudioContext to start before converting without sound.
const AUDIO_START_MS = 500;

/** True when an uploaded clip has to be re-recorded before it can be posted, by type and size alone. */
export function needsConversion(file: Blob): boolean {
  return !PASS_THROUGH_TYPES.includes(normalizeMimeType(file.type)) || file.size > MAX_CLIP_BYTES;
}

// An MP4 or WebM that passes on type and size is still converted when it runs past the 20 s cap
// (§4.1.1), which cuts it to 20 s. The slack covers a live clip's own rounding.
export const MAX_UPLOAD_MS = MAX_RECORD_MS + 500;

/** True when a clip of this length has to be cut. */
export const isTooLong = (durationS: number) => durationS * 1000 > MAX_UPLOAD_MS;

/** A long edge of at most `maxEdge`, with even sides, which video encoders need. */
export function convertedSize(width: number, height: number, maxEdge = 1280) {
  const size = frameSize(width, height, maxEdge);
  return { width: size.width - (size.width % 2), height: size.height - (size.height % 2) };
}

type Options = {
  /** 0 to 1, as the clip plays through. */
  onProgress?: (fraction: number) => void;
  /** Stop after this much of the clip (§4.1.1's 20 s cap). */
  maxMs?: number;
  /** Abandons the conversion (the camera closed, or another file was picked). */
  signal?: AbortSignal;
  /** False drops the sound, as for a fix clip, which is silent at the source (§4.3.1). */
  audio?: boolean;
};

/**
 * Re-records `file` as MP4 (or WebM where MP4 isn't supported), 1280 px or less at about 1.5 Mbps,
 * with its audio, cut at 20 s. Call it straight from the file input's change handler: playback
 * and the AudioContext start before the first await, so iOS still counts the tap that picked the
 * file. If the browser doesn't, the clip is converted without sound rather than not at all.
 */
export function convertClip(
  file: Blob,
  { onProgress, maxMs = MAX_RECORD_MS, signal, audio: withAudio = true }: Options = {},
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  // In the DOM (but invisible), because iOS Safari won't decode frames for a detached video.
  video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(video);
  video.src = url;

  // The audio goes to the recording only, never the speaker. Without WebAudio the clip is silent.
  // `context` is kept apart from `audio`, so it's closed even after the sound is dropped.
  let context: AudioContext | null = null;
  let audio: { context: AudioContext; stream: MediaStream } | null = null;
  if (withAudio) {
    try {
      context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      context.createMediaElementSource(video).connect(destination);
      void context.resume().catch(() => {});
      audio = { context, stream: destination.stream };
    } catch {
      video.muted = true;
    }
  } else {
    video.muted = true;
  }
  // Inside the tap: this play() is what lets the later ones run on iOS.
  const unlocked = video.play().catch(() => {
    video.muted = true;
  });

  let recorder: MediaRecorder | null = null;
  let tracks: MediaStreamTrack[] = [];
  const cleanup = () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.stop();
    }
    tracks.forEach((track) => track.stop());
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
    void context?.close().catch(() => {});
  };

  const aborted = () => new DOMException("The conversion was cancelled.", "AbortError");

  return (async () => {
    try {
      await unlocked;
      if (signal?.aborted) throw aborted();
      video.pause();
      await ready(video);
      video.currentTime = 0;
      await event(video, "seeked");

      const { width, height } = convertedSize(video.videoWidth, video.videoHeight);
      if (!width || !height) throw new Error("The clip has no picture.");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D isn't available.");

      // A suspended context feeds the recorder nothing, and some recorders (WebM) then write
      // nothing at all, so a clip without sound beats an empty one.
      if (audio && audio.context.state !== "running") {
        await Promise.race([audio.context.resume(), new Promise((resolve) => setTimeout(resolve, AUDIO_START_MS))]);
        // Re-read: resume() may have changed it (TypeScript still narrows from the check above).
        if ((audio.context.state as AudioContextState) !== "running") audio = null;
      }

      tracks = [...canvas.captureStream(FPS).getVideoTracks(), ...(audio?.stream.getAudioTracks() ?? [])];
      const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(new MediaStream(tracks), {
        ...(mimeType && { mimeType }),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        ...(audio && { audioBitsPerSecond: AUDIO_BITS_PER_SECOND }),
      });
      recorder = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      const stopped = new Promise<void>((resolve, reject) => {
        rec.onstop = () => resolve();
        rec.onerror = () => reject(new Error("Converting the clip stopped unexpectedly."));
      });

      const endS = Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, maxMs / 1000);
      let lastProgressAt = Date.now();
      let lastTime = -1;
      await new Promise<void>((resolve, reject) => {
        const draw = () => {
          ctx.drawImage(video, 0, 0, width, height);
          if (video.currentTime !== lastTime) {
            lastTime = video.currentTime;
            lastProgressAt = Date.now();
            if (Number.isFinite(endS)) onProgress?.(Math.min(1, video.currentTime / endS));
          }
          if (signal?.aborted) return reject(aborted());
          if (video.ended || video.currentTime >= endS) return resolve();
          if (Date.now() - lastProgressAt > STALL_MS) return reject(new Error("The clip stopped playing."));
          requestAnimationFrame(draw);
        };
        video.onerror = () => reject(new Error("The clip couldn't be read."));
        rec.start(1000);
        video.play().then(() => requestAnimationFrame(draw), reject);
      });
      video.pause();
      rec.stop();
      await stopped;
      const out = new Blob(chunks, { type: rec.mimeType || mimeType || "video/webm" });
      if (out.size === 0) throw new Error("The converted clip came out empty.");
      onProgress?.(1);
      return out;
    } finally {
      cleanup();
    }
  })();
}

function event(video: HTMLVideoElement, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`Timed out waiting for ${name}.`)), STALL_MS);
    const ok = () => done();
    const fail = () => done(new Error("The clip couldn't be read."));
    function done(err?: Error) {
      clearTimeout(timer);
      video.removeEventListener(name, ok);
      video.removeEventListener("error", fail);
      if (err) reject(err);
      else resolve();
    }
    video.addEventListener(name, ok);
    video.addEventListener("error", fail);
  });
}

// Metadata (size and duration) loaded.
async function ready(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
  await event(video, "loadedmetadata");
}

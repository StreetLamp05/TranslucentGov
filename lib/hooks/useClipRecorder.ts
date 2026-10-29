"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { describeCameraError } from "@/lib/media/cameraError";
import {
  AUDIO_BITS_PER_SECOND,
  FRAME_SAMPLE_MS,
  MAX_RECORD_MS,
  MIN_RECORD_MS,
  VIDEO_BITS_PER_SECOND,
} from "@/lib/media/constants";
import { convertClip, isTooLong, needsConversion } from "@/lib/media/convertClip";
import { clipDurationS, framesFromFile, grabFrame, pickEvenly } from "@/lib/media/frames";
import { pickMimeType } from "@/lib/media/mimeType";

// The in-page recorder (§4.1.1) without its look: rear camera, about 720p at 1.5 Mbps, stopping
// by itself at 20 s, plus clips from a file. VideoRecorder (fixes, dev pages) and CameraCapture
// (posts) both render on top of it.

export type RecordedClip = {
  blob: Blob;
  mimeType: string;
  /** 6 evenly spaced JPEG frames (fewer for very short clips). Frame 0 is the thumbnail and poster. */
  frames: Blob[];
};
// Clips from a file are passed through as they are when Gemini and every phone can take them,
// so they keep any audio track even when `audio` is false. Anything else (an iPhone .mov, a clip
// over 25 MB or 20 s) is converted first (lib/media/convertClip), without sound when `audio` is false.

export type RecorderPhase =
  | { kind: "idle" }
  | { kind: "preview" }
  | { kind: "recording"; startedAt: number; endsAt: number }
  | { kind: "converting"; progress: number }
  | { kind: "processing" }
  | { kind: "done" }
  | { kind: "error"; message: string };

type Options = {
  audio: boolean;
  onDone: (clip: RecordedClip) => void;
  /** Open the camera on mount. If the browser refuses without a tap, the error says so. */
  autoOpen?: boolean;
};

const COUNTDOWN_TICK_MS = 250;
const EMPTY_CLIP_MESSAGE = "The recording came out empty. Try again.";
const RECORDER_ERROR_MESSAGE = "Recording stopped unexpectedly. Try again.";
export const FILE_ERROR_MESSAGE = "We couldn't read that video. Try a different clip.";
export const CONVERT_ERROR_MESSAGE = "We couldn't convert that video. Try a shorter clip, or record it here.";

const subscribe = () => () => {};
const canRecordInPage = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

export function useClipRecorder({ audio, onDone, autoOpen = false }: Options) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const framesRef = useRef<Promise<Blob | null>[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const busyRef = useRef(false);
  // Bumped when a file is picked, so a camera that finishes opening afterwards is closed again.
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  // The conversion in progress, cancelled by a newer pick or unmounting.
  const conversionRef = useRef<AbortController | null>(null);
  const onDoneRef = useRef(onDone);
  const [phase, setPhase] = useState<RecorderPhase>({ kind: "idle" });
  const [now, setNow] = useState(0);
  // True during server render and hydration, so the page doesn't flash the fallback.
  const inPage = useSyncExternalStore(subscribe, canRecordInPage, () => true);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  function clearTimers() {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Release the camera (and drop any half-finished clip) when the component unmounts.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      conversionRef.current?.abort();
      clearTimers();
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (autoOpen && canRecordInPage()) openCamera();
    // Only on mount: toggling autoOpen later shouldn't reopen a camera the resident is using.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function deliver(clip: RecordedClip) {
    if (!mountedRef.current) return;
    setPhase({ kind: "done" });
    onDoneRef.current(clip);
  }

  function fail(message: string) {
    clearTimers();
    stopCamera();
    if (mountedRef.current) setPhase({ kind: "error", message });
  }

  async function openCamera() {
    // A double tap would otherwise open two streams.
    if (busyRef.current) return;
    busyRef.current = true;
    const attempt = ++attemptRef.current;
    const stale = () => !mountedRef.current || attempt !== attemptRef.current;
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio,
      });
      if (stale()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      if (stale()) return stopCamera();
      setPhase({ kind: "preview" });
    } catch (err) {
      if (!stale()) fail(describeCameraError(err, { audio }));
    } finally {
      busyRef.current = false;
    }
  }

  function sampleFrame() {
    framesRef.current.push(grabFrame(videoRef.current!).catch(() => null));
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || recorderRef.current) return;
    const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType && { mimeType }),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        ...(audio && { audioBitsPerSecond: AUDIO_BITS_PER_SECOND }),
      });
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = () => finishRecording(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      recorder.onerror = () => {
        recorder.onstop = null;
        recorderRef.current = null;
        fail(RECORDER_ERROR_MESSAGE);
      };
      recorder.start(1000);
    } catch (err) {
      // Nothing is kept on failure, so Record works again once the camera reopens.
      return fail(describeCameraError(err, { audio }));
    }
    recorderRef.current = recorder;
    framesRef.current = [];
    sampleFrame();

    const startedAt = Date.now();
    setNow(startedAt);
    setPhase({ kind: "recording", startedAt, endsAt: startedAt + MAX_RECORD_MS });
    timersRef.current = [
      setTimeout(stopRecording, MAX_RECORD_MS),
      setInterval(sampleFrame, FRAME_SAMPLE_MS),
      setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS),
    ];
  }

  function stopRecording() {
    clearTimers();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    sampleFrame();
    recorder.stop();
  }

  async function finishRecording(blob: Blob) {
    clearTimers();
    stopCamera();
    recorderRef.current = null;
    if (!mountedRef.current) return;
    if (blob.size === 0) return fail(EMPTY_CLIP_MESSAGE);
    setPhase({ kind: "processing" });
    try {
      let frames = (await Promise.all(framesRef.current)).filter((f): f is Blob => f !== null);
      if (frames.length === 0) frames = await framesFromFile(blob);
      deliver({ blob, mimeType: blob.type, frames: pickEvenly(frames) });
    } catch {
      fail(EMPTY_CLIP_MESSAGE);
    }
  }

  /** A clip from a file. Call it straight from the input's change handler (see convertClip). */
  function takeFile(file: File | undefined) {
    if (!file) return;
    const attempt = ++attemptRef.current;
    const live = () => mountedRef.current && attempt === attemptRef.current;
    stopCamera();
    let convert = needsConversion(file);
    setPhase(convert ? { kind: "converting", progress: 0 } : { kind: "processing" });
    conversionRef.current?.abort();
    const controller = new AbortController();
    conversionRef.current = controller;
    const startConversion = () =>
      convertClip(file, {
        onProgress: (progress) => live() && setPhase({ kind: "converting", progress }),
        signal: controller.signal,
        // A fix clip (audio off) comes out silent, as it would recorded live (§4.3.1).
        audio,
      });
    // Started before any await, inside the tap.
    const converted = convert ? startConversion() : null;
    void (async () => {
      try {
        let blob: Blob = file;
        if (converted) {
          blob = await converted;
        } else if (isTooLong(await clipDurationS(file).catch(() => 0))) {
          // Too long to post as it is (§4.1.1). This starts after the tap, so iOS may convert it
          // without sound. A clip whose length can't be read goes on, and framesFromFile decides.
          if (!live()) return;
          convert = true;
          setPhase({ kind: "converting", progress: 0 });
          blob = await startConversion();
        }
        if (!live()) return;
        setPhase({ kind: "processing" });
        const frames = await framesFromFile(blob);
        if (live()) deliver({ blob, mimeType: blob.type, frames });
      } catch {
        if (live()) fail(convert ? CONVERT_ERROR_MESSAGE : FILE_ERROR_MESSAGE);
      }
    })();
  }

  const secondsLeft = phase.kind === "recording" ? Math.max(0, Math.ceil((phase.endsAt - now) / 1000)) : 0;
  const elapsedMs = phase.kind === "recording" ? Math.min(MAX_RECORD_MS, now - phase.startedAt) : 0;
  const canStop = phase.kind === "recording" && now - phase.startedAt >= MIN_RECORD_MS;
  const busy = phase.kind === "converting" || phase.kind === "processing" || phase.kind === "done";
  const showCamera = phase.kind === "preview" || phase.kind === "recording";

  return {
    videoRef,
    phase,
    inPage,
    openCamera,
    startRecording,
    stopRecording,
    takeFile,
    secondsLeft,
    elapsedMs,
    canStop,
    busy,
    showCamera,
  };
}

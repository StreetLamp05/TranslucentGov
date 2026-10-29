"use client";

import { useEffect, useRef, useState } from "react";
import DemoBanner from "@/app/DemoBanner";
import { MAX_PHOTOS } from "@/server/lib/postLimits";
import { useClipRecorder, type RecordedClip } from "@/lib/hooks/useClipRecorder";
import { MAX_RECORD_MS } from "@/lib/media/constants";
import { grabFrame } from "@/lib/media/frames";
import { noPhotosMessage, prepareJpegs } from "@/lib/media/preparePhotos";

// The post camera (§4.1.1), laid out like TikTok's: a full-screen viewfinder, a round shutter,
// VIDEO · PHOTO under it, and Upload bottom-left for a clip or photos already on the phone.
// Video mode records a 20 s clip (useClipRecorder). Photo mode snaps stills from the same live
// camera, up to 10, then Next hands them over. Uploaded clips an iPhone saves (.mov) are converted.

export type CaptureMode = "video" | "photos";

type Props = {
  /** The modes offered, in tab order. One mode hides the tabs (a retake keeps the post's type). */
  modes: readonly CaptureMode[];
  initialMode?: CaptureMode;
  /** Record sound with video. */
  audio?: boolean;
  /** A line over the viewfinder for each mode. */
  hints?: Partial<Record<CaptureMode, string>>;
  onVideo: (clip: RecordedClip) => void;
  onPhotos: (photos: Blob[]) => void;
  onClose: () => void;
};

type Photo = { blob: Blob; url: string };

const TAB_LABEL: Record<CaptureMode, string> = { video: "Video", photos: "Photo" };
const SNAP_ERROR = "We couldn't take that photo. Try again.";
const RING_RADIUS = 36;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export default function CameraCapture({ modes, initialMode, audio = true, hints, onVideo, onPhotos, onClose }: Props) {
  const [mode, setMode] = useState<CaptureMode>(initialMode && modes.includes(initialMode) ? initialMode : modes[0]);
  // The microphone only for Video, so a denied mic still leaves the Photo shutter working.
  const wantAudio = audio && mode === "video";
  const recorder = useClipRecorder({ audio: wantAudio, onDone: onVideo, autoOpen: true });
  const { videoRef, phase, inPage } = recorder;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Kept in step with every change, so two quick snaps can't both see room for one more.
  const photosRef = useRef(photos);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // Reopen the camera when the mode needs a different stream: Video after a silent one, or
  // Photo after the camera failed (likely the mic was denied, which Photo doesn't need).
  const openedWithAudio = useRef(wantAudio);
  useEffect(() => {
    if (!inPage) return;
    const reopen = wantAudio ? !openedWithAudio.current : phase.kind === "error";
    if (!reopen) return;
    openedWithAudio.current = wantAudio;
    void recorder.openCamera();
    // Only on a mode switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const recording = phase.kind === "recording";
  const busy = recorder.busy || preparing;
  const full = photos.length >= MAX_PHOTOS;
  const cameraOpen = phase.kind === "preview" || recording;

  function commit(next: Photo[]) {
    photosRef.current = next;
    setPhotos(next);
  }

  // Adds what fits under 10 and returns how many didn't.
  function addPhotos(blobs: Blob[]) {
    const current = photosRef.current;
    const added = blobs.slice(0, MAX_PHOTOS - current.length).map((blob) => ({ blob, url: URL.createObjectURL(blob) }));
    commit([...current, ...added]);
    return blobs.length - added.length;
  }

  function removePhoto(index: number) {
    const current = photosRef.current;
    URL.revokeObjectURL(current[index].url);
    commit(current.filter((_, i) => i !== index));
  }

  async function snap() {
    const video = videoRef.current;
    if (!video || full) return;
    try {
      addPhotos([await grabFrame(video)]);
      setNote(null);
    } catch {
      setNote(SNAP_ERROR);
    }
  }

  async function uploadPhotos(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setPreparing(true);
    setNote(null);
    try {
      const { jpegs, cut, unreadable, heic } = await prepareJpegs(files);
      if (!jpegs.length) return setNote(noPhotosMessage(heic));
      const over = addPhotos(jpegs) + cut;
      const notes = [
        over > 0 && `A post can have up to ${MAX_PHOTOS} photos, so ${over === 1 ? "1 was" : `${over} were`} left out.`,
        unreadable > 0 && `${unreadable === 1 ? "1 photo" : `${unreadable} photos`} couldn't be read.`,
      ].filter(Boolean);
      setNote(notes.length ? notes.join(" ") : null);
    } finally {
      setPreparing(false);
    }
  }

  function shutter() {
    if (!cameraOpen) return void recorder.openCamera();
    if (mode === "photos") return void snap();
    if (recording) recorder.stopRecording();
    else recorder.startRecording();
  }

  const shutterLabel = !cameraOpen
    ? "Open camera"
    : mode === "photos"
      ? "Take photo"
      : recording
        ? "Stop"
        : "Record";
  const shutterDisabled =
    busy || (cameraOpen && mode === "photos" && full) || (recording && !recorder.canStop) || (!cameraOpen && !inPage);
  const status =
    phase.kind === "converting"
      ? `Converting your video… ${Math.round(phase.progress * 100)}%`
      : phase.kind === "processing" || phase.kind === "done"
        ? "Preparing your clip…"
        : preparing
          ? "Preparing your photos…"
          : null;
  const lastPhoto = photos.at(-1);

  return (
    <div role="dialog" aria-label="Camera" className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* Full screen covers the page's banner, and everything simulated stays labeled (§6.1.1). */}
      <div className="relative z-10">
        <DemoBanner />
      </div>
      <video
        ref={videoRef}
        playsInline
        muted
        className={`absolute inset-0 h-full w-full object-cover ${recorder.showCamera ? "" : "invisible"}`}
      />

      {/* Top bar */}
      <div className="relative flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          disabled={recording}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-2xl disabled:opacity-40"
        >
          ✕
        </button>
        {recording ? (
          <p aria-live="polite" className="rounded-full bg-black/50 px-3 py-1 text-sm font-semibold tabular-nums">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-500" />
            {recorder.secondsLeft}s left
          </p>
        ) : (
          mode === "photos" && (
            <p className="rounded-full bg-black/50 px-3 py-1 text-sm font-semibold tabular-nums">
              {photos.length}/{MAX_PHOTOS}
            </p>
          )
        )}
      </div>
      {hints?.[mode] && !recording && (
        <p className="relative mx-4 rounded-lg bg-black/50 px-3 py-2 text-center text-sm">{hints[mode]}</p>
      )}

      {/* Middle: whatever isn't the live picture */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        {!inPage && <p>This browser can&apos;t open the camera here. Upload instead.</p>}
        {phase.kind === "idle" && inPage && <p className="text-white/70">Opening the camera…</p>}
        {phase.kind === "error" && (
          <p role="alert" className="rounded-lg bg-black/60 px-3 py-2">
            {phase.message}
          </p>
        )}
        {status && (
          <p aria-live="polite" className="rounded-lg bg-black/60 px-3 py-2">
            {status}
          </p>
        )}
        {note && (
          <p role="status" className="rounded-lg bg-black/60 px-3 py-2 text-sm">
            {note}
          </p>
        )}
      </div>

      {/* Photos taken so far, like the strip above an iPhone's shutter */}
      {mode === "photos" && photos.length > 0 && (
        <ul className="relative flex gap-2 overflow-x-auto px-4 pt-2 pb-3">
          {photos.map((photo, i) => (
            <li key={photo.url} className="relative shrink-0">
              {/* Local object URLs, so not next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={`Photo ${i + 1}`} className="h-16 w-12 rounded-md object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-xs"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Bottom: Upload · shutter · Next */}
      <div className="relative grid grid-cols-3 items-center px-6 pb-2">
        <div className="min-h-16 justify-self-start">
          {!recording && (
            <label
              className={`flex cursor-pointer flex-col items-center gap-1 text-xs font-semibold ${busy ? "pointer-events-none opacity-40" : ""}`}
            >
              <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border-2 border-white bg-white/20">
                {mode === "photos" && lastPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lastPhoto.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                )}
              </span>
              Upload
              {mode === "video" ? (
                // Called straight from the change handler, so an iPhone .mov converts inside the tap.
                <input
                  type="file"
                  accept="video/*"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => recorder.takeFile(e.target.files?.[0])}
                />
              ) : (
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  disabled={busy || full}
                  onChange={(e) => {
                    void uploadPhotos(e.target.files);
                    // Cleared so picking the same photos again still fires a change.
                    e.target.value = "";
                  }}
                />
              )}
            </label>
          )}
        </div>

        <button
          type="button"
          onClick={shutter}
          disabled={shutterDisabled}
          aria-label={shutterLabel}
          className="relative h-20 w-20 justify-self-center rounded-full disabled:opacity-40"
        >
          <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="40" cy="40" r={RING_RADIUS} fill="none" stroke="white" strokeOpacity={0.9} strokeWidth="5" />
            {recording && (
              <circle
                cx="40"
                cy="40"
                r={RING_RADIUS}
                fill="none"
                stroke="#FE2C55"
                strokeWidth="5"
                strokeDasharray={RING_LENGTH}
                strokeDashoffset={RING_LENGTH * (1 - recorder.elapsedMs / MAX_RECORD_MS)}
              />
            )}
          </svg>
          <span
            className={`absolute transition-all ${
              mode === "photos"
                ? "inset-[10px] rounded-full bg-white"
                : recording
                  ? "inset-[26px] rounded-md bg-[#FE2C55]"
                  : "inset-[10px] rounded-full bg-[#FE2C55]"
            }`}
          />
          {mode === "photos" && photos.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#FE2C55] px-1 text-xs font-bold">
              {photos.length}
            </span>
          )}
        </button>

        <div className="justify-self-end">
          {mode === "photos" && photos.length > 0 && !busy && (
            <button
              type="button"
              onClick={() => onPhotos(photos.map((p) => p.blob))}
              className="rounded-full bg-[#FE2C55] px-4 py-2 font-bold"
            >
              Next
            </button>
          )}
          {/* The phone's own camera app, when this browser can't record in the page. */}
          {mode === "video" && !inPage && !busy && (
            <label className="cursor-pointer rounded-full border border-white px-3 py-2 text-xs font-semibold">
              Camera app
              <input
                type="file"
                accept="video/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => recorder.takeFile(e.target.files?.[0])}
              />
            </label>
          )}
        </div>
      </div>

      {/* VIDEO · PHOTO. The row keeps its height while hidden, so the shutter doesn't jump. */}
      <div className="relative flex min-h-12 justify-center gap-6 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {modes.length > 1 &&
          !recording &&
          !busy &&
          modes.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`text-sm font-bold tracking-wide uppercase ${mode === m ? "text-white" : "text-white/50"}`}
            >
              {TAB_LABEL[m]}
            </button>
          ))}
      </div>
    </div>
  );
}

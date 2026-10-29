"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import VideoRecorder, { type RecordedClip } from "@/components/capture/VideoRecorder";
import { uploadAdminMedia } from "@/lib/adminUpload";
import { mutate, query } from "@/lib/data/api";
import { LIVE_STATUS_MS, useLive } from "@/lib/data/useLive";
import { normalizeMimeType } from "@/lib/media/mimeType";
import type { VideoIntake } from "@/server/db/schema";
import { MAX_CLIP_BYTES } from "@/server/lib/clipLimit";
import { errorMessage, useAdminSession } from "../useAdminSession";

type InputMode = "record" | "file";

export default function VideoIntakePage() {
  const [inputMode, setInputMode] = useState<InputMode>("record");
  const [passcode, setPasscode] = useState("");
  const session = useAdminSession();
  const [file, setFile] = useState<File | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [recorderSession, setRecorderSession] = useState(0);
  // The worker transcribes after the upload, so poll the entry until it's complete or failed.
  const entry = useLive<VideoIntake | null>(
    recordId && session.signedIn ? `intake:${recordId}` : null,
    (signal) => query("/api/admin/video-intake", { id: recordId }, { signal }),
    { intervalMs: LIVE_STATUS_MS },
  );

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await session.signIn(passcode);
      setPasscode("");
      setRecordId(null); // an entry from before the session expired isn't this sign-in's
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(false);
    }
  }

  async function uploadAndTranscribe(blob: Blob, fileName: string, rawContentType: string) {
    if (!session.signedIn) {
      setError("Sign in to use video intake.");
      return;
    }
    setWorking(true);
    setError(null);
    setRecordId(null);

    try {
      const contentType = normalizeMimeType(rawContentType);
      if (contentType !== "video/mp4" && contentType !== "video/webm") {
        throw new Error("Choose an MP4 or WebM video.");
      }
      if (blob.size === 0 || blob.size > MAX_CLIP_BYTES) {
        throw new Error("Choose a video larger than 0 bytes and no larger than 25 MB.");
      }

      const key = await uploadAdminMedia(blob.type === contentType ? blob : blob.slice(0, blob.size, contentType));
      // Saving queues the transcription; the entry below shows it finish.
      setRecordId(await mutate<string>("/api/admin/video-intake", { key, fileName, contentType, fileSize: blob.size }));
    } catch (cause) {
      session.handleError(cause);
      setError(errorMessage(cause));
    } finally {
      setWorking(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file) await uploadAndTranscribe(file, file.name, file.type);
  }

  function handleRecorded(clip: RecordedClip) {
    const contentType = normalizeMimeType(clip.mimeType);
    const extension = contentType === "video/mp4" ? "mp4" : "webm";
    void uploadAndTranscribe(clip.blob, `recorded-${Date.now()}.${extension}`, clip.mimeType);
  }

  function startOver() {
    setFile(null);
    setRecordId(null);
    setError(null);
    setRecorderSession((session) => session + 1);
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0] ?? null);
    setError(null);
    setRecordId(null);
  }

  if (!session.signedIn) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
        <header>
          <h1 className="text-2xl font-extrabold">Video intake test</h1>
          <p className="mt-2 text-sm text-[#4A5A6E]">Admin sign-in is required to upload or view test videos.</p>
        </header>
        <form onSubmit={signIn} className="flex flex-col gap-4 rounded-xl border border-[#D8DEE6] bg-white p-5">
          <label className="flex flex-col gap-2 text-sm font-semibold">
            Admin passcode
            <input
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(event) => setPasscode(event.currentTarget.value)}
              disabled={working}
              required
              className="rounded border px-3 py-2 font-normal"
            />
          </label>
          <button
            type="submit"
            disabled={!passcode || working}
            className="rounded-lg bg-[#157A47] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {(error ?? session.notice) && (
          <p role="alert" className="rounded-lg border border-[#F5C2C0] bg-[#FDECEC] p-4 text-sm text-[#8A1C1C]">
            {error ?? session.notice}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-extrabold">Video intake test</h1>
        <p className="mt-2 text-sm text-[#4A5A6E]">
          Record a clip or choose an MP4/WebM video up to 25 MB. MinIO stores it, then Gemini transcribes it.
        </p>
        <button
          type="button"
          onClick={() => {
            session.signOut();
            setRecordId(null);
            setFile(null);
          }}
          className="mt-3 rounded-lg border px-3 py-1 text-sm font-semibold"
        >
          Sign out
        </button>
      </header>

      <div className="flex gap-2" role="group" aria-label="Video input type">
        {(["record", "file"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setInputMode(mode)}
            disabled={working}
            aria-pressed={inputMode === mode}
            className="rounded-lg border px-4 py-2 font-semibold disabled:opacity-50"
          >
            {mode === "record" ? "Record video" : "Choose a file"}
          </button>
        ))}
      </div>

      {inputMode === "record" ? (
        <section className="flex flex-col gap-4 rounded-xl border border-[#D8DEE6] bg-white p-5">
          <VideoRecorder key={recorderSession} audio onDone={handleRecorded} />
          {working && <p role="status">Uploading and transcribing…</p>}
          {(recordId || error) && !working && (
            <button
              type="button"
              onClick={startOver}
              className="self-start rounded-lg border px-4 py-2 font-semibold"
            >
              Record another video
            </button>
          )}
        </section>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-[#D8DEE6] bg-white p-5">
          <label className="flex flex-col gap-2 text-sm font-semibold">
            Video file
            <input
              type="file"
              accept="video/mp4,video/webm"
              onChange={selectFile}
              disabled={working}
              className="text-sm font-normal"
            />
          </label>
          {file && <p className="text-sm text-[#4A5A6E]">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
          <button
            type="submit"
            disabled={!file || working}
            className="rounded-lg bg-[#157A47] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working ? "Uploading and transcribing…" : "Upload and transcribe"}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-[#F5C2C0] bg-[#FDECEC] p-4 text-sm text-[#8A1C1C]">
          {error}
        </p>
      )}

      {recordId && (
        <section aria-live="polite" className="flex flex-col gap-3 rounded-xl border border-[#D8DEE6] bg-white p-5">
          <h2 className="font-bold">Intake result</h2>
          <p className="text-sm">Status: {entry?.status ?? "saving"}</p>
          {entry?.transcript != null && <p className="whitespace-pre-wrap">{entry.transcript || "(No speech detected)"}</p>}
          {entry?.segments && entry.segments.length > 0 && (
            <ul className="flex flex-col gap-2 text-sm text-[#4A5A6E]">
              {entry.segments.map((segment, index) => (
                <li key={`${segment.start}-${index}`}>
                  {segment.start.toFixed(1)}s–{segment.end.toFixed(1)}s: {segment.text}
                </li>
              ))}
            </ul>
          )}
          {entry?.error && <p role="alert" className="text-sm text-[#8A1C1C]">{entry.error}</p>}
        </section>
      )}
    </main>
  );
}

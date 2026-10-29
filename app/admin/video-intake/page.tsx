"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import VideoRecorder, { type RecordedClip } from "@/components/capture/VideoRecorder";
import { MAX_CLIP_BYTES } from "@/server/lib/clipLimit";
import { normalizeMimeType } from "@/lib/media/mimeType";

type InputMode = "record" | "file";

export default function VideoIntakePage() {
  const [inputMode, setInputMode] = useState<InputMode>("record");
  const [passcode, setPasscode] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [recordId, setRecordId] = useState<Id<"videoIntake"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [recorderSession, setRecorderSession] = useState(0);
  const login = useAction(api.videoIntakeAuth.login);
  const generateUploadUrl = useMutation(api.videoIntake.generateUploadUrl);
  const saveUpload = useMutation(api.videoIntake.saveUpload);
  const transcribeVideo = useAction(api.videoIntake.transcribeVideo);
  const entry = useQuery(
    api.videoIntake.get,
    recordId && sessionToken ? { id: recordId, sessionToken } : "skip",
  );

  useEffect(() => {
    if (sessionExpiresAt === null) return;
    const timer = window.setTimeout(() => {
      setSessionToken(null);
      setSessionExpiresAt(null);
      setRecordId(null);
      setError("Admin session expired. Sign in again.");
    }, Math.max(0, sessionExpiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [sessionExpiresAt]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const session = await login({ passcode });
      setSessionToken(session.token);
      setSessionExpiresAt(session.expiresAt);
      setPasscode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  }

  async function uploadAndTranscribe(blob: Blob, fileName: string, rawContentType: string) {
    if (!sessionToken) {
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

      const uploadUrl = await generateUploadUrl({ sessionToken });
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: blob,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Convex upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`);
      }

      const { storageId } = (await uploadResponse.json()) as { storageId: Id<"_storage"> };
      const id = await saveUpload({
        storageId,
        sessionToken,
        fileName,
        contentType,
        fileSize: blob.size,
      });
      setRecordId(id);
      await transcribeVideo({ id, sessionToken });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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

  if (!sessionToken) {
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
        {error && (
          <p role="alert" className="rounded-lg border border-[#F5C2C0] bg-[#FDECEC] p-4 text-sm text-[#8A1C1C]">
            {error}
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
          Record a clip or choose an MP4/WebM video up to 25 MB. Convex stores it, then Gemini transcribes it.
        </p>
        <button
          type="button"
          onClick={() => {
            setSessionToken(null);
            setSessionExpiresAt(null);
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
          <h2 className="font-bold">Convex intake result</h2>
          <p className="text-sm">Status: {entry?.status ?? "saving"}</p>
          {entry?.transcript !== undefined && <p className="whitespace-pre-wrap">{entry.transcript || "(No speech detected)"}</p>}
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

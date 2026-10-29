"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import CameraCapture from "@/components/capture/CameraCapture";
import { ApiError, mutate, query } from "@/lib/data/api";
import { LIVE_STATUS_MS, useLive } from "@/lib/data/useLive";
import { useT, type TFunction } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";
import { MAX_CLIP_BYTES } from "@/server/lib/clipLimit";
import type { OwnerReport } from "@/server/lib/publicReport";
import { MAX_SCREENING_RETRIES, SCREENING_FAILED_REASON } from "@/server/lib/screening";
import { useResidentToken } from "@/lib/hooks/useResidentToken";
import { uploadMedia } from "@/lib/upload";

// "Checking…" (§4.2.1): the poster waits here, subscribed to their report, until screening
// moves it out of pending, then sees what happened: posted (maybe muted), retake, reject,
// Call 911, or "screening failed" with Try again. A retake or Try again puts the report back
// to pending, so this screen goes back to Checking… on its own. Retake and ScreeningFailed are
// exported for the Me page (US24): they render a layout-neutral <section>, and this screen
// supplies the page around them (Page).

// An error line is either one of our own messages (translated when shown) or text the server sent.
type UiError = { key: MessageKey } | { text: string };
const errorText = (error: UiError, t: TFunction) => ("key" in error ? t(error.key) : error.text);

const primary = "rounded-xl bg-[#173F35] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#245446] disabled:opacity-40";
const secondary = "rounded-xl border border-[#D8DDD2] bg-[#FFFEFA] px-4 py-3 font-semibold disabled:opacity-40";

export default function CheckingScreen({
  reportId,
  onPostAnother,
}: {
  reportId: string;
  onPostAnother: () => void;
}) {
  const t = useT();
  const token = useResidentToken();
  // Polled every ~2s (§1.1.1), so the verdict appears without a refresh.
  const report = useLive(
    token ? `my-report:${reportId}` : null,
    (signal) => query<OwnerReport | null>("/api/posts/mine", { reportId }, { signal }),
    { intervalMs: LIVE_STATUS_MS },
  );
  const postAnother = (
    <button onClick={onPostAnother} className={secondary}>
      {t("post.check.postAnother")}
    </button>
  );

  if (report === null) {
    return (
      <Page>
        <Panel title={t("post.check.notFoundTitle")}>
          <p className="text-[#4A5A6E]">{t("post.check.notFoundBody")}</p>
          {postAnother}
        </Panel>
      </Page>
    );
  }

  if (report === undefined || report.status === "pending") {
    return (
      <Page busy>
        <span className="h-10 w-10 animate-spin rounded-full border-4 border-[#D8DDD2] border-t-[#173F35]" />
        <h1 className="text-2xl font-extrabold">{t("post.check.checkingTitle")}</h1>
        <p className="text-[#4A5A6E]">{t("post.check.checkingBody")}</p>
      </Page>
    );
  }

  // Full screen on its own, over everything else on the page.
  if (report.status === "held" && report.verdict === "emergency") return <Emergency report={report} />;

  return <Page>{result(report, token, onPostAnother, postAnother, t)}</Page>;
}

function result(
  report: OwnerReport,
  token: string | null,
  onPostAnother: () => void,
  postAnother: ReactNode,
  t: TFunction,
) {
  if (report.status !== "held") return <Posted report={report}>{postAnother}</Posted>;
  // "Screening failed" carries no verdict (US13's markFailed clears it), so it's matched on the reason.
  if (report.reason === SCREENING_FAILED_REASON) {
    return <ScreeningFailed token={token} report={report} onPostAnother={onPostAnother} />;
  }
  if (report.verdict === "retake") return <Retake token={token} report={report} />;
  // reject, and any hold without a verdict this screen knows
  return (
    <Panel title={t("post.check.cantPostTitle")}>
      <p className="text-[#4A5A6E]">{report.reason ?? t("post.check.cantPostBody")}</p>
      {postAnother}
      <HoldDebug report={report} />
    </Panel>
  );
}

// Debugging aid through Oct 30 (§8): why the report is held, raw.
export function HoldDebug({ report, className = "text-[#4A5A6E]" }: { report: OwnerReport; className?: string }) {
  return (
    <p data-testid="hold-debug" className={`max-w-sm break-words font-mono text-xs ${className}`}>
      held: {report.verdict ?? "no verdict"} · {report.screeningError ?? report.reason ?? "no reason"}
    </p>
  );
}

function Posted({ report, children }: { report: OwnerReport; children: ReactNode }) {
  const t = useT();
  return (
    <Panel title={t("post.check.postedTitle")}>
      {report.title && (
        <p className="text-[#4A5A6E]">
          {report.title}
          {report.agency && ` · ${report.agency}`}
        </p>
      )}
      {report.audioMuted && (
        // §4.2.1 mute: plays muted, no captions, description hidden.
        <div role="note" className="rounded-lg border border-[#E8D9A8] bg-[#FBF5E1] p-4 text-left text-sm text-[#5C4A12]">
          <p className="font-bold">{t("post.check.mutedTitle")}</p>
          <p className="mt-1">
            {report.mediaType === "video" ? t("post.check.mutedVideo") : t("post.check.mutedPhotos")}
          </p>
          {report.reason && <p className="mt-1">{report.reason}</p>}
        </div>
      )}
      <Link href={`/?report=${report._id}`} className={primary}>
        {t("post.check.seeInFeed")}
      </Link>
      {children}
    </Panel>
  );
}

// Shown the moment the verdict arrives (§4.2.1), over everything else on the page.
function Emergency({ report }: { report: OwnerReport }) {
  const t = useT();
  return (
    <main
      role="alertdialog"
      aria-labelledby="emergency-title"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#B42318] p-6 text-center text-white"
    >
      <h1 id="emergency-title" className="text-3xl font-extrabold">
        {t("post.check.emergencyTitle")}
      </h1>
      {report.reason && <p className="text-lg">{report.reason}</p>}
      <a
        href="tel:911"
        className="w-full max-w-sm rounded-2xl bg-white py-5 text-2xl font-extrabold text-[#B42318] shadow-lg"
      >
        {t("post.check.call911")}
      </a>
      <p className="text-sm">{t("post.check.emergencyNote")}</p>
      <Link href="/" className="text-sm font-semibold underline">
        {t("post.check.backToFeed")}
      </Link>
      <HoldDebug report={report} className="text-white/80" />
    </main>
  );
}

// Record again with the same media type; the new files replace the old ones on this report.
export function Retake({ token, report }: { token: string | null; report: OwnerReport }) {
  const t = useT();
  const [step, setStep] = useState<"reason" | "capture" | "sending">("reason");
  const [error, setError] = useState<UiError | null>(null);

  async function send(files: { clip?: Blob; frames: Blob[] }) {
    if (!token) return;
    if (files.clip && files.clip.size > MAX_CLIP_BYTES) {
      setError({ key: "post.clipTooBig" });
      setStep("reason");
      return;
    }
    setStep("sending");
    setError(null);
    try {
      const [clipStorageId, frameStorageIds] = await Promise.all([
        files.clip ? uploadMedia(files.clip) : undefined,
        Promise.all(files.frames.map((frame) => uploadMedia(frame))),
      ]);
      // On success the report is pending again and this screen turns back into Checking….
      await mutate("/api/retake", { reportId: report._id, mediaType: report.mediaType, clipStorageId, frameStorageIds });
    } catch (err) {
      // Back to the reason, where the error shows (the camera covers the screen), with Retake again.
      setError(err instanceof ApiError && typeof err.data === "string" ? { text: err.data } : { key: "post.check.sendError" });
      setStep("reason");
    }
  }

  const isVideo = report.mediaType === "video";
  const errorLine = error && (
    <p role="alert" className="text-[#8A1C1C]">
      {errorText(error, t)}
    </p>
  );

  if (step === "sending") {
    return (
      <Panel title={t("post.check.sendingRetake")}>
        <p className="text-[#4A5A6E]">{t("post.check.sendingBody")}</p>
      </Panel>
    );
  }

  // The same full-screen camera as a new post, in the post's own format only (§4.2.1).
  if (step === "capture") {
    return (
      <section>
        <CameraCapture
          modes={[report.mediaType]}
          hints={report.reason ? { [report.mediaType]: report.reason } : undefined}
          onVideo={(clip) => send({ clip: clip.blob, frames: clip.frames })}
          onPhotos={(photos) => send({ frames: photos })}
          onClose={() => setStep("reason")}
        />
      </section>
    );
  }

  // No Post another: a second post would leave this one held instead of replacing its clip (§4.2.1).
  return (
    <Panel title={isVideo ? t("post.check.retakeVideoTitle") : t("post.check.retakePhotosTitle")}>
      <p className="text-[#4A5A6E]">{report.reason ?? t("post.check.retakeBody")}</p>
      {errorLine}
      <button
        onClick={() => {
          setError(null);
          setStep("capture");
        }}
        disabled={!token}
        className={primary}
      >
        {t("post.check.retake")}
      </button>
      <HoldDebug report={report} />
    </Panel>
  );
}

// Try again re-runs screening on the same files, up to MAX_SCREENING_RETRIES times. After that
// the poster can only start a new post (the held one is purged after 7 days, §7.1.1).
export function ScreeningFailed({
  token,
  report,
  onPostAnother,
}: {
  token: string | null;
  report: OwnerReport;
  /** Omit where there's no posting flow to restart (e.g. the Me page). */
  onPostAnother?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const outOfRetries = (report.screeningRetries ?? 0) >= MAX_SCREENING_RETRIES;

  async function tryAgain() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await mutate("/api/retake/retry", { reportId: report._id });
    } catch (err) {
      setError(err instanceof ApiError && typeof err.data === "string" ? { text: err.data } : { key: "post.check.retryError" });
    } finally {
      setBusy(false);
    }
  }

  if (outOfRetries) {
    return (
      <Panel title={t("post.check.outOfRetriesTitle")}>
        <p className="text-[#4A5A6E]">{t("post.check.outOfRetriesBody")}</p>
        {onPostAnother && (
          <button onClick={onPostAnother} className={secondary}>
            {t("post.check.postAnother")}
          </button>
        )}
        <HoldDebug report={report} />
      </Panel>
    );
  }

  return (
    <Panel title={t("post.check.failedTitle")}>
      <p className="text-[#4A5A6E]">{t("post.check.failedBody")}</p>
      {error && (
        <p role="alert" className="text-[#8A1C1C]">
          {errorText(error, t)}
        </p>
      )}
      <button onClick={tryAgain} disabled={!token || busy} className={primary}>
        {busy ? t("post.check.starting") : t("post.check.tryAgain")}
      </button>
      <HoldDebug report={report} />
    </Panel>
  );
}

// One result, without page padding, so the Me page can place it in its own layout.
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex w-full flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function Page({ busy, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <main className="flex flex-col items-center gap-4 p-6 pt-16 text-center" aria-busy={busy || undefined}>
      {children}
    </main>
  );
}

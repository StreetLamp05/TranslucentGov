"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import VideoRecorder, { type RecordedClip } from "@/components/capture/VideoRecorder";
import { MAX_CLIP_BYTES } from "@/server/lib/clipLimit";
import { tooFarMessage } from "@/server/lib/fixRules";
import { haversineMeters, NEARBY_METERS } from "@/server/lib/geo";
import { CLIP_TOO_BIG } from "@/server/lib/postLimits";
import type { PublicReport } from "@/server/lib/publicReport";
import { ApiError, mutate, query } from "@/lib/data/api";
import { LIVE_STATUS_MS, useLive } from "@/lib/data/useLive";
import { useCurrentLocation, type LocationState } from "@/lib/hooks/useCurrentLocation";
import { uploadProof } from "./uploadProof";

// Proof-of-fix capture (§4.3.1, §5.3.1), for a fixer (/fix/[reportId]) and for a neighbor
// confirming a report the city doesn't own (/confirm/[reportId], §4.3.2): the 50 m geofence,
// a silent clip, then Checking… until Claude's verdict. Demo mode's "Upload clip" comes with
// VideoRecorder (§6.1.1).

// Who is submitting. The tokens themselves ride on the identity headers lib/data/api.ts sends;
// this only picks which one the server should check.
export type FixAuth = { fixerToken: string } | { residentToken: string };
const authKind = (auth: FixAuth) => ("fixerToken" in auth ? "fixer" : "resident") as "fixer" | "resident";

type Props = {
  /** Live from the page's subscription, so a fix by someone else shows up here. */
  report: Pick<PublicReport, "_id" | "lat" | "lng" | "status">;
  auth: FixAuth;
  /** The first Record fix tap, so the page can keep this screen up once the report turns fixed. */
  onStart?: () => void;
};

type Step =
  | { kind: "ready"; error?: string }
  | { kind: "recording" }
  | { kind: "sending" }
  | { kind: "checking"; attemptId: string };

// How often to ask for a new GPS fix while the capture screen is up.
const RECHECK_MS = 5000;
const ALREADY_FIXED = "This report was already marked fixed.";
const SEND_ERROR = "We couldn't send your clip. Check your connection and try again.";
const LOCATION_LOST = "We lost your location. Try again once it's back.";

// Verdicts that send you back to record again, with Claude's reason (§4.3.1) or US22's FAILED_REASON.
const RETRY_TITLE = { not_fixed: "Not fixed yet", retake: "Try another take", failed: "We couldn't check this clip" };

type FixAttemptView = {
  reportId: string;
  status: "checking" | "verified" | "not_fixed" | "retake" | "failed" | "superseded";
  reason?: string;
};

const button = "w-full rounded-xl bg-[#0F1E33] py-3 font-bold text-white disabled:opacity-40";

export default function FixCapture({ report, auth, onStart }: Props) {
  const location = useCurrentLocation();
  const as = authKind(auth);
  const [step, setStep] = useState<Step>({ kind: "ready" });
  const recorderRef = useRef<HTMLElement>(null);

  const meters = location.status === "ready" ? haversineMeters(location.point, report) : null;
  const inRange = meters !== null && meters <= NEARBY_METERS;
  const { refresh } = location;

  // Keep the position fresh while you can record, so Record fix enables as you walk up and the
  // clip is sent with where it was filmed, not where the page was opened.
  const live = step.kind === "ready" || step.kind === "recording";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refresh, RECHECK_MS);
    return () => clearInterval(timer);
  }, [live, refresh]);

  // The camera opens below the original clip, so bring it on screen.
  useEffect(() => {
    if (step.kind === "recording") recorderRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [step.kind]);

  function record() {
    onStart?.();
    setStep({ kind: "recording" });
  }

  // Sent with the latest position, checked here before the upload and again on the server.
  async function send(clip: RecordedClip) {
    if (location.status !== "ready") return setStep({ kind: "ready", error: LOCATION_LOST });
    const distance = haversineMeters(location.point, report);
    if (distance > NEARBY_METERS) return setStep({ kind: "ready", error: `${tooFarMessage(distance, NEARBY_METERS)}.` });
    if (clip.blob.size > MAX_CLIP_BYTES) return setStep({ kind: "ready", error: CLIP_TOO_BIG });
    const { lat, lng } = location.point;
    setStep({ kind: "sending" });
    try {
      const [clipStorageId, frameStorageIds] = await Promise.all([
        uploadProof(clip.blob, as, "video"),
        Promise.all(clip.frames.map((frame) => uploadProof(frame, as, "image"))),
      ]);
      const attemptId = await mutate<string>("/api/fixes", {
        as,
        reportId: report._id,
        clipStorageId,
        frameStorageIds,
        lat,
        lng,
      });
      setStep({ kind: "checking", attemptId });
    } catch (err) {
      setStep({ kind: "ready", error: err instanceof ApiError && typeof err.data === "string" ? err.data : SEND_ERROR });
    }
  }

  const retry = () => setStep({ kind: "ready" });

  // Another fixer or neighbor closed the report first: no point filming (or finishing) a clip
  // the server would refuse. After you send, the verdict screen takes over instead.
  if (live && report.status !== "open") {
    return (
      <Result title={ALREADY_FIXED}>
        <FeedLink reportId={report._id} />
      </Result>
    );
  }
  if (step.kind === "checking") {
    return <AttemptResult attemptId={step.attemptId} as={as} reportId={report._id} onRetry={retry} />;
  }
  if (step.kind === "sending") {
    return <Checking text="Sending your clip…" />;
  }
  if (step.kind === "recording") {
    return (
      <section ref={recorderRef} className="mt-6 flex flex-col gap-3">
        <p className="text-sm text-[#46505C]">
          Film the spot from where the original was taken. No sound is recorded.
        </p>
        <VideoRecorder audio={false} autoOpen onDone={send} />
        <button type="button" onClick={retry} className="text-sm font-semibold text-[#46505C]">
          Cancel
        </button>
      </section>
    );
  }

  return (
    <section className="mt-6 flex flex-col gap-2">
      {location.status === "ready" ? (
        <>
          <button type="button" onClick={record} disabled={!inRange} className={button}>
            Record fix
          </button>
          {!inRange && meters !== null && (
            <p className="text-center text-sm text-[#46505C]">{tooFarMessage(meters, NEARBY_METERS)}</p>
          )}
        </>
      ) : (
        <LocationProblem location={location} />
      )}
      {step.error && (
        <p role="alert" className="text-center text-sm font-semibold text-[#B42318]">
          {step.error}
        </p>
      )}
    </section>
  );
}

function LocationProblem({ location }: { location: LocationState & { refresh: () => void } }) {
  if (location.status === "loading") return <p className="text-center text-sm text-[#46505C]">Finding your location…</p>;
  return (
    <div role="alert" className="rounded-xl border border-[#F5C2C0] bg-[#FDECEC] p-4 text-sm text-[#8A1C1C]">
      <p className="font-bold">
        {location.status === "denied" ? "Location is turned off for GovTok" : "We couldn't find your location"}
      </p>
      <p className="mt-1">A fix has to be filmed within {NEARBY_METERS} m of the report.</p>
      <button
        type="button"
        onClick={location.refresh}
        className="mt-3 rounded-lg bg-[#0F1E33] px-4 py-2 font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}

// Checking… until verifyFix (the worker job) settles the attempt, then its verdict.
function AttemptResult({
  attemptId,
  as,
  reportId,
  onRetry,
}: {
  attemptId: string;
  as: "fixer" | "resident";
  reportId: string;
  onRetry: () => void;
}) {
  // Polled until the worker settles the attempt, so the verdict shows without a refresh.
  const attempt = useLive(
    `fix-attempt:${attemptId}`,
    (signal) => query<FixAttemptView | null>("/api/fixes/attempt", { attemptId, as }, { signal }),
    { intervalMs: LIVE_STATUS_MS },
  );
  const feedLink = <FeedLink reportId={reportId} />;
  const tryAgain = (
    <button type="button" onClick={onRetry} className={button}>
      Try again
    </button>
  );

  if (attempt === undefined || attempt?.status === "checking") {
    return <Checking text="Comparing your clip with the original. This takes a few seconds." />;
  }
  if (attempt === null) return <Result title="We couldn't find this fix">{tryAgain}</Result>;

  switch (attempt.status) {
    case "verified":
      return (
        <Result title="Fix verified">
          <p className="text-sm text-[#46505C]">Your clip matches the original. The report is now fixed.</p>
          {feedLink}
        </Result>
      );
    // No reason is stored for this one (US22): another fix closed the report first.
    case "superseded":
      return <Result title={ALREADY_FIXED}>{feedLink}</Result>;
    default:
      return (
        <Result title={RETRY_TITLE[attempt.status]}>
          {attempt.reason && <p className="text-sm text-[#46505C]">{attempt.reason}</p>}
          {tryAgain}
        </Result>
      );
  }
}

function FeedLink({ reportId }: { reportId: string }) {
  return (
    <Link href={`/?report=${reportId}`} className={`${button} block text-center`}>
      See it in the feed
    </Link>
  );
}

function Checking({ text }: { text: string }) {
  return (
    <section className="mt-6 flex flex-col items-center gap-3 text-center" aria-busy="true">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-[#CBD5E1] border-t-[#0F1E33]" />
      <h2 className="text-xl font-extrabold">Checking…</h2>
      <p className="text-sm text-[#46505C]">{text}</p>
    </section>
  );
}

function Result({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 flex flex-col gap-3 text-center">
      <h2 className="text-xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CameraCapture from "@/components/capture/CameraCapture";
import LocationPicker from "@/components/map/LocationPicker";
import NearbyCheck from "@/components/post/NearbyCheck";
import { ApiError, mutate, query } from "@/lib/data/api";
import { LIVE_LIST_MS, useLive } from "@/lib/data/useLive";
import { ACTIVE_CITY } from "@/server/lib/city";
import type { NearbySuggestion } from "@/server/nearby";
import { MAX_CLIP_BYTES } from "@/server/lib/clipLimit";
import { CLIP_TOO_BIG, MAX_DESCRIPTION_LENGTH } from "@/server/lib/postLimits";
import type { LatLng } from "@/lib/demo";
import type { RecordedClip } from "@/lib/hooks/useClipRecorder";
import { useCurrentLocation, type LocationState } from "@/lib/hooks/useCurrentLocation";
import { useResidentToken } from "@/lib/hooks/useResidentToken";
import { uploadMedia } from "@/lib/upload";
import CheckingScreen from "./CheckingScreen";

// Posting (§4.1.1): location → full-screen camera (video or photos) → preview + optional description → Submit → Checking….
// Each file is uploaded to MinIO, then createReport saves the report as pending.

// What's being posted, with object URLs for the preview and the location it was captured at.
type Draft =
  | { kind: "video"; clip: RecordedClip; clipUrl: string; posterUrl?: string; point: LatLng | null }
  | { kind: "photos"; photos: Blob[]; photoUrls: string[]; point: LatLng | null };
type Mode = Draft["kind"];

const SUBMIT_ERROR = "We couldn't send your post. Check your connection and try again.";
const HINTS = {
  video: "Film the problem for up to 20 seconds. Say what's wrong if you like. Posts use your current location unless you choose a pin first.",
  photos: "Up to 10 photos. Posts use your current location unless you choose a pin first.",
};

export default function PostFlow() {
  const router = useRouter();
  const location = useCurrentLocation();
  const residentToken = useResidentToken();
  const [mode, setMode] = useState<Mode>("video");
  const [selectedPoint, setSelectedPoint] = useState<LatLng | null>(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const nearbyReports = useLive(
    locationConfirmed && selectedPoint && residentToken ? `nearby:${selectedPoint.lat},${selectedPoint.lng}` : null,
    (signal) =>
      query<NearbySuggestion[]>("/api/nearby", { lat: selectedPoint?.lat, lng: selectedPoint?.lng }, { signal }),
    { intervalMs: LIVE_LIST_MS },
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [continueToCapture, setContinueToCapture] = useState(false);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  // Revoke the preview URLs when the draft is replaced or the page unmounts.
  useEffect(() => {
    if (!draft) return;
    return () => {
      if (draft.kind === "photos") return draft.photoUrls.forEach((url) => URL.revokeObjectURL(url));
      URL.revokeObjectURL(draft.clipUrl);
      if (draft.posterUrl) URL.revokeObjectURL(draft.posterUrl);
    };
  }, [draft]);

  // Back to the recorder or photo picker, keeping the description.
  function recordAgain() {
    setDraft(null);
    setError(null);
  }

  function startOver() {
    recordAgain();
    setDescription("");
    setReportId(null);
    setContinueToCapture(false);
  }

  function captured(clip: RecordedClip) {
    // So Record again comes back to the same mode.
    setMode("video");
    setDraft({
      kind: "video",
      clip,
      clipUrl: URL.createObjectURL(clip.blob),
      posterUrl: clip.frames[0] ? URL.createObjectURL(clip.frames[0]) : undefined,
      point: selectedPoint,
    });
  }

  function picked(photos: Blob[]) {
    setMode("photos");
    setDraft({
      kind: "photos",
      photos,
      photoUrls: photos.map((photo) => URL.createObjectURL(photo)),
      point: selectedPoint,
    });
  }

  const point = draft?.point ?? selectedPoint;

  async function submit() {
    if (!draft || submitting || !point) return;
    // Uploads over 25 MB are converted first (convertClip), so this is a backstop: it fails fast
    // instead of after a long upload.
    if (draft.kind === "video" && draft.clip.blob.size > MAX_CLIP_BYTES) {
      setError(CLIP_TOO_BIG);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { lat, lng } = point;
      const report = { description: description.trim() || undefined, lat, lng };
      let id: string;
      if (draft.kind === "photos") {
        // A slideshow's photos go where a video's frames would (§2.1.1), and there's no clip.
        const frameStorageIds = await Promise.all(draft.photos.map((photo) => uploadMedia(photo)));
        id = await mutate<string>("/api/posts", { ...report, mediaType: "photos", frameStorageIds });
      } else {
        const [clipStorageId, frameStorageIds] = await Promise.all([
          uploadMedia(draft.clip.blob),
          Promise.all(draft.clip.frames.map((frame) => uploadMedia(frame))),
        ]);
        id = await mutate<string>("/api/posts", { ...report, mediaType: "video", clipStorageId, frameStorageIds });
      }
      setReportId(id);
    } catch (err) {
      setError(err instanceof ApiError && typeof err.data === "string" ? err.data : SUBMIT_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  if (reportId) return <CheckingScreen reportId={reportId} onPostAnother={startOver} />;

  if (!draft) {
    if (!locationConfirmed) {
      if (choosingLocation) {
        return (
          <LocationPicker
            initialPoint={selectedPoint ?? (location.status === "ready" ? location.point : ACTIVE_CITY.center)}
            onConfirm={(point) => {
              setSelectedPoint(point);
              setLocationConfirmed(true);
              setChoosingLocation(false);
            }}
            onCancel={() => setChoosingLocation(false)}
          />
        );
      }
      return (
        <LocationGate
          location={location}
          onUseCurrent={() => {
            if (location.status !== "ready") return;
            setSelectedPoint(location.point);
            setLocationConfirmed(true);
          }}
          onChooseMap={() => setChoosingLocation(true)}
        />
      );
    }
    if (!residentToken || nearbyReports === undefined) {
      return (
        <main className="flex flex-col gap-4 p-6" aria-busy="true">
          <h1 className="text-2xl font-extrabold">Post a problem</h1>
          <p className="text-[#68756F]">Checking for nearby reports…</p>
        </main>
      );
    }
    if (nearbyReports.length > 0 && !continueToCapture) {
      return (
        <NearbyCheck
          reports={nearbyReports}
          now={now}
          onContinue={() => setContinueToCapture(true)}
        />
      );
    }
    return (
      <CameraCapture
        modes={["video", "photos"]}
        initialMode={mode}
        hints={HINTS}
        onVideo={captured}
        onPhotos={picked}
        onClose={() => router.push("/")}
      />
    );
  }

  return (
    <main className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">Check your post</h1>
      {draft.kind === "video" ? (
        <video
          src={draft.clipUrl}
          poster={draft.posterUrl}
          controls
          playsInline
          className="mx-auto aspect-[9/16] w-full max-w-sm rounded-lg bg-black object-contain"
        />
      ) : (
        // Swipes sideways through the photos, the way the feed shows a slideshow (§5.1.1).
        <div className="mx-auto flex aspect-[9/16] w-full max-w-sm snap-x snap-mandatory overflow-x-auto rounded-lg bg-black">
          {draft.photoUrls.map((url, i) => (
            // Local object URLs, so not next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={`Photo ${i + 1} of ${draft.photoUrls.length}`}
              className="h-full w-full shrink-0 snap-center object-contain"
            />
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">
          Description <span className="font-normal text-[#68756F]">(optional)</span>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={MAX_DESCRIPTION_LENGTH}
          rows={3}
          disabled={submitting}
          placeholder="What's wrong, and how long has it been like this?"
          aria-describedby="description-count"
          className="rounded-xl border border-[#D8DDD2] bg-[#FFFEFA] p-3 focus-visible:outline-[#173F35]"
        />
        <span id="description-count" aria-live="polite" className="self-end text-sm text-[#68756F] tabular-nums">
          {description.length}/{MAX_DESCRIPTION_LENGTH}
        </span>
      </label>
      {error && (
        <p role="alert" className="text-[#8A1C1C]">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={recordAgain}
          disabled={submitting}
          className="flex-1 rounded-lg border px-4 py-3 font-semibold disabled:opacity-40"
        >
          {draft.kind === "video" ? "Record again" : "Pick again"}
        </button>
        <button
          onClick={submit}
          disabled={submitting || !point}
          className="flex-1 rounded-xl bg-[#173F35] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#245446] disabled:opacity-40"
        >
          {submitting ? "Sending…" : "Submit"}
        </button>
      </div>
    </main>
  );
}

// GPS is the default report pin, but a manually selected map point also works without GPS (§4.1.1).
function LocationGate({
  location,
  onUseCurrent,
  onChooseMap,
}: {
  location: LocationState & { refresh: () => void };
  onUseCurrent: () => void;
  onChooseMap: () => void;
}) {
  return (
    <main className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">Post a problem</h1>
      {location.status === "ready" ? (
        <>
          <p className="text-sm text-[#68756F]">
            Using your {location.simulated ? "simulated demo location" : "current location"}:{" "}
            {location.point.lat.toFixed(5)}, {location.point.lng.toFixed(5)}
          </p>
          <button
            type="button"
            onClick={onUseCurrent}
            className="rounded-xl bg-[#173F35] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#245446]"
          >
            Use this location
          </button>
        </>
      ) : (
        <div role="status" className="rounded-2xl border border-[#E7E6DE] bg-[#FFFEFA] p-4 text-sm text-[#68756F]">
          {location.status === "loading"
            ? "Finding your location… You can also choose a pin on the map."
            : `Can't use GPS (${location.status === "denied" ? "permission denied" : "location unavailable"}). Choose a pin on the map instead.`}
          <button
            type="button"
            onClick={location.refresh}
            className="mt-3 block rounded-lg border px-4 py-2 font-semibold"
          >
            Try GPS again
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onChooseMap}
        className="rounded-xl border border-[#BFC9B7] bg-[#FFFEFA] px-4 py-3 font-semibold text-[#245446] transition-colors hover:bg-[#F1F3E9]"
      >
        Choose location on map
      </button>
    </main>
  );
}

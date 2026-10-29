"use client";

import { MarkerClusterer, type Marker } from "@googlemaps/markerclusterer";
import { AdvancedMarker, APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapReport } from "../../convex/map";
import { ACTIVE_CITY } from "../../server/lib/city";
import { DEMO_POINT, type LatLng } from "../../lib/demo";
import { useCurrentLocation } from "../../lib/hooks/useCurrentLocation";
import { useDemoMode } from "../../lib/hooks/useDemoMode";
import { bubbleStyle } from "./bubble";
import { reportClusterRenderer } from "./clusterRenderer";
import { markerCount, STATUS_COLOR } from "./counts";

// Google Maps with clustered report markers (§1.1.2, §5.2.1). Centered on the active city
// (server/lib/city.ts), or on DEMO_POINT in demo mode (§6.1.1), which sits by the seeds.
export const CITY_CENTER: LatLng = ACTIVE_CITY.center;
const CITY_ZOOM = 13;
// Past the clusterer's max zoom (16), so a focused report always shows on its own.
const FOCUS_ZOOM = 17;

type Props = {
  reports: MapReport[];
  // From /map?report=<id>: centered on and highlighted.
  focusId: string | null;
  onOpen: (id: MapReport["_id"]) => void;
};

export default function ReportsMap(props: Props) {
  const home = useDemoMode() ? DEMO_POINT : CITY_CENTER;
  // Read here, not at module load, so Next inlines them and tests can stub them.
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  // Advanced Markers need a Map ID.
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;

  if (!apiKey || !mapId) {
    return (
      <div className="flex h-full items-center justify-center bg-[#EDF0EA] p-6 text-center text-sm font-semibold text-[#4A5A6E]">
        The map isn&apos;t configured: NEXT_PUBLIC_GOOGLE_MAPS_KEY and NEXT_PUBLIC_GOOGLE_MAP_ID must be set.
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <GoogleMap
        mapId={mapId}
        defaultCenter={home}
        defaultZoom={CITY_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        className="h-full w-full"
      >
        <ClusteredMarkers {...props} home={home} />
        <YouDot />
      </GoogleMap>
    </APIProvider>
  );
}

type MarkerRefs = Record<string, google.maps.marker.AdvancedMarkerElement>;

// The renderer reads each clustered marker's report from here. Weak, so unmounted markers
// drop out on their own.
const reportOfMarker = new WeakMap<Marker, MapReport>();
const renderer = reportClusterRenderer((marker) => reportOfMarker.get(marker));

function ClusteredMarkers({ reports, focusId, onOpen, home }: Props & { home: LatLng }) {
  const map = useMap();
  const [markers, setMarkers] = useState<MarkerRefs>({});

  // Built detached and attached in an effect, so StrictMode's mount, unmount, remount in
  // dev reattaches it instead of leaving it off the map.
  const clusterer = useMemo(() => (map ? new MarkerClusterer({ renderer }) : null), [map]);
  useEffect(() => {
    if (!clusterer || !map) return;
    clusterer.setMap(map);
    return () => clusterer.setMap(null);
  }, [clusterer, map]);

  // Re-cluster on every change, including live me-too counts, which change cluster labels
  // without changing any marker. The focused report stays out of clusters.
  useEffect(() => {
    if (!clusterer || !map) return;
    const byId = new Map(reports.map((r) => [r._id as string, r]));
    const clustered: Marker[] = [];
    let focused: google.maps.marker.AdvancedMarkerElement | null = null;
    for (const [id, marker] of Object.entries(markers)) {
      const report = byId.get(id);
      if (!report) continue;
      reportOfMarker.set(marker, report);
      if (id === focusId) focused = marker;
      else clustered.push(marker);
    }
    // Not clearMarkers(true): the clusterer only redraws when its marker list changes, so
    // re-adding the same markers alone would leave stale labels and colors. Clearing with
    // a draw forces the redraw; both happen before the browser paints.
    clusterer.clearMarkers();
    clusterer.addMarkers(clustered);
    // clearMarkers takes markers off the map, so put the focused one back.
    if (focused) focused.map = map;
  }, [clusterer, map, markers, reports, focusId]);

  const focusReport = focusId ? reports.find((r) => r._id === focusId) : undefined;
  useCamera(map, focusId, focusReport, home);

  const setMarkerRef = useCallback((marker: google.maps.marker.AdvancedMarkerElement | null, id: string) => {
    setMarkers((prev) => {
      if (marker ? prev[id] === marker : !(id in prev)) return prev;
      const next = { ...prev };
      if (marker) next[id] = marker;
      else delete next[id];
      return next;
    });
  }, []);

  return reports.map((report) => (
    <ReportMarker
      key={report._id}
      report={report}
      highlighted={report._id === focusId}
      onOpen={onOpen}
      setMarkerRef={setMarkerRef}
    />
  ));
}

// Centers once per target, so live updates and filter taps don't yank the map back while
// panning. The target is the focused report, else home. Home can change once after
// hydration, when demo mode turns on.
function useCamera(map: google.maps.Map | null, focusId: string | null, report: MapReport | undefined, home: LatLng) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!map) return;
    if (focusId) {
      if (!report || done.current === focusId) return;
      done.current = focusId;
      map.setCenter({ lat: report.lat, lng: report.lng });
      map.setZoom(FOCUS_ZOOM);
      return;
    }
    const key = `${home.lat},${home.lng}`;
    if (done.current === key) return;
    done.current = key;
    // Also resets the zoom, e.g. from /map?report=<id> back to the plain Map tab.
    map.setCenter(home);
    map.setZoom(CITY_ZOOM);
  }, [map, focusId, report, home]);
}

function ReportMarker({
  report,
  highlighted,
  onOpen,
  setMarkerRef,
}: {
  report: MapReport;
  highlighted: boolean;
  onOpen: Props["onOpen"];
  setMarkerRef: (marker: google.maps.marker.AdvancedMarkerElement | null, id: string) => void;
}) {
  // A stable ref callback; a new one each render would re-register the marker forever.
  const ref = useCallback(
    (marker: google.maps.marker.AdvancedMarkerElement | null) => setMarkerRef(marker, report._id),
    [setMarkerRef, report._id],
  );
  const position = useMemo(() => ({ lat: report.lat, lng: report.lng }), [report.lat, report.lng]);
  const count = markerCount(report);
  const people = count === 1 ? "1 person" : `${count} people`;

  return (
    <AdvancedMarker
      ref={ref}
      position={position}
      title={`${report.isSample ? "Sample. " : ""}${report.title ?? "Report"}. ${report.status === "fixed" ? "Fixed. " : ""}${people} reported this.`}
      onClick={() => onOpen(report._id)}
      anchorLeft="-50%"
      anchorTop="-50%"
      zIndex={highlighted ? 3000 : undefined}
    >
      <div style={bubbleStyle(count, STATUS_COLOR[report.status], highlighted)}>{count}</div>
    </AdvancedMarker>
  );
}

// The phone's position, or DEMO_POINT in demo mode (§6.1.1), as in the mockup. Never
// clustered. The Map tab never prompts for location: a "deny" here would be remembered
// and block posting, which needs GPS (§4.1.2). So the dot shows only in demo mode or once
// location is already allowed, e.g. after a post.
function YouDot() {
  const granted = useLocationAlreadyGranted();
  return useDemoMode() || granted ? <LocatedDot /> : null;
}

// False until the Permissions API says geolocation is granted; also false where the API
// is missing. Never triggers a prompt.
function useLocationAlreadyGranted(): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let live = true;
    const update = () => setGranted(status?.state === "granted");
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((s) => {
        if (!live) return;
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => {});
    return () => {
      live = false;
      status?.removeEventListener("change", update);
    };
  }, []);
  return granted;
}

// Nothing shows until a location arrives (denied or unavailable: none).
function LocatedDot() {
  const location = useCurrentLocation();
  if (location.status !== "ready") return null;
  return (
    <AdvancedMarker
      position={location.point}
      title={location.simulated ? "Your simulated location" : "You are here"}
      anchorLeft="-50%"
      anchorTop="-50%"
      zIndex={2500}
    >
      <div className="h-4 w-4 rounded-full border-[3px] border-white bg-[#2563EB] shadow-[0_0_0_7px_rgba(37,99,235,.2)]" />
    </AdvancedMarker>
  );
}

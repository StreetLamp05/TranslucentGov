// @vitest-environment jsdom
import type { Marker, Renderer } from "@googlemaps/markerclusterer";
import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, StrictMode, useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MapReport } from "../../../server/map";
import { DEMO_VALUE } from "../../../lib/demo";

// A fake map and clusterer that record what ReportsMap does with them. Markers are plain
// objects with a title and a `map`, like AdvancedMarkerElement.
const h = vi.hoisted(() => {
  type FakeMarker = { title: string; map: unknown };
  class FakeClusterer {
    static instances: FakeClusterer[] = [];
    renderer: Renderer;
    map: unknown = null;
    markers: FakeMarker[] = [];
    // The noDraw argument of each clearMarkers call.
    clears: (boolean | undefined)[] = [];
    constructor(opts: { renderer: Renderer; map?: unknown }) {
      this.renderer = opts.renderer;
      if (opts.map) this.map = opts.map;
      FakeClusterer.instances.push(this);
    }
    setMap(map: unknown) {
      this.map = map;
    }
    clearMarkers(noDraw?: boolean) {
      this.clears.push(noDraw);
      for (const m of this.markers) m.map = null;
      this.markers = [];
    }
    addMarkers(markers: FakeMarker[]) {
      this.markers.push(...markers);
    }
  }
  // Where US25 will move DEMO_POINT: next to the seeds, away from the town center.
  const seedsPoint = { lat: 33.8201, lng: -84.5902 };
  return { FakeClusterer, map: { setCenter: vi.fn(), setZoom: vi.fn() }, seedsPoint };
});
const SEEDS_POINT = h.seedsPoint;

vi.mock("@googlemaps/markerclusterer", () => ({ MarkerClusterer: h.FakeClusterer }));
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => children,
  Map: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMap: () => h.map,
  AdvancedMarker: function FakeAdvancedMarker({
    ref,
    title,
    children,
  }: {
    ref?: (marker: { title: string; map: unknown } | null) => void;
    title: string;
    children: ReactNode;
  }) {
    const [marker] = useState(() => ({ title, map: h.map as unknown }));
    useLayoutEffect(() => {
      ref?.(marker);
      return () => ref?.(null);
    }, [ref, marker]);
    return <div title={title}>{children}</div>;
  },
}));
vi.mock("../../../lib/demo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/demo")>()),
  DEMO_POINT: h.seedsPoint,
}));

const { default: ReportsMap, CITY_CENTER } = await import("../../../components/map/ReportsMap");

const report = (id: string, status: MapReport["status"], meTooCount: number, lat = 33.81, isSample = false) =>
  ({ _id: id, lat, lng: -84.58, status, meTooCount, title: id, category: "pothole", isSample }) as MapReport;

const REPORTS = [report("A", "open", 2, 33.811), report("B", "open", 0, 33.812), report("C", "fixed", 4, 33.813)];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAP_ID", "test-map-id");
  class FakeAdvancedMarkerElement {
    constructor(public options: google.maps.marker.AdvancedMarkerElementOptions) {}
  }
  vi.stubGlobal("google", { maps: { marker: { AdvancedMarkerElement: FakeAdvancedMarkerElement } } });
  h.FakeClusterer.instances = [];
  h.map.setCenter.mockReset();
  h.map.setZoom.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "geolocation");
  Reflect.deleteProperty(navigator, "permissions");
});

const attached = () => h.FakeClusterer.instances.filter((c) => c.map === h.map);
const titles = (markers: { title: string }[]) => markers.map((m) => m.title);
const clusterLabel = (c: InstanceType<typeof h.FakeClusterer>) => {
  const rendered = c.renderer.render(
    { markers: c.markers as unknown as Marker[], position: {} } as never,
    {} as never,
    {} as never,
  ) as unknown as { options: { content: HTMLElement } };
  return rendered.options.content.textContent;
};
const onOpen = () => {};

test("clusters every report but the focused one, labels clusters with the sum, and centers on the focus", () => {
  render(<ReportsMap reports={REPORTS} focusId="B" onOpen={onOpen} />);

  const [clusterer] = attached();
  expect(titles(clusterer.markers)).toEqual(["A. 3 people reported this.", "C. Fixed. 5 people reported this."]);
  // Read through the marker → report lookup, so a missing lookup shows up as 0.
  expect(clusterLabel(clusterer)).toBe("8");
  expect(h.map.setCenter).toHaveBeenLastCalledWith({ lat: 33.812, lng: -84.58 });
  expect(h.map.setZoom).toHaveBeenLastCalledWith(17);
});

test("a live me-too redraws the cluster label", () => {
  const { rerender } = render(<ReportsMap reports={REPORTS} focusId={null} onOpen={onOpen} />);
  const [clusterer] = attached();
  expect(clusterLabel(clusterer)).toBe("9");

  rerender(<ReportsMap reports={[report("A", "open", 5, 33.811), ...REPORTS.slice(1)]} focusId={null} onOpen={onOpen} />);

  expect(clusterLabel(clusterer)).toBe("12");
  // The clusterer only redraws when its marker list changes, so the clear must draw.
  expect(clusterer.clears.at(-1)).not.toBe(true);
});

test("StrictMode's remount leaves exactly one clusterer on the map, holding every marker", () => {
  render(
    <StrictMode>
      <ReportsMap reports={REPORTS} focusId={null} onOpen={onOpen} />
    </StrictMode>,
  );

  expect(attached()).toHaveLength(1);
  expect(attached()[0].markers).toHaveLength(3);
});

test("markers are colored by status and ringed when focused", () => {
  render(<ReportsMap reports={REPORTS} focusId="A" onOpen={onOpen} />);
  const bubble = (title: string) => screen.getByTitle(title).firstElementChild as HTMLElement;

  expect(bubble("A. 3 people reported this.").style.background).toBe("rgb(194, 65, 12)");
  expect(bubble("C. Fixed. 5 people reported this.").style.background).toBe("rgb(21, 122, 71)");
  expect(bubble("A. 3 people reported this.").style.boxShadow).toContain("6px");
  expect(bubble("B. 1 person reported this.").style.boxShadow).not.toContain("6px");
});

test("sample reports say so in their marker title", () => {
  render(<ReportsMap reports={[report("S", "open", 0, 33.81, true)]} focusId={null} onOpen={onOpen} />);

  expect(screen.getByTitle("Sample. S. 1 person reported this.")).toBeTruthy();
});

const getCurrentPosition = vi.fn((ok: PositionCallback) =>
  ok({ coords: { latitude: 33.8, longitude: -84.6, accuracy: 5 } } as GeolocationPosition),
);
function stubLocation(permission: PermissionState) {
  getCurrentPosition.mockClear();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: async () => ({ state: permission, addEventListener() {}, removeEventListener() {} }) },
  });
}

test("shows a 'you' dot, outside the clusters, once location is already allowed", async () => {
  stubLocation("granted");
  render(<ReportsMap reports={REPORTS} focusId={null} onOpen={onOpen} />);

  expect(await screen.findByTitle("You are here")).toBeTruthy();
  expect(titles(attached()[0].markers)).not.toContain("You are here");
});

test("never asks for location on the map, so a deny can't block posting", async () => {
  stubLocation("prompt");
  render(<ReportsMap reports={REPORTS} focusId={null} onOpen={onOpen} />);
  await act(async () => {});

  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.queryByTitle("You are here")).toBeNull();
});

test("no 'you' dot where the Permissions API is missing", async () => {
  render(<ReportsMap reports={REPORTS} focusId={null} onOpen={onOpen} />);
  await act(async () => {});

  expect(screen.queryByTitle("You are here")).toBeNull();
});

test("centers on the active city, not on DEMO_POINT, outside demo mode", () => {
  render(<ReportsMap reports={REPORTS} focusId={null} onOpen={onOpen} />);

  expect(h.map.setCenter).toHaveBeenLastCalledWith(CITY_CENTER);
  expect(h.map.setZoom).toHaveBeenLastCalledWith(13);
});

test("live updates to the focused report don't re-center the map", () => {
  const { rerender } = render(<ReportsMap reports={REPORTS} focusId="B" onOpen={onOpen} />);
  const centers = h.map.setCenter.mock.calls.length;

  rerender(<ReportsMap reports={[REPORTS[0], report("B", "open", 3, 33.812), REPORTS[2]]} focusId="B" onOpen={onOpen} />);

  expect(h.map.setCenter).toHaveBeenCalledTimes(centers);
});

test("leaving /map?report=<id> for the plain map returns to the city view", () => {
  const { rerender } = render(<ReportsMap reports={REPORTS} focusId="B" onOpen={onOpen} />);
  expect(h.map.setZoom).toHaveBeenLastCalledWith(17);

  rerender(<ReportsMap reports={REPORTS} focusId={null} onOpen={onOpen} />);

  expect(h.map.setCenter).toHaveBeenLastCalledWith(CITY_CENTER);
  expect(h.map.setZoom).toHaveBeenLastCalledWith(13);
});

// Last: demo mode sticks for the rest of the module once it's seen in the URL.
test("centers on DEMO_POINT in demo mode", () => {
  window.history.replaceState(null, "", `/map?demo=${DEMO_VALUE}`);
  render(<ReportsMap reports={REPORTS} focusId={null} onOpen={onOpen} />);

  expect(h.map.setCenter).toHaveBeenLastCalledWith(SEEDS_POINT);
  expect(screen.getByTitle("Your simulated location")).toBeTruthy();
});

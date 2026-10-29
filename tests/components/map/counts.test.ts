// @vitest-environment jsdom
import type { Cluster, Marker } from "@googlemaps/markerclusterer";
import { afterEach, expect, test, vi } from "vitest";
import { reportClusterRenderer } from "../../../components/map/clusterRenderer";
import { clusterColor, clusterCount, markerCount, MIXED_COLOR, STATUS_COLOR } from "../../../components/map/counts";
import type { MapReport } from "../../../server/map";

afterEach(() => vi.unstubAllGlobals());

const report = (id: string, status: MapReport["status"], meTooCount: number) =>
  ({ _id: id, lat: 33.8, lng: -84.58, status, meTooCount, title: "Pothole", category: "pothole" }) as MapReport;

test("a marker counts its poster plus every me-too", () => {
  expect(markerCount({ meTooCount: 0 })).toBe(1);
  expect(markerCount({ meTooCount: 4 })).toBe(5);
});

test("the cluster label sums its members' counts, not the number of markers", () => {
  expect(clusterCount([{ meTooCount: 0 }, { meTooCount: 2 }, { meTooCount: 4 }])).toBe(9);
});

test("a cluster is colored by status only when every member shares it", () => {
  expect(clusterColor([report("a", "open", 0), report("b", "open", 1)])).toBe(STATUS_COLOR.open);
  expect(clusterColor([report("a", "fixed", 0)])).toBe(STATUS_COLOR.fixed);
  expect(clusterColor([report("a", "open", 0), report("b", "fixed", 1)])).toBe(MIXED_COLOR);
});

test("the cluster renderer labels a cluster of 0, 2 and 4 me-toos with 9", () => {
  class FakeAdvancedMarkerElement {
    constructor(public options: google.maps.marker.AdvancedMarkerElementOptions) {}
  }
  vi.stubGlobal("google", { maps: { marker: { AdvancedMarkerElement: FakeAdvancedMarkerElement } } });

  const markers = [{}, {}, {}] as Marker[];
  const reports = new Map<Marker, MapReport>([
    [markers[0], report("a", "open", 0)],
    [markers[1], report("b", "open", 2)],
    [markers[2], report("c", "fixed", 4)],
  ]);
  const position = { lat: 33.8, lng: -84.58 };
  const cluster = { markers, position } as unknown as Cluster;

  const rendered = reportClusterRenderer((m) => reports.get(m)).render(
    cluster,
    {} as never,
    {} as google.maps.Map,
  ) as unknown as FakeAdvancedMarkerElement;

  const content = rendered.options.content as HTMLElement;
  expect(content.textContent).toBe("9");
  expect(content.style.background).not.toBe("");
  expect(rendered.options.position).toBe(position);
  expect(rendered.options.title).toBe("3 reports here, 9 people in total. Zoom in.");
});

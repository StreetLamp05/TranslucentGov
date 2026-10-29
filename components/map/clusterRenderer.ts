import type { Marker, Renderer } from "@googlemaps/markerclusterer";
import type { MapReport } from "../../server/map";
import { clusterBubble } from "./bubble";
import { clusterColor, clusterCount } from "./counts";

// A cluster's label is the sum of its members' counts, not how many pins it holds
// (§5.2.1). `reportOf` maps each clustered marker back to its report.
export function reportClusterRenderer(reportOf: (marker: Marker) => MapReport | undefined): Renderer {
  return {
    render(cluster) {
      const members = cluster.markers.map(reportOf).filter((r): r is MapReport => r !== undefined);
      const count = clusterCount(members);
      return new google.maps.marker.AdvancedMarkerElement({
        position: cluster.position,
        content: clusterBubble(count, clusterColor(members)),
        title: `${members.length} reports here, ${count} people in total. Zoom in.`,
        // Above single markers, bigger clusters on top.
        zIndex: 1000 + count,
      });
    },
  };
}

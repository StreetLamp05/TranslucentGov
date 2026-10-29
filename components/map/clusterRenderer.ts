import type { Marker, Renderer } from "@googlemaps/markerclusterer";
import type { MapReport } from "../../server/map";
import { translate } from "../../lib/i18n/dictionary";
import type { TFunction } from "../../lib/i18n/I18nProvider";
import { clusterBubble } from "./bubble";
import { clusterColor, clusterCount } from "./counts";

// A cluster's label is the sum of its members' counts, not how many pins it holds
// (§5.2.1). `reportOf` maps each clustered marker back to its report. `t` is the chosen
// language's translator (English when omitted); the map builds these outside React.
export function reportClusterRenderer(
  reportOf: (marker: Marker) => MapReport | undefined,
  t: TFunction = (key, vars) => translate("en", key, vars),
): Renderer {
  return {
    render(cluster) {
      const members = cluster.markers.map(reportOf).filter((r): r is MapReport => r !== undefined);
      const count = clusterCount(members);
      return new google.maps.marker.AdvancedMarkerElement({
        position: cluster.position,
        content: clusterBubble(count, clusterColor(members)),
        title: t("map.cluster.title", { reports: members.length, people: count }),
        // Above single markers, bigger clusters on top.
        zIndex: 1000 + count,
      });
    },
  };
}

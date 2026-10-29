"use client";

import { AdvancedMarker, APIProvider, Map as GoogleMap } from "@vis.gl/react-google-maps";
import { useState } from "react";
import type { LatLng } from "@/lib/demo";
import { useT } from "@/lib/i18n/I18nProvider";

type Props = {
  initialPoint: LatLng;
  onConfirm: (point: LatLng) => void;
  onCancel: () => void;
};

export default function LocationPicker({ initialPoint, onConfirm, onCancel }: Props) {
  const t = useT();
  const [point, setPoint] = useState(initialPoint);
  const [hasPlacedPin, setHasPlacedPin] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;

  return (
    <main className="flex h-[calc(100dvh-4rem)] flex-col gap-3 p-4">
      <header>
        <h1 className="text-[23px] font-semibold tracking-[-0.03em] text-[#18382F]">{t("map.picker.title")}</h1>
        <p className="mt-1 text-sm text-[#68756F]">{t("map.picker.hint")}</p>
      </header>
      {apiKey && mapId ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl">
          <APIProvider apiKey={apiKey}>
            <GoogleMap
              mapId={mapId}
              defaultCenter={initialPoint}
              defaultZoom={16}
              gestureHandling="greedy"
              disableDefaultUI
              clickableIcons={false}
              className="h-full w-full"
              onClick={(event) => {
                const { latLng } = event.detail;
                if (latLng) {
                  setPoint({ lat: latLng.lat, lng: latLng.lng });
                  setHasPlacedPin(true);
                }
              }}
            >
              <AdvancedMarker position={point} title={t("map.picker.pinTitle")}>
                <div
                  aria-label={t("map.picker.pinLabel")}
                  className="h-7 w-7 rounded-full border-[4px] border-white bg-[#B42318] shadow-[0_2px_8px_rgba(0,0,0,.35)]"
                />
              </AdvancedMarker>
            </GoogleMap>
          </APIProvider>
        </div>
      ) : (
        <p role="alert" className="rounded-lg border border-[#F5C2C0] bg-[#FDECEC] p-4 text-sm text-[#8A1C1C]">
          {t("map.picker.notConfigured")}
        </p>
      )}
      <p className="text-center text-xs text-[#68756F]" aria-live="polite">
        {t("map.picker.selected", { lat: point.lat.toFixed(5), lng: point.lng.toFixed(5) })}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border px-4 py-3 font-semibold"
        >
          {t("map.picker.back")}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(point)}
          disabled={!apiKey || !mapId || !hasPlacedPin}
          className="flex-1 rounded-xl bg-[#173F35] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#245446] disabled:opacity-40"
        >
          {t("map.picker.confirm")}
        </button>
      </div>
    </main>
  );
}

"use client";
import { useEffect, useRef } from "react";

interface Props {
  latitude: number;
  longitude: number;
  /** Optional label shown in the popup (e.g. suburb or address) */
  label?: string | null;
}

/**
 * Read-only Leaflet map for the dumping report detail modal.
 * Shows a red pin at the exact GPS location where the photo was taken.
 */
export default function ReportDetailMap({ latitude, longitude, label }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{
    map: import("leaflet").Map;
    marker: import("leaflet").Marker;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((mapRef.current as any)._leaflet_id) return;

    let mounted = true;

    import("leaflet").then((L) => {
      if (!mounted || !mapRef.current) return;

      // Fix default icon paths
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current, {
        center: [latitude, longitude],
        zoom: 16,
        zoomControl: true,
        scrollWheelZoom: false,
        dragging: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Pulsing red marker SVG
      const pulseIcon = L.divIcon({
        className: "",
        html: `
          <div style="position:relative;width:28px;height:28px;">
            <div style="
              position:absolute;inset:0;
              background:rgba(239,68,68,0.25);
              border-radius:50%;
              animation:pulse-ring 1.5s ease-out infinite;
            "></div>
            <div style="
              position:absolute;top:50%;left:50%;
              transform:translate(-50%,-50%);
              background:#ef4444;
              border:3px solid white;
              border-radius:50%;
              width:16px;height:16px;
              box-shadow:0 2px 6px rgba(0,0,0,0.45);
            "></div>
          </div>
          <style>
            @keyframes pulse-ring {
              0%   { transform:scale(0.5); opacity:1; }
              100% { transform:scale(1.8); opacity:0; }
            }
          </style>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const popupText = label
        ? `<b>📍 Dump site</b><br/>${label}<br/><small>${latitude.toFixed(5)}, ${longitude.toFixed(5)}</small>`
        : `<b>📍 Dump site</b><br/><small>${latitude.toFixed(5)}, ${longitude.toFixed(5)}</small>`;

      const marker = L.marker([latitude, longitude], { icon: pulseIcon, draggable: false })
        .addTo(map)
        .bindPopup(popupText, { maxWidth: 200 })
        .openPopup();

      instanceRef.current = { map, marker };
    });

    return () => {
      mounted = false;
      if (instanceRef.current) {
        instanceRef.current.map.remove();
        instanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center and update popup if the report changes
  useEffect(() => {
    if (!instanceRef.current) return;
    const { map, marker } = instanceRef.current;
    marker.setLatLng([latitude, longitude]);
    map.setView([latitude, longitude], 16);
  }, [latitude, longitude]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={mapRef} className="h-full w-full" />
    </>
  );
}

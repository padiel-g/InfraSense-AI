"use client";
import { useEffect, useRef } from "react";
import type { DumpingReport } from "@/types";

interface Props {
  reports: DumpingReport[];
  onSelect: (report: DumpingReport) => void;
}

/** Colour-code pins by report status */
function pinColor(status: string): string {
  switch (status) {
    case "verified": return "#22c55e";   // green
    case "rejected": return "#6b7280";   // grey
    case "cleaned":  return "#3b82f6";   // blue
    default:         return "#f59e0b";   // amber = detected/pending
  }
}

/**
 * Full-page Leaflet map showing all citizen dump reports as pins.
 * Clicking a pin fires onSelect to open the detail modal.
 */
export default function DumpingReportsMap({ reports, onSelect }: Props) {
  const mapRef     = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{
    map: import("leaflet").Map;
    L: typeof import("leaflet");
    markers: import("leaflet").CircleMarker[];
  } | null>(null);

  // Build / rebuild markers whenever the reports list changes
  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return;

    const initOrUpdate = async () => {
      const L = (await import("leaflet")).default ?? (await import("leaflet"));

      // ── Init map once ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(mapRef.current as any)._leaflet_id) {
        // Default icon fix (required by Leaflet + webpack)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
          iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
          shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        });

        const defaultCenter: [number, number] = reports.length > 0
          ? [reports[0].latitude, reports[0].longitude]
          : [-19.45, 29.82]; // Gweru, Zimbabwe

        const map = L.map(mapRef.current!, {
          center: defaultCenter,
          zoom: 13,
          zoomControl: true,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map);

        instanceRef.current = { map, L, markers: [] };
      }

      const { map, markers: existingMarkers } = instanceRef.current!;

      // Remove old markers
      existingMarkers.forEach((m) => m.remove());

      // Add fresh markers
      const newMarkers: import("leaflet").CircleMarker[] = [];

      reports.forEach((report) => {
        const color = pinColor(report.status);

        const marker = L.circleMarker([report.latitude, report.longitude], {
          radius: 9,
          fillColor: color,
          color: "#fff",
          weight: 2.5,
          opacity: 1,
          fillOpacity: 0.92,
        }).addTo(map);

        const categories = report.waste_categories
          ? report.waste_categories.split(",").map((c) => c.trim()).join(", ")
          : "Unknown";

        const conf = report.detection_confidence != null
          ? `${(report.detection_confidence * 100).toFixed(0)}% confidence`
          : "";

        marker.bindPopup(
          `<div style="min-width:160px">
            <b style="color:${color}">● ${report.status.charAt(0).toUpperCase() + report.status.slice(1)}</b><br/>
            ${report.suburb ? `<span>${report.suburb}</span><br/>` : ""}
            ${report.address ? `<small>${report.address}</small><br/>` : ""}
            <small style="color:#6b7280">${categories}</small><br/>
            ${conf ? `<small style="color:#6b7280">${conf}</small><br/>` : ""}
            <a href="#" style="color:#3b82f6;font-size:12px;margin-top:4px;display:inline-block">View details →</a>
          </div>`,
          { maxWidth: 220 }
        );

        marker.on("popupopen", () => {
          // Wire "View details" anchor inside popup
          const container = marker.getPopup()?.getElement();
          container?.querySelector("a")?.addEventListener("click", (e) => {
            e.preventDefault();
            onSelect(report);
          });
        });

        // Single click also opens modal directly
        marker.on("click", () => onSelect(report));

        newMarkers.push(marker);
      });

      instanceRef.current!.markers = newMarkers;

      // Fit map to all pins
      if (reports.length > 0) {
        const latlngs = reports.map((r) => [r.latitude, r.longitude] as [number, number]);
        map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30], maxZoom: 15 });
      }
    };

    initOrUpdate();
  }, [reports, onSelect]);

  useEffect(() => {
    return () => {
      if (instanceRef.current) {
        instanceRef.current.map.remove();
        instanceRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={mapRef} className="h-full w-full" />
    </>
  );
}

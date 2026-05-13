"use client";

/**
 * Leaflet-backed map for the Crew Routing page.
 *
 * Renders:
 *  - all open incidents as severity-colored circle markers
 *  - the crew's current location (green pin) when set
 *  - the OSRM route geometry (blue polyline) when calculated
 *
 * The map is initialised once on mount and updated imperatively from
 * effects to avoid the marker / layer churn that react-leaflet's
 * declarative API can cause when the parent re-renders frequently.
 *
 * Uses OpenStreetMap tiles (no API key required).
 */

import { useEffect, useRef } from "react";
import type { Incident, OsrmRouteResponse } from "@/types";

const GWERU_CENTER: [number, number] = [-19.451, 29.816]; // [lat, lng]

// Severity → marker color.
function severityColor(severity: string): string {
  const s = (severity || "").toLowerCase();
  if (s === "emergency") return "#7f1d1d"; // dark red / maroon
  if (s === "critical") return "#7f1d1d";
  if (s === "high") return "#ef4444";
  if (s === "medium") return "#f97316";
  if (s === "low") return "#16a34a";
  return "#6b7280"; // unknown / default
}

interface Props {
  incidents: Incident[];
  selectedIncidentId: string | null;
  onSelectIncident: (id: string) => void;
  crewLocation: { lat: number; lng: number } | null;
  route: OsrmRouteResponse | null;
}

export default function IncidentLeafletMap({
  incidents,
  selectedIncidentId,
  onSelectIncident,
  crewLocation,
  route,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Holds the leaflet primitives. Typed as `any` because react-leaflet's
  // Map / Marker types live in a CJS module that doesn't always satisfy
  // TS in this project — and we only touch a tiny surface area.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stateRef = useRef<any>({ map: null, markers: [], routeLayer: null, originMarker: null, L: null });

  // Track the current select handler in a ref so per-marker click closures
  // always invoke the latest version (prop changes between renders).
  const selectHandlerRef = useRef(onSelectIncident);
  useEffect(() => { selectHandlerRef.current = onSelectIncident; }, [onSelectIncident]);

  // Initialise once
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;
    let cancelled = false;

    import("leaflet").then((Lmod) => {
      if (cancelled || !containerRef.current) return;
      const L = Lmod.default ?? Lmod;

      // Default icon assets — ship from the leaflet CDN so we don't need
      // to copy them into /public.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(containerRef.current, {
        center: GWERU_CENTER,
        zoom: 13,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      stateRef.current.map = map;
      stateRef.current.L = L;
      // Trigger an effect-driven render after mount.
      map.invalidateSize();
    });

    return () => {
      cancelled = true;
      const { map } = stateRef.current;
      if (map) {
        map.remove();
        stateRef.current = { map: null, markers: [], routeLayer: null, originMarker: null, L: null };
      }
    };
  }, []);

  // Re-render incident markers whenever the set or selection changes.
  useEffect(() => {
    const { map, L, markers } = stateRef.current;
    if (!map || !L) return;

    // Remove previous incident markers (origin / route handled separately).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    markers.forEach((m: any) => map.removeLayer(m));
    stateRef.current.markers = [];

    incidents
      .filter((i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude))
      .forEach((incident) => {
        const isSelected = incident.id === selectedIncidentId;
        const color = severityColor(incident.severity);
        const marker = L.circleMarker([incident.latitude, incident.longitude], {
          radius: isSelected ? 11 : 8,
          color: "#ffffff",
          weight: 2,
          fillColor: color,
          fillOpacity: 0.9,
        }).addTo(map);

        const issue = incident.issue_type || incident.incident_type;
        const popup = `
          <div style="min-width:180px;font-family:inherit;">
            <div style="font-weight:600;margin-bottom:2px;">${escapeHtml(issue.replace(/_/g, " "))}</div>
            <div style="font-size:12px;color:#475569;margin-bottom:4px;">
              Severity: <b style="color:${color};text-transform:capitalize;">${escapeHtml(incident.severity)}</b>
            </div>
            ${incident.address ? `<div style="font-size:12px;margin-bottom:4px;">${escapeHtml(incident.address)}</div>` : ""}
            ${incident.description ? `<div style="font-size:12px;color:#64748b;">${escapeHtml(incident.description.slice(0, 140))}${incident.description.length > 140 ? "…" : ""}</div>` : ""}
            <div style="font-size:11px;color:#64748b;margin-top:6px;">Status: ${escapeHtml(incident.status)}</div>
          </div>
        `;
        marker.bindPopup(popup);
        marker.on("click", () => selectHandlerRef.current(incident.id));
        stateRef.current.markers.push(marker);
      });
  }, [incidents, selectedIncidentId]);

  // Re-render the crew origin marker.
  useEffect(() => {
    const { map, L, originMarker } = stateRef.current;
    if (!map || !L) return;

    if (originMarker) {
      map.removeLayer(originMarker);
      stateRef.current.originMarker = null;
    }

    if (crewLocation) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="
          background:#10b981;
          border:3px solid white;
          border-radius:50%;
          width:18px;height:18px;
          box-shadow:0 2px 6px rgba(0,0,0,0.4);
        "></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const marker = L.marker([crewLocation.lat, crewLocation.lng], { icon })
        .addTo(map)
        .bindPopup("📍 Crew location");
      stateRef.current.originMarker = marker;
    }
  }, [crewLocation]);

  // Re-render the route polyline + fit bounds.
  useEffect(() => {
    const { map, L, routeLayer } = stateRef.current;
    if (!map || !L) return;

    if (routeLayer) {
      map.removeLayer(routeLayer);
      stateRef.current.routeLayer = null;
    }

    if (route?.geometry?.coordinates?.length) {
      // OSRM gives [lng, lat]; Leaflet wants [lat, lng].
      const latlngs: [number, number][] = route.geometry.coordinates.map(
        ([lng, lat]) => [lat, lng]
      );
      const layer = L.polyline(latlngs, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.85,
      }).addTo(map);
      stateRef.current.routeLayer = layer;

      const bounds = L.latLngBounds(latlngs);
      bounds.extend([route.start.lat, route.start.lng]);
      bounds.extend([route.end.lat, route.end.lng]);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: true });
    }
  }, [route]);

  return (
    <>
      {/* Leaflet stylesheet — loaded inline so the component is portable.
          Browsers de-dup the request if it's already loaded elsewhere. */}
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div
        ref={containerRef}
        className="h-[520px] w-full rounded-lg overflow-hidden border"
      />
    </>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

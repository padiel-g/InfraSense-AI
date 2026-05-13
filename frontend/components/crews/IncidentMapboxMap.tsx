"use client";

import { useEffect, useRef, useState } from "react";
import type { Incident, OsrmRouteResponse } from "@/types";
import { enableRoadLabels, getFirstSymbolLayerId } from "@/lib/mapboxLayers";

import "mapbox-gl/dist/mapbox-gl.css";

type MapboxGl = typeof import("mapbox-gl").default;

const GWERU_CENTER: [number, number] = [29.8178, -19.4565];
const GWERU_ZOOM = 12.1;

const GWERU_BOUNDS: [[number, number], [number, number]] = [
  [29.62, -19.62],
  [30.05, -19.28],
];

const MAPBOX_ACCESS_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface Props {
  incidents: Incident[];
  selectedIncidentId: string | null;
  onSelectIncident: (id: string) => void;
  onCalculateRoute?: (incidentId: string) => void;
  onSetCrewLocation?: (location: { lat: number; lng: number }) => void;
  crewLocation: { lat: number; lng: number } | null;
  route: OsrmRouteResponse | null;
}

function severityColor(severity: string): string {
  const normalized = (severity || "").toLowerCase();
  if (normalized === "emergency") return "#6d1b7b";
  if (normalized === "critical") return "#7f1d1d";
  if (normalized === "high") return "#ef4444";
  if (normalized === "medium") return "#f97316";
  if (normalized === "low") return "#16a34a";
  return "#6b7280";
}

function formatIssue(type?: string | null): string {
  if (!type) return "Incident";
  return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function IncidentMapboxMap({
  incidents,
  selectedIncidentId,
  onSelectIncident,
  onCalculateRoute,
  onSetCrewLocation,
  crewLocation,
  route,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectHandlerRef = useRef(onSelectIncident);
  const calculateRouteRef = useRef(onCalculateRoute);
  const setCrewLocationRef = useRef(onSetCrewLocation);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapInstanceRef = useRef<{
    map: import("mapbox-gl").Map;
    mapboxgl: MapboxGl;
    incidentMarkers: import("mapbox-gl").Marker[];
    crewMarker: import("mapbox-gl").Marker | null;
    routeSourceId: string;
  } | null>(null);

  useEffect(() => {
    selectHandlerRef.current = onSelectIncident;
  }, [onSelectIncident]);

  useEffect(() => {
    calculateRouteRef.current = onCalculateRoute;
  }, [onCalculateRoute]);

  useEffect(() => {
    setCrewLocationRef.current = onSetCrewLocation;
  }, [onSetCrewLocation]);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    let mounted = true;

    import("mapbox-gl").then((mapboxgl) => {
      if (!mounted || !containerRef.current) return;

      if (!MAPBOX_ACCESS_TOKEN) {
        setMapError("Missing Mapbox token. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in frontend/.env.local.");
        return;
      }

      mapboxgl.default.accessToken = MAPBOX_ACCESS_TOKEN;

      const map = new mapboxgl.default.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: GWERU_CENTER,
        zoom: GWERU_ZOOM,
        minZoom: 11,
        maxBounds: GWERU_BOUNDS,
      });

      map.addControl(new mapboxgl.default.NavigationControl(), "bottom-right");
      map.getCanvas().style.cursor = "crosshair";
      map.on("style.load", () => enableRoadLabels(map));

      map.on("click", (event) => {
        setCrewLocationRef.current?.({
          lat: event.lngLat.lat,
          lng: event.lngLat.lng,
        });
      });

      map.on("load", () => {
        if (!mounted) return;

        mapInstanceRef.current = {
          map,
          mapboxgl: mapboxgl.default,
          incidentMarkers: [],
          crewMarker: null,
          routeSourceId: "crew-route",
        };
        setMapReady(true);
      });
    });

    return () => {
      mounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.map.remove();
        mapInstanceRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    const { map, mapboxgl, incidentMarkers } = mapInstanceRef.current;

    incidentMarkers.forEach((marker) => marker.remove());
    incidentMarkers.length = 0;

    incidents
      .filter((incident) => Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude))
      .forEach((incident) => {
        const color = severityColor(incident.severity);
        const isSelected = incident.id === selectedIncidentId;
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `Select ${formatIssue(incident.issue_type ?? incident.incident_type)}`);
        el.style.width = isSelected ? "26px" : "20px";
        el.style.height = isSelected ? "26px" : "20px";
        el.style.borderRadius = "999px";
        el.style.background = isSelected ? "#dc2626" : color;
        el.style.border = "3px solid #ffffff";
        el.style.boxShadow = isSelected
          ? "0 0 0 3px rgba(37,99,235,0.6), 0 2px 10px rgba(0,0,0,0.35)"
          : "0 2px 8px rgba(0,0,0,0.35)";
        el.style.cursor = "pointer";

        const popupHtml = `
          <div style="min-width:190px;font-family:Inter,system-ui,sans-serif;">
            <div style="font-weight:700;margin-bottom:3px;">${escapeHtml(formatIssue(incident.issue_type ?? incident.incident_type))}</div>
            <div style="font-size:12px;color:#475569;margin-bottom:5px;">
              Severity: <b style="color:${color};text-transform:capitalize;">${escapeHtml(incident.severity)}</b>
            </div>
            <div style="font-size:12px;color:#475569;margin-bottom:5px;">Status: <b style="text-transform:capitalize;">${escapeHtml(incident.status.replace(/_/g, " "))}</b></div>
            <div style="font-size:12px;color:#475569;margin-bottom:5px;">Reported: ${escapeHtml(new Date(incident.reported_at).toLocaleString())}</div>
            ${incident.address ? `<div style="font-size:12px;margin-bottom:5px;">${escapeHtml(incident.address)}</div>` : ""}
            ${incident.description ? `<div style="font-size:12px;color:#64748b;">${escapeHtml(truncate(incident.description, 140))}</div>` : ""}
            <button
              type="button"
              data-route-incident-id="${escapeHtml(incident.id)}"
              style="margin-top:8px;width:100%;border:0;border-radius:6px;background:#2563eb;color:white;padding:6px 8px;font-size:12px;font-weight:700;cursor:pointer;"
            >
              Calculate route
            </button>
          </div>
        `;

        const popup = new mapboxgl.Popup({ offset: 14 }).setHTML(popupHtml);
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([incident.longitude, incident.latitude])
          .setPopup(popup)
          .addTo(map);

        el.addEventListener("click", () => selectHandlerRef.current(incident.id));
        popup.on("open", () => {
          const button = popup.getElement()?.querySelector(`[data-route-incident-id="${incident.id}"]`);
          button?.addEventListener("click", () => {
            selectHandlerRef.current(incident.id);
            calculateRouteRef.current?.(incident.id);
          });
        });
        incidentMarkers.push(marker);

        if (isSelected) {
          map.flyTo({
            center: [incident.longitude, incident.latitude],
            zoom: Math.max(map.getZoom(), 15),
            essential: true,
          });
          marker.togglePopup();
        }
      });
  }, [incidents, mapReady, selectedIncidentId]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    const { map, mapboxgl } = mapInstanceRef.current;

    mapInstanceRef.current.crewMarker?.remove();
    mapInstanceRef.current.crewMarker = null;

    if (!crewLocation) return;

    const el = document.createElement("div");
    el.style.width = "26px";
    el.style.height = "26px";
    el.style.borderRadius = "999px";
    el.style.background = "#2563eb";
    el.style.border = "4px solid #ffffff";
    el.style.boxShadow = "0 2px 10px rgba(0,0,0,0.4)";

    mapInstanceRef.current.crewMarker = new mapboxgl.Marker({ element: el })
      .setLngLat([crewLocation.lng, crewLocation.lat])
      .setPopup(new mapboxgl.Popup({ offset: 14 }).setHTML("<b>Crew current location</b>"))
      .addTo(map);
  }, [crewLocation, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    const { map, mapboxgl, routeSourceId } = mapInstanceRef.current;
    const routeLayerId = `${routeSourceId}-line`;

    if (map.getLayer(routeLayerId)) {
      map.removeLayer(routeLayerId);
    }
    if (map.getSource(routeSourceId)) {
      map.removeSource(routeSourceId);
    }

    if (!route?.geometry?.coordinates?.length) return;

    map.addSource(routeSourceId, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: route.geometry,
      },
    });

    map.addLayer(
      {
        id: routeLayerId,
        type: "line",
        source: routeSourceId,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 6,
          "line-opacity": 0.95,
        },
      },
      getFirstSymbolLayerId(map),
    );

    const bounds = new mapboxgl.LngLatBounds();
    if (crewLocation) bounds.extend([crewLocation.lng, crewLocation.lat]);
    bounds.extend([route.end.lng, route.end.lat]);
    route.geometry.coordinates.forEach(([lng, lat]) => bounds.extend([lng, lat]));

    map.fitBounds(bounds, {
      padding: 70,
      maxZoom: 16,
      animate: true,
    });
  }, [crewLocation, mapReady, route]);

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-lg border bg-muted">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      {mapError && (
        <div className="absolute inset-x-4 top-4 rounded-lg border border-red-200 bg-white/95 p-3 text-sm text-red-700 shadow">
          {mapError}
        </div>
      )}
    </div>
  );
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}...`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

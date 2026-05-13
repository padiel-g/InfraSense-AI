"use client";
import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Crew, DumpingReport, ShortestRouteResponse } from "@/types";
import { enableRoadLabels, getFirstSymbolLayerId } from "@/lib/mapboxLayers";

const GWERU_CENTER: [number, number] = [29.816, -19.451]; // [lng, lat]
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

interface Props {
  incident: DumpingReport | null;
  crews: Crew[];
  selectedCrew: Crew | null;
  manualOrigin: { lat: number; lng: number } | null;
  route: ShortestRouteResponse | null;
}

export default function RouteMap({
  incident,
  crews,
  selectedCrew,
  manualOrigin,
  route,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Initialize the map once
  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return;
    if (mapInstanceRef.current) return;
    if (!MAPBOX_TOKEN) {
      console.warn("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: GWERU_CENTER,
      zoom: 13,
      attributionControl: true,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("style.load", () => enableRoadLabels(map));

    mapInstanceRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update markers and route layer when data changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const applyUpdates = () => {
      // Clear existing markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const bounds = new mapboxgl.LngLatBounds();
      let hasBounds = false;

      // Available crew markers
      crews
        .filter((crew) => crew.status === "available" && crew.latitude && crew.longitude)
        .forEach((crew) => {
          const lngLat: [number, number] = [crew.longitude!, crew.latitude!];
          const el = document.createElement("div");
          el.style.width = "12px";
          el.style.height = "12px";
          el.style.borderRadius = "9999px";
          el.style.background = "#60a5fa";
          el.style.border = "2px solid #2563eb";
          el.style.boxShadow = "0 0 0 2px rgba(37,99,235,0.25)";
          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat(lngLat)
            .setPopup(
              new mapboxgl.Popup({ offset: 12 }).setHTML(
                `<b>${crew.full_name}</b><br/>Available crew`,
              ),
            )
            .addTo(map);
          markersRef.current.push(marker);
          bounds.extend(lngLat);
          hasBounds = true;
        });

      // Incident marker
      if (incident) {
        const lngLat: [number, number] = [incident.longitude, incident.latitude];
        const marker = new mapboxgl.Marker({ color: "#ef4444" })
          .setLngLat(lngLat)
          .setPopup(
            new mapboxgl.Popup({ offset: 24 }).setHTML(
              `<b>Incident location</b><br/>${incident.description || "Illegal dumping incident"}`,
            ),
          )
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend(lngLat);
        hasBounds = true;
      }

      // Origin marker
      const origin = route?.origin ?? (
        selectedCrew?.latitude && selectedCrew?.longitude
          ? { lat: selectedCrew.latitude, lng: selectedCrew.longitude }
          : manualOrigin
      );
      if (origin) {
        const lngLat: [number, number] = [origin.lng, origin.lat];
        const marker = new mapboxgl.Marker({ color: "#10b981" })
          .setLngLat(lngLat)
          .setPopup(new mapboxgl.Popup({ offset: 24 }).setHTML("<b>Current crew location</b>"))
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend(lngLat);
        hasBounds = true;
      }

      // Route layer
      if (map.getLayer("route-line")) map.removeLayer("route-line");
      if (map.getSource("route")) map.removeSource("route");

      if (route && route.route.geometry.length > 0) {
        const coords = route.route.geometry.map(([lng, lat]) => [lng, lat]);
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: coords },
          },
        });
        map.addLayer(
          {
            id: "route-line",
            type: "line",
            source: "route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": "#2563eb",
              "line-width": 5,
              "line-opacity": 0.85,
              ...(route.route.is_approximate ? { "line-dasharray": [2, 1.5] } : {}),
            },
          },
          getFirstSymbolLayerId(map),
        );
        coords.forEach((c) => bounds.extend(c as [number, number]));
        hasBounds = true;
      }

      if (hasBounds && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 600 });
      }
    };

    if (map.isStyleLoaded()) {
      applyUpdates();
    } else {
      map.once("load", applyUpdates);
    }
  }, [incident, crews, selectedCrew, manualOrigin, route]);

  return <div ref={mapRef} className="h-full min-h-[520px] w-full rounded-lg overflow-hidden" />;
}

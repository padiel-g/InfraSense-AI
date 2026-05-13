"use client";
import { useEffect, useRef } from "react";

interface Props {
  coords: { lat: number; lng: number };
  onMove?: (coords: { lat: number; lng: number }) => void;
}

export default function LocationMap({ coords, onMove }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{
    map: import("leaflet").Map;
    marker: import("leaflet").Marker;
    L: typeof import("leaflet");
  } | null>(null);

  // Initialise map once
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
        center: [coords.lat, coords.lng],
        zoom: 15,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Red draggable marker
      const redIcon = L.divIcon({
        className: "",
        html: `<div style="
          background:#ef4444;
          border:3px solid white;
          border-radius:50%;
          width:20px;height:20px;
          box-shadow:0 2px 6px rgba(0,0,0,0.4);
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const marker = L.marker([coords.lat, coords.lng], {
        draggable: true,
        icon: redIcon,
      })
        .addTo(map)
        .bindPopup("📍 Reported location")
        .openPopup();

      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        onMove?.({ lat, lng });
      });

      instanceRef.current = { map, marker, L };
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

  // Pan map + move marker when coords prop changes externally
  useEffect(() => {
    if (!instanceRef.current) return;
    const { map, marker } = instanceRef.current;
    const current = marker.getLatLng();
    // Only pan if the change is significant (GPS refresh, not drag)
    if (
      Math.abs(current.lat - coords.lat) > 0.0001 ||
      Math.abs(current.lng - coords.lng) > 0.0001
    ) {
      marker.setLatLng([coords.lat, coords.lng]);
      map.panTo([coords.lat, coords.lng]);
    }
  }, [coords]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={mapRef} className="h-full w-full" />
    </>
  );
}

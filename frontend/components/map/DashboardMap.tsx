"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  LocateFixed,
  Loader2,
  MapPin,
  Menu,
  Navigation,
  Route,
  Search,
} from "lucide-react";

import { useRiskMap } from "@/hooks/useDashboard";
import { useIncidents } from "@/hooks/useIncidents";
import { useDumpingReports } from "@/hooks/useDumping";
import { getRiskColor } from "@/lib/map";
import { enableRoadLabels, getFirstSymbolLayerId } from "@/lib/mapboxLayers";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import "mapbox-gl/dist/mapbox-gl.css";

type MapboxGl = typeof import("mapbox-gl").default;

// Gweru, Zimbabwe
const GWERU_CENTER: [number, number] = [-19.4565, 29.8178];
const GWERU_ZOOM = 12.1;

// Wider Gweru bounds so roads, suburbs and real places remain visible
const GWERU_BOUNDS: [[number, number], [number, number]] = [
  [-19.62, 29.62], // southwest
  [-19.28, 30.05], // northeast
];

const MAPBOX_ACCESS_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type RiskFilter = "all" | "low" | "medium" | "high";
type LayerKey = "assets" | "incidents" | "dumps";

type MapPoint = {
  latitude: number;
  longitude: number;
  label?: string;
  address?: string;
};

type RouteResponse = {
  start: MapPoint;
  destination: MapPoint;
  city: string;
  routing_provider: string;
  route_profile: string;
  distance_meters: number;
  distance_km: number;
  duration_seconds: number;
  duration_minutes: number;
  route_geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  message: string;
};

const RISK_BUTTONS: { key: RiskFilter; label: string; dot: string }[] = [
  { key: "all", label: "All", dot: "bg-muted-foreground" },
  { key: "low", label: "Low", dot: "bg-green-500" },
  { key: "medium", label: "Medium", dot: "bg-yellow-500" },
  { key: "high", label: "High", dot: "bg-red-500" },
];

const POPULAR_DESTINATIONS = [
  "A5",
  "Midlands Hotel",
  "KFC Gweru",
  "Gweru General Hospital",
  "Mkoba 6",
  "Gweru City Council",
  "Senga",
  "Mkoba Teachers College",
  "Midlands State University",
];

function isInsideGweru(latitude: number, longitude: number) {
  const [[minLat, minLng], [maxLat, maxLng]] = GWERU_BOUNDS;

  return (
    latitude >= minLat &&
    latitude <= maxLat &&
    longitude >= minLng &&
    longitude <= maxLng
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        "border transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-background/95 text-muted-foreground border-border hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export default function DashboardMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const currentLocationRef = useRef<MapPoint | null>(null);

  const mapInstanceRef = useRef<{
    map: import("mapbox-gl").Map;
    mapboxgl: MapboxGl;
    markers: import("mapbox-gl").Marker[];
    routeMarkers: import("mapbox-gl").Marker[];
    routeSourceId: string;
  } | null>(null);

  const [risk, setRisk] = useState<RiskFilter>("all");

  const [enabled] = useState<Record<LayerKey, boolean>>({
    assets: true,
    incidents: true,
    dumps: true,
  });

  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");

  const [routePanelSide, setRoutePanelSide] = useState<"left" | "right">("left");

  const [currentLocation, setCurrentLocation] = useState<MapPoint | null>(null);
  const [destination, setDestination] = useState<MapPoint | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResponse | null>(null);

  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [loadingDestination, setLoadingDestination] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const { data: riskItems } = useRiskMap();
  const { data: incidents } = useIncidents({ status: "reported" });
  const { data: dumps } = useDumpingReports({ status: "detected" });

  useEffect(() => {
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);

  const filteredRisk = useMemo(() => {
    const items = riskItems ?? [];

    if (risk === "all") return items;

    return items.filter(
      (item) => item.risk_category?.toLowerCase() === risk
    );
  }, [riskItems, risk]);

  async function geocodeGweruLocation(query: string): Promise<MapPoint> {
    if (!MAPBOX_ACCESS_TOKEN) {
      throw new Error(
        "Missing Mapbox token. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in frontend/.env.local."
      );
    }

    const bbox = [
      GWERU_BOUNDS[0][1],
      GWERU_BOUNDS[0][0],
      GWERU_BOUNDS[1][1],
      GWERU_BOUNDS[1][0],
    ].join(",");

    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        query
      )}.json`
    );

    url.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);
    url.searchParams.set("limit", "1");
    url.searchParams.set("bbox", bbox);
    url.searchParams.set("country", "ZW");
    url.searchParams.set("types", "address,poi,place,locality,neighborhood");
    url.searchParams.set("proximity", `${GWERU_CENTER[1]},${GWERU_CENTER[0]}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error("Failed to search location.");
    }

    const data: {
      features?: Array<{
        center: [number, number];
        place_name: string;
        text: string;
      }>;
    } = await response.json();

    const feature = data.features?.[0];
    if (!feature) {
      throw new Error("Location not found inside Gweru City.");
    }

    const [longitude, latitude] = feature.center;

    if (!isInsideGweru(latitude, longitude)) {
      throw new Error("Selected location must be inside Gweru City.");
    }

    return {
      latitude,
      longitude,
      label: query,
      address: feature.place_name,
    };
  }

  function focusMapOnPoint(point: MapPoint, zoom = 17) {
    if (!mapInstanceRef.current) return;

    mapInstanceRef.current.map.flyTo({
      center: [point.longitude, point.latitude],
      zoom,
      essential: true,
    });
  }

  async function handleUseBrowserLocation() {
    if (!navigator.geolocation) {
      setRouteError("Your browser does not support location access.");
      return;
    }

    setLoadingCurrent(true);
    setRouteError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        setLoadingCurrent(false);

        if (!isInsideGweru(latitude, longitude)) {
          setRouteError("Your current location must be inside Gweru City.");
          return;
        }

        const point = {
          latitude,
          longitude,
          label: "Your location",
        };

        setCurrentLocation(point);
        setRouteResult(null);
        focusMapOnPoint(point);
      },
      () => {
        setLoadingCurrent(false);
        setRouteError("Could not access your current location.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    );
  }

  async function handleSearchDestination(query?: string) {
    const value = (query ?? destinationQuery).trim();

    if (!value) {
      setRouteError("Enter your destination first.");
      return;
    }

    try {
      setLoadingDestination(true);
      setRouteError(null);
      setRouteResult(null);

      const point = await geocodeGweruLocation(value);

      setDestination(point);
      setDestinationQuery(value);
      focusMapOnPoint(point);
    } catch (error) {
      setRouteError(
        error instanceof Error ? error.message : "Failed to find destination."
      );
    } finally {
      setLoadingDestination(false);
    }
  }

  async function calculateShortestRouteTo(
    routeDestination: MapPoint,
    routeStart = currentLocation
  ) {
    if (!routeStart) {
      setRouteError("Please use your current location first.");
      return;
    }

    try {
      setLoadingRoute(true);
      setRouteError(null);

      if (!MAPBOX_ACCESS_TOKEN) {
        throw new Error(
          "Missing Mapbox token. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in frontend/.env.local."
        );
      }

      const profile = "driving";
      const url = new URL(
        `https://api.mapbox.com/directions/v5/mapbox/${profile}/${routeStart.longitude},${routeStart.latitude};${routeDestination.longitude},${routeDestination.latitude}`
      );

      url.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("overview", "full");
      url.searchParams.set("alternatives", "false");

      const response = await fetch(url.toString());
      const data: {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { type: "LineString"; coordinates: [number, number][] };
        }>;
        message?: string;
      } = await response.json();

      const route = data.routes?.[0];
      if (!response.ok || !route) {
        throw new Error(data.message || "Failed to calculate shortest route.");
      }

      setRouteResult({
        start: routeStart,
        destination: routeDestination,
        city: "Gweru",
        routing_provider: "mapbox",
        route_profile: profile,
        distance_meters: route.distance,
        distance_km: route.distance / 1000,
        duration_seconds: route.duration,
        duration_minutes: route.duration / 60,
        route_geometry: route.geometry,
        message: "OK",
      });
    } catch (error) {
      setRouteError(
        error instanceof Error ? error.message : "Route calculation failed."
      );
    } finally {
      setLoadingRoute(false);
    }
  }

  async function handleMapDestinationClick(latitude: number, longitude: number) {
    if (!isInsideGweru(latitude, longitude)) {
      setRouteError("Selected destination must be inside Gweru City.");
      return;
    }

    const point: MapPoint = {
      latitude,
      longitude,
      label: "Map destination",
      address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    };

    setDestination(point);
    setDestinationQuery(point.address ?? "");
    setRouteResult(null);

    const origin = currentLocationRef.current;
    if (!origin) {
      setRouteError("Destination selected. Use your current location to show the route.");
      return;
    }

    await calculateShortestRouteTo(point, origin);
  }

  async function handleSearchOrigin(query?: string) {
    const value = (query ?? originQuery).trim();

    if (!value) {
      setRouteError("Enter your current location first.");
      return;
    }

    try {
      setLoadingCurrent(true);
      setRouteError(null);
      setRouteResult(null);

      const point = await geocodeGweruLocation(value);

      setCurrentLocation(point);
      setOriginQuery(value);
      focusMapOnPoint(point);
    } catch (error) {
      setRouteError(
        error instanceof Error
          ? error.message
          : "Failed to find current location."
      );
    } finally {
      setLoadingCurrent(false);
    }
  }

  async function handleFindShortestRoute() {
    if (!currentLocation) {
      setRouteError("Please use your current location first.");
      return;
    }

    if (!destination) {
      setRouteError("Please choose a destination first.");
      return;
    }

    await calculateShortestRouteTo(destination, currentLocation);
  }

  // Initialize Mapbox Streets
  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return;

    let mounted = true;

    import("mapbox-gl").then((mapboxgl) => {
      if (!mounted || !mapRef.current) return;

      if (!MAPBOX_ACCESS_TOKEN) {
        setRouteError(
          "Missing Mapbox token. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in frontend/.env.local."
        );
        return;
      }

      mapboxgl.default.accessToken = MAPBOX_ACCESS_TOKEN;

      const map = new mapboxgl.default.Map({
        container: mapRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [GWERU_CENTER[1], GWERU_CENTER[0]],
        zoom: GWERU_ZOOM,
        minZoom: 11,
        maxBounds: [
          [GWERU_BOUNDS[0][1], GWERU_BOUNDS[0][0]],
          [GWERU_BOUNDS[1][1], GWERU_BOUNDS[1][0]],
        ],
      });

      map.addControl(new mapboxgl.default.NavigationControl(), "bottom-right");
      map.getCanvas().style.cursor = "crosshair";
      map.on("style.load", () => enableRoadLabels(map));

      map.on("click", (event) => {
        handleMapDestinationClick(event.lngLat.lat, event.lngLat.lng);
      });

      map.on("load", () => {
        if (!mounted) return;

        mapInstanceRef.current = {
          map,
          mapboxgl: mapboxgl.default,
          markers: [],
          routeMarkers: [],
          routeSourceId: "gweru-route",
        };
      });
    });

    return () => {
      mounted = false;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.map.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Plot assets, incidents and dump reports
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const { map, mapboxgl, markers } = mapInstanceRef.current;

    markers.forEach((marker) => marker.remove());
    markers.length = 0;

    function addDotMarker(
      latitude: number,
      longitude: number,
      color: string,
      popupHtml: string,
      size = 16
    ) {
      const el = document.createElement("div");
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = "999px";
      el.style.background = color;
      el.style.border = "2px solid #ffffff";
      el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([longitude, latitude])
        .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(popupHtml))
        .addTo(map);

      markers.push(marker);
    }

    function addBadgeMarker(
      latitude: number,
      longitude: number,
      label: string,
      background: string,
      popupHtml: string
    ) {
      const el = document.createElement("div");
      el.style.width = "22px";
      el.style.height = "22px";
      el.style.borderRadius = "999px";
      el.style.background = background;
      el.style.color = "white";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontSize = "12px";
      el.style.fontWeight = "800";
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";
      el.textContent = label;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([longitude, latitude])
        .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(popupHtml))
        .addTo(map);

      markers.push(marker);
    }

    if (enabled.assets) {
      filteredRisk.forEach((item) => {
        if (!item.latitude || !item.longitude) return;

        addDotMarker(
          item.latitude,
          item.longitude,
          getRiskColor(item.risk_score),
          `<b>${item.asset_type.replace(/_/g, " ").toUpperCase()}</b><br/>
           Risk: <b>${(item.risk_score * 100).toFixed(0)}%</b> — ${
             item.risk_category
           }<br/>
           ${
             item.last_failure
               ? `Last failure: ${new Date(item.last_failure).toLocaleDateString()}`
               : "No failures recorded"
           }`
        );
      });
    }

    if (enabled.incidents) {
      (incidents ?? []).forEach((incident) => {
        if (!incident.latitude || !incident.longitude) return;

        addBadgeMarker(
          incident.latitude,
          incident.longitude,
          "!",
          "#ec4899",
          `<b>${
            incident.incident_type?.replace(/_/g, " ").toUpperCase() ?? "Incident"
          }</b><br/>
           ${incident.address ?? ""}<br/>
           Severity: <b>${incident.severity ?? "—"}</b> | Status: ${
             incident.status
           }`
        );
      });
    }

    if (enabled.dumps) {
      (dumps ?? []).forEach((dump) => {
        if (!dump.latitude || !dump.longitude) return;

        addBadgeMarker(
          dump.latitude,
          dump.longitude,
          "D",
          "#ef4444",
          `<b>Illegal Dump</b><br/>
           ${dump.address ?? ""}<br/>
           Confidence: ${((dump.detection_confidence ?? 0) * 100).toFixed(0)}%`
        );
      });
    }
  }, [filteredRisk, incidents, dumps, enabled]);

  // Draw current location, destination and shortest route line
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const { map, mapboxgl, routeMarkers, routeSourceId } =
      mapInstanceRef.current;

    routeMarkers.forEach((marker) => marker.remove());
    routeMarkers.length = 0;

    if (map.getLayer(`${routeSourceId}-line`)) {
      map.removeLayer(`${routeSourceId}-line`);
    }
    if (map.getSource(routeSourceId)) {
      map.removeSource(routeSourceId);
    }

    function addBigMarker(point: MapPoint, label: "S" | "D") {
      const el = document.createElement("div");
      el.style.width = "28px";
      el.style.height = "28px";
      el.style.borderRadius = "999px";
      el.style.background = label === "S" ? "#16a34a" : "#dc2626";
      el.style.color = "white";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontSize = "12px";
      el.style.fontWeight = "800";
      el.style.border = "3px solid white";
      el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)";
      el.textContent = label;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setHTML(
            `<b>${label === "S" ? "Current location" : "Destination"}</b><br/>${
              point.address || point.label || ""
            }`
          )
        )
        .addTo(map);

      routeMarkers.push(marker);
    }

    if (currentLocation) {
      addBigMarker(currentLocation, "S");
    }

    if (destination) {
      addBigMarker(destination, "D");
    }

    if (routeResult?.route_geometry?.coordinates?.length) {
      const routeGeoJson = {
        type: "Feature",
        properties: {},
        geometry: routeResult.route_geometry,
      } as const;

      map.addSource(routeSourceId, {
        type: "geojson",
        data: routeGeoJson,
      });

      map.addLayer(
        {
          id: `${routeSourceId}-line`,
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
      routeResult.route_geometry.coordinates.forEach(([lng, lat]) => {
        bounds.extend([lng, lat]);
      });

      map.fitBounds(bounds, {
        padding: 70,
        animate: true,
      });
    } else if (currentLocation && destination) {
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([currentLocation.longitude, currentLocation.latitude]);
      bounds.extend([destination.longitude, destination.latitude]);

      map.fitBounds(bounds, {
        padding: 70,
        animate: true,
      });
    }
  }, [currentLocation, destination, routeResult]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-muted">
      {/* Real OpenStreetMap canvas */}
      <div ref={mapRef} className="absolute inset-0 z-0 h-full w-full" />

      {/* Floating menu and risk filters */}
      <div className="absolute left-4 top-4 z-[1000] flex items-center gap-2">
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full border bg-background/95 shadow-lg backdrop-blur"
          aria-label="Menu"
        >
          <Menu className="h-6 w-6" />
        </button>

        <div className="hidden items-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-lg backdrop-blur md:flex">
          {RISK_BUTTONS.map((button) => (
            <FilterChip
              key={button.key}
              active={risk === button.key}
              onClick={() => setRisk(button.key)}
            >
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  button.dot
                )}
              />
              {button.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Floating current-location button */}
      <div className="absolute right-4 top-1/2 z-[1000] -translate-y-1/2">
        <button
          type="button"
          onClick={handleUseBrowserLocation}
          className="flex h-12 w-12 items-center justify-center rounded-full border bg-background/95 shadow-lg backdrop-blur"
          aria-label="Use current location"
        >
          {loadingCurrent ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Navigation className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Smaller route panel */}
      <div
        className={cn(
          "absolute bottom-4 z-[1000] w-[360px] max-w-[calc(100%-2rem)] rounded-2xl border bg-background/95 p-4 shadow-2xl backdrop-blur",
          routePanelSide === "left" ? "left-4" : "right-4"
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Where from</div>
            <div className="text-xl font-semibold">
              {currentLocation ? "Your location set" : "Your location"}
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() =>
              setRoutePanelSide((prev) => (prev === "left" ? "right" : "left"))
            }
            aria-label="Move panel"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-3 rounded-2xl bg-muted px-4 py-3">
          <div className="flex items-center gap-3">
            {loadingCurrent ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Search className="h-5 w-5 text-muted-foreground" />
            )}

            <Input
              value={originQuery}
              onChange={(event) => setOriginQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSearchOrigin();
                }
              }}
              placeholder="Enter your location"
              className="h-auto border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        <div className="mb-3 rounded-2xl bg-muted px-4 py-3">
          <div className="flex items-center gap-3">
            {loadingDestination ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Search className="h-5 w-5 text-muted-foreground" />
            )}

            <Input
              value={destinationQuery}
              onChange={(event) => setDestinationQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSearchDestination();
                }
              }}
              placeholder="Search or click map"
              className="h-auto border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        <div className="mb-4 max-h-48 space-y-1 overflow-y-auto">
          {POPULAR_DESTINATIONS.map((place) => (
            <button
              type="button"
              key={place}
              onClick={() => handleSearchDestination(place)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted"
            >
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm">{place}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={handleUseBrowserLocation}
            disabled={loadingCurrent}
          >
            {loadingCurrent ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LocateFixed className="mr-2 h-4 w-4" />
            )}
            Use current
          </Button>

          <Button
            type="button"
            className="flex-1"
            onClick={handleFindShortestRoute}
            disabled={loadingRoute || !currentLocation || !destination}
          >
            {loadingRoute ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Route className="mr-2 h-4 w-4" />
            )}
            Route
          </Button>
        </div>

        {routeResult && (
          <div className="mt-4 rounded-xl border bg-muted/40 p-3">
            <div className="text-sm font-semibold">Shortest route</div>
            <div className="mt-1 text-sm">
              {routeResult.distance_km.toFixed(2)} km ·{" "}
              {routeResult.duration_minutes.toFixed(1)} min
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Provider: {routeResult.routing_provider.toUpperCase()}
            </div>
          </div>
        )}

        {routeError && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {routeError}
          </div>
        )}
      </div>
    </div>
  );
}

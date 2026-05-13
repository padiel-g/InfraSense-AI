"use client";
/**
 * Crew Routing page.
 *
 * Lists every open incident from /api/v1/incidents/open beside a
 * Mapbox that pins each one with a severity-coloured
 * marker. The crew can:
 *
 *  - select an incident from either the list or the map
 *  - capture their current location with the browser's geolocation API
 *    or enter coordinates manually
 *  - calculate the shortest road route via /api/routing/shortest-route
 *    (OSRM-backed) — the route is drawn on the map and distance/ETA are
 *    surfaced in the sidebar
 *  - update the incident status (Assigned / In Progress / Resolved),
 *    which simultaneously updates the linked Alert row on the backend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Loader2, MapPin, Navigation, RefreshCw, Route,
} from "lucide-react";

import {
  calculateShortestRoute,
  fetchActiveIncidents,
  fetchIncident,
  fetchOsrmRoute,
  updateIncidentStatus,
} from "@/lib/api";
import { extractApiError } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Incident, OsrmRouteResponse, ShortestRouteResponse } from "@/types";

const IncidentMapboxMap = dynamic(
  () => import("@/components/crews/IncidentMapboxMap"),
  { ssr: false },
);

// Friendly labels (mirrors backend _ISSUE_TYPE_LABELS).
const ISSUE_LABELS: Record<string, string> = {
  illegal_dumping: "Illegal Dumping",
  water_leak: "Water Leak",
  burst_pipe: "Burst Pipe",
  sewer_burst: "Sewer Burst",
  blocked_drainage: "Blocked Drainage",
  water_quality: "Water Quality Problem",
  low_pressure: "Low Water Pressure",
  no_water: "No Water Supply",
  road_hazard: "Road or Municipal Hazard",
  other: "Municipal Issue",
};

function formatIssue(t?: string | null): string {
  if (!t) return "Incident";
  return ISSUE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityBadgeColor(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "emergency" || s === "critical") return "bg-red-900 text-white";
  if (s === "high") return "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400";
  if (s === "medium") return "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400";
  if (s === "low") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400";
  return "bg-muted text-muted-foreground";
}

function normalizeIncidentCoordinates(incident: Incident): Incident {
  return {
    ...incident,
    latitude: Number(incident.latitude),
    longitude: Number(incident.longitude),
  };
}

export default function CrewsPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  // ── Data ────────────────────────────────────────────────────────
  // Cache for 30 s so quickly switching tabs doesn't re-fetch every time.
  // Auto-refresh every 60 s so resolved incidents disappear from the map
  // without manual reload. Errors here never log the user out — the axios
  // refresh interceptor handles 401s, all other errors render an inline
  // banner with a Retry button.
  const {
    data: incidents,
    isLoading: incidentsLoading,
    error: incidentsError,
    refetch: refetchIncidents,
    isRefetching,
  } = useQuery({
    queryKey: ["incidents-active"],
    queryFn: fetchActiveIncidents,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ── Selection / location state ─────────────────────────────────
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>("");
  const [crewLat, setCrewLat] = useState<string>("");
  const [crewLng, setCrewLng] = useState<string>("");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [route, setRoute] = useState<OsrmRouteResponse | null>(null);
  const [routeRecommendation, setRouteRecommendation] = useState<ShortestRouteResponse["recommended_crew"] | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [remainingDistanceKm, setRemainingDistanceKm] = useState<number | null>(null);
  const [remainingEtaMin, setRemainingEtaMin] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const selectedIncidentRef = useRef<Incident | null>(null);
  const incidentIdFromUrl = searchParams.get("incidentId") ?? searchParams.get("incident");

  const {
    data: linkedIncident,
    isLoading: linkedIncidentLoading,
    error: linkedIncidentError,
  } = useQuery({
    queryKey: ["incident", incidentIdFromUrl],
    queryFn: () => fetchIncident(incidentIdFromUrl as string),
    enabled: Boolean(incidentIdFromUrl),
    staleTime: 30_000,
  });

  const activeIncidents = useMemo<Incident[]>(() => {
    const base = (incidents ?? []).map(normalizeIncidentCoordinates);
    if (!linkedIncident) return base;

    const normalizedLinkedIncident = normalizeIncidentCoordinates(linkedIncident);
    if (base.some((incident) => incident.id === normalizedLinkedIncident.id)) {
      return base.map((incident) => (
        incident.id === normalizedLinkedIncident.id ? normalizedLinkedIncident : incident
      ));
    }

    return [normalizedLinkedIncident, ...base];
  }, [incidents, linkedIncident]);

  // Pre-select an incident if /crews?incidentId=<id> is in the URL
  // (Alerts page "View on Map" deep-link).
  useEffect(() => {
    if (incidentIdFromUrl && selectedIncidentId !== incidentIdFromUrl) {
      setSelectedIncidentId(incidentIdFromUrl);
    }
  }, [incidentIdFromUrl, selectedIncidentId]);

  const selectedIncident = useMemo(
    () => activeIncidents.find((i) => i.id === selectedIncidentId) ?? null,
    [activeIncidents, selectedIncidentId],
  );

  useEffect(() => {
    selectedIncidentRef.current = selectedIncident;
  }, [selectedIncident]);

  const crewLocation = useMemo(() => {
    const lat = Number.parseFloat(crewLat);
    const lng = Number.parseFloat(crewLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [crewLat, crewLng]);

  // Reset the drawn route whenever the selected incident changes.
  useEffect(() => {
    setRoute(null);
    setRouteRecommendation(null);
    setRemainingDistanceKm(null);
    setRemainingEtaMin(null);
    setRouteError(null);
  }, [selectedIncidentId]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // ── Geolocation ────────────────────────────────────────────────
  function handleUseMyLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCrewLat(pos.coords.latitude.toFixed(6));
        setCrewLng(pos.coords.longitude.toFixed(6));
      },
      (err) => {
        const msg =
          err.code === 1 ? "Location permission denied. Allow location access or enter coordinates manually."
          : err.code === 2 ? "Location unavailable. Try again or enter coordinates manually."
          : "Could not get your location. Try again or enter coordinates manually.";
        setGeoError(msg);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  function setCrewLocation(location: { lat: number; lng: number }) {
    setCrewLat(location.lat.toFixed(6));
    setCrewLng(location.lng.toFixed(6));
  }

  // ── Route calculation ──────────────────────────────────────────
  const routeMutation = useMutation({
    mutationFn: (input?: { incident?: Incident; origin?: { lat: number; lng: number } }) => {
      const incident = input?.incident ?? selectedIncident;
      const origin = input?.origin ?? crewLocation;
      if (!incident) throw new Error("Select an incident first.");
      if (!origin) throw new Error("Set your current location.");
      return Promise.allSettled([
        fetchOsrmRoute(origin, {
          lat: incident.latitude,
          lng: incident.longitude,
        }),
        calculateShortestRoute({
          incident_id: incident.id,
          origin,
        }),
      ]).then(([routeResult, recommendationResult]) => {
        if (routeResult.status === "rejected") throw routeResult.reason;
        return {
          route: routeResult.value,
          recommendation: recommendationResult.status === "fulfilled"
            ? recommendationResult.value.recommended_crew
            : null,
        };
      });
    },
    onSuccess: (data) => {
      setRoute(data.route);
      setRemainingDistanceKm(data.route.distance_km);
      setRemainingEtaMin(data.route.duration_min);
      setRouteRecommendation(data.recommendation);
      setRouteError(null);
    },
    onError: (err) => {
      setRouteError(extractApiError(err, "Could not calculate the route. Please try again."));
      setRoute(null);
      setRemainingDistanceKm(null);
      setRemainingEtaMin(null);
      setRouteRecommendation(null);
    },
  });

  function calculateRouteFrom(location: { lat: number; lng: number }, incident = selectedIncidentRef.current) {
    if (!incident) return;
    routeMutation.mutate({ incident, origin: location });
  }

  function handleMapCrewLocation(location: { lat: number; lng: number }) {
    setCrewLocation(location);
    if (selectedIncidentRef.current) {
      calculateRouteFrom(location, selectedIncidentRef.current);
    }
  }

  function handleStartTracking() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not available in this browser.");
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setIsTracking(false);
      return;
    }

    setIsTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setCrewLocation(location);
        if (selectedIncidentRef.current) {
          calculateRouteFrom(location, selectedIncidentRef.current);
        }
      },
      (err) => {
        const msg =
          err.code === 1 ? "Location permission denied. Allow location access or enter coordinates manually."
          : err.code === 2 ? "Location unavailable. Try again or enter coordinates manually."
          : "Could not track your location. Try again or enter coordinates manually.";
        setGeoError(msg);
        setIsTracking(false);
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 },
    );
  }

  // ── Status updates (Assign / In Progress / Resolved) ───────────
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateIncidentStatus(id, status),
    onSuccess: (updated) => {
      setStatusMessage(`Incident marked ${updated.status.replace(/_/g, " ")}.`);
      // Refresh both the open-incidents list and the alerts page cache
      // since the backend syncs the linked Alert row.
      queryClient.invalidateQueries({ queryKey: ["incidents-active"] });
      queryClient.invalidateQueries({ queryKey: ["alerts-feed"] });
      // If the incident was resolved, drop the local selection so the
      // user is nudged to pick the next one.
      if (updated.status === "resolved") {
        setSelectedIncidentId("");
        setRoute(null);
        setRemainingDistanceKm(null);
        setRemainingEtaMin(null);
      }
    },
    onError: (err) => {
      setStatusMessage(extractApiError(err, "Could not update the incident."));
    },
  });

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-6 min-h-full">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl p-3 bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400">
          <Route className="h-7 w-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Crew Routing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick an open incident, set your current location, and we&apos;ll plot the shortest road route via OSRM.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchIncidents()} disabled={isRefetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Left column — controls + lists */}
        <div className="xl:col-span-2 space-y-6">

          {/* Crew location */}
          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Your Current Location
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-3">
              <Button onClick={handleUseMyLocation} variant="outline" className="w-full">
                <Navigation className="mr-2 h-4 w-4" /> Use My Current Location
              </Button>
              <Button onClick={handleStartTracking} variant={isTracking ? "default" : "outline"} className="w-full">
                <MapPin className="mr-2 h-4 w-4" />
                {isTracking ? "Stop live tracking" : "Start live tracking"}
              </Button>
              <p className="text-xs text-muted-foreground">
                You can also click the map to set your current crew location and suggest the shortest route.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <span className="block text-xs font-medium text-muted-foreground">Latitude</span>
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="-19.451"
                    value={crewLat}
                    onChange={(e) => setCrewLat(e.target.value)}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-xs font-medium text-muted-foreground">Longitude</span>
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="29.816"
                    value={crewLng}
                    onChange={(e) => setCrewLng(e.target.value)}
                  />
                </label>
              </div>
              {geoError && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{geoError}</p>
              )}
              {crewLocation && (
                <p className="text-xs font-mono text-muted-foreground">
                  {crewLocation.lat.toFixed(5)}, {crewLocation.lng.toFixed(5)}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Selected incident & actions */}
          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Selected Incident</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              {selectedIncident ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{formatIssue(selectedIncident.issue_type ?? selectedIncident.incident_type)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {selectedIncident.address || "Geo-tagged location"}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${severityBadgeColor(selectedIncident.severity)}`}>
                      {selectedIncident.severity}
                    </span>
                  </div>
                  {selectedIncident.description && (
                    <p className="text-xs text-muted-foreground">{selectedIncident.description}</p>
                  )}
                  <p className="font-mono text-xs text-muted-foreground">
                    {selectedIncident.latitude.toFixed(5)}, {selectedIncident.longitude.toFixed(5)}
                  </p>
                  <Badge variant="outline" className="capitalize">{selectedIncident.status.replace(/_/g, " ")}</Badge>

                  <Button
                    className="w-full"
                    onClick={() => routeMutation.mutate(undefined)}
                    disabled={routeMutation.isPending || !crewLocation}
                  >
                    {routeMutation.isPending
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Calculating route…</>
                      : <><Navigation className="mr-2 h-4 w-4" /> Calculate Shortest Route</>}
                  </Button>

                  {routeError && (
                    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
                      {routeError}
                    </p>
                  )}

                  {route && (
                    <div className="grid grid-cols-2 gap-3">
                      <SummaryTile label="Distance" value={`${route.distance_km.toFixed(2)} km`} />
                      <SummaryTile label="ETA" value={`${route.duration_min.toFixed(0)} min`} />
                      <SummaryTile label="Distance left" value={remainingDistanceKm == null ? "—" : `${remainingDistanceKm.toFixed(2)} km`} />
                      <SummaryTile label="ETA left" value={remainingEtaMin == null ? "—" : `${remainingEtaMin.toFixed(0)} min`} />
                    </div>
                  )}

                  {routeRecommendation && (
                    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                      <p className="text-xs font-medium text-muted-foreground">Recommended crew</p>
                      <p className="mt-1 font-semibold">{routeRecommendation.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {routeRecommendation.distance_km.toFixed(2)} km away - ETA {routeRecommendation.eta_min.toFixed(0)} min
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ id: selectedIncident.id, status: "assigned" })}
                    >
                      Assign to Me
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ id: selectedIncident.id, status: "in_progress" })}
                    >
                      In Progress
                    </Button>
                    <Button
                      size="sm"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ id: selectedIncident.id, status: "resolved" })}
                    >
                      Resolved
                    </Button>
                  </div>
                  {statusMessage && (
                    <p className="text-xs text-muted-foreground">{statusMessage}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select an incident from the list or click a marker on the map.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Open incidents list */}
          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Active Incidents ({activeIncidents.length})</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {incidentsLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )}
              {incidentsError && (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                  <AlertCircle className="h-6 w-6" />
                  <p className="text-sm">Failed to load incidents.</p>
                  <Button variant="outline" size="sm" onClick={() => refetchIncidents()}>Retry</Button>
                </div>
              )}
              {incidentIdFromUrl && linkedIncidentLoading && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading the selected resident report...
                </div>
              )}
              {incidentIdFromUrl && linkedIncidentError && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                  <AlertCircle className="h-3.5 w-3.5" />
                  The selected incident could not be loaded directly. Showing currently active incidents.
                </div>
              )}
              {!incidentsLoading && !incidentsError && activeIncidents.length === 0 && (
                <p className="text-sm text-muted-foreground">No active incidents right now.</p>
              )}
              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {activeIncidents.map((incident) => {
                  const selected = incident.id === selectedIncidentId;
                  return (
                    <button
                      key={incident.id}
                      type="button"
                      onClick={() => setSelectedIncidentId(incident.id)}
                      className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                        selected
                          ? "border-blue-600 bg-blue-50 dark:bg-blue-950/30"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {formatIssue(incident.issue_type ?? incident.incident_type)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {incident.address || `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`}
                          </p>
                        </div>
                        <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${severityBadgeColor(incident.severity)}`}>
                          {incident.severity}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="capitalize">{incident.status.replace(/_/g, " ")}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column — Mapbox map */}
        <Card className="xl:col-span-3">
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Incident Map
              <span className="ml-auto text-xs text-muted-foreground font-normal">
                Mapbox Streets
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <IncidentMapboxMap
              incidents={activeIncidents}
              selectedIncidentId={selectedIncidentId || null}
              onSelectIncident={setSelectedIncidentId}
              onCalculateRoute={(incidentId) => {
                const incident = activeIncidents.find((item) => item.id === incidentId);
                setSelectedIncidentId(incidentId);
                if (incident) {
                  routeMutation.mutate({ incident });
                } else {
                  setRouteError("Select an incident first.");
                }
              }}
              onSetCrewLocation={handleMapCrewLocation}
              crewLocation={crewLocation}
              route={route}
            />
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <LegendDot color="#16a34a" label="Low" />
              <LegendDot color="#f97316" label="Medium" />
              <LegendDot color="#ef4444" label="High" />
              <LegendDot color="#7f1d1d" label="Emergency / Critical" />
              <LegendDot color="#2563eb" label="Crew location" outline />
              <LegendLine color="#2563eb" label="Route" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function LegendDot({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block rounded-full"
        style={{
          width: 10,
          height: 10,
          background: color,
          border: outline ? "2px solid white" : undefined,
          boxShadow: outline ? "0 0 0 1px #94a3b8" : undefined,
        }}
      />
      {label}
    </span>
  );
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block" style={{ width: 18, height: 3, background: color, borderRadius: 2 }} />
      {label}
    </span>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { useIncidents } from "@/hooks/useIncidents";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

function formatIncidentType(type?: string | null) {
  if (!type) return "Incident";
  return ISSUE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function imageUrl(src?: string | null) {
  if (!src) return null;
  return src.startsWith("http") ? src : `${API_BASE}${src}`;
}

export default function IncidentsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data, isLoading, error, refetch } = useIncidents({
    status: statusFilter !== "all" ? statusFilter : undefined,
    severity: severityFilter !== "all" ? severityFilter : undefined,
    incident_type: typeFilter !== "all" ? typeFilter : undefined,
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Incidents</h1>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="reported">Reported</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="burst">Burst</SelectItem>
              <SelectItem value="leak">Leak</SelectItem>
              <SelectItem value="overflow">Overflow</SelectItem>
              <SelectItem value="blockage">Blockage</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p>Failed to load incidents</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !error && (!data || data.length === 0) && (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p>No incidents found</p>
        </div>
      )}

      {!isLoading && !error && data && data.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Found {data.length} incident(s)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((incident) => {
              const hasLocation = Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude);
              return (
                <Card key={incident.id}>
                  <CardContent className="space-y-4 p-4">
                    {imageUrl(incident.image_url) && (
                      <div className="overflow-hidden rounded-lg border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageUrl(incident.image_url) as string}
                          alt={`${formatIncidentType(incident.issue_type ?? incident.incident_type)} image`}
                          className="h-44 w-full object-cover"
                        />
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold">{formatIncidentType(incident.issue_type ?? incident.incident_type)}</h2>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {incident.address || (hasLocation ? `${incident.latitude.toFixed(5)}, ${incident.longitude.toFixed(5)}` : "No location available")}
                        </p>
                      </div>
                      <span className="rounded-full border px-2 py-0.5 text-xs font-medium capitalize">
                        {incident.severity}
                      </span>
                    </div>

                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Status</dt>
                        <dd className="font-medium capitalize">{incident.status.replace(/_/g, " ")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Reported</dt>
                        <dd className="font-medium">{new Date(incident.reported_at).toLocaleString()}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted-foreground">Reported by</dt>
                        <dd className="font-medium">
                          {incident.reporter_name || incident.reporter_email || incident.reporter_phone || "Anonymous resident"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted-foreground">Location</dt>
                        <dd className="font-mono text-[11px]">
                          {hasLocation ? `${incident.latitude.toFixed(5)}, ${incident.longitude.toFixed(5)}` : "No location available for this incident."}
                        </dd>
                      </div>
                    </dl>

                    {incident.description && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{incident.description}</p>
                    )}

                    {hasLocation ? (
                      <Button asChild size="sm" className="w-full">
                        <Link href={`/crews?incidentId=${incident.id}`}>
                          <MapPin className="h-4 w-4" /> View on map
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" className="w-full" disabled title="No location available for this incident.">
                        <MapPin className="h-4 w-4" /> View on map
                      </Button>
                    )}
                    {!hasLocation && (
                      <p className="text-xs text-muted-foreground">No location available for this incident.</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

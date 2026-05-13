"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAlertsFeed, markAlertRead } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, RefreshCw, CheckCircle, Map as MapIcon } from "lucide-react";
import { formatDate, severityColor } from "@/lib/utils";

// Friendly labels — keep in sync with backend _ISSUE_TYPE_LABELS.
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

function formatIssueType(t: string): string {
  return ISSUE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AlertsPage() {
  const [severityFilter, setSeverityFilter] = useState("all");
  const queryClient = useQueryClient();

  // 30-second auto-refresh keeps the page lively without hammering the API.
  // Failures here intentionally do NOT log the user out — the axios refresh
  // interceptor already handles 401 transparently; other errors render an
  // inline retry block.
  const { data: alerts, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["alerts-feed", severityFilter],
    queryFn: () =>
      fetchAlertsFeed({
        severity: severityFilter === "all" ? undefined : severityFilter,
        limit: 200,
      }),
    refetchInterval: 30000,
  });

  const readMutation = useMutation({
    mutationFn: (id: string) => markAlertRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts-feed"] }),
  });

  const list = alerts ?? [];
  const isHighSeverity = (s: string) =>
    s === "high" || s === "emergency" || s === "critical";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Alerts</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="emergency">Emergency</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          {isRefetching && (
            <span className="text-xs text-muted-foreground self-center">Refreshing…</span>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Alert History{" "}
            <span className="text-muted-foreground font-normal">({list.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <AlertCircle className="h-8 w-8" />
              <p>Failed to load alerts</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
            </div>
          )}
          {!isLoading && !error && list.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <p>No alerts found for the selected filters.</p>
            </div>
          )}
          {!isLoading && !error && list.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Severity</th>
                    <th className="pb-2 pr-4 font-medium">Issue Type</th>
                    <th className="pb-2 pr-4 font-medium">Message</th>
                    <th className="pb-2 pr-4 font-medium">Location</th>
                    <th className="pb-2 pr-4 font-medium">Reported</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((alert) => {
                    // High / Emergency rows get a subtle red wash so the
                    // dispatcher's eye is drawn to them first.
                    const highlight = isHighSeverity(alert.severity)
                      ? "bg-red-50/60 dark:bg-red-950/20"
                      : "";
                    const unread = !alert.is_read ? "font-medium" : "";
                    return (
                      <tr
                        key={alert.id}
                        className={`border-b hover:bg-muted/50 ${highlight} ${unread}`}
                      >
                        <td className="py-3 pr-4">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${severityColor(alert.severity)}`}>
                            {alert.severity}
                          </span>
                        </td>
                        <td className="py-3 pr-4">{formatIssueType(alert.alert_type)}</td>
                        <td className="py-3 pr-4 max-w-md truncate" title={alert.message ?? undefined}>
                          {alert.message ?? alert.title}
                        </td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground font-mono">
                          {alert.latitude != null && alert.longitude != null
                            ? `${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}`
                            : "—"}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                          {formatDate(alert.created_at)}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant={
                              alert.status === "resolved" ? "success"
                              : alert.status === "in_progress" ? "default"
                              : "warning"
                            }
                          >
                            {alert.status.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex gap-2">
                            {alert.incident_id && (
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/crews?incident=${alert.incident_id}`}>
                                  <MapIcon className="mr-1 h-3.5 w-3.5" />
                                  View on Map
                                </Link>
                              </Button>
                            )}
                            {!alert.is_read && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={readMutation.isPending}
                                onClick={() => readMutation.mutate(alert.id)}
                              >
                                Mark read
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

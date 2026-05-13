"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useDumpingReports } from "@/hooks/useDumping";
import DetectionModal from "@/components/dumping/DetectionModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ImageIcon, Map, LayoutGrid } from "lucide-react";
import { formatRelativeTime, statusColor } from "@/lib/utils";
import type { DumpingReport } from "@/types";

const DumpingReportsMap = dynamic(
  () => import("@/components/dumping/DumpingReportsMap"),
  { ssr: false }
);

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type ViewMode = "grid" | "map";

export default function DumpingPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode]         = useState<ViewMode>("grid");
  const [selected, setSelected]         = useState<DumpingReport | null>(null);

  const { data, isLoading, error } = useDumpingReports({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const reports = data ?? [];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold">Illegal Dumping Detection</h1>

        {/* Summary counts */}
        {reports.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{reports.length} report{reports.length !== 1 ? "s" : ""}</span>
            {["detected", "verified", "rejected"].map((s) => {
              const count = reports.filter((r) => r.status === s).length;
              return count > 0 ? (
                <span key={s} className={`px-2 py-0.5 rounded-full font-semibold ${statusColor(s)}`}>
                  {count} {s}
                </span>
              ) : null;
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">

          {/* Filter + view toggle bar */}
          <Card>
            <CardContent className="flex items-center gap-3 p-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="detected">Detected</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="cleaned">Cleaned</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>

              {/* Grid / Map toggle */}
              <div className="ml-auto flex rounded-md border overflow-hidden">
                <Button
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none h-8 px-3"
                  onClick={() => setViewMode("grid")}
                >
                  <LayoutGrid className="h-4 w-4 mr-1.5" /> Grid
                </Button>
                <Button
                  variant={viewMode === "map" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none h-8 px-3 border-l"
                  onClick={() => setViewMode("map")}
                >
                  <Map className="h-4 w-4 mr-1.5" /> Map
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Loading skeletons */}
          {isLoading && (
            viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-44" />
                ))}
              </div>
            ) : (
              <Skeleton className="h-[420px] rounded-xl" />
            )
          )}

          {/* Error */}
          {error && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <AlertCircle className="h-8 w-8" />
              <p>Failed to load reports</p>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && reports.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
              <p>No dumping reports found</p>
            </div>
          )}

          {/* ── MAP VIEW ── */}
          {!isLoading && !error && reports.length > 0 && viewMode === "map" && (
            <div className="relative rounded-xl border overflow-hidden" style={{ height: "500px" }}>
              {/* Legend */}
              <div className="absolute z-10 m-3 bg-white dark:bg-zinc-900 rounded-lg border shadow-sm px-3 py-2 flex items-center gap-3 text-xs pointer-events-none">
                {[
                  { color: "#f59e0b", label: "Detected" },
                  { color: "#22c55e", label: "Verified" },
                  { color: "#3b82f6", label: "Cleaned" },
                  { color: "#6b7280", label: "Rejected" },
                ].map(({ color, label }) => (
                  <span key={label} className="flex items-center gap-1">
                    <span style={{ background: color, width: 10, height: 10, borderRadius: "50%", display: "inline-block", border: "1.5px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }} />
                    {label}
                  </span>
                ))}
              </div>
              <DumpingReportsMap reports={reports} onSelect={setSelected} />
            </div>
          )}

          {/* ── GRID VIEW ── */}
          {!isLoading && !error && reports.length > 0 && viewMode === "grid" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {reports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => setSelected(report)}
                  className="text-left rounded-lg border overflow-hidden hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {/* Thumbnail */}
                  <div className="h-32 bg-muted flex items-center justify-center overflow-hidden relative">
                    {report.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${API}${report.image_url}`}
                        alt="Dump site"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    )}
                    {/* Source badge */}
                    {report.source === "citizen" && (
                      <span className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        citizen
                      </span>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="p-2 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-xs rounded-full px-2 py-0.5 font-semibold ${statusColor(report.status)}`}>
                        {report.status}
                      </span>
                      {report.detection_confidence != null && (
                        <span className="text-xs text-muted-foreground">
                          {(report.detection_confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {report.suburb || `${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(report.detected_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
      </div>

      <DetectionModal report={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

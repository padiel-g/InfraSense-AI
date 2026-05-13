"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import BboxCanvas from "./BboxCanvas";
import { useDeleteDumpingImage, useVerifyDumping } from "@/hooks/useDumping";
import { extractApiError } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import type { DumpingReport } from "@/types";
import {
  MapPin, Calendar, Gauge, Tag, User, FileText,
  CheckCircle, XCircle, Clock, Trash2,
} from "lucide-react";

const ReportDetailMap = dynamic(() => import("./ReportDetailMap"), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Props { report: DumpingReport | null; onClose: () => void }

function statusBadgeClass(status: string) {
  switch (status) {
    case "verified": return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
    case "rejected": return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
    case "cleaned":  return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
    default:         return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  }
}

function DetailRow({ icon, label, value }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
        <div className="text-sm font-medium break-words">{value ?? "—"}</div>
      </div>
    </div>
  );
}

export default function DetectionModal({ report, onClose }: Props) {
  const { mutate: verify, isPending } = useVerifyDumping();
  const { mutate: deleteImage, isPending: isDeletingImage } = useDeleteDumpingImage();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!report) return null;

  const imageUrl   = report.image_url ? `${API}${report.image_url}` : null;
  const boxes      = report.bounding_boxes ?? [];
  const categories = report.waste_categories
    ? report.waste_categories.split(",").map((c) => c.trim()).filter(Boolean)
    : [];
  const locationLabel = report.suburb || report.address || null;
  const reportId = report.id;
  const hasImage = Boolean(report.image_url);

  function handleDeleteImage() {
    if (!hasImage) return;
    setDeleteError(null);
    const confirmed = window.confirm(
      "Delete this uploaded image from the dumping report? The report and location will remain."
    );
    if (!confirmed) return;
    deleteImage(reportId, {
      onSuccess: onClose,
      onError: (err) => {
        setDeleteError(extractApiError(err, "Image could not be deleted. Please try again."));
      },
    });
  }

  return (
    <Dialog open={!!report} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-3 text-base">
            Dumping Report
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusBadgeClass(report.status)}`}>
              {report.status.charAt(0).toUpperCase() + report.status.slice(1)}
            </span>
            {report.source === "citizen" && (
              <span className="ml-auto text-xs text-muted-foreground font-normal flex items-center gap-1">
                <User className="h-3.5 w-3.5" /> Citizen Report
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-5">

          {/* ── Image + Map ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Photo with YOLO bounding boxes */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Photo Evidence
              </p>
              <div className="rounded-lg overflow-hidden bg-muted border flex items-center justify-center min-h-[200px]">
                {imageUrl ? (
                  <BboxCanvas imageUrl={imageUrl} boxes={boxes} />
                ) : (
                  <p className="text-sm text-muted-foreground p-8">No image available</p>
                )}
              </div>
              {boxes.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {boxes.length} detection{boxes.length !== 1 ? "s" : ""} highlighted
                </p>
              )}
            </div>

            {/* GIS map — exact GPS pin */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> GPS Location
              </p>
              <div className="rounded-lg overflow-hidden border" style={{ height: "220px" }}>
                <ReportDetailMap
                  latitude={report.latitude}
                  longitude={report.longitude}
                  label={locationLabel}
                />
              </div>
              <p className="text-xs font-mono text-muted-foreground">
                {report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}
              </p>
            </div>
          </div>

          {/* ── Details ── */}
          <div className="rounded-lg border bg-card px-4 py-1">
            <DetailRow
              icon={<MapPin className="h-4 w-4" />}
              label="Address / Suburb"
              value={[report.address, report.suburb].filter(Boolean).join(" · ") || "Not provided"}
            />
            <DetailRow
              icon={<Calendar className="h-4 w-4" />}
              label="Reported at"
              value={formatDate(report.detected_at)}
            />
            {report.capture_date && (
              <DetailRow
                icon={<Clock className="h-4 w-4" />}
                label="Photo captured"
                value={formatDate(report.capture_date)}
              />
            )}
            <DetailRow
              icon={<Gauge className="h-4 w-4" />}
              label="Detection confidence"
              value={
                report.detection_confidence != null ? (
                  <span className="flex items-center gap-2">
                    {(report.detection_confidence * 100).toFixed(1)}%
                    <span
                      className="inline-block h-2 rounded-full"
                      style={{
                        width: "80px",
                        background: `linear-gradient(to right,
                          #22c55e ${(report.detection_confidence * 100).toFixed(0)}%,
                          #e5e7eb ${(report.detection_confidence * 100).toFixed(0)}%)`,
                      }}
                    />
                  </span>
                ) : "—"
              }
            />
            <DetailRow
              icon={<Tag className="h-4 w-4" />}
              label="Waste categories"
              value={
                categories.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {categories.map((c) => (
                      <span
                        key={c}
                        className="bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 text-xs px-2 py-0.5 rounded-full"
                      >
                        {c}
                      </span>
                    ))}
                  </span>
                ) : "Not classified"
              }
            />
            {report.description && (
              <DetailRow
                icon={<FileText className="h-4 w-4" />}
                label="Citizen description"
                value={report.description}
              />
            )}
          </div>

          {/* ── Actions ── */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!report.is_verified && report.status !== "rejected" && (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => verify({ id: report.id, verified: true }, { onSuccess: onClose })}
                disabled={isPending}
              >
                <CheckCircle className="h-4 w-4 mr-1.5" />
                Verify Report
              </Button>
            )}
            {report.status !== "rejected" && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => verify({ id: report.id, verified: false }, { onSuccess: onClose })}
                disabled={isPending}
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Reject
              </Button>
            )}
            {hasImage && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleDeleteImage}
                disabled={isDeletingImage}
                className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                {isDeletingImage ? "Deleting..." : "Delete image"}
              </Button>
            )}
            {deleteError && (
              <p className="basis-full text-xs text-red-600 dark:text-red-400">
                {deleteError}
              </p>
            )}
            <Button size="sm" variant="outline" className="ml-auto" onClick={onClose}>
              Close
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

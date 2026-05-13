"use client";
import { useState, useCallback, useRef } from "react";
import { useReportDumping } from "@/hooks/useDumping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, CheckCircle, Loader2, X, MapPin } from "lucide-react";
import type { DumpingDetectionResult } from "@/types";

export default function UploadPanel() {
  const [file, setFile]     = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [lat, setLat]       = useState("");
  const [lng, setLng]       = useState("");
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<DumpingDetectionResult | null>(null);
  const fileInputRef        = useRef<HTMLInputElement>(null);
  const { mutate, isPending } = useReportDumping();

  // ── File selection (no camera — staff uses existing images/evidence) ──
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  const clearFile = useCallback(() => {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── GPS helper ──
  function getGPS() {
    setGpsState("loading");
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setLat(String(p.coords.latitude));
        setLng(String(p.coords.longitude));
        setGpsState("done");
      },
      () => setGpsState("error"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // ── Submit ──
  function submit() {
    if (!file || !lat || !lng) return;
    const fd = new FormData();
    fd.append("image",     file);
    fd.append("latitude",  lat);
    fd.append("longitude", lng);
    mutate(fd, { onSuccess: (data) => setResult(data) });
  }

  // ── Success screen ──
  if (result) {
    return (
      <div className="rounded-lg border bg-green-50 dark:bg-green-950/20 p-4 space-y-2">
        <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-semibold">
          <CheckCircle className="h-5 w-5" /> Detection Complete
        </div>
        <p className="text-sm">
          Confidence: <strong>{(result.confidence * 100).toFixed(1)}%</strong>
        </p>
        <p className="text-sm">
          Categories: <strong>{result.waste_categories.join(", ") || "None detected"}</strong>
        </p>
        <p className="text-xs text-muted-foreground">
          Processed in {result.processing_time_ms.toFixed(0)} ms
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setResult(null); clearFile(); setLat(""); setLng(""); setGpsState("idle"); }}
        >
          Upload another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── File picker (no capture attribute — desktop/file only) ── */}
      <div>
        {preview ? (
          <div className="relative rounded-lg overflow-hidden border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Selected" className="w-full max-h-40 object-cover" />
            <button
              type="button"
              onClick={clearFile}
              className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <p className="text-xs text-muted-foreground px-2 py-1 truncate">{file?.name}</p>
          </div>
        ) : (
          <label className="block">
            <div className="rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/30">
              <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Click to select an image file</p>
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG or WebP · max 10 MB</p>
            </div>
            {/* No capture attribute — prevents mobile camera picker */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        )}
      </div>

      {/* ── Location ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={getGPS}
            disabled={gpsState === "loading"}
            className="shrink-0"
          >
            {gpsState === "loading"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              : <MapPin className="h-3.5 w-3.5 mr-1.5" />}
            {gpsState === "done" ? "GPS captured" : "Use my GPS"}
          </Button>
          {gpsState === "error" && (
            <span className="text-xs text-red-500">GPS unavailable — enter manually</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Latitude"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            inputMode="decimal"
          />
          <Input
            placeholder="Longitude"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>

      {/* ── Submit ── */}
      <Button
        onClick={submit}
        disabled={!file || !lat || !lng || isPending}
        className="w-full"
      >
        {isPending
          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing…</>
          : "Run Detection"}
      </Button>
    </div>
  );
}

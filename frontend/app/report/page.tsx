"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { useCreateIncident } from "@/hooks/useIncidents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Upload, MapPin, Loader2, AlertTriangle, Trash2, ArrowRight } from "lucide-react";

export default function PublicReportPage() {
  const router = useRouter();
  const { mutate, isPending } = useCreateIncident();
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    incident_type: "",
    description: "",
    latitude: "",
    longitude: "",
    address: "",
    reporter_phone: "",
  });
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    maxFiles: 1,
  });

  function captureGPS() {
    setGpsStatus("loading");
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setForm((f) => ({
          ...f,
          latitude: String(p.coords.latitude),
          longitude: String(p.coords.longitude),
        }));
        setGpsStatus("done");
      },
      () => setGpsStatus("error"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutate(
      {
        incident_type: form.incident_type,
        description: form.description || undefined,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        address: form.address || undefined,
        reporter_phone: form.reporter_phone || undefined,
      },
      {
        onSuccess: (data) => setTicketId(data.id),
      }
    );
  }

  // ── Success screen ──
  if (ticketId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Report Submitted!</h1>
        <p className="text-muted-foreground mb-4">
          Thank you. Your report has been received and will be reviewed shortly.
        </p>
        <div className="rounded-lg bg-muted px-6 py-4 font-mono text-sm mb-6">
          Ticket ID: <strong>{ticketId.slice(0, 8).toUpperCase()}</strong>
        </div>
        <Button
          onClick={() => {
            setTicketId(null);
            setForm({ incident_type: "", description: "", latitude: "", longitude: "", address: "", reporter_phone: "" });
            setFile(null);
            setGpsStatus("idle");
          }}
        >
          Submit Another Report
        </Button>
      </div>
    );
  }

  // ── Illegal dumping redirect card (shown when that type is selected) ──
  if (form.incident_type === "dumping") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border bg-card shadow-sm p-8 text-center space-y-5">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 mx-auto">
            <Trash2 className="h-8 w-8 text-orange-600 dark:text-orange-400" />
          </div>

          <div>
            <h2 className="text-xl font-bold mb-2">Reporting Illegal Dumping?</h2>
            <p className="text-sm text-muted-foreground">
              We have a dedicated portal for illegal dumping reports. It automatically captures
              your GPS location and photo evidence — no manual steps needed.
            </p>
          </div>

          <Button
            className="w-full bg-orange-600 hover:bg-orange-700 text-white"
            size="lg"
            onClick={() => router.push("/resident")}
          >
            Go to Dumping Report Portal
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>

          <button
            type="button"
            className="text-sm text-muted-foreground underline underline-offset-2"
            onClick={() => setForm({ ...form, incident_type: "" })}
          >
            ← Choose a different issue type
          </button>
        </div>
      </div>
    );
  }

  // ── Main form ──
  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-4">
      <div className="w-full max-w-md space-y-6 pt-8">

        {/* Header */}
        <div className="text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-2" />
          <h1 className="text-2xl font-bold">Report an Issue</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Help us identify water and environmental problems in your area.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Issue type — now includes Illegal Dumping */}
          <div>
            <label className="text-sm font-medium mb-1 block">Issue Type *</label>
            <Select
              value={form.incident_type}
              onValueChange={(v) => setForm({ ...form, incident_type: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select issue type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="burst">Burst Pipe</SelectItem>
                <SelectItem value="leak">Water Leak</SelectItem>
                <SelectItem value="overflow">Sewer Overflow</SelectItem>
                <SelectItem value="blockage">Blockage</SelectItem>
                <SelectItem value="dumping">
                  <span className="flex items-center gap-2">
                    <Trash2 className="h-3.5 w-3.5 text-orange-500" />
                    Illegal Dumping
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Photo */}
          <div>
            <label className="text-sm font-medium mb-1 block">Photo (optional)</label>
            <div
              {...getRootProps()}
              className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                isDragActive ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="mx-auto h-6 w-6 text-muted-foreground mb-1" />
              {file ? (
                <p className="text-sm font-medium text-green-600">{file.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Tap to add photo</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Textarea
              placeholder="Describe what you see..."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>

          {/* GPS */}
          <div>
            <label className="text-sm font-medium mb-1 block">Location *</label>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={captureGPS}
              disabled={gpsStatus === "loading"}
            >
              {gpsStatus === "loading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {gpsStatus === "done"
                ? <MapPin className="mr-2 h-4 w-4 text-green-500" />
                : <MapPin className="mr-2 h-4 w-4" />}
              {gpsStatus === "done"
                ? `${parseFloat(form.latitude).toFixed(4)}, ${parseFloat(form.longitude).toFixed(4)}`
                : gpsStatus === "error"
                ? "GPS unavailable — enter manually"
                : "Capture my GPS location"}
            </Button>
            {(gpsStatus === "error" || !form.latitude) && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input
                  placeholder="Latitude"
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                  inputMode="decimal"
                />
                <Input
                  placeholder="Longitude"
                  value={form.longitude}
                  onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                  inputMode="decimal"
                />
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Street Address (optional)</label>
            <Input
              placeholder="e.g. Near Mkoba Shopping Centre, Gweru"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Your Phone (optional)</label>
            <Input
              type="tel"
              placeholder="For follow-up contact"
              value={form.reporter_phone}
              onChange={(e) => setForm({ ...form, reporter_phone: e.target.value })}
              inputMode="tel"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isPending || !form.incident_type || !form.latitude || !form.longitude}
          >
            {isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
              : "Submit Report"}
          </Button>
        </form>
      </div>
    </div>
  );
}

"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera, Upload, MapPin, Loader2, CheckCircle,
  X, RefreshCw, AlertTriangle, Navigation, Trash2,
  Droplets, Wrench, Waves, FlaskConical, GaugeCircle,
  Power, TriangleAlert, HelpCircle, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { analyseDumpingImage, reportIncident } from "@/lib/api";
import { extractApiError } from "@/lib/utils";
import type { DumpingImageAnalysisResult, IncidentReportResult } from "@/types";

const LocationMap = dynamic(() => import("@/components/resident/LocationMap"), { ssr: false });
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WHATSAPP_PHONE_DISPLAY = "0782278361";
const WHATSAPP_LINK = "https://wa.me/263782278361";

type GpsState = "idle" | "loading" | "done" | "error";
type CameraState = "idle" | "active" | "captured";
type AutoStep = "gps" | "sending" | null;
type ValidationStep = "idle" | "analysing" | "done" | "error";

interface Coords { lat: number; lng: number }

type IssueKey =
  | "illegal_dumping"
  | "water_leak"
  | "burst_pipe"
  | "sewer_burst"
  | "blocked_drainage"
  | "water_quality"
  | "low_pressure"
  | "no_water"
  | "road_hazard"
  | "other";

type SeverityKey = "low" | "medium" | "high" | "emergency";

interface IssueOption {
  key: IssueKey;
  label: string;
  category: string;
  placeholder: string;
  Icon: typeof Trash2;
}

// Order matches the spec; category drives the small caption shown under the title.
const ISSUE_OPTIONS: readonly IssueOption[] = [
  { key: "illegal_dumping",  label: "Illegal Dumping",         category: "Environmental",            placeholder: "Describe what you see — type of waste, how long it's been there, etc.",  Icon: Trash2 },
  { key: "water_leak",       label: "Water Leak",              category: "Water infrastructure",     placeholder: "Where is the leak? How big is it? Any wet patches or running water?",   Icon: Droplets },
  { key: "burst_pipe",       label: "Burst Pipe",              category: "Emergency · water",        placeholder: "Describe the burst — visible jet, flooding, location of pipe.",         Icon: Wrench },
  { key: "sewer_burst",      label: "Sewer Burst",             category: "Sewer",                    placeholder: "Describe the sewage overflow — strong smell, manhole, drain, etc.",     Icon: Waves },
  { key: "blocked_drainage", label: "Blocked Drainage",        category: "Drainage",                 placeholder: "Where is the blockage? Standing water, backflow, blocked storm drain?",  Icon: Waves },
  { key: "water_quality",    label: "Water Quality Problem",   category: "Water quality",            placeholder: "Colour, smell, taste, particles. When did you first notice it?",        Icon: FlaskConical },
  { key: "low_pressure",     label: "Low Water Pressure",      category: "Water supply",             placeholder: "How long has pressure been low? Any taps with no flow at all?",         Icon: GaugeCircle },
  { key: "no_water",         label: "No Water Supply",         category: "Water supply",             placeholder: "When did supply stop? Whole street or only your property?",             Icon: Power },
  { key: "road_hazard",      label: "Road or Municipal Hazard", category: "Municipal hazard",        placeholder: "Describe the hazard — pothole, exposed wire, fallen tree, etc.",        Icon: TriangleAlert },
  { key: "other",            label: "Other",                   category: "General",                  placeholder: "Describe the issue you would like to report.",                          Icon: HelpCircle },
] as const;

const SEVERITY_OPTIONS: readonly { key: SeverityKey; label: string; tone: string }[] = [
  { key: "low",       label: "Low",       tone: "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" },
  { key: "medium",    label: "Medium",    tone: "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" },
  { key: "high",      label: "High",      tone: "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400" },
  { key: "emergency", label: "Emergency", tone: "border-red-600 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400" },
] as const;

export default function ResidentReportPage() {
  const router = useRouter();
  // Camera / image
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState]   = useState<CameraState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob]   = useState<Blob | null>(null);
  const [uploadedFile, setUploadedFile]   = useState<File | null>(null);

  // GPS
  const [coords,   setCoords]   = useState<Coords | null>(null);
  const [gpsState, setGpsState] = useState<GpsState>("idle");

  // Form
  const descRef    = useRef("");          // refs so the auto-flow closure captures latest value
  const addressRef = useRef("");
  const issueRef    = useRef<IssueKey>("illegal_dumping");
  const severityRef = useRef<SeverityKey>("medium");
  const [description, setDescription] = useState("");
  const [address,     setAddress]     = useState("");
  const [issueType, setIssueType]     = useState<IssueKey>("illegal_dumping");
  const [severity,  setSeverity]      = useState<SeverityKey>("medium");

  const activeIssue = ISSUE_OPTIONS.find((opt) => opt.key === issueType) ?? ISSUE_OPTIONS[0];

  // Submission
  const [autoStep,   setAutoStep]   = useState<AutoStep>(null); // drives the overlay
  const [submitting, setSubmitting] = useState(false);
  const [reportResult, setReportResult] = useState<IncidentReportResult | null>(null);
  const [mapNavigationError, setMapNavigationError] = useState("");
  const [error,      setError]      = useState("");
  const [validationStep, setValidationStep] = useState<ValidationStep>("idle");
  const [dumpingValidation, setDumpingValidation] = useState<DumpingImageAnalysisResult | null>(null);
  const isIllegalDumping = issueType === "illegal_dumping";
  const hasPhoto = Boolean(capturedBlob || uploadedFile);
  const dumpingReadyToSubmit = !isIllegalDumping || dumpingValidation?.status === "suspected_illegal_dumping";

  // Keep refs in sync with state so closures always see fresh values
  useEffect(() => { descRef.current     = description; }, [description]);
  useEffect(() => { addressRef.current  = address;     }, [address]);
  useEffect(() => { issueRef.current    = issueType;   }, [issueType]);
  useEffect(() => { severityRef.current = severity;    }, [severity]);
  useEffect(() => {
    setDumpingValidation(null);
    setValidationStep("idle");
  }, [issueType]);

  // Stop camera stream on unmount
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  // ── GPS (promise-based) ───────────────────────────────────────────
  const getGPS = useCallback((): Promise<Coords> => {
    setGpsState("loading");
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        setGpsState("error");
        reject(new Error("no_geolocation"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCoords(c);
          setGpsState("done");
          resolve(c);
        },
        (err) => {
          setGpsState("error");
          // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
          const type = err.code === 1 ? "gps_denied" : "gps_unavailable";
          reject(new Error(type));
        },
        { enableHighAccuracy: true, timeout: 12000 }
      );
    });
  }, []);

  // Manual GPS retry button
  const retryGPS = useCallback(() => { getGPS().catch(() => {}); }, [getGPS]);

  // ── Core submit logic ─────────────────────────────────────────────
  // Every issue type — including illegal_dumping — flows through the
  // single /api/v1/incidents/report endpoint. The backend creates an
  // Incident row + an Alert row in one transaction, so the report
  // appears immediately on the Alerts page and the Crew Routing map.
  async function doSubmit(blob: Blob | null, file: File | null, location: Coords) {
    const fd = new FormData();
    fd.append("issue_type", issueRef.current);
    fd.append("severity",   severityRef.current);
    fd.append("latitude",   String(location.lat));
    fd.append("longitude",  String(location.lng));
    fd.append("source",     "resident_portal");
    if (descRef.current)    fd.append("description", descRef.current);
    if (addressRef.current) fd.append("address",     addressRef.current);
    if (issueRef.current === "illegal_dumping") {
      if (!blob && !file) {
        throw new Error("A photo is required for Illegal Dumping reports.");
      }
      if (dumpingValidation?.status !== "suspected_illegal_dumping") {
        throw new Error("Please analyse a clear illegal dumping photo before submitting.");
      }
      fd.append("yolo_status", dumpingValidation.status);
      fd.append("yolo_confidence", String(dumpingValidation.confidence));
    }
    if (blob) fd.append("photo", blob,  "incident_photo.jpg");
    else if (file) fd.append("photo", file, file.name);

    const result = await reportIncident(fd);
    setReportResult(result);
  }

  async function analyseIllegalDumpingPhoto(blob: Blob | null, file: File | null) {
    setError("");
    setDumpingValidation(null);
    if (!blob && !file) {
      setValidationStep("idle");
      return;
    }
    setValidationStep("analysing");
    try {
      const fd = new FormData();
      if (blob) fd.append("image", blob, "incident_photo.jpg");
      else if (file) fd.append("image", file, file.name);
      const result = await analyseDumpingImage(fd);
      setDumpingValidation(result);
      setValidationStep("done");
      if (result.status === "not_illegal_dumping") {
        setError("The image does not appear to show illegal dumping. Please retake the photo if this is incorrect, or choose another issue type if you are reporting a different municipal problem.");
      } else if (result.status === "needs_manual_review") {
        setError(result.message || "The image is unclear. Please retake or upload a clearer photo.");
      }
    } catch (err: unknown) {
      setValidationStep("error");
      setError(extractApiError(err, "Image analysis failed. Please retake or upload a clearer photo."));
    }
  }

  // ── Auto-flow: GPS → submit (triggered on photo capture / upload) ─
  async function autoLocateAndSend(blob: Blob | null, file: File | null) {
    setError("");
    setSubmitting(true);

    try {
      // Step 1 — get GPS (reuse existing coords if already captured)
      setAutoStep("gps");
      const location = coords ?? await getGPS();

      // Step 2 — submit
      setAutoStep("sending");
      await doSubmit(blob, file, location);
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      if (msg === "gps_denied" || msg === "no_geolocation") {
        setError(
          "GPS access was denied. Enter your coordinates below and tap Submit Report."
        );
      } else if (msg === "gps_unavailable") {
        setError(
          "GPS signal not available (timeout or no signal). Tap Retry GPS or enter coordinates manually."
        );
      } else {
        setError(extractApiError(err, "Submission failed. Please check your connection and try again."));
      }
    } finally {
      setAutoStep(null);
      setSubmitting(false);
    }
  }

  // ── Camera helpers ────────────────────────────────────────────────
  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraState("active");
    } catch {
      setError("Camera not available. Please allow camera access or upload a photo instead.");
    }
  }

  function capturePhoto() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    setCapturedImage(canvas.toDataURL("image/jpeg", 0.85));
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraState("captured");
    // Blob → auto-locate → auto-send
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedBlob(blob);
        if (issueRef.current === "illegal_dumping") {
          analyseIllegalDumpingPhoto(blob, null);
        } else {
          autoLocateAndSend(blob, null);
        }
      }
    }, "image/jpeg", 0.85);
  }

  function resetCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCapturedImage(null);
    setCapturedBlob(null);
    setDumpingValidation(null);
    setValidationStep("idle");
    setCameraState("idle");
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadedFile(f);
    setCapturedImage(URL.createObjectURL(f));
    setCapturedBlob(null);
    if (issueRef.current === "illegal_dumping") {
      analyseIllegalDumpingPhoto(null, f);
    } else {
      autoLocateAndSend(null, f);
    }
  }

  // ── Manual submit (fallback when auto-flow GPS fails) ─────────────
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (issueRef.current === "illegal_dumping" && !capturedBlob && !uploadedFile) {
      setError("A photo is required. Please take or upload one first.");
      return;
    }
    if (issueRef.current === "illegal_dumping" && dumpingValidation?.status !== "suspected_illegal_dumping") {
      setError("Please analyse a clear illegal dumping photo before submitting.");
      return;
    }
    if (!coords) {
      setError("Enter your coordinates manually and try again.");
      return;
    }
    setSubmitting(true);
    try { await doSubmit(capturedBlob, uploadedFile, coords); }
    catch (err: unknown) {
      setError(extractApiError(err, "Submission failed. Please try again."));
    } finally { setSubmitting(false); }
  }

  function resetForm() {
    resetCamera();
    setUploadedFile(null);
    setCoords(null);
    setDescription("");
    setAddress("");
    setIssueType("illegal_dumping");
    setSeverity("medium");
    setReportResult(null);
    setMapNavigationError("");
    setError("");
    setDumpingValidation(null);
    setValidationStep("idle");
    setGpsState("idle");
  }

  // ── Success screen ────────────────────────────────────────────────
  if (reportResult) {
    const incident = reportResult.incident;
    const incidentTypeLabel = ISSUE_OPTIONS.find((opt) => opt.key === incident.issue_type)?.label
      ?? incident.issue_type?.replace(/_/g, " ")
      ?? incident.incident_type.replace(/_/g, " ");
    const hasLocation = Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude);
    const imageSrc = incident.image_url
      ? incident.image_url.startsWith("http")
        ? incident.image_url
        : `${API_BASE}${incident.image_url}`
      : capturedImage;

    function handleViewOnMap() {
      if (!hasLocation) return;
      try {
        router.push(`/crews?incidentId=${incident.id}`);
      } catch {
        setMapNavigationError("Incident submitted, but map could not be opened.");
      }
    }

    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-green-100 p-3 text-green-700 dark:bg-green-500/15 dark:text-green-300">
              <CheckCircle className="h-8 w-8" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold">Incident reported successfully</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Thank you. Your report has been submitted and sent to the response team.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_220px]">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <ResultItem label="Incident type" value={incidentTypeLabel} />
              <ResultItem label="Severity" value={incident.severity} capitalize />
              <ResultItem label="Status" value={incident.status.replace(/_/g, " ")} capitalize />
              <ResultItem label="Reported" value={new Date(incident.reported_at).toLocaleString()} />
              <ResultItem
                label="Location"
                value={hasLocation ? `${incident.latitude.toFixed(5)}, ${incident.longitude.toFixed(5)}` : "No location available"}
              />
              <ResultItem label="Incident reference ID" value={incident.id} mono />
              {incident.address && <ResultItem label="Address" value={incident.address} />}
            </dl>

            {imageSrc && (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageSrc} alt="Uploaded incident" className="h-44 w-full rounded-lg border object-cover" />
              </div>
            )}
          </div>

          {!hasLocation && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              No location available for this incident.
            </p>
          )}
          {mapNavigationError && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
              {mapNavigationError}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={handleViewOnMap} disabled={!hasLocation}>
              <MapPin className="mr-2 h-4 w-4" /> View incident on map
            </Button>
            <Button onClick={resetForm} variant="outline">Report another incident</Button>
            <Button asChild variant="secondary">
              <Link href="/incidents">Go to incidents</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Auto-flow overlay (shown while GPS is loading / submitting) ───
  if (submitting && autoStep) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="rounded-2xl border bg-card p-8 max-w-sm w-full shadow-lg text-center">
          <Loader2 className="h-14 w-14 animate-spin text-blue-600 mx-auto mb-5" />

          <h2 className="text-xl font-bold mb-1">
            {autoStep === "gps" ? "Getting your location…" : "Sending your report…"}
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            {autoStep === "gps"
              ? "Allow location access when your browser asks."
              : "Uploading photo and coordinates to the server."}
          </p>

          {/* Step pills */}
          <div className="flex items-center justify-center gap-3 text-xs font-medium mb-6">
            <span className={`flex items-center gap-1 px-3 py-1 rounded-full ${autoStep === "gps" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
              {autoStep === "gps"
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <CheckCircle className="h-3 w-3" />}
              GPS
            </span>
            <span className="text-muted-foreground">→</span>
            <span className={`flex items-center gap-1 px-3 py-1 rounded-full ${autoStep === "sending" ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>
              {autoStep === "sending" && <Loader2 className="h-3 w-3 animate-spin" />}
              Send
            </span>
          </div>

          {capturedImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={capturedImage} alt="Preview" className="rounded-lg w-full max-h-36 object-cover mb-4" />
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSubmitting(false); setAutoStep(null); }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <a
        href={WHATSAPP_LINK}
        target="_blank"
        rel="noopener noreferrer"
        title={`Send WhatsApp message to ${WHATSAPP_PHONE_DISPLAY}`}
        aria-label={`Send WhatsApp message to ${WHATSAPP_PHONE_DISPLAY}`}
        className="group fixed bottom-5 right-5 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-emerald-900/25 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2"
      >
        <MessageCircle className="h-7 w-7" />
        <span className="pointer-events-none absolute right-16 top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white shadow-md group-hover:block group-focus:block">
          WhatsApp {WHATSAPP_PHONE_DISPLAY}
        </span>
      </a>

      {/* Header — compact on desktop, full bleed gradient on mobile */}
      <div className="bg-gradient-to-r from-blue-700 to-cyan-600 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 md:py-6 lg:py-5">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-medium uppercase tracking-wide">Resident Portal</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold">Report Municipal Issue</h1>
          <p className="text-blue-100 text-sm md:text-base mt-1 max-w-2xl">
            Report water, sewer, dumping, or municipal service issues. The app
            will capture your location and send the report automatically.
          </p>
        </div>
      </div>

      {/* Two-column responsive grid: stacked on mobile / tablet, 2+1 on lg+ */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Main column: form sections ─────────────────────── */}
          <div className="lg:col-span-2 space-y-5">

        {/* ── Issue type selector ───────────────────────────────── */}
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-blue-600" />
            Issue Type
            <span className="ml-auto text-xs text-muted-foreground font-normal">
              {activeIssue.category}
            </span>
          </h2>

          <div className="grid grid-cols-2 gap-2">
            {ISSUE_OPTIONS.map(({ key, label, Icon }) => {
              const selected = issueType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIssueType(key)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      : "border-input bg-background hover:bg-accent"
                  }`}
                  aria-pressed={selected}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${selected ? "text-blue-600" : "text-muted-foreground"}`} />
                  <span className="leading-tight">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Native dropdown fallback for accessibility / quick selection */}
          <label className="block mt-3 text-xs text-muted-foreground">
            Or select from list
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value as IssueKey)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {ISSUE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </label>
        </section>

        {/* ── Severity selector ─────────────────────────────────── */}
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-blue-600" />
            Severity
            <span className="ml-auto text-xs text-muted-foreground font-normal">How urgent is it?</span>
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {SEVERITY_OPTIONS.map(({ key, label, tone }) => {
              const selected = severity === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSeverity(key)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                    selected ? tone : "border-input bg-background text-foreground hover:bg-accent"
                  }`}
                  aria-pressed={selected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Optional details (fill before photo) ──────────────── */}
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-blue-600" />
            Optional Details
            <span className="ml-auto text-xs text-muted-foreground font-normal">Fill before taking photo</span>
          </h2>
          <div className="space-y-3">
            <Textarea
              placeholder={activeIssue.placeholder}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Input
              placeholder="Street address or landmark (e.g. Near Mkoba Shopping Centre, Gweru)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        </section>

        {/* ── Photo + auto-send ─────────────────────────────────── */}
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Camera className="h-4 w-4 text-blue-600" />
            Photo of the Issue
            <span className="ml-auto text-xs text-blue-600 font-normal">
              {isIllegalDumping ? "Analysed before submission" : "Auto-locates & sends on capture"}
            </span>
          </h2>

          {/* Preview */}
          {capturedImage && (
            <div className="relative mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capturedImage} alt="Captured" className="w-full rounded-lg object-cover max-h-64" />
              <button
                type="button"
                onClick={() => { resetCamera(); setUploadedFile(null); }}
                className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Camera viewfinder */}
          {cameraState === "active" && (
            <div className="mb-3">
              <video ref={videoRef} className="w-full rounded-lg bg-black" autoPlay playsInline muted />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
          <input
            id="resident-photo-upload"
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />

          {isIllegalDumping && (capturedImage || validationStep !== "idle") && (
            <DumpingValidationPanel
              result={dumpingValidation}
              step={validationStep}
              onRetake={() => { resetCamera(); setUploadedFile(null); }}
              onUploadDifferent={() => {
                resetCamera();
                setUploadedFile(null);
                document.getElementById("resident-photo-upload")?.click();
              }}
              onChangeIssue={() => setIssueType("other")}
            />
          )}

          {/* Controls */}
          {cameraState === "idle" && !capturedImage && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={startCamera}>
                <Camera className="mr-2 h-4 w-4" /> Open Camera
              </Button>
              <label className="flex-1">
                <span className="flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium cursor-pointer hover:bg-accent transition-colors h-9">
                  <Upload className="h-4 w-4" /> Upload Photo
                </span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          )}

          {cameraState === "active" && (
            <Button type="button" className="w-full bg-blue-600 hover:bg-blue-700" onClick={capturePhoto}>
              <Camera className="mr-2 h-4 w-4" /> {isIllegalDumping ? "Take Photo & Analyse" : "Take Photo — Locate & Send"}
            </Button>
          )}

          {cameraState === "captured" && !submitting && (
            <Button type="button" variant="outline" className="w-full" onClick={() => { resetCamera(); setUploadedFile(null); }}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retake Photo
            </Button>
          )}

          {!isIllegalDumping && !capturedBlob && !uploadedFile && !submitting && (
            <Button
              type="button"
              className="w-full bg-blue-600 hover:bg-blue-700 mt-2"
              onClick={() => autoLocateAndSend(null, null)}
            >
              <CheckCircle className="mr-2 h-4 w-4" /> Submit Without Photo
            </Button>
          )}

          {/* Explicit Submit button — visible whenever we have a photo and
              are not currently mid-submission. Lets the resident re-send
              after editing description/severity/address, and acts as a
              fallback if the auto-send on capture/upload failed. */}
          {(capturedBlob || uploadedFile) && !submitting && (
            <Button
              type="button"
              className="w-full bg-blue-600 hover:bg-blue-700 mt-2"
              disabled={isIllegalDumping && (!hasPhoto || !dumpingReadyToSubmit || validationStep === "analysing")}
              onClick={async () => {
                setError("");
                if (isIllegalDumping && !dumpingReadyToSubmit) {
                  setError("Please upload or take a photo that shows suspected illegal dumping before submitting.");
                  return;
                }
                setSubmitting(true);
                try {
                  setAutoStep("gps");
                  const location = coords ?? await getGPS();
                  setAutoStep("sending");
                  await doSubmit(capturedBlob, uploadedFile, location);
                } catch (err: unknown) {
                  setError(extractApiError(err, "Submission failed. Please try again."));
                } finally {
                  setAutoStep(null);
                  setSubmitting(false);
                }
              }}
            >
              <CheckCircle className="mr-2 h-4 w-4" /> {isIllegalDumping ? "Submit Illegal Dumping Report" : "Submit Report"}
            </Button>
          )}
        </section>

        {/* ── Fallback: manual GPS + submit (shown only after GPS fails) */}
        {gpsState === "error" && !submitting && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 md:p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2 text-amber-800 dark:text-amber-400">
              <MapPin className="h-4 w-4" />
              Location Required
            </h2>
            <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">
              GPS was denied. Enter your coordinates manually or retry, then tap Submit.
            </p>

            <Button type="button" variant="outline" size="sm" onClick={retryGPS} className="mb-3">
              <RefreshCw className="h-3 w-3 mr-1" /> Retry GPS
            </Button>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <Input
                placeholder="Latitude (e.g. -19.450)"
                inputMode="decimal"
                onChange={(e) =>
                  setCoords((c) => ({ lat: parseFloat(e.target.value) || 0, lng: c?.lng ?? 0 }))
                }
              />
              <Input
                placeholder="Longitude (e.g. 29.817)"
                inputMode="decimal"
                onChange={(e) =>
                  setCoords((c) => ({ lat: c?.lat ?? 0, lng: parseFloat(e.target.value) || 0 }))
                }
              />
            </div>

            {coords && (
              <div className="h-40 rounded-lg overflow-hidden border mb-3">
                <LocationMap coords={coords} onMove={(c) => setCoords(c)} />
              </div>
            )}

            <form onSubmit={handleManualSubmit}>
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={submitting || !coords}
              >
                {submitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
                  : "Submit Report"}
              </Button>
            </form>
          </section>
        )}

        {/* Error banner — kept in the main column so submit feedback is
            adjacent to the controls that produced it. */}
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

          </div>
          {/* ── End main column ─────────────────────────────────── */}

          {/* ── Sidebar (right column on lg+, stacks under on mobile) ── */}
          <aside className="lg:col-span-1 space-y-5">

            <section className="rounded-xl border bg-card p-4 md:p-5">
              <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <MessageCircle className="h-4 w-4 text-[#25D366]" />
                WhatsApp Support
              </h2>
              <p className="text-sm text-muted-foreground mb-3">
                Send a direct WhatsApp message if you need help reporting an incident.
              </p>
              <Button asChild className="w-full bg-[#25D366] text-white hover:bg-[#1fb457]">
                <a href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Message {WHATSAPP_PHONE_DISPLAY}
                </a>
              </Button>
            </section>

            {/* Reporting tips */}
            <section className="rounded-xl border bg-card p-4 md:p-5">
              <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <HelpCircle className="h-4 w-4 text-blue-600" />
                Reporting Tips
              </h2>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-outside pl-5">
                <li>Pick the issue type that best matches what you see.</li>
                <li>Use <span className="font-medium text-foreground">Emergency</span> only for active flooding, sewer overflow, or hazards to life.</li>
                <li>Include a short description and a nearby landmark to help the crew locate the site.</li>
                <li>Allow location access so we can route the nearest crew automatically.</li>
                <li>Attach a clear, well-lit photo of the issue.</li>
              </ul>
            </section>

            {/* Selected issue summary */}
            <section className="rounded-xl border bg-card p-4 md:p-5">
              <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <activeIssue.Icon className="h-4 w-4 text-blue-600" />
                Selected Issue
              </h2>
              <dl className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium text-right">{activeIssue.label}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Category</dt>
                  <dd className="text-right">{activeIssue.category}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Severity</dt>
                  <dd className="font-medium capitalize text-right">{severity}</dd>
                </div>
                {address && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Address</dt>
                    <dd className="text-right max-w-[60%] break-words">{address}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* GPS location */}
            <section className="rounded-xl border bg-card p-4 md:p-5">
              <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <Navigation className="h-4 w-4 text-blue-600" />
                Captured Location
              </h2>
              {gpsState === "done" && coords ? (
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    <span>GPS captured</span>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  </p>
                </div>
              ) : gpsState === "loading" ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Getting your location…
                </div>
              ) : gpsState === "error" ? (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  GPS unavailable — enter coordinates manually using the form on the left.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your location will be captured automatically when you take or upload a photo.
                </p>
              )}
            </section>

            {/* Photo preview */}
            {capturedImage && (
              <section className="rounded-xl border bg-card p-4 md:p-5">
                <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                  <Camera className="h-4 w-4 text-blue-600" />
                  Photo Preview
                </h2>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={capturedImage}
                  alt="Selected"
                  className="w-full rounded-lg object-cover max-h-56"
                />
              </section>
            )}

            {/* What happens next */}
            <section className="rounded-xl border bg-card p-4 md:p-5">
              <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-blue-600" />
                What Happens Next
              </h2>
              <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-outside pl-5">
                <li>Your report is sent to the Gweru City Council operations centre.</li>
                <li>It is routed to the relevant team — water, sewer, environmental, or municipal services.</li>
                <li>A crew is dispatched and you can track progress with your reference number.</li>
                <li>The incident is marked resolved once the on-site crew confirms completion.</li>
              </ol>
            </section>

          </aside>
          {/* ── End sidebar ─────────────────────────────────────── */}
        </div>
      </div>
    </div>
  );
}

function ResultItem({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-semibold ${mono ? "font-mono" : ""} ${capitalize ? "capitalize" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function DumpingValidationPanel({
  result,
  step,
  onRetake,
  onUploadDifferent,
  onChangeIssue,
}: {
  result: DumpingImageAnalysisResult | null;
  step: ValidationStep;
  onRetake: () => void;
  onUploadDifferent: () => void;
  onChangeIssue: () => void;
}) {
  const isAnalysing = step === "analysing";
  const statusLabel = result?.status === "suspected_illegal_dumping"
    ? "Suspected illegal dumping"
    : result?.status === "not_illegal_dumping"
      ? "Not illegal dumping"
      : result?.status === "needs_manual_review"
        ? "Low confidence / needs manual review"
        : "Waiting for image analysis";
  const statusText = isAnalysing
    ? "Analysing photo"
    : result?.can_submit
      ? "Ready to submit"
      : result
        ? "Submission blocked"
        : "Photo required";
  const tone = result?.status === "suspected_illegal_dumping"
    ? "border-green-200 bg-green-50 text-green-800 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-200"
    : result?.status === "not_illegal_dumping"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
      : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200";

  return (
    <div className={`mb-3 rounded-lg border p-3 text-sm ${tone}`}>
      <div className="flex items-start gap-2">
        {isAnalysing
          ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          : result?.can_submit
            ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
            : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">YOLO result: {statusLabel}</p>
          <p className="mt-1">Confidence: {result ? `${Math.round(result.confidence * 100)}%` : "Pending"}</p>
          <p>Status: {statusText}</p>
          {result && !result.can_submit && (
            <p className="mt-2">
              {result.status === "not_illegal_dumping"
                ? "The image does not appear to show illegal dumping. Please retake the photo if this is incorrect, or choose another issue type if you are reporting a different municipal problem."
                : result.message}
            </p>
          )}
        </div>
      </div>
      {result && !result.can_submit && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button type="button" size="sm" variant="outline" onClick={onRetake}>Retake photo</Button>
          <Button type="button" size="sm" variant="outline" onClick={onUploadDifferent}>Upload different photo</Button>
          <Button type="button" size="sm" variant="outline" onClick={onChangeIssue}>Change issue type</Button>
        </div>
      )}
    </div>
  );
}

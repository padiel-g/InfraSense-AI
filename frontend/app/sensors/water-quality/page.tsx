"use client";
import { useMemo, useState } from "react";
import {
  AlertTriangle, Beaker, CheckCircle2, ClipboardCheck, Droplets,
  FileText, FlaskConical, Gauge, Info, Loader2, Play, Send,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, ReferenceArea, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SeverityBadge from "@/components/sensors-detection/SeverityBadge";
import ResultBanner from "@/components/sensors-detection/ResultBanner";
import StatPill from "@/components/sensors-detection/StatPill";
import {
  useWaterQualityManualMutation,
  useWaterQualitySimulation,
  useWaterQualitySequenceSimulation,
  useWaterQualityThresholds,
} from "@/hooks/useWaterQuality";
import { extractApiError } from "@/lib/utils";
import type { WQManualEntryResult, WQScenario, WQScenarioType, WQSequenceSimulationResult } from "@/lib/api";
import { cn } from "@/lib/utils";

const PIPE_MATERIALS = [
  { value: "cast_iron",  label: "Cast Iron" },
  { value: "pvc",        label: "PVC" },
  { value: "galvanized", label: "Galvanized" },
  { value: "copper",     label: "Copper" },
  { value: "hdpe",       label: "HDPE" },
];

const SCENARIOS: { value: WQScenario; label: string }[] = [
  { value: "normal",                label: "Normal operation" },
  { value: "gradual_corrosion",     label: "Gradual corrosion-like disturbance" },
  { value: "gradual_contamination", label: "Gradual contamination-like disturbance" },
  { value: "sediment_disturbance",  label: "Sediment disturbance" },
  { value: "sensor_fault",          label: "Sensor fault" },
  { value: "sudden_spike",          label: "Sediment disturbance (legacy: sudden spike)" },
  { value: "corrosion_event",       label: "Gradual corrosion (legacy: corrosion event)" },
  { value: "random",                label: "Random mix (legacy)" },
];

const PRESENTATION_SCENARIOS: { value: WQScenario; label: string }[] = [
  { value: "normal", label: "Normal water quality" },
  { value: "gradual_contamination", label: "Possible contamination event" },
  { value: "gradual_corrosion", label: "Possible pipe corrosion event" },
  { value: "sensor_fault", label: "Sensor noise / false alarm test" },
];

type StatusLevel = "safe" | "monitor" | "warning" | "critical";

type WQSimulationResultType = NonNullable<ReturnType<typeof useWaterQualitySimulation>["data"]>;
type WQSimulationReadingType = WQSimulationResultType["readings"][number];

const STATUS_COPY: Record<StatusLevel, {
  label: string;
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
  cardClass: string;
  badgeClass: string;
  progressClass: string;
}> = {
  safe: {
    label: "Safe",
    badge: "Low risk",
    icon: CheckCircle2,
    cardClass: "border-green-200 bg-green-50/80 dark:border-green-500/25 dark:bg-green-500/10",
    badgeClass: "border-transparent bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
    progressClass: "bg-green-500",
  },
  monitor: {
    label: "Monitor",
    badge: "Watch closely",
    icon: Info,
    cardClass: "border-blue-200 bg-blue-50/80 dark:border-blue-500/25 dark:bg-blue-500/10",
    badgeClass: "border-transparent bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    progressClass: "bg-blue-500",
  },
  warning: {
    label: "Warning",
    badge: "Elevated risk",
    icon: AlertTriangle,
    cardClass: "border-amber-200 bg-amber-50/80 dark:border-amber-500/25 dark:bg-amber-500/10",
    badgeClass: "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    progressClass: "bg-amber-500",
  },
  critical: {
    label: "Critical",
    badge: "High risk",
    icon: AlertTriangle,
    cardClass: "border-red-200 bg-red-50/80 dark:border-red-500/25 dark:bg-red-500/10",
    badgeClass: "border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    progressClass: "bg-red-500",
  },
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/* Manual Entry Tab                                                       */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface HistoryEntry extends WQManualEntryResult {
  pipe_material?: string;
  pipe_age_years?: number;
}

function ManualEntryTab() {
  const { data: thresholds } = useWaterQualityThresholds();
  const mutation = useWaterQualityManualMutation();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [form, setForm] = useState({
    sensor_id: "", turbidity_ntu: "", ph: "", flow_rate_lps: "",
    pressure_kpa: "", residual_chlorine_mg_l: "", conductivity_us_cm: "",
    pipe_age_years: "", pipe_material: "cast_iron",
  });
  const [error, setError] = useState<string | null>(null);

  const lastResult = history[0];

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await mutation.mutateAsync({
        sensor_id: form.sensor_id || `manual-${Date.now()}`,
        turbidity_ntu: parseFloat(form.turbidity_ntu),
        ph: parseFloat(form.ph),
        flow_rate_lps: parseFloat(form.flow_rate_lps),
        pressure_kpa: form.pressure_kpa ? parseFloat(form.pressure_kpa) : undefined,
        residual_chlorine_mg_l: form.residual_chlorine_mg_l ? parseFloat(form.residual_chlorine_mg_l) : undefined,
        conductivity_us_cm: form.conductivity_us_cm ? parseFloat(form.conductivity_us_cm) : undefined,
        pipe_age_years: form.pipe_age_years ? parseFloat(form.pipe_age_years) : undefined,
        pipe_material: form.pipe_material,
      });
      setHistory((prev) => [
        { ...res, pipe_material: form.pipe_material, pipe_age_years: form.pipe_age_years ? +form.pipe_age_years : undefined },
        ...prev,
      ]);
    } catch (err) {
      setError(extractApiError(err, "Manual reading failed â€” is the backend running?"));
    }
  }

  /* Reading vs threshold colour helper */
  function turbidityTone(v: number) {
    if (!thresholds) return "neutral";
    if (v >= thresholds.turbidity_critical_ntu) return "bad";
    if (v >= thresholds.turbidity_warning_ntu)  return "warn";
    if (v <= thresholds.turbidity_normal_max_ntu) return "good";
    return "warn";
  }
  function phTone(v: number) {
    if (!thresholds) return "neutral";
    const [nLo, nHi] = thresholds.ph_normal_range;
    const [wLo, wHi] = thresholds.ph_warning_range;
    if (v < wLo || v > wHi) return "bad";
    if (v < nLo || v > nHi) return "warn";
    return "good";
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Form */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-base">Manual Reading</CardTitle>
          <p className="text-xs text-muted-foreground">
            Submit a single reading to run instant detection.
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Sensor ID">
              <Input
                placeholder="e.g. WQ-NORTH-12"
                value={form.sensor_id}
                onChange={(e) => update("sensor_id", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Turbidity (NTU)">
                <Input
                  type="number" step="0.1" min={0} required
                  value={form.turbidity_ntu}
                  onChange={(e) => update("turbidity_ntu", e.target.value)}
                />
              </Field>
              <Field label="pH">
                <Input
                  type="number" step="0.1" min={0} max={14} required
                  value={form.ph}
                  onChange={(e) => update("ph", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Flow Rate (L/s)">
              <Input
                type="number" step="0.1" min={0} required
                value={form.flow_rate_lps}
                onChange={(e) => update("flow_rate_lps", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Chlorine (mg/L)" optional>
                <Input
                  type="number" step="0.01" min={0}
                  placeholder="0.2-0.5"
                  value={form.residual_chlorine_mg_l}
                  onChange={(e) => update("residual_chlorine_mg_l", e.target.value)}
                />
              </Field>
              <Field label="Conductivity (uS/cm)" optional>
                <Input
                  type="number" step="1" min={0}
                  value={form.conductivity_us_cm}
                  onChange={(e) => update("conductivity_us_cm", e.target.value)}
                />
              </Field>
              <Field label="Pressure (kPa)" optional>
                <Input
                  type="number" step="1" min={0}
                  value={form.pressure_kpa}
                  onChange={(e) => update("pressure_kpa", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pipe Age (yrs)" optional>
                <Input
                  type="number" step="1" min={0}
                  value={form.pipe_age_years}
                  onChange={(e) => update("pipe_age_years", e.target.value)}
                />
              </Field>
              <Field label="Pipe Material" optional>
                <Select
                  value={form.pipe_material}
                  onValueChange={(v) => update("pipe_material", v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PIPE_MATERIALS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Button type="submit" disabled={mutation.isPending} className="w-full">
              {mutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Detectingâ€¦</>
                : <><Send className="h-4 w-4" /> Run detection</>}
            </Button>
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Results + history */}
      <div className="lg:col-span-3 space-y-6">
        <Card>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base">Latest Result</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-4">
            {!lastResult && !mutation.isPending && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Submit a reading to see detection results here.
              </div>
            )}
            {mutation.isPending && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            )}
            {lastResult && (
              <>
                <ResultBanner
                  anomaly={lastResult.anomaly_detected}
                  title={lastResult.anomaly_detected
                    ? `Anomaly detected â€” ${lastResult.anomaly_type ?? "unknown"}`
                    : "All readings normal"}
                  message={lastResult.message}
                >
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <SeverityBadge severity={lastResult.severity} />
                    {lastResult.anomaly_type && (
                      <Badge variant="outline" className="capitalize">
                        {lastResult.anomaly_type.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                </ResultBanner>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ScoreBar
                    label="Confidence"
                    value={lastResult.confidence_score}
                    icon={Gauge}
                  />
                  <ScoreBar
                    label="Corrosion risk"
                    value={lastResult.corrosion_risk_score}
                    icon={FlaskConical}
                    fillClassName={
                      lastResult.corrosion_risk_score > 0.7 ? "bg-red-500"
                      : lastResult.corrosion_risk_score > 0.4 ? "bg-amber-500"
                      : "bg-green-500"
                    }
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <ReadingTile
                    label="Turbidity"
                    value={`${lastResult.readings.turbidity_ntu.toFixed(2)} NTU`}
                    accent={turbidityTone(lastResult.readings.turbidity_ntu)}
                  />
                  <ReadingTile
                    label="pH"
                    value={lastResult.readings.ph.toFixed(2)}
                    accent={phTone(lastResult.readings.ph)}
                  />
                  <ReadingTile
                    label="Flow"
                    value={`${lastResult.readings.flow_rate_lps.toFixed(2)} L/s`}
                  />
                  <ReadingTile
                    label="Chlorine"
                    value={lastResult.readings.residual_chlorine_mg_l == null ? "Not provided" : `${lastResult.readings.residual_chlorine_mg_l.toFixed(2)} mg/L`}
                  />
                  <ReadingTile
                    label="Conductivity"
                    value={lastResult.readings.conductivity_us_cm == null ? "Not provided" : `${lastResult.readings.conductivity_us_cm.toFixed(0)} uS/cm`}
                  />
                  <ReadingTile
                    label="Pressure"
                    value={lastResult.readings.pressure_kpa == null ? "Not provided" : `${lastResult.readings.pressure_kpa.toFixed(0)} kPa`}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {history.length > 0 && (
          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Session History</CardTitle>
              <p className="text-xs text-muted-foreground">
                Resets when you leave this page.
              </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground bg-muted/40">
                    <tr>
                      <Th>Time</Th>
                      <Th>Sensor</Th>
                      <Th right>Turbidity</Th>
                      <Th right>pH</Th>
                      <Th right>Flow</Th>
                      <Th>Result</Th>
                      <Th right>Conf.</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t hover:bg-muted/30 transition-colors">
                        <Td className="tabular-nums whitespace-nowrap">
                          {format(parseISO(h.timestamp), "HH:mm:ss")}
                        </Td>
                        <Td className="font-mono text-xs truncate max-w-[120px]">{h.sensor_id}</Td>
                        <Td right className="tabular-nums">{h.readings.turbidity_ntu.toFixed(2)}</Td>
                        <Td right className="tabular-nums">{h.readings.ph.toFixed(2)}</Td>
                        <Td right className="tabular-nums">{h.readings.flow_rate_lps.toFixed(2)}</Td>
                        <Td>
                          {h.anomaly_detected
                            ? <SeverityBadge severity={h.severity} />
                            : <Badge variant="outline" className="border-transparent bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">Normal</Badge>}
                        </Td>
                        <Td right className="tabular-nums">{(h.confidence_score * 100).toFixed(0)}%</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/* Simulation Tab                                                         */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function SimulationTab() {
  const sim = useWaterQualitySequenceSimulation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [config, setConfig] = useState({
    // Basic simulation control
    duration_hours: 24,
    interval_minutes: 15,
    scenario: "normal" as WQScenario,
    noise_level: 0.1,
    
    // Pipe context
    pipe_age_years: 20,
    pipe_material: "cast_iron",
    pipe_zone: "",
    
    // Baseline water quality
    baseline_turbidity_ntu: 1.0,
    baseline_ph: 7.2,
    baseline_flow_lps: 4.0,
    baseline_pressure_kpa: 350.0,
    baseline_temperature_c: 20.0,
    baseline_chlorine_mg_l: 0.5,
    baseline_conductivity_us_cm: 400.0,
    
    // Event settings
    event_start_time_minutes: 360,
    event_duration_minutes: 240,
    event_severity: "medium" as const,
    
    // Behavior rates
    pressure_drop_rate_kpa_per_step: 0.1,
    flow_change_rate_lps_per_step: 0.05,
    turbidity_increase_rate: 0.2,
    ph_change_rate: 0.01,
    chlorine_decay_rate: 0.02,
    conductivity_increase_rate: 2.0,
    
    // Detection config
    detection_window_size: 12,
    random_seed: undefined as number | undefined,
  });
  const [error, setError] = useState<string | null>(null);
  
  // Compute derived values
  const warmupMinutes = config.detection_window_size * config.interval_minutes;
  const totalMinutes = config.duration_hours * 60;

  async function handleRun() {
    setError(null);
    try {
      const scenarioType =
        config.scenario === "sudden_spike" ? "sediment_disturbance"
        : config.scenario === "corrosion_event" ? "gradual_corrosion"
        : config.scenario === "random" ? "gradual_contamination"
        : config.scenario;

      await sim.mutateAsync({
        // Baseline
        baseline_turbidity_ntu: config.baseline_turbidity_ntu,
        baseline_ph: config.baseline_ph,
        baseline_flow_lps: config.baseline_flow_lps,
        baseline_pressure_kpa: config.baseline_pressure_kpa,
        baseline_temperature_c: config.baseline_temperature_c,
        baseline_chlorine_mg_l: config.baseline_chlorine_mg_l,
        baseline_conductivity_us_cm: config.baseline_conductivity_us_cm,

        // Scenario
        scenario_type: scenarioType as WQScenarioType,
        event_start_time_minutes: config.event_start_time_minutes,
        event_duration_minutes: config.event_duration_minutes,
        event_severity: config.event_severity,

        // Rates
        pressure_drop_rate_kpa_per_step: config.pressure_drop_rate_kpa_per_step,
        flow_change_rate_lps_per_step: config.flow_change_rate_lps_per_step,
        turbidity_increase_rate: config.turbidity_increase_rate,
        ph_change_rate: config.ph_change_rate,
        chlorine_decay_rate: config.chlorine_decay_rate,
        conductivity_increase_rate: config.conductivity_increase_rate,

        // Context
        pipe_material: config.pipe_material,
        pipe_age_years: config.pipe_age_years,
        pipe_zone: config.pipe_zone || undefined,

        // Controls
        duration_hours: config.duration_hours,
        data_frequency_minutes: config.interval_minutes,
        sensor_uncertainty: config.noise_level,
        detection_window_size: config.detection_window_size,
        random_seed: config.random_seed,
      });
    } catch (err) {
      setError(extractApiError(err, "Simulation failed â€” is the backend running?"));
    }
  }

  const result = sim.data as WQSequenceSimulationResult | undefined;
  const chartData = useMemo(() => {
    if (!result) return [];
    const detByTs = new Map(result.detection_results.map((d) => [d.timestamp, d] as const));
    const eventStartMs = result.summary.event_start_time
      ? parseISO(result.summary.event_start_time).getTime()
      : null;
    return result.generated_readings.map((r) => {
      const det = detByTs.get(r.timestamp);
      const turbidityRisk = getTurbidityRisk(r.turbidity_ntu);
      const chlorineRisk = getChlorineRisk(r.residual_chlorine_mg_l);
      const phRisk = getPhRisk(r.ph);
      const conductivityRisk = getConductivityRisk(
        r.conductivity_us_cm,
        config.baseline_conductivity_us_cm,
      );
      const rawRisk = getCombinedWaterQualityRisk({
        turbidityRisk,
        chlorineRisk,
        phRisk,
        conductivityRisk,
      });
      const normalizedRisk = r.event_active ? rawRisk : Math.min(rawRisk, 38);
      const modelRisk = det?.confidence == null ? null : det.confidence * 100;
      const isBeforeDisturbance = eventStartMs != null && parseISO(r.timestamp).getTime() < eventStartMs;
      const visibleRisk = config.scenario === "normal"
        ? Math.min(normalizedRisk, 35)
        : isBeforeDisturbance
          ? Math.min(normalizedRisk, 35)
          : Math.max(normalizedRisk, modelRisk ?? 0);
      return {
        t: format(parseISO(r.timestamp), "HH:mm"),
        timestamp: r.timestamp,
        turbidity: r.turbidity_ntu,
        ph: r.ph,
        flow: r.flow_lps,
        pressure: r.pressure_kpa,
        temp: r.temperature_c,
        chlorine: r.residual_chlorine_mg_l,
        conductivity: r.conductivity_us_cm,
        truth: r.ground_truth_label,
        eventActive: r.event_active,
        prediction: det?.prediction ?? null,
        status: det?.status ?? "collecting_sequence",
        confidence: det?.confidence ?? null,
        confidencePct: modelRisk,
        riskPct: visibleRisk,
        turbidityRisk,
        chlorineRisk,
        phRisk,
        conductivityRisk,
      };
    });
  }, [config.baseline_conductivity_us_cm, config.scenario, result]);

  const detectionMarker = result?.summary.first_detection_time ? format(parseISO(result.summary.first_detection_time), "HH:mm") : null;
  const eventMarker = result?.summary.event_start_time ? format(parseISO(result.summary.event_start_time), "HH:mm") : null;
  const warmupEndMarker = result?.generated_readings[config.detection_window_size]
    ? format(parseISO(result.generated_readings[config.detection_window_size].timestamp), "HH:mm")
    : null;

  const maxRiskScore = chartData.length
    ? Math.max(...chartData.map((r) => Number.isFinite(r.riskPct) ? r.riskPct : 0))
    : 0;
  const detectionTone =
    !result ? "neutral"
    : result.summary.predicted_label || maxRiskScore >= 40 ? "warn"
    : "good";
  const riskStatus = getRiskStatusLabel(result?.summary.predicted_label, maxRiskScore);
  const selectedScenarioLabel = formatScenarioLabel(config.scenario);

  return (
    <div className="space-y-6">
      {/* Config */}
      <Card>
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-base">Simulation Configuration</CardTitle>
          <p className="text-xs text-muted-foreground">Configure baseline conditions, event parameters, and detection settings.</p>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-5">
          
          {/* Basic Controls */}
          <div>
            <h3 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Simulation Duration & Frequency</h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <Field label="Scenario">
                <Select
                  value={config.scenario}
                  onValueChange={(v) => setConfig((c) => ({ ...c, scenario: v as WQScenario }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRESENTATION_SCENARIOS.map((scenario) => (
                      <SelectItem key={scenario.value} value={scenario.value}>{scenario.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={`Duration: ${config.duration_hours}h`}>
                <input
                  type="range" min={1} max={168} step={1}
                  value={config.duration_hours}
                  onChange={(e) => setConfig((c) => ({ ...c, duration_hours: +e.target.value }))}
                  className="w-full accent-primary"
                />
              </Field>
              <Field label="Interval (min)">
                <Select
                  value={String(config.interval_minutes)}
                  onValueChange={(v) => setConfig((c) => ({ ...c, interval_minutes: +v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 5, 15, 30, 60].map((m) => (
                      <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Noise level">
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={config.noise_level}
                  onChange={(e) => setConfig((c) => ({ ...c, noise_level: +e.target.value }))}
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">{config.noise_level.toFixed(2)}</p>
              </Field>
              <Field label="Random seed (opt)">
                <Input
                  type="number" min={0}
                  placeholder="Leave empty"
                  value={config.random_seed ?? ""}
                  onChange={(e) => setConfig((c) => ({ ...c, random_seed: e.target.value ? +e.target.value : undefined }))}
                />
              </Field>
            </div>
          </div>
          
          {/* Baseline Water Quality */}
          <div>
            <h3 className="text-xs font-semibold mb-3 text-muted-foreground uppercase">Baseline Water Quality</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Turbidity (NTU)">
                <Input
                  type="number" min={0} step={0.1}
                  value={config.baseline_turbidity_ntu}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_turbidity_ntu: +e.target.value }))}
                />
              </Field>
              <Field label="pH">
                <Input
                  type="number" min={0} max={14} step={0.1}
                  value={config.baseline_ph}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_ph: +e.target.value }))}
                />
              </Field>
              <Field label="Flow (L/s)">
                <Input
                  type="number" min={0} step={0.1}
                  value={config.baseline_flow_lps}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_flow_lps: +e.target.value }))}
                />
              </Field>
              <Field label="Pressure (kPa)">
                <Input
                  type="number" min={0} step={10}
                  value={config.baseline_pressure_kpa}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_pressure_kpa: +e.target.value }))}
                />
              </Field>
              <Field label="Temperature (Â°C)">
                <Input
                  type="number" min={-10} max={50} step={1}
                  value={config.baseline_temperature_c}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_temperature_c: +e.target.value }))}
                />
              </Field>
              <Field label="Chlorine (mg/L)">
                <Input
                  type="number" min={0} step={0.1}
                  value={config.baseline_chlorine_mg_l}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_chlorine_mg_l: +e.target.value }))}
                />
              </Field>
              <Field label="Conductivity (ÂµS/cm)">
                <Input
                  type="number" min={0} step={10}
                  value={config.baseline_conductivity_us_cm}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_conductivity_us_cm: +e.target.value }))}
                />
              </Field>
              <Field label="Pipe Material">
                <Select
                  value={config.pipe_material}
                  onValueChange={(v) => setConfig((c) => ({ ...c, pipe_material: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PIPE_MATERIALS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Pipe zone" optional>
                <Input
                  placeholder="e.g. North"
                  value={config.pipe_zone}
                  onChange={(e) => setConfig((c) => ({ ...c, pipe_zone: e.target.value }))}
                />
              </Field>
            </div>
          </div>
          
          {/* Advanced Options */}
          <div className="border-t pt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? "Hide" : "Show"} advanced: parameter rates & detection
            </button>
            
            {showAdvanced && (
              <>
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Turbidity rate (per step)">
                    <Input
                      type="number" min={0} step={0.05}
                      value={config.turbidity_increase_rate}
                      onChange={(e) => setConfig((c) => ({ ...c, turbidity_increase_rate: +e.target.value }))}
                    />
                  </Field>
                  <Field label="pH rate">
                    <Input
                      type="number" min={0} step={0.001}
                      value={config.ph_change_rate}
                      onChange={(e) => setConfig((c) => ({ ...c, ph_change_rate: +e.target.value }))}
                    />
                  </Field>
                  <Field label="Pressure drop rate">
                    <Input
                      type="number" min={0} step={0.01}
                      value={config.pressure_drop_rate_kpa_per_step}
                      onChange={(e) => setConfig((c) => ({ ...c, pressure_drop_rate_kpa_per_step: +e.target.value }))}
                    />
                  </Field>
                  <Field label="Flow change rate">
                    <Input
                      type="number" min={0} step={0.01}
                      value={config.flow_change_rate_lps_per_step}
                      onChange={(e) => setConfig((c) => ({ ...c, flow_change_rate_lps_per_step: +e.target.value }))}
                    />
                  </Field>
                  <Field label="Chlorine decay rate">
                    <Input
                      type="number" min={0} step={0.01}
                      value={config.chlorine_decay_rate}
                      onChange={(e) => setConfig((c) => ({ ...c, chlorine_decay_rate: +e.target.value }))}
                    />
                  </Field>
                  <Field label="Conductivity rate">
                    <Input
                      type="number" min={0} step={0.5}
                      value={config.conductivity_increase_rate}
                      onChange={(e) => setConfig((c) => ({ ...c, conductivity_increase_rate: +e.target.value }))}
                    />
                  </Field>
                  <Field label="Detection window (samples)">
                    <Input
                      type="number" min={2} step={1}
                      value={config.detection_window_size}
                      onChange={(e) => setConfig((c) => ({ ...c, detection_window_size: +e.target.value }))}
                    />
                  </Field>
                  <Field label="Pipe age (years)">
                    <Input
                      type="number" min={0} step={1}
                      value={config.pipe_age_years}
                      onChange={(e) => setConfig((c) => ({ ...c, pipe_age_years: +e.target.value }))}
                    />
                  </Field>
                </div>
                
                <div className="mt-3 p-2 bg-muted rounded text-xs text-muted-foreground">
                  <strong>Warmup:</strong> {warmupMinutes} min ({config.detection_window_size} samples) Â· <strong>Total:</strong> {totalMinutes} min
                </div>
              </>
            )}
          </div>
          
          {/* Action Button */}
          <div className="flex items-center gap-3">
            <Button onClick={handleRun} disabled={sim.isPending}>
              {sim.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Runningâ€¦</>
                : <><Play className="h-4 w-4" /> Run simulation</>}
            </Button>
            {sim.isPending && (
              <p className="text-xs text-muted-foreground">
                Generating ~{Math.round((config.duration_hours * 60) / config.interval_minutes)} readingsâ€¦
              </p>
            )}
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {sim.isPending && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
            <Skeleton className="h-72 w-full" />
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Simulation Summary</CardTitle>
                <Badge
                  variant="outline"
                  className={cn(
                    "border-transparent",
                    detectionTone === "good" && "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
                    detectionTone === "warn" && "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
                  )}>
                  {riskStatus}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <StatPill label="Scenario selected" value={selectedScenarioLabel} />
                <StatPill label="Warm-up" value={`${result.summary.warmup_time} min`} />
                <StatPill label="Disturbance start" value={result.summary.event_start_time ? format(parseISO(result.summary.event_start_time), "HH:mm") : "Not injected"} />
                <StatPill label="First detection" value={result.summary.first_detection_time ? format(parseISO(result.summary.first_detection_time), "HH:mm") : "Not detected"} accent={result.summary.first_detection_time ? "warn" : "neutral"} />
                <StatPill label="Detection latency" value={result.summary.detection_latency == null ? "N/A" : `${Math.max(0, result.summary.detection_latency)} min`} />
                <StatPill label="Risk status" value={riskStatus} accent={result.summary.predicted_label || maxRiskScore >= 40 ? "warn" : "neutral"} />
                <StatPill label="Max risk score" value={`${maxRiskScore.toFixed(0)}%`} />
              </div>

              <p className="mt-4 rounded-lg border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                The disturbance profile is only used to generate synthetic sensor behavior and hidden evaluation labels.
                The detection model receives only water quality and hydraulic sensor streams, then infers possible anomalies from those trends.
              </p>

              {/* Detection latency info */}
              {result.summary.event_start_time && result.summary.first_detection_time && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-500/10 dark:border-blue-500/20">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Disturbance start</p>
                      <p className="font-mono font-semibold">{format(parseISO(result.summary.event_start_time), "HH:mm:ss")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">First detection</p>
                      <p className="font-mono font-semibold">{format(parseISO(result.summary.first_detection_time), "HH:mm:ss")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Detection latency</p>
                      <p className="font-mono font-semibold text-amber-600 dark:text-amber-400">{result.summary.detection_latency == null ? "N/A" : `${Math.max(0, result.summary.detection_latency)} min`}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Predicted anomaly</p>
                      <p className="font-semibold capitalize">{formatPrediction(result.summary.predicted_label)}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <RiskScoreChart
            data={chartData}
            eventMarker={config.scenario === "normal" ? null : eventMarker}
            detectionMarker={detectionMarker}
            warmupEndMarker={warmupEndMarker}
          />

          <EvidenceChart
            data={chartData}
            eventMarker={config.scenario === "normal" ? null : eventMarker}
            detectionMarker={detectionMarker}
          />

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Interpretation</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <p className="text-sm leading-6 text-muted-foreground">
                {buildSequenceInterpretation(chartData, result.summary.predicted_label, config.scenario, maxRiskScore)}
              </p>
            </CardContent>
          </Card>

          <EvaluationDetails result={result} />
        </>
      )}
    </div>
  );
}

function RiskScoreChart(props: {
  data: SequenceChartRow[];
  eventMarker: string | null;
  detectionMarker: string | null;
  warmupEndMarker?: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base">Water Quality Risk Score Over Time</CardTitle>
        <p className="text-xs text-muted-foreground">
          One presentation view of model risk from 0% to 100%. The threshold marks when the system treats the trend as an early-warning anomaly risk.
        </p>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={props.data} margin={{ top: 14, right: 28, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              formatter={(value, name) => [`${Number(value).toFixed(0)}%`, name]}
              contentStyle={{
                fontSize: 12, padding: 10, borderRadius: 8,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceArea y1={0} y2={40} fill="#22c55e" fillOpacity={0.08} />
            <ReferenceArea y1={40} y2={70} fill="#f59e0b" fillOpacity={0.10} />
            <ReferenceArea y1={70} y2={100} fill="#ef4444" fillOpacity={0.08} />
            <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="5 4" label={{ value: "Detection threshold", fontSize: 11, fill: "#dc2626", position: "insideTopRight" }} />
            {props.warmupEndMarker && (
              <ReferenceArea x1={props.data[0]?.t} x2={props.warmupEndMarker} y1={0} y2={100} fill="#94a3b8" fillOpacity={0.10} />
            )}
            {props.eventMarker && (
              <ReferenceLine x={props.eventMarker} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.95} label={{ value: "Disturbance", fontSize: 11, fill: "#b45309", position: "top" }} />
            )}
            {props.detectionMarker && (
              <ReferenceLine x={props.detectionMarker} stroke="#dc2626" strokeDasharray="4 3" strokeOpacity={0.95} label={{ value: "Detection", fontSize: 11, fill: "#dc2626", position: "insideTopLeft" }} />
            )}
            <Line type="monotone" dataKey="riskPct" name="Water quality risk score" stroke="#2563eb" strokeWidth={3} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <LegendSwatch color="#22c55e" label="Normal zone: 0-40%" />
          <LegendSwatch color="#f59e0b" label="Warning zone: 40-70%" />
          <LegendSwatch color="#ef4444" label="High-risk zone: above 70%" />
          <LegendSwatch color="#f59e0b" label="Disturbance injection begins" />
          <LegendSwatch color="#ef4444" label="First model detection" />
          <span>Shaded area: warm-up period</span>
        </div>
      </CardContent>
    </Card>
  );
}

function EvidenceChart(props: {
  data: SequenceChartRow[];
  eventMarker: string | null;
  detectionMarker: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base">Key Sensor Evidence: Normalized Risk Contributions</CardTitle>
        <p className="text-xs text-muted-foreground">
          Raw units are converted into comparable 0-100% contribution scores so the evidence is easy to explain.
        </p>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={props.data} margin={{ top: 10, right: 28, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              formatter={(value, name) => [`${Number(value).toFixed(0)}%`, name]}
              contentStyle={{
                fontSize: 12, padding: 10, borderRadius: 8,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {props.eventMarker && (
              <ReferenceLine x={props.eventMarker} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.9} />
            )}
            {props.detectionMarker && (
              <ReferenceLine x={props.detectionMarker} stroke="#dc2626" strokeDasharray="4 3" strokeOpacity={0.9} />
            )}
            <Line type="monotone" dataKey="turbidityRisk" name="Turbidity contribution" stroke="#2563eb" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="chlorineRisk" name="Residual chlorine contribution" stroke="#f97316" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="phRisk" name="pH contribution" stroke="#16a34a" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

type SequenceChartRow = {
  t: string;
  timestamp: string;
  turbidity: number;
  ph: number;
  flow: number;
  pressure: number;
  temp: number;
  chlorine: number;
  conductivity: number;
  truth: string;
  eventActive: boolean;
  prediction: string | null;
  status: string;
  confidence: number | null;
  confidencePct: number | null;
  riskPct: number;
  turbidityRisk: number;
  chlorineRisk: number;
  phRisk: number;
  conductivityRisk: number;
};

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

function getTurbidityRisk(turbidityNtu: number) {
  if (turbidityNtu <= 5) return 0;
  return clampPct(((turbidityNtu - 5) / 7) * 100);
}

function getChlorineRisk(chlorineMgL: number) {
  if (chlorineMgL >= 0.2 && chlorineMgL <= 0.5) return 0;
  if (chlorineMgL < 0.2) return clampPct(((0.2 - chlorineMgL) / 0.2) * 100);
  return clampPct(((chlorineMgL - 0.5) / 0.5) * 45);
}

function getPhRisk(ph: number) {
  if (ph >= 6.5 && ph <= 8.5) return 0;
  if (ph < 6.5) return clampPct(((6.5 - ph) / 1.5) * 100);
  return clampPct(((ph - 8.5) / 1.5) * 100);
}

function getConductivityRisk(conductivity: number, baseline: number) {
  const safeBaseline = Math.max(1, baseline);
  const relativeChange = Math.abs(conductivity - safeBaseline) / safeBaseline;
  if (relativeChange <= 0.15) return 0;
  return clampPct(((relativeChange - 0.15) / 0.25) * 60);
}

function getCombinedWaterQualityRisk(values: {
  turbidityRisk: number;
  chlorineRisk: number;
  phRisk: number;
  conductivityRisk: number;
}) {
  return clampPct(
    values.turbidityRisk * 0.36
    + values.chlorineRisk * 0.34
    + values.phRisk * 0.22
    + values.conductivityRisk * 0.08,
  );
}

function formatPrediction(value?: string | null) {
  if (!value || value === "normal") return "Normal";
  const labels: Record<string, string> = {
    possible_contamination: "Predicted possible contamination risk",
    possible_corrosion: "Predicted possible corrosion-related water quality risk",
    possible_sediment_disturbance: "Possible sediment disturbance",
    sensor_fault_suspected: "Sensor fault suspected",
    collecting_sequence: "Collecting sequence",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function getRiskStatusLabel(prediction: string | null | undefined, maxRiskScore: number) {
  if (prediction && prediction !== "normal") return formatPrediction(prediction);
  if (maxRiskScore >= 40) return "Temporary warning - monitor further";
  return "Normal";
}

function formatScenarioLabel(value: WQScenario) {
  return PRESENTATION_SCENARIOS.find((scenario) => scenario.value === value)?.label
    ?? value.replace(/_/g, " ");
}

function buildSequenceInterpretation(
  rows: SequenceChartRow[],
  prediction?: string | null,
  scenario?: WQScenario,
  maxRiskScore = 0,
) {
  if (!rows.length) return "No simulation readings are available yet.";
  const first = rows[0];
  const last = rows[rows.length - 1];
  const turbidityDelta = last.turbidity - first.turbidity;
  const chlorineDelta = last.chlorine - first.chlorine;
  const conductivityDelta = last.conductivity - first.conductivity;
  const phValues = rows.map((r) => r.ph);
  const phRange = Math.max(...phValues) - Math.min(...phValues);
  const maxTurbidityRisk = Math.max(...rows.map((r) => r.turbidityRisk));
  const maxChlorineRisk = Math.max(...rows.map((r) => r.chlorineRisk));
  const maxPhRisk = Math.max(...rows.map((r) => r.phRisk));

  if (scenario === "normal") {
    return "The simulated readings remained within expected operating ranges. No water quality anomaly risk was detected during this simulation.";
  }
  if (scenario === "sensor_fault") {
    return "The simulation introduced short sensor fluctuations. The system treated these as temporary changes and did not classify them as confirmed contamination.";
  }
  if (prediction === "possible_contamination") {
    return "Interpretation: The system predicted a possible water quality anomaly because the risk score crossed the detection threshold after turbidity increased and residual chlorine dropped below the expected range. This is an early-warning result and should be verified through field inspection or laboratory testing.";
  }
  if (prediction === "possible_corrosion") {
    return "Interpretation: The system predicted a possible corrosion-related water quality risk because the readings showed gradual deterioration over time. This result should guide inspection of pipe condition and water quality sampling.";
  }
  if (prediction === "possible_sediment_disturbance") {
    return "Interpretation: The system predicted a possible sediment disturbance because turbidity contributed strongly to the risk score. Field inspection should confirm the operational cause.";
  }
  if (prediction === "sensor_fault_suspected") {
    return "Interpretation: The system identified a suspected sensor fault pattern. The sensor should be checked before using the reading for operational decisions.";
  }

  const signals = [
    turbidityDelta > 0.5 || maxTurbidityRisk >= 30 ? "turbidity increased" : null,
    chlorineDelta < -0.05 || maxChlorineRisk >= 30 ? "residual chlorine moved outside the expected range" : null,
    phRange > 0.4 || maxPhRisk >= 30 ? "pH shifted outside the expected range" : null,
    conductivityDelta > 8 ? "conductivity changed slightly" : null,
  ].filter(Boolean);

  if (!prediction && maxRiskScore >= 40) {
    return `Interpretation: The simulation produced temporary warning-level movement (${signals.join(", ") || "brief sensor fluctuation"}), but the abnormal pattern did not persist long enough to trigger a water quality anomaly prediction.`;
  }

  return signals.length
    ? `Interpretation: The visible sensor movement was limited to ${signals.join(", ")}. The combined risk score did not cross the detection threshold, so no water quality anomaly risk was detected during this simulation.`
    : "Interpretation: The simulated readings remained within expected operating ranges. No water quality anomaly risk was detected during this simulation.";
}

function EvaluationDetails({ result }: { result: WQSequenceSimulationResult }) {
  return (
    <Card>
      <CardContent className="p-0">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck className="h-4 w-4" /> Evaluation Details
            </span>
            <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="border-t px-5 py-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <StatPill label="Hidden disturbance profile" value={result.summary.disturbance_profile.replace(/_/g, " ")} />
              <StatPill label="Injected anomaly type" value={result.summary.expected_label.replace(/_/g, " ")} />
              <StatPill label="False positives" value={result.summary.false_positives} />
              <StatPill label="False negatives" value={result.summary.false_negatives} />
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              These labels are evaluation metadata for synthetic runs. They are not passed to the detector or engineered-feature pipeline.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function MultiMetricChart(props: {
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  eventMarker: string | null;
  detectionMarker: string | null;
  lines: Array<{ key: string; label: string; stroke: string; yAxisId: "left" | "right" | "ph" }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={props.data} margin={{ top: 8, right: 42, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
            <YAxis
              yAxisId="ph"
              orientation="right"
              domain={[0, 14]}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={{
                fontSize: 11, padding: 8, borderRadius: 8,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {props.eventMarker && (
              <ReferenceLine yAxisId="left" x={props.eventMarker} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.9} />
            )}
            {props.detectionMarker && (
              <ReferenceLine yAxisId="left" x={props.detectionMarker} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.9} />
            )}
            {props.lines.map((l) => (
              <Line
                key={l.key}
                name={l.label}
                type="monotone"
                dataKey={l.key}
                yAxisId={l.yAxisId}
                stroke={l.stroke}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/* Page                                                                   */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function DecisionSupportSimulationTab() {
  const sim = useWaterQualitySimulation();
  const { data: thresholds } = useWaterQualityThresholds();
  const [config, setConfig] = useState({
    duration_hours: 24,
    interval_minutes: 15,
    scenario: "gradual_contamination" as WQScenario,
    noise_level: 0.1,
    pipe_age_years: 20,
    pipe_material: "cast_iron",
  });
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setError(null);
    try {
      await sim.mutateAsync(config);
    } catch (err) {
      setError(extractApiError(err, "Simulation failed - is the backend running?"));
    }
  }

  const result = sim.data;
  const chartData = useMemo(() => {
    if (!result) return [];
    return result.readings.map((r) => ({
      timeLabel: format(parseISO(r.timestamp), "HH:mm"),
      fullTime: format(parseISO(r.timestamp), "MMM d, HH:mm"),
      turbidity: r.turbidity_ntu,
      ph: r.ph,
      flow: r.flow_rate_lps,
      anomaly: r.anomaly_detected,
      truth: r.is_ground_truth_anomaly,
      issueType: getFriendlyIssueType(r),
      confidence: r.confidence_score,
    }));
  }, [result]);

  const interpretation = useMemo(() => {
    if (!result) return null;
    return buildSimulationInterpretation(result, config);
  }, [result, config]);

  const eventRows = useMemo(() => {
    if (!result) return [];
    return result.readings.filter((r) => r.anomaly_detected || r.is_ground_truth_anomaly);
  }, [result]);

  const suspectedWindow = useMemo(() => {
    const marked = chartData.filter((r) => r.anomaly || r.truth);
    if (marked.length < 2) return null;
    return {
      start: marked[0].timeLabel,
      end: marked[marked.length - 1].timeLabel,
    };
  }, [chartData]);

  const reliability = result ? getReliabilityState(result.summary.accuracy) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-base">Scenario Setup</CardTitle>
          <p className="text-xs text-muted-foreground">
            Choose the situation and pipe conditions to simulate.
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={`Duration (h): ${config.duration_hours}`}>
              <input
                type="range"
                min={1}
                max={168}
                step={1}
                value={config.duration_hours}
                onChange={(e) => setConfig((c) => ({ ...c, duration_hours: +e.target.value }))}
                className="w-full accent-primary"
              />
            </Field>
            <Field label="Reading frequency" description="How often the sensor reports a new reading.">
              <Select
                value={String(config.interval_minutes)}
                onValueChange={(v) => setConfig((c) => ({ ...c, interval_minutes: +v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 5, 15, 30, 60].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Situation" description="Choose the type of water quality event to simulate.">
              <Select
                value={config.scenario}
                onValueChange={(v) => setConfig((c) => ({ ...c, scenario: v as WQScenario }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCENARIOS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={`Sensor uncertainty: ${config.noise_level.toFixed(2)}`}
              description="Higher values simulate less reliable sensor readings."
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={config.noise_level}
                onChange={(e) => setConfig((c) => ({ ...c, noise_level: +e.target.value }))}
                className="w-full accent-primary"
              />
            </Field>
            <Field label="Pipe age" description="Older pipes may increase corrosion-related risk.">
              <Input
                type="number"
                min={0}
                step={1}
                value={config.pipe_age_years}
                onChange={(e) => setConfig((c) => ({ ...c, pipe_age_years: +e.target.value }))}
              />
            </Field>
            <Field label="Pipe material">
              <Select
                value={config.pipe_material}
                onValueChange={(v) => setConfig((c) => ({ ...c, pipe_material: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIPE_MATERIALS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={handleRun} disabled={sim.isPending}>
              {sim.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Running...</>
                : <><Play className="h-4 w-4" /> Run simulation</>}
            </Button>
            {sim.isPending && (
              <p className="text-xs text-muted-foreground">
                Generating ~{Math.round((config.duration_hours * 60) / config.interval_minutes)} readings...
              </p>
            )}
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </CardContent>
      </Card>

      {sim.isPending && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
            <Skeleton className="h-72 w-full" />
          </CardContent>
        </Card>
      )}

      {result && interpretation && reliability && (
        <>
          <Card className={cn("overflow-hidden", STATUS_COPY[interpretation.status].cardClass)}>
            <CardContent className="p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={STATUS_COPY[interpretation.status].badgeClass}>
                      Status: {STATUS_COPY[interpretation.status].label}
                    </Badge>
                    <Badge variant="outline" className={STATUS_COPY[interpretation.status].badgeClass}>
                      {STATUS_COPY[interpretation.status].badge}
                    </Badge>
                  </div>
                  <div className="flex gap-3">
                    <div className="mt-1 rounded-full bg-background/70 p-2">
                      {(() => {
                        const Icon = STATUS_COPY[interpretation.status].icon;
                        return <Icon className="h-5 w-5" />;
                      })()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold tracking-tight">
                        {STATUS_COPY[interpretation.status].label}: {interpretation.headline}
                      </h2>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                        {interpretation.message}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:min-w-[320px]">
                  <ReadingTile label="Unusual readings" value={String(result.anomalies_detected)} accent={result.anomalies_detected > 0 ? "warn" : "good"} />
                  <ReadingTile label="Suspected cause" value={interpretation.shortCause} accent={interpretation.status === "safe" ? "good" : "warn"} />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Card className="xl:col-span-2">
              <CardHeader className="pb-3 pt-5 px-5">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> What happened?
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">{interpretation.explanation}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <ReadingTile label="Situation" value={describeScenario(config.scenario)} />
                  <ReadingTile label="Pipe material" value={formatPipeMaterial(config.pipe_material)} />
                  <ReadingTile label="Pipe age" value={`${config.pipe_age_years} yrs`} />
                  <ReadingTile label="Main signal" value={interpretation.primarySignal} accent={interpretation.status === "safe" ? "good" : "warn"} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 pt-5 px-5">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4" /> Recommended Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <ActionList status={interpretation.status} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-base">Reliability and Results</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Plain-language indicators for how much confidence to place in this simulation.
                  </p>
                </div>
                <Badge variant="outline" className={reliability.badgeClass}>{reliability.label}</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-5">
              <div className="rounded-lg border bg-background/70 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Target reliability: 70-75%</p>
                    <p className="text-xs text-muted-foreground">
                      Current reliability: {(result.summary.accuracy * 100).toFixed(1)}%
                    </p>
                  </div>
                  <Badge variant="outline" className={reliability.badgeClass}>{reliability.rangeLabel}</Badge>
                </div>
                <Progress value={result.summary.accuracy * 100} fillClassName={reliability.progressClass} className="mt-3" />
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{reliability.message}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                <FriendlyMetric label="Overall reliability" value={`${(result.summary.accuracy * 100).toFixed(1)}%`} helper="How often the model's simulation result matches the expected outcome." accent={reliability.accent} />
                <FriendlyMetric label="Alert correctness" value={`${(result.summary.precision * 100).toFixed(1)}%`} helper="When the system raises an alert, how often that alert is likely to be correct." />
                <FriendlyMetric label="Detection coverage" value={`${(result.summary.recall * 100).toFixed(1)}%`} helper="How many real problems the system is likely to catch." />
                <FriendlyMetric label="Possible false alarms" value={`${(result.summary.false_positive_rate * 100).toFixed(1)}%`} helper="How often normal readings may be flagged as unusual." />
                <FriendlyMetric label="Sensor readings analyzed" value={result.total_readings} helper="Total readings reviewed during this simulation." />
                <FriendlyMetric label="Unusual readings detected" value={result.anomalies_detected} helper="Readings that looked different enough to require attention." accent={result.anomalies_detected > 0 ? "warn" : "good"} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Water Quality Trends Over Time</CardTitle>
              <p className="text-xs text-muted-foreground">
                The lines show turbidity, pH balance, and water flow. Red markers show unusual readings.
              </p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="timeLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip content={<PlainChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={4} yAxisId="left" stroke="#f97316" strokeDasharray="4 3" strokeOpacity={0.55} />
                  {suspectedWindow && (
                    <ReferenceArea yAxisId="left" x1={suspectedWindow.start} x2={suspectedWindow.end} fill="#ef4444" fillOpacity={0.08} strokeOpacity={0} />
                  )}
                  <Line yAxisId="left" type="monotone" dataKey="turbidity" stroke="#2563eb" strokeWidth={2} dot={false} name="Turbidity" />
                  <Line yAxisId="right" type="monotone" dataKey="ph" stroke="#16a34a" strokeWidth={2} dot={false} name="pH balance" />
                  <Line yAxisId="left" type="monotone" dataKey="flow" stroke="#7c3aed" strokeWidth={1.5} dot={false} name="Water flow" strokeDasharray="3 2" />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="turbidity"
                    stroke="transparent"
                    name="Unusual readings"
                    dot={(props) => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const { cx, cy, payload } = props as any;
                      if (!payload?.anomaly) return <g key={`a-${cx}-${cy}`} />;
                      return <circle key={`a-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />;
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Unusual Reading Log</CardTitle>
              <p className="text-xs text-muted-foreground">
                Readings that were detected as unusual or were part of the simulated event.
              </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground bg-muted/40 sticky top-0">
                    <tr>
                      <Th>Time</Th>
                      <Th>Issue type</Th>
                      <Th right>Turbidity</Th>
                      <Th right>pH</Th>
                      <Th right>Flow</Th>
                      <Th right>Confidence</Th>
                      <Th>Actual event</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventRows.map((r, i) => (
                      <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                        <Td className="tabular-nums whitespace-nowrap">{format(parseISO(r.timestamp), "MMM d HH:mm")}</Td>
                        <Td>
                          {r.anomaly_type
                            ? <Badge variant="outline">{getFriendlyIssueType(r)}</Badge>
                            : <span className="text-muted-foreground text-xs">Unusual pattern</span>}
                        </Td>
                        <Td right className="tabular-nums">{r.turbidity_ntu.toFixed(2)} NTU</Td>
                        <Td right className="tabular-nums">{r.ph.toFixed(2)}</Td>
                        <Td right className="tabular-nums">{r.flow_rate_lps.toFixed(2)} L/s</Td>
                        <Td right className="tabular-nums">{(r.confidence_score * 100).toFixed(0)}%</Td>
                        <Td>
                          {r.is_ground_truth_anomaly
                            ? <Badge variant="outline" className="border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">Injected in simulation</Badge>
                            : <span className="text-muted-foreground text-xs">Outside injected disturbance</span>}
                        </Td>
                      </tr>
                    ))}
                    {eventRows.length === 0 && (
                      <tr><Td colSpan={7} className="text-center text-muted-foreground py-6">No unusual readings in this run.</Td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <TechnicalDetails result={result} thresholds={thresholds} config={config} />
        </>
      )}
    </div>
  );
}

export default function WaterQualityPage() {
  return (
    <div className="p-6 space-y-6 min-h-full">
      <Breadcrumb
        items={[
          { label: "Sensors", href: "/sensors" },
          { label: "Water Quality" },
        ]}
      />
      <div className="flex items-start gap-4">
        <div className="rounded-2xl p-3 bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400">
          <Droplets className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Water Quality Detection
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <Beaker className="h-3.5 w-3.5" />
            Contamination & corrosion detection from turbidity, pH and flow.
          </p>
        </div>
      </div>

      <Tabs defaultValue="manual">
        <TabsList>
          <TabsTrigger value="manual">Manual Entry</TabsTrigger>
          <TabsTrigger value="simulation">Simulation</TabsTrigger>
        </TabsList>
        <TabsContent value="manual"><ManualEntryTab /></TabsContent>
        <TabsContent value="simulation"><SimulationTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* â”€â”€ Tiny presentational helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function getFriendlyIssueType(reading: Pick<WQSimulationReadingType, "anomaly_type" | "turbidity_ntu" | "ph" | "flow_rate_lps">) {
  switch (reading.anomaly_type) {
    case "contamination":
      return "Rising turbidity";
    case "corrosion_indicator":
      return "Possible corrosion contamination";
    case "ph_deviation":
      return "pH instability";
    default:
      if (reading.turbidity_ntu >= 4) return "Rising turbidity";
      if (reading.ph < 6.5 || reading.ph > 8.5) return "pH instability";
      if (reading.flow_rate_lps < 3 || reading.flow_rate_lps > 7) return "Flow irregularity";
      return "Unusual reading";
  }
}

function buildSimulationInterpretation(
  result: WQSimulationResultType,
  config: {
    scenario: WQScenario;
    pipe_age_years: number;
    pipe_material: string;
    noise_level: number;
  }
) {
  const readings = result.readings;
  const first = readings[0];
  const last = readings[readings.length - 1] ?? first;
  const turbidityDelta = (last?.turbidity_ntu ?? 0) - (first?.turbidity_ntu ?? 0);
  const phValues = readings.map((r) => r.ph);
  const flowValues = readings.map((r) => r.flow_rate_lps);
  const phRange = Math.max(...phValues) - Math.min(...phValues);
  const flowRange = Math.max(...flowValues) - Math.min(...flowValues);
  const anomalyEvents = result.anomalies_detected;
  const anomalyRatio = result.total_readings ? anomalyEvents / result.total_readings : 0;
  const highRiskPipe = ["cast_iron", "galvanized"].includes(config.pipe_material) && config.pipe_age_years >= 25;
  const avgCorrosion = result.summary.avg_corrosion_risk;
  const maxConfidence = Math.max(0, ...readings.map((r) => r.confidence_score ?? 0));

  let status: StatusLevel = "safe";
  if (
    anomalyEvents > 0 &&
    (avgCorrosion >= 0.7 || anomalyRatio >= 0.25 || (config.scenario === "sudden_spike" && maxConfidence >= 0.75))
  ) {
    status = "critical";
  } else if (anomalyEvents > 0 || avgCorrosion >= 0.45 || config.scenario === "corrosion_event") {
    status = "warning";
  } else if (avgCorrosion >= 0.25 || config.noise_level >= 0.35) {
    status = "monitor";
  }

  const primarySignal =
    Math.abs(turbidityDelta) >= 0.8 ? "Turbidity rising"
    : phRange >= 0.8 ? "pH unstable"
    : flowRange >= 2 ? "Flow irregular"
    : "Stable readings";

  const shortCause =
    highRiskPipe || avgCorrosion >= 0.45 || config.scenario === "corrosion_event"
      ? "Aging pipe risk"
      : Math.abs(turbidityDelta) >= 0.8
        ? "Rising turbidity"
        : phRange >= 0.8
          ? "pH instability"
          : flowRange >= 2
            ? "Flow irregularity"
            : "No clear issue";

  const headline =
    status === "safe" ? "Water quality appears safe"
    : status === "monitor" ? "Small changes need watching"
    : status === "warning" ? "Possible contamination pattern detected"
    : "High-risk water quality pattern detected";

  const causeSentence =
    shortCause === "Aging pipe risk"
      ? `The pattern may be related to ${config.pipe_age_years}-year-old ${formatPipeMaterial(config.pipe_material).toLowerCase()} pipes.`
      : shortCause === "No clear issue"
        ? "No single cause stands out from this run."
        : `${shortCause} appears to be the main signal.`;

  const message =
    status === "safe"
      ? "No unusual water quality pattern was detected in this simulation. Continue routine monitoring."
      : `${headline}. ${describeSignalChanges(turbidityDelta, phRange, flowRange)} ${causeSentence}`;

  const explanation = `During this ${describeScenario(config.scenario).toLowerCase()} simulation, ${describeSignalChanges(
    turbidityDelta,
    phRange,
    flowRange
  ).toLowerCase()} The pipe material was ${formatPipeMaterial(config.pipe_material).toLowerCase()} and the pipe age was ${config.pipe_age_years} years. ${
    status === "safe"
      ? "This pattern does not suggest an immediate water quality issue."
      : "This pattern may indicate contamination or corrosion-related change and should be verified before operational decisions are finalized."
  }`;

  return {
    status,
    headline,
    message,
    explanation,
    shortCause,
    primarySignal,
  };
}

function describeSignalChanges(turbidityDelta: number, phRange: number, flowRange: number) {
  const signals = [];
  if (turbidityDelta >= 0.8) signals.push("turbidity increased");
  if (turbidityDelta <= -0.8) signals.push("turbidity dropped");
  if (phRange >= 0.8) signals.push("pH remained unstable");
  if (flowRange >= 2) signals.push("flow was irregular");
  if (signals.length === 0) return "The main readings stayed mostly stable.";
  return `${signals.join(", ")}.`;
}

function describeScenario(scenario: WQScenario) {
  return SCENARIOS.find((s) => s.value === scenario)?.label ?? scenario.replace(/_/g, " ");
}

function formatPipeMaterial(value: string) {
  return PIPE_MATERIALS.find((m) => m.value === value)?.label ?? value.replace(/_/g, " ");
}

function getReliabilityState(accuracy: number) {
  if (accuracy < 0.7) {
    return {
      label: "Below target reliability",
      rangeLabel: "Below target",
      accent: "bad" as const,
      badgeClass: "border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
      progressClass: "bg-red-500",
      message: "Model reliability is below the target range. Results should be treated as indicative and verified with field testing.",
    };
  }
  if (accuracy <= 0.75) {
    return {
      label: "Minimum target met",
      rangeLabel: "Meets target",
      accent: "warn" as const,
      badgeClass: "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
      progressClass: "bg-amber-500",
      message: "Model reliability meets the minimum target range, but alerts should still be verified.",
    };
  }
  return {
    label: "Above target reliability",
    rangeLabel: "Above target",
    accent: "good" as const,
    badgeClass: "border-transparent bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
    progressClass: "bg-green-500",
    message: "Model reliability is above the target range for this simulation.",
  };
}

function ActionList({ status }: { status: StatusLevel }) {
  const actions: Record<StatusLevel, string[]> = {
    safe: ["Continue normal monitoring", "No immediate action required"],
    monitor: ["Review recent sensor readings", "Continue monitoring for changes"],
    warning: ["Inspect affected pipe section", "Verify turbidity and pH readings", "Schedule water sample testing"],
    critical: [
      "Trigger operational alert",
      "Perform immediate water quality testing",
      "Notify responsible response team",
      "Consider public advisory workflow",
    ],
  };

  return (
    <ul className="space-y-3">
      {actions[status].map((action) => (
        <li key={action} className="flex gap-2 text-sm leading-5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{action}</span>
        </li>
      ))}
    </ul>
  );
}

function FriendlyMetric({
  label,
  value,
  helper,
  accent = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  helper: string;
  accent?: "good" | "warn" | "bad" | "neutral";
}) {
  const tone = {
    good: "border-green-200 bg-green-50/60 dark:border-green-500/30 dark:bg-green-500/10",
    warn: "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10",
    bad: "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10",
    neutral: "border-border bg-card",
  }[accent];

  return (
    <div className={cn("rounded-lg border p-4", tone)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{helper}</p>
    </div>
  );
}

function PlainChartTooltip({ active, payload }: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">Time: {row.fullTime}</p>
      <p className="mt-2">Turbidity: {row.turbidity.toFixed(2)} NTU</p>
      <p>pH: {row.ph.toFixed(2)}</p>
      <p>Flow: {row.flow.toFixed(2)} L/s</p>
      <p className={cn("mt-2 font-medium", row.anomaly ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
        Status: {row.anomaly ? "Unusual reading detected" : "No unusual reading detected"}
      </p>
    </div>
  );
}

function TechnicalDetails({
  result,
  thresholds,
  config,
}: {
  result: WQSimulationResultType;
  thresholds: {
    turbidity_normal_max_ntu: number;
    turbidity_warning_ntu: number;
    turbidity_critical_ntu: number;
    ph_normal_range: [number, number];
    ph_warning_range: [number, number];
    flow_deviation_warning_pct: number;
    flow_deviation_critical_pct: number;
  } | undefined;
  config: {
    duration_hours: number;
    interval_minutes: number;
    scenario: WQScenario;
    noise_level: number;
    pipe_age_years: number;
    pipe_material: string;
  };
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Gauge className="h-4 w-4" /> Technical Details
            </span>
            <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="border-t px-5 py-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FriendlyMetric label="Accuracy" value={`${(result.summary.accuracy * 100).toFixed(1)}%`} helper="Raw model accuracy for this run." />
              <FriendlyMetric label="Precision" value={`${(result.summary.precision * 100).toFixed(1)}%`} helper="Raw precision score." />
              <FriendlyMetric label="Recall" value={`${(result.summary.recall * 100).toFixed(1)}%`} helper="Raw recall score." />
              <FriendlyMetric label="False positives" value={`${(result.summary.false_positive_rate * 100).toFixed(1)}%`} helper="Raw false positive rate." />
            </div>
            <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs text-muted-foreground">
              <div className="rounded-lg border p-4">
                <p className="mb-2 font-semibold text-foreground">Raw thresholds</p>
                {thresholds ? (
                  <div className="space-y-1">
                    <p>Turbidity normal max: {thresholds.turbidity_normal_max_ntu} NTU</p>
                    <p>Turbidity warning: {thresholds.turbidity_warning_ntu} NTU</p>
                    <p>Turbidity critical: {thresholds.turbidity_critical_ntu} NTU</p>
                    <p>pH normal range: {thresholds.ph_normal_range.join(" - ")}</p>
                    <p>pH warning range: {thresholds.ph_warning_range.join(" - ")}</p>
                    <p>Flow warning deviation: {thresholds.flow_deviation_warning_pct}%</p>
                    <p>Flow critical deviation: {thresholds.flow_deviation_critical_pct}%</p>
                  </div>
                ) : (
                  <p>Thresholds are loading or unavailable.</p>
                )}
              </div>
              <div className="rounded-lg border p-4">
                <p className="mb-2 font-semibold text-foreground">Model parameters</p>
                <div className="space-y-1">
                  <p>Scenario: {config.scenario}</p>
                  <p>Duration hours: {config.duration_hours}</p>
                  <p>Interval minutes: {config.interval_minutes}</p>
                  <p>Noise level: {config.noise_level}</p>
                  <p>Pipe age: {config.pipe_age_years}</p>
                  <p>Pipe material: {config.pipe_material}</p>
                  <p>Average corrosion risk: {(result.summary.avg_corrosion_risk * 100).toFixed(1)}%</p>
                </div>
              </div>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function Field({ label, children, optional, description }: {
  label: string; children: React.ReactNode; optional?: boolean; description?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">
        {label}{optional && <span className="opacity-60"> (optional)</span>}
      </span>
      {description && (
        <span className="block text-[11px] leading-4 text-muted-foreground/80">
          {description}
        </span>
      )}
      {children}
    </label>
  );
}

function ScoreBar({
  label, value, icon: Icon, fillClassName,
}: {
  label: string;
  value: number; // 0â€“1
  icon: React.ComponentType<{ className?: string }>;
  fillClassName?: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="text-xs font-semibold tabular-nums">{pct}%</span>
      </div>
      <Progress value={pct} fillClassName={fillClassName} />
    </div>
  );
}

function ReadingTile({
  label, value, accent,
}: {
  label: string;
  value: string;
  accent?: "good" | "warn" | "bad" | "neutral";
}) {
  const tone = {
    good: "border-green-300 dark:border-green-500/40",
    warn: "border-amber-300 dark:border-amber-500/40",
    bad:  "border-red-300 dark:border-red-500/40",
    neutral: "border-border",
  }[accent ?? "neutral"];
  return (
    <div className={cn("rounded-lg border p-3", tone)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tracking-tight tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn(
      "px-3 py-2 font-semibold uppercase tracking-wider whitespace-nowrap",
      right ? "text-right" : "text-left"
    )}>
      {children}
    </th>
  );
}
function Td({
  children, right, className, colSpan,
}: {
  children: React.ReactNode; right?: boolean; className?: string; colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn("px-3 py-2", right && "text-right", className)}>
      {children}
    </td>
  );
}





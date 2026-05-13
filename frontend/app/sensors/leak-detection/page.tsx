"use client";
import { useMemo, useState } from "react";
import {
  AlertTriangle, Loader2, Play, Activity,
  CheckCircle2, XCircle, Cpu, Database, ClipboardCheck, FileText, Info,
  ChevronDown,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend, ReferenceArea,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import Breadcrumb from "@/components/layout/Breadcrumb";
import ResultBanner from "@/components/sensors-detection/ResultBanner";
import StatPill from "@/components/sensors-detection/StatPill";
import {
  useLeakSimulation,
  useLeakSequenceSimulation,
  useLeakModelStatus,
} from "@/hooks/useLeakDetection";
import { extractApiError } from "@/lib/utils";
import type {
  LeakScenario,
  LeakScenarioType,
  LeakPredictionLabel,
  LeakSimulationRunResult,
  LeakSimulationResult,
  LeakValveStatusSim,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const SCENARIOS: { value: LeakScenario; label: string }[] = [
  { value: "normal",            label: "Normal operation" },
  { value: "slow_leak",         label: "Slow leak" },
  { value: "burst_pipe",        label: "Burst pipe" },
  { value: "overflow",          label: "Overflow" },
  { value: "intermittent_leak", label: "Intermittent leak" },
  { value: "random",            label: "Random mix" },
];

type PipeDiameterOption = 50 | 75 | 100 | 150 | 200 | 250;
type SessionZoneType = "residential" | "commercial" | "industrial" | "mixed";

const PIPE_DIAMETER_PRESETS: Record<PipeDiameterOption, {
  flow: [number, number];
  pressure: [number, number];
}> = {
  50: { flow: [0.5, 3], pressure: [200, 450] },
  75: { flow: [1, 6], pressure: [220, 460] },
  100: { flow: [2, 10], pressure: [240, 470] },
  150: { flow: [5, 20], pressure: [270, 480] },
  200: { flow: [10, 35], pressure: [280, 500] },
  250: { flow: [20, 55], pressure: [300, 520] },
};

function estimateBaselineRanges(
  diameter: PipeDiameterOption,
  zoneType: SessionZoneType,
  connectedProperties: number,
) {
  const preset = PIPE_DIAMETER_PRESETS[diameter] ?? PIPE_DIAMETER_PRESETS[150];
  const zoneMultiplier = zoneType === "industrial" ? 1.4
    : zoneType === "commercial" ? 1.2
    : zoneType === "mixed" ? 1.1
    : 1.0;
  const demandMultiplier = connectedProperties < 30 ? 0.85
    : connectedProperties > 100 ? 1.25
    : 1.0;
  const flowMultiplier = zoneMultiplier * demandMultiplier;

  return {
    pressureMin: preset.pressure[0],
    pressureMax: preset.pressure[1],
    flowMin: Number((preset.flow[0] * flowMultiplier).toFixed(1)),
    flowMax: Number((preset.flow[1] * flowMultiplier).toFixed(1)),
  };
}

function getBaselineWarnings(config: {
  baseline_pressure_min_kpa: number;
  baseline_pressure_max_kpa: number;
  baseline_flow_min_lps: number;
  baseline_flow_max_lps: number;
  pipe_diameter_mm: PipeDiameterOption;
  zone_type: SessionZoneType;
  connected_properties_count: number;
}) {
  const recommended = estimateBaselineRanges(
    config.pipe_diameter_mm,
    config.zone_type,
    config.connected_properties_count,
  );
  const warnings: string[] = [];

  if (config.baseline_pressure_min_kpa >= config.baseline_pressure_max_kpa) {
    warnings.push("Pressure minimum should be lower than pressure maximum.");
  }
  if (config.baseline_flow_min_lps >= config.baseline_flow_max_lps) {
    warnings.push("Flow minimum should be lower than flow maximum.");
  }
  if (config.baseline_flow_max_lps > recommended.flowMax * 1.6) {
    warnings.push(`Flow range appears high for a ${config.pipe_diameter_mm} mm pipe. Confirm if this is based on field data.`);
  }
  if (config.baseline_pressure_min_kpa < recommended.pressureMin * 0.75) {
    warnings.push("Pressure range appears low for this zone. Check pump/elevation conditions.");
  }

  return warnings;
}

type LeakStatus = "normal" | "monitor" | "suspected" | "critical";

const LEAK_STATUS_COPY: Record<LeakStatus, {
  label: string;
  badge: string;
  cardClass: string;
  badgeClass: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  normal: {
    label: "Normal",
    badge: "Stable",
    cardClass: "border-green-200 bg-green-50/80 dark:border-green-500/25 dark:bg-green-500/10",
    badgeClass: "border-transparent bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
    icon: CheckCircle2,
  },
  monitor: {
    label: "Monitor",
    badge: "Watch closely",
    cardClass: "border-blue-200 bg-blue-50/80 dark:border-blue-500/25 dark:bg-blue-500/10",
    badgeClass: "border-transparent bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    icon: Info,
  },
  suspected: {
    label: "Possible Leak Risk",
    badge: "Action advised",
    cardClass: "border-orange-200 bg-orange-50/80 dark:border-orange-500/25 dark:bg-orange-500/10",
    badgeClass: "border-transparent bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
    icon: AlertTriangle,
  },
  critical: {
    label: "High Leak Risk",
    badge: "Immediate action",
    cardClass: "border-red-200 bg-red-50/80 dark:border-red-500/25 dark:bg-red-500/10",
    badgeClass: "border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    icon: AlertTriangle,
  },
};

function SimulationSessionTab() {
  const sim = useLeakSequenceSimulation();
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [runResult, setRunResult] = useState<LeakSimulationRunResult | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [showDisturbance, setShowDisturbance] = useState(false);
  const [rangeMode, setRangeMode] = useState<"recommended" | "manual">("recommended");
  const [history, setHistory] = useState<Array<{
    id: string;
    groundTruth: LeakScenarioType;
    durationHours: number;
    samplingMin: number;
    windowReadings: number;
    prediction: LeakPredictionLabel | null;
    confidence: number | null;
    anomalyScore: number | null;
    latencyMin: number | null;
    severity: "low" | "medium" | "high" | "critical";
    baselinePressure: [number, number];
    baselineFlow: [number, number];
    status: "completed" | "failed";
  }>>([]);

  const [config, setConfig] = useState({
    // ── Existing controls ──────────────────────────────
    duration_hours: 24,
    sampling_interval_minutes: 15,
    detection_window_readings: 21,
    sensor_uncertainty: 0.2,
    valve_status: "unknown" as LeakValveStatusSim,
    event_start_minutes: 180,
    ground_truth_event: "small_leak" as LeakScenarioType,

    // ── Baseline operating conditions ──────────────────
    baseline_pressure_min_kpa: 270,
    baseline_pressure_max_kpa: 480,
    baseline_flow_min_lps: 5,
    baseline_flow_max_lps: 20,
    baseline_tank_level_percent: 60,
    baseline_acoustic_db: 30,
    baseline_soil_moisture_percent: 40,
    pipe_diameter_mm: 150 as PipeDiameterOption,
    zone_type: "residential" as SessionZoneType,
    connected_properties_count: 50,

    // ── Disturbance / anomaly profile ──────────────────
    pressure_drop_pattern: "gradual" as "none" | "gradual" | "sudden" | "intermittent",
    pressure_decay_rate_kpa_per_step: 5,

    flow_spike_pattern: "gradual" as "none" | "gradual" | "sudden" | "intermittent",
    flow_increase_rate_lps_per_step: 1.2,
    sustained_night_flow: false,

    acoustic_spike_pattern: "gradual" as "none" | "gradual" | "sudden" | "intermittent",
    acoustic_increase_rate_db: 10,

    tank_rise_rate_percent_per_step: 0,
    inflow_continues: false,

    soil_moisture_increase_rate_percent: 0.3,

    severity: "medium" as "low" | "medium" | "high" | "critical",
    disturbance_duration_minutes: 240,
  });

  const totalMinutes = config.duration_hours * 60;
  const warmupMinutes = config.detection_window_readings * config.sampling_interval_minutes;
  const warmupHours = warmupMinutes / 60;
  const warmupWarning = config.event_start_minutes < warmupMinutes;
  const recommendedRanges = useMemo(
    () => estimateBaselineRanges(
      config.pipe_diameter_mm,
      config.zone_type,
      config.connected_properties_count,
    ),
    [config.connected_properties_count, config.pipe_diameter_mm, config.zone_type],
  );
  const activeRanges = rangeMode === "recommended"
    ? recommendedRanges
    : {
      pressureMin: config.baseline_pressure_min_kpa,
      pressureMax: config.baseline_pressure_max_kpa,
      flowMin: config.baseline_flow_min_lps,
      flowMax: config.baseline_flow_max_lps,
    };
  const baselineWarnings = useMemo(
    () => getBaselineWarnings({
      baseline_pressure_min_kpa: activeRanges.pressureMin,
      baseline_pressure_max_kpa: activeRanges.pressureMax,
      baseline_flow_min_lps: activeRanges.flowMin,
      baseline_flow_max_lps: activeRanges.flowMax,
      pipe_diameter_mm: config.pipe_diameter_mm,
      zone_type: config.zone_type,
      connected_properties_count: config.connected_properties_count,
    }),
    [activeRanges.flowMax, activeRanges.flowMin, activeRanges.pressureMax, activeRanges.pressureMin, config.connected_properties_count, config.pipe_diameter_mm, config.zone_type],
  );
  const simulationRanges = useMemo(() => ({
    pressureMin: Math.max(0, activeRanges.pressureMin),
    pressureMax: Math.max(activeRanges.pressureMax, activeRanges.pressureMin + 1),
    flowMin: Math.max(0, activeRanges.flowMin),
    flowMax: Math.max(activeRanges.flowMax, activeRanges.flowMin + 0.1),
  }), [activeRanges.flowMax, activeRanges.flowMin, activeRanges.pressureMax, activeRanges.pressureMin]);
  const rangeModeLabel = rangeMode === "recommended" ? "Use recommended ranges" : "Manual override";

  function switchToManualWithRecommended() {
    setRangeMode("manual");
    setConfig((c) => ({
      ...c,
      baseline_pressure_min_kpa: activeRanges.pressureMin,
      baseline_pressure_max_kpa: activeRanges.pressureMax,
      baseline_flow_min_lps: activeRanges.flowMin,
      baseline_flow_max_lps: activeRanges.flowMax,
    }));
  }

  function setManualRangeValue(
    key: "baseline_pressure_min_kpa" | "baseline_pressure_max_kpa" | "baseline_flow_min_lps" | "baseline_flow_max_lps",
    value: number,
  ) {
    setRangeMode("manual");
    setConfig((c) => ({ ...c, [key]: value }));
  }

  const generated = runResult?.generated_readings ?? [];
  const summary = runResult?.summary;

  const detectionResults = runResult?.detection_results ?? [];
  const detByTs = useMemo(() => {
    const m = new Map<string, { prediction: LeakPredictionLabel | null; confidence: number | null }>();
    for (const d of detectionResults) m.set(d.timestamp, { prediction: d.prediction ?? null, confidence: d.confidence ?? null });
    return m;
  }, [detectionResults]);

  const chartData = useMemo(() => {
    if (!generated.length) return [];
    return generated.map((r, idx) => {
      const d = detByTs.get(r.timestamp);
      const conf = d?.confidence ?? null;
      const pred = d?.prediction ?? null;
      const anomalyScore = conf == null ? null
        : (pred && pred !== "normal" ? conf : Math.min(0.35, Math.max(0, 1 - conf)));
      return {
        idx,
        t: format(parseISO(r.timestamp), "HH:mm"),
        timestamp: r.timestamp,
        pressure: r.pressure_kpa,
        flow: r.flow_lps,
        acoustic: r.acoustic_db,
        soil: r.soil_moisture_percent,
        tank: r.tank_level_percent,
        valve: r.valve_status,
        eventActive: r.event_active,
        prediction: pred,
        confidence: conf,
        anomalyScore: anomalyScore == null ? null : Math.min(1, Math.max(0, anomalyScore)),
        riskPct: anomalyScore == null ? null : Math.round(Math.min(1, Math.max(0, anomalyScore)) * 100),
      };
    });
  }, [generated, detByTs]);

  const eventIndex = Math.min(
    Math.max(0, Math.floor(config.event_start_minutes / config.sampling_interval_minutes)),
    Math.max(0, chartData.length - 1)
  );

  const detectionIndex = summary?.first_detection_time_minutes == null
    ? null
    : Math.min(
      Math.max(0, Math.floor(summary.first_detection_time_minutes / config.sampling_interval_minutes)),
      Math.max(0, chartData.length - 1)
    );

  async function handleStart() {
    setError(null);
    setStarted(true);
    setRunResult(null);
  }

  async function handleRun() {
    setError(null);
    const effectiveEventStart = config.ground_truth_event === "normal"
      ? 0
      : Math.max(config.event_start_minutes, warmupMinutes);
    const effectiveDisturbance = Math.max(
      30,
      Math.min(config.disturbance_duration_minutes, totalMinutes - effectiveEventStart),
    );
    try {
      const result = await sim.mutateAsync({
        // ── Existing fields ─────────────────────────────
        duration_hours: config.duration_hours,
        data_frequency_minutes: config.sampling_interval_minutes,
        detection_sensitivity_window: config.detection_window_readings,
        sensor_uncertainty: config.sensor_uncertainty,
        valve_status: config.valve_status,
        enable_time_of_day_pattern: false,
        scenario_type: config.ground_truth_event,
        event_start_time_minutes: effectiveEventStart,
        event_duration_minutes: effectiveDisturbance,
        event_severity: config.severity,

        // ── Baseline operating conditions ───────────────
        baseline_pressure_min_kpa: simulationRanges.pressureMin,
        baseline_pressure_max_kpa: simulationRanges.pressureMax,
        baseline_flow_min_lps: simulationRanges.flowMin,
        baseline_flow_max_lps: simulationRanges.flowMax,
        tank_level_initial_percent: config.baseline_tank_level_percent,
        acoustic_baseline_db: config.baseline_acoustic_db,
        soil_moisture_baseline_percent: config.baseline_soil_moisture_percent,
        pipe_diameter_mm: config.pipe_diameter_mm,
        zone_type: config.zone_type,
        connected_properties_count: config.connected_properties_count,

        // ── Extended disturbance profile (NOT model inputs) ──
        pressure_drop_pattern: config.pressure_drop_pattern,
        pressure_decay_rate_kpa_per_step: config.pressure_decay_rate_kpa_per_step,
        flow_spike_pattern: config.flow_spike_pattern,
        flow_increase_rate_lps_per_step: config.flow_increase_rate_lps_per_step,
        sustained_night_flow: config.sustained_night_flow,
        acoustic_spike_pattern: config.acoustic_spike_pattern,
        acoustic_increase_rate_db: config.acoustic_increase_rate_db,
        tank_rise_rate_percent_per_step: config.tank_rise_rate_percent_per_step,
        inflow_continues: config.inflow_continues,
        soil_moisture_increase_rate_percent: config.soil_moisture_increase_rate_percent,
        disturbance_duration_minutes: effectiveDisturbance,
      });
      setRunResult(result);
      setHistory((prev) => [
        {
          id: result.simulation_id,
          groundTruth: config.ground_truth_event,
          durationHours: config.duration_hours,
          samplingMin: config.sampling_interval_minutes,
          windowReadings: config.detection_window_readings,
          prediction: result.summary.predicted_label,
          confidence: result.summary.predicted_label ? result.summary.max_confidence : null,
          anomalyScore: result.summary.max_anomaly_score ?? null,
          latencyMin: result.summary.detection_latency_minutes,
          severity: config.severity,
          baselinePressure: [simulationRanges.pressureMin, simulationRanges.pressureMax],
          baselineFlow: [simulationRanges.flowMin, simulationRanges.flowMax],
          status: "completed",
        },
        ...prev,
      ]);
    } catch (err) {
      setError(extractApiError(err, "Simulation failed."));
      setHistory((prev) => [
        {
          id: `failed-${Date.now()}`,
          groundTruth: config.ground_truth_event,
          durationHours: config.duration_hours,
          samplingMin: config.sampling_interval_minutes,
          windowReadings: config.detection_window_readings,
          prediction: null,
          confidence: null,
          anomalyScore: null,
          latencyMin: null,
          severity: config.severity,
          baselinePressure: [simulationRanges.pressureMin, simulationRanges.pressureMax],
          baselineFlow: [simulationRanges.flowMin, simulationRanges.flowMax],
          status: "failed",
        },
        ...prev,
      ]);
    }
  }

  function handleReset() {
    setError(null);
    setStarted(false);
    setRunResult(null);
    setHistory([]);
  }

  const derivedPrediction = useMemo(() => {
    const pred = summary?.predicted_label ?? null;
    if (!pred) {
      return {
        prediction: "No detection yet",
        confidence: null as number | null,
        severity: "—",
        recommended: "—",
        explanation: "Run a simulation to generate a sequence and compute a prediction.",
      };
    }
    const map: Record<LeakPredictionLabel, {
      label: string;
      severity: string;
      recommended: string;
      explanation: string;
    }> = {
      normal: {
        label: "Normal operating pattern",
        severity: "Low",
        recommended: "Continue monitoring",
        explanation: "Pressure and flow remain within expected operating ranges.",
      },
      possible_leak: {
        label: "Possible leak risk detected",
        severity: "High",
        recommended: "Dispatch crew to inspect the affected zone",
        explanation: "Pattern consistent with possible leak: pressure loss and flow increase were detected across the sequence.",
      },
      possible_burst: {
        label: "Pattern consistent with possible burst",
        severity: "Critical",
        recommended: "Isolate valve and dispatch crew",
        explanation: "Sudden pressure drop and sharp flow spike detected across the sequence.",
      },
      overflow_risk: {
        label: "Possible overflow risk detected",
        severity: "Critical",
        recommended: "Verify tank inflow/outflow and adjust valve settings",
        explanation: "Tank level behavior suggests possible overflow risk.",
      },
      sensor_fault: {
        label: "Sensor anomaly suspected",
        severity: "Medium",
        recommended: "Validate sensor health and cross-check with nearby sensors",
        explanation: "Inconsistent readings suggest sensor fault rather than hydraulics.",
      },
    };
    return {
      prediction: map[pred].label,
      confidence: summary?.max_confidence ?? null,
      severity: map[pred].severity,
      recommended: map[pred].recommended,
      explanation: map[pred].explanation,
    };
  }, [summary]);

  const baselineComparison = useMemo(
    () => buildThreeHourBaselineComparison(chartData, summary, {
      ...config,
      baseline_flow_max_lps: simulationRanges.flowMax,
    }),
    [chartData, config, simulationRanges.flowMax, summary],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-base">Detection Session</CardTitle>
          <p className="text-xs text-muted-foreground">
            Configure baseline operating conditions and inject a synthetic disturbance.
            The detection model only receives generated sensor streams.
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-1 gap-4">
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

            <Field label="Sampling interval (min)">
              <Select
                value={String(config.sampling_interval_minutes)}
                onValueChange={(v) => setConfig((c) => ({ ...c, sampling_interval_minutes: +v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 5, 15, 30, 60].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={`Detection window: ${config.detection_window_readings} readings`}>
              <input
                type="range"
                min={2}
                max={48}
                step={1}
                value={config.detection_window_readings}
                onChange={(e) => setConfig((c) => ({ ...c, detection_window_readings: +e.target.value }))}
                className="w-full accent-primary"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Sampling interval: <span className="font-mono">{config.sampling_interval_minutes} min</span> ·
                {" "}Warm-up time: <span className={cn("font-mono", warmupWarning && "text-amber-700 dark:text-amber-300")}>
                  {warmupMinutes} min ({warmupHours.toFixed(2)} h)
                </span>
              </p>
              {warmupWarning && (
                <div className="mt-2 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                  <AlertTriangle className="h-3 w-3" />
                  Event start will be adjusted to after model warm-up.
                </div>
              )}
            </Field>

            <Field label={`Sensor uncertainty: ${config.sensor_uncertainty.toFixed(2)}`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={config.sensor_uncertainty}
                onChange={(e) => setConfig((c) => ({ ...c, sensor_uncertainty: +e.target.value }))}
                className="w-full accent-primary"
              />
            </Field>

            <Field label="Valve status">
              <Select
                value={config.valve_status}
                onValueChange={(v) => setConfig((c) => ({ ...c, valve_status: v as LeakValveStatusSim }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="partially_open">Partially open</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="failed_open">Failed open</SelectItem>
                  <SelectItem value="failed_closed">Failed closed</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label={`Event start (min): ${config.ground_truth_event === "normal" ? "—" : config.event_start_minutes}`}>
              <input
                type="range"
                min={0}
                max={totalMinutes}
                step={config.sampling_interval_minutes}
                value={config.event_start_minutes}
                onChange={(e) => setConfig((c) => ({ ...c, event_start_minutes: +e.target.value }))}
                className="w-full accent-primary"
                disabled={config.ground_truth_event === "normal"}
              />
            </Field>

          </div>

          {/* ─────────── Baseline Operating Conditions ─────────── */}
          <CollapsibleSection
            title="Baseline Operating Conditions"
            open={showBaseline}
            onToggle={() => setShowBaseline((v) => !v)}
          >
            <div className="space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                Recommended pressure and flow ranges are estimated from pipe diameter, zone type, and connected demand. They can be adjusted using council field data because real network conditions also depend on elevation, pump pressure, pipe age, valve status, and local demand.
              </div>

              <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{rangeModeLabel}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Recommended: {recommendedRanges.pressureMin}-{recommendedRanges.pressureMax} kPa · {recommendedRanges.flowMin}-{recommendedRanges.flowMax} L/s
                    </p>
                  </div>
                  <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
                    <Button
                      type="button"
                      size="sm"
                      variant={rangeMode === "recommended" ? "default" : "ghost"}
                      className="h-8 text-xs"
                      onClick={() => setRangeMode("recommended")}
                    >
                      Use recommended ranges
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={rangeMode === "manual" ? "default" : "ghost"}
                      className="h-8 text-xs"
                      onClick={switchToManualWithRecommended}
                    >
                      Manual override
                    </Button>
                  </div>
                </div>
                {rangeMode === "manual" && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Values have been customised. The simulation will use the manual pressure and flow ranges shown below.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Pressure min (kPa)">
                <Input type="number" min={0} value={activeRanges.pressureMin}
                  onChange={(e) => setManualRangeValue("baseline_pressure_min_kpa", +e.target.value)} />
              </Field>
              <Field label="Pressure max (kPa)">
                <Input type="number" min={0} value={activeRanges.pressureMax}
                  onChange={(e) => setManualRangeValue("baseline_pressure_max_kpa", +e.target.value)} />
              </Field>
              <Field label="Flow min (L/s)">
                <Input type="number" min={0} step={0.1} value={activeRanges.flowMin}
                  onChange={(e) => setManualRangeValue("baseline_flow_min_lps", +e.target.value)} />
              </Field>
              <Field label="Flow max (L/s)">
                <Input type="number" min={0} step={0.1} value={activeRanges.flowMax}
                  onChange={(e) => setManualRangeValue("baseline_flow_max_lps", +e.target.value)} />
              </Field>
              <Field label="Tank level (%)">
                <Input type="number" min={0} max={100} step={0.1} value={config.baseline_tank_level_percent}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_tank_level_percent: +e.target.value }))} />
              </Field>
              <Field label="Acoustic baseline (dB)">
                <Input type="number" min={0} step={0.1} value={config.baseline_acoustic_db}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_acoustic_db: +e.target.value }))} />
              </Field>
              <Field label="Soil moisture (%)">
                <Input type="number" min={0} max={100} step={0.1} value={config.baseline_soil_moisture_percent}
                  onChange={(e) => setConfig((c) => ({ ...c, baseline_soil_moisture_percent: +e.target.value }))} />
              </Field>
              <Field label="Pipe diameter (mm)">
                <Select value={String(config.pipe_diameter_mm)}
                  onValueChange={(v) => setConfig((c) => ({ ...c, pipe_diameter_mm: +v as PipeDiameterOption }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="75">75</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="150">150</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                    <SelectItem value="250">250</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Zone type">
                <Select value={config.zone_type}
                  onValueChange={(v) => setConfig((c) => ({ ...c, zone_type: v as SessionZoneType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Connected properties">
                <Input type="number" min={1} value={config.connected_properties_count}
                  onChange={(e) => setConfig((c) => ({ ...c, connected_properties_count: +e.target.value }))} />
              </Field>
              </div>

              {baselineWarnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                  <div className="mb-1 flex items-center gap-1 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Baseline checks
                  </div>
                  <ul className="space-y-1">
                    {baselineWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <details className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
                <summary className="cursor-pointer font-semibold text-slate-800 dark:text-slate-100">
                  How ranges are estimated
                </summary>
                <p className="mt-2 text-muted-foreground">
                  Flow range is estimated mainly from pipe diameter, connected properties, and zone type. Pressure range is treated as an operating envelope because pressure depends on pump/reservoir head, elevation, valve status, friction losses, and local network conditions.
                </p>
              </details>
            </div>
          </CollapsibleSection>

          {/* ─────────── Disturbance / Anomaly Profile ─────────── */}
          <CollapsibleSection
            title="Disturbance / Anomaly Profile"
            open={showDisturbance}
            onToggle={() => setShowDisturbance((v) => !v)}
          >
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pressure behavior</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Pressure drop pattern">
                    <Select value={config.pressure_drop_pattern}
                      onValueChange={(v) => setConfig((c) => ({ ...c, pressure_drop_pattern: v as typeof c.pressure_drop_pattern }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="gradual">Gradual</SelectItem>
                        <SelectItem value="sudden">Sudden</SelectItem>
                        <SelectItem value="intermittent">Intermittent</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Pressure decay rate (kPa/step)">
                    <Input type="number" min={0} step={0.1} value={config.pressure_decay_rate_kpa_per_step}
                      onChange={(e) => setConfig((c) => ({ ...c, pressure_decay_rate_kpa_per_step: +e.target.value }))} />
                  </Field>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Flow behavior</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Flow spike pattern">
                    <Select value={config.flow_spike_pattern}
                      onValueChange={(v) => setConfig((c) => ({ ...c, flow_spike_pattern: v as typeof c.flow_spike_pattern }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="gradual">Gradual</SelectItem>
                        <SelectItem value="sudden">Sudden</SelectItem>
                        <SelectItem value="intermittent">Intermittent</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Flow increase rate (L/s/step)">
                    <Input type="number" min={0} step={0.05} value={config.flow_increase_rate_lps_per_step}
                      onChange={(e) => setConfig((c) => ({ ...c, flow_increase_rate_lps_per_step: +e.target.value }))} />
                  </Field>
                  <Field label="Sustained night flow">
                    <Select value={config.sustained_night_flow ? "on" : "off"}
                      onValueChange={(v) => setConfig((c) => ({ ...c, sustained_night_flow: v === "on" }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="on">On</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Acoustic behavior</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Acoustic spike pattern">
                    <Select value={config.acoustic_spike_pattern}
                      onValueChange={(v) => setConfig((c) => ({ ...c, acoustic_spike_pattern: v as typeof c.acoustic_spike_pattern }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="gradual">Gradual</SelectItem>
                        <SelectItem value="sudden">Sudden</SelectItem>
                        <SelectItem value="intermittent">Intermittent</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Acoustic increase rate (dB)">
                    <Input type="number" min={0} step={0.1} value={config.acoustic_increase_rate_db}
                      onChange={(e) => setConfig((c) => ({ ...c, acoustic_increase_rate_db: +e.target.value }))} />
                  </Field>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tank behavior</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Tank rise rate (%/step)">
                    <Input type="number" min={0} step={0.05} value={config.tank_rise_rate_percent_per_step}
                      onChange={(e) => setConfig((c) => ({ ...c, tank_rise_rate_percent_per_step: +e.target.value }))} />
                  </Field>
                  <Field label="Inflow continues">
                    <Select value={config.inflow_continues ? "on" : "off"}
                      onValueChange={(v) => setConfig((c) => ({ ...c, inflow_continues: v === "on" }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="on">On</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Soil moisture behavior</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Soil moisture increase rate (%)">
                    <Input type="number" min={0} step={0.05} value={config.soil_moisture_increase_rate_percent}
                      onChange={(e) => setConfig((c) => ({ ...c, soil_moisture_increase_rate_percent: +e.target.value }))} />
                  </Field>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Event severity & duration</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Severity">
                    <Select value={config.severity}
                      onValueChange={(v) => setConfig((c) => ({ ...c, severity: v as typeof c.severity }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Disturbance duration (min)">
                    <Input type="number" min={1} value={config.disturbance_duration_minutes}
                      onChange={(e) => setConfig((c) => ({ ...c, disturbance_duration_minutes: +e.target.value }))} />
                  </Field>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button type="button" variant={started ? "outline" : "default"} onClick={handleStart}>
              Start simulation
            </Button>
            <Button type="button" onClick={handleRun} disabled={!started || sim.isPending}>
              {sim.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Running</>
                : <><Play className="h-4 w-4" /> Run simulation</>}
            </Button>
            <Button type="button" variant="outline" onClick={handleReset}>
              Reset simulation
            </Button>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </CardContent>
      </Card>

      <div className="lg:col-span-3 space-y-6">
        <Card>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base">Generated Readings</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {!runResult && !sim.isPending ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Start a simulation, then run it to generate sensor readings.
              </div>
            ) : sim.isPending ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} domain={[0, "dataMax + 20"]} label={{ value: "kPa", angle: -90, position: "insideLeft", fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, "dataMax + 5"]} label={{ value: "L/s", angle: 90, position: "insideRight", fontSize: 11 }} />
                  <Tooltip content={<LeakChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceArea yAxisId="left" y1={simulationRanges.pressureMin} y2={simulationRanges.pressureMax} fill="#22c55e" fillOpacity={0.10} name="Normal pressure range" />
                  <ReferenceArea yAxisId="right" y1={simulationRanges.flowMin} y2={simulationRanges.flowMax} fill="#06b6d4" fillOpacity={0.08} name="Normal flow range" />
                  <ReferenceArea yAxisId="left" x1={chartData[0]?.t} x2={chartData[Math.min(chartData.length - 1, Math.max(0, Math.floor(warmupMinutes / config.sampling_interval_minutes)))]?.t} fill="#94a3b8" fillOpacity={0.08} name="Warm-up area" />
                  {config.ground_truth_event !== "normal" && (
                    <ReferenceLine yAxisId="left" x={chartData[eventIndex]?.t} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.85} label={{ value: "Event start", fontSize: 11, fill: "#b45309" }} />
                  )}
                  {detectionIndex != null && (
                    <ReferenceLine yAxisId="left" x={chartData[detectionIndex]?.t} stroke="#2563eb" strokeDasharray="4 3" strokeOpacity={0.85} label={{ value: "First detection", fontSize: 11, fill: "#1d4ed8" }} />
                  )}
                  <Line yAxisId="left" type="monotone" dataKey="pressure" stroke="#475569" strokeWidth={2.5} dot={false} name="Pressure (kPa)" />
                  <Line yAxisId="right" type="monotone" dataKey="flow" stroke="#0891b2" strokeWidth={2.5} dot={false} name="Flow (L/s)" />
                </LineChart>
              </ResponsiveContainer>
            )}
            {runResult && (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {buildGraphExplanation(baselineComparison, summary?.predicted_label ?? null)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base">
              {summary?.predicted_label === "overflow_risk" || config.ground_truth_event === "overflow"
                ? "Overflow Risk Score Over Time"
                : "Leak Risk Score Over Time"}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {!runResult && !sim.isPending ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Run a simulation to see model risk over time.
              </div>
            ) : sim.isPending ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<RiskScoreTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceArea y1={0} y2={40} fill="#22c55e" fillOpacity={0.10} name="Normal zone: 0-40%" />
                  <ReferenceArea y1={40} y2={70} fill="#f59e0b" fillOpacity={0.12} name="Warning zone: 40-70%" />
                  <ReferenceArea y1={70} y2={100} fill="#ef4444" fillOpacity={0.10} name="High-risk zone: above 70%" />
                  <ReferenceLine y={70} stroke="#dc2626" strokeDasharray="4 3" label={{ value: "Detection threshold", fontSize: 11, fill: "#dc2626" }} />
                  {config.ground_truth_event !== "normal" && (
                    <ReferenceLine x={chartData[eventIndex]?.t} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.85} label={{ value: "Event start", fontSize: 11, fill: "#b45309" }} />
                  )}
                  {detectionIndex != null && (
                    <ReferenceLine x={chartData[detectionIndex]?.t} stroke="#2563eb" strokeDasharray="4 3" strokeOpacity={0.85} label={{ value: "First detection", fontSize: 11, fill: "#1d4ed8" }} />
                  )}
                  <Line type="monotone" dataKey="riskPct" stroke="#7c3aed" strokeWidth={2.5} dot={false} name="Risk score" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base">Latest Result</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-4">
            {!runResult && !sim.isPending ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Run a simulation to see the prediction from the generated sequence.
              </div>
            ) : sim.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ) : (
              <>
                <ResultBanner
                  anomaly={Boolean(summary?.predicted_label) && summary?.predicted_label !== "normal"}
                  title={derivedPrediction.prediction}
                  message={derivedPrediction.explanation}
                >
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Badge variant="outline">Simulation: {runResult!.simulation_id.slice(0, 8)}</Badge>
                    {summary?.predicted_label && (
                      <Badge variant="outline" className="capitalize">{summary.predicted_label.replace(/_/g, " ")}</Badge>
                    )}
                  </div>
                </ResultBanner>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <ReadingTile label="Confidence" value={derivedPrediction.confidence == null ? "—" : `${Math.round(derivedPrediction.confidence * 100)}%`} />
                  <ReadingTile
                    label="Anomaly score"
                    value={summary?.max_anomaly_score == null ? "—" : `${Math.round((summary.max_anomaly_score || 0) * 100)}%`}
                  />
                  <ReadingTile label="Severity" value={derivedPrediction.severity} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <ReadingTile
                    label="First detection time"
                    value={summary?.first_detection_time_minutes == null ? "Not detected" : `${summary.first_detection_time_minutes} min after start`}
                  />
                  <ReadingTile
                    label="Detection latency"
                    value={summary?.detection_latency_minutes == null ? "N/A" : `${Math.max(0, summary.detection_latency_minutes)} min after event start`}
                  />
                  <ReadingTile
                    label="Warm-up status"
                    value={(() => {
                      const wm = summary?.warmup_time_minutes ?? warmupMinutes;
                      const fd = summary?.first_detection_time_minutes;
                      if (fd != null && fd >= wm) return "completed";
                      if (fd != null) return "detection held until warm-up";
                      return `${wm} min required`;
                    })()}
                  />
                </div>

                <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Recommended action:</span>{" "}
                  {derivedPrediction.recommended}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base">3-Hour Baseline Comparison</CardTitle>
            <p className="text-xs text-muted-foreground">
              Compares the latest 3-hour operating window with the previous stable 3-hour baseline.
            </p>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-4">
            {!baselineComparison ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Run a simulation with enough readings to compare two 3-hour windows.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  <ReadingTile label="Pressure change" value={baselineComparison.pressureChange} accent={baselineComparison.pressureTone} />
                  <ReadingTile label="Flow change" value={baselineComparison.flowChange} accent={baselineComparison.flowTone} />
                  <ReadingTile label="Tank level trend" value={baselineComparison.tankTrend} accent={baselineComparison.tankTone} />
                  <ReadingTile label="Acoustic signal" value={baselineComparison.acousticChange} accent={baselineComparison.acousticTone} />
                  <ReadingTile label="Soil moisture" value={baselineComparison.soilChange} accent={baselineComparison.soilTone} />
                  <ReadingTile label="Leak risk" value={baselineComparison.riskChange} accent={baselineComparison.riskTone} />
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                  {baselineComparison.interpretation}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base">Simulation History</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {history.length === 0 ? (
              <div className="mx-5 mb-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No simulations yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground bg-muted/40">
                    <tr>
                      <Th>Simulation</Th>
                      <Th right>Duration</Th>
                      <Th right>Sampling</Th>
                      <Th right>Window</Th>
                      <Th>Pressure (kPa)</Th>
                      <Th>Flow (L/s)</Th>
                      <Th>Severity</Th>
                      <Th>Prediction</Th>
                      <Th right>Max conf.</Th>
                      <Th right>Anomaly</Th>
                      <Th right>Latency</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id} className="border-t hover:bg-muted/30 transition-colors">
                        <Td className="font-mono text-xs">{row.id.slice(0, 8)}</Td>
                        <Td right className="tabular-nums">{row.durationHours} h</Td>
                        <Td right className="tabular-nums">{row.samplingMin} min</Td>
                        <Td right className="tabular-nums">{row.windowReadings}</Td>
                        <Td className="tabular-nums whitespace-nowrap">{row.baselinePressure[0]}–{row.baselinePressure[1]}</Td>
                        <Td className="tabular-nums whitespace-nowrap">{row.baselineFlow[0]}–{row.baselineFlow[1]}</Td>
                        <Td className="capitalize">{row.severity}</Td>
                        <Td className="capitalize">{row.prediction ? row.prediction.replace(/_/g, " ") : "—"}</Td>
                        <Td right className="tabular-nums">{row.confidence == null ? "—" : `${Math.round(row.confidence * 100)}%`}</Td>
                        <Td right className="tabular-nums">{row.anomalyScore == null ? "—" : `${Math.round(row.anomalyScore * 100)}%`}</Td>
                        <Td right className="tabular-nums">{row.latencyMin == null ? "—" : `${row.latencyMin} min`}</Td>
                        <Td>
                          {row.status === "failed"
                            ? <Badge variant="outline" className="border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">Failed</Badge>
                            : <Badge variant="outline" className="border-transparent bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">Completed</Badge>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type LeakSessionChartRow = {
  idx: number;
  t: string;
  timestamp: string;
  pressure: number;
  flow: number;
  acoustic: number;
  soil: number;
  tank: number;
  eventActive: boolean;
  prediction: LeakPredictionLabel | null;
  confidence: number | null;
  anomalyScore: number | null;
  riskPct: number | null;
};

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentChange(previous: number, current: number) {
  if (Math.abs(previous) < 1e-6) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(0)}%`;
}

function riskBand(score: number) {
  if (score >= 0.7) return "High";
  if (score >= 0.4) return "Warning";
  return "Normal";
}

function neutralTone(value: number, threshold: number): "good" | undefined {
  return Math.abs(value) < threshold ? "good" : undefined;
}

function buildThreeHourBaselineComparison(
  rows: LeakSessionChartRow[],
  summary: LeakSimulationRunResult["summary"] | undefined,
  config: {
    sampling_interval_minutes: number;
    event_start_minutes: number;
    ground_truth_event: LeakScenarioType;
    baseline_flow_max_lps: number;
  },
) {
  const windowSize = Math.max(1, Math.round(180 / config.sampling_interval_minutes));
  if (rows.length < windowSize * 2) return null;

  const eventStartIdx = config.ground_truth_event === "normal"
    ? Math.max(windowSize, rows.length - windowSize)
    : Math.max(
      windowSize,
      Math.floor((summary?.event_start_time_minutes ?? config.event_start_minutes) / config.sampling_interval_minutes),
    );
  const currentStartIdx = summary?.first_detection_time_minutes == null
    ? eventStartIdx
    : Math.max(eventStartIdx, Math.floor(summary.first_detection_time_minutes / config.sampling_interval_minutes));
  const currentEndIdx = Math.min(rows.length, currentStartIdx + windowSize);
  const adjustedCurrentStart = Math.max(windowSize, currentEndIdx - windowSize);
  const baselineEndIdx = Math.max(windowSize, eventStartIdx);
  const baselineStartIdx = Math.max(0, baselineEndIdx - windowSize);

  const baselineRows = rows.slice(baselineStartIdx, baselineEndIdx);
  const currentRows = rows.slice(adjustedCurrentStart, currentEndIdx);
  if (baselineRows.length < 2 || currentRows.length < 2) return null;

  const baselinePressure = average(baselineRows.map((r) => r.pressure));
  const currentPressure = average(currentRows.map((r) => r.pressure));
  const pressurePct = percentChange(baselinePressure, currentPressure);

  const baselineFlow = average(baselineRows.map((r) => r.flow));
  const currentFlow = average(currentRows.map((r) => r.flow));
  const flowPct = percentChange(baselineFlow, currentFlow);

  const baselineAcoustic = average(baselineRows.map((r) => r.acoustic));
  const currentAcoustic = average(currentRows.map((r) => r.acoustic));
  const acousticPct = percentChange(baselineAcoustic, currentAcoustic);

  const baselineSoil = average(baselineRows.map((r) => r.soil));
  const currentSoil = average(currentRows.map((r) => r.soil));
  const soilPct = percentChange(baselineSoil, currentSoil);

  const baselineRisk = Math.max(0, ...baselineRows.map((r) => r.anomalyScore ?? 0));
  const currentRisk = Math.max(0, ...currentRows.map((r) => r.anomalyScore ?? 0));

  const baselineTankRate = (baselineRows[baselineRows.length - 1].tank - baselineRows[0].tank) / Math.max(1, baselineRows.length - 1);
  const currentTankRate = (currentRows[currentRows.length - 1].tank - currentRows[0].tank) / Math.max(1, currentRows.length - 1);
  const tankDelta = currentTankRate - baselineTankRate;
  const tankTrend = config.ground_truth_event === "overflow"
    ? tankDelta > 0.05 ? "Increasing faster" : "Stable"
    : tankDelta < -0.05 ? "Faster decrease" : Math.abs(tankDelta) <= 0.05 ? "Stable" : "Increasing";

  const likelyOverflow = summary?.predicted_label === "overflow_risk" || config.ground_truth_event === "overflow";
  const pressureDecreased = pressurePct <= -5;
  const flowIncreased = flowPct >= 10;
  const flowHigh = currentFlow > config.baseline_flow_max_lps * 1.05;
  const tankFallingFaster = tankDelta < -0.05;
  const acousticIncreased = acousticPct >= 10;
  const soilIncreased = soilPct >= 10;
  const riskMovedHigh = currentRisk >= 0.7 && baselineRisk < 0.7;
  const leakEvidence = [
    pressureDecreased,
    flowIncreased,
    flowHigh,
    tankFallingFaster,
    acousticIncreased,
    soilIncreased,
    riskMovedHigh,
  ].filter(Boolean).length;

  const riskRemainedHigh = baselineRisk >= 0.7 && currentRisk >= 0.7;
  const stable = Math.max(Math.abs(pressurePct), Math.abs(flowPct), Math.abs(acousticPct), Math.abs(soilPct)) < 10
    && currentRisk < 0.4;
  const interpretation = likelyOverflow
    ? "The current window shows tank level increasing or remaining too high compared with the previous stable baseline. This supports a possible overflow risk, not a leak label."
    : riskRemainedHigh
      ? "Risk remained high across both windows, suggesting the abnormal condition started before the comparison window or persisted for a long period."
      : leakEvidence >= 2
        ? `The current window supports a possible leak pattern: ${[
          pressureDecreased ? "pressure decreased" : null,
          flowIncreased ? "flow increased" : null,
          flowHigh ? "flow stayed above the normal range" : null,
          tankFallingFaster ? "tank level decreased faster than baseline" : null,
          acousticIncreased ? "acoustic signal increased" : null,
          soilIncreased ? "soil moisture increased" : null,
          riskMovedHigh ? "risk moved into the high zone" : null,
        ].filter(Boolean).join(", ")}. Field verification is still recommended.`
        : stable
          ? "The readings remained within the expected pressure and flow ranges. No leak or overflow risk was detected."
          : "Recent readings show some abnormal behaviour, but the pattern is not strong enough for a confident leak classification. Continued monitoring or field verification is recommended.";

  return {
    pressureChange: formatPercent(pressurePct),
    pressureTone: pressurePct <= -5 ? "warn" as const : neutralTone(pressurePct, 5),
    flowChange: formatPercent(flowPct),
    flowTone: flowPct >= 10 || flowHigh ? "warn" as const : flowPct <= -10 ? "good" as const : neutralTone(flowPct, 10),
    tankTrend,
    tankTone: likelyOverflow ? (tankDelta > 0.05 ? "warn" as const : "good" as const) : (tankFallingFaster ? "warn" as const : "good" as const),
    acousticChange: formatPercent(acousticPct),
    acousticTone: acousticPct >= 10 ? "warn" as const : neutralTone(acousticPct, 10),
    soilChange: formatPercent(soilPct),
    soilTone: soilPct >= 10 ? "warn" as const : neutralTone(soilPct, 10),
    riskChange: `${riskBand(baselineRisk)} → ${riskBand(currentRisk)}`,
    riskTone: currentRisk >= 0.4 ? "warn" as const : "good" as const,
    interpretation,
  };
}

function buildGraphExplanation(
  comparison: ReturnType<typeof buildThreeHourBaselineComparison>,
  prediction: LeakPredictionLabel | null,
) {
  if (!comparison) return "The chart will explain the decision once enough readings are available for the baseline and current windows.";
  if (prediction === "normal") {
    return "The readings remained within the expected pressure and flow ranges. No leak or overflow risk was detected.";
  }
  if (prediction === "overflow_risk") {
    return "The model raised a possible overflow risk because tank level behaviour became abnormal while the hydraulic readings moved away from the previous stable baseline.";
  }
  if (prediction === "possible_leak" || prediction === "possible_burst") {
    return "The model raised a possible leak risk because the current window shows abnormal hydraulic behaviour compared with the previous stable baseline. The decision is mainly supported when pressure loss, abnormal flow, acoustic, soil moisture, or risk-score movement align.";
  }
  return "The comparison does not show a clear leak pattern. Some readings changed, but they do not strongly match the expected pressure-loss and flow-increase behaviour of a leak.";
}

function SimulationTab() {
  const sim = useLeakSequenceSimulation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [config, setConfig] = useState({
    duration_hours: 48,
    data_frequency_minutes: 15,
    scenario_type: "small_leak" as LeakScenarioType,
    sensor_uncertainty: 0.2,
    detection_sensitivity_window: 21,

    baseline_pressure_min_kpa: 270,
    baseline_pressure_max_kpa: 480,
    baseline_flow_min_lps: 5,
    baseline_flow_max_lps: 20,
    pipe_diameter_mm: 150 as 100 | 150 | 200,
    zone_type: "residential" as const,
    connected_properties_count: 50,
    pipe_zone: "",

    event_start_time_minutes: 180,
    event_duration_minutes: 240,
    event_severity: "medium" as const,

    pressure_drop_rate_kpa_per_step: 0.8,
    flow_increase_rate_lps_per_step: 0.2,
    acoustic_baseline_db: 38.0,
    acoustic_event_increase_db: 10.0,
    soil_moisture_baseline_percent: 28.0,
    soil_moisture_increase_rate_percent_per_step: 0.3,

    valve_status: "unknown" as const,
    tank_level_initial_percent: 60.0,
    tank_inflow_lps: 1.5,
    tank_outflow_lps: 1.2,
    overflow_threshold_percent: 95.0,

    enable_time_of_day_pattern: true,
    morning_peak_multiplier: 1.35,
    evening_peak_multiplier: 1.45,
    night_low_flow_multiplier: 0.65,

    random_seed: "" as string,
    expected_label_output: "" as string,
  });
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setError(null);
    try {
      await sim.mutateAsync({
        ...config,
        pipe_zone: config.pipe_zone || undefined,
        random_seed: config.random_seed.trim() === "" ? undefined : +config.random_seed,
        expected_label_output: config.expected_label_output.trim() === "" ? undefined : (config.expected_label_output as any),
      } as any);
    }
    catch (err) { setError(extractApiError(err, "Simulation failed.")); }
  }

  const result = sim.data as LeakSimulationRunResult | undefined;

  const warmupTimeMinutes = config.detection_sensitivity_window * config.data_frequency_minutes;
  const warmupTimeHours = warmupTimeMinutes / 60;
  const totalMinutes = config.duration_hours * 60;
  const warmupWarning = config.event_start_time_minutes < warmupTimeMinutes && config.scenario_type !== "normal";

  const chartData = useMemo(() => {
    if (!result) return [];
    const detByTs = new Map(result.detection_results.map((d) => [d.timestamp, d] as const));
    return result.generated_readings.map((r) => {
      const det = detByTs.get(r.timestamp);
      return {
        t: format(parseISO(r.timestamp), "MMM d HH:mm"),
        timestamp: r.timestamp,
        pressure: r.pressure_kpa,
        flow: r.flow_lps,
        tank: r.tank_level_percent,
        acoustic: r.acoustic_db,
        soil: r.soil_moisture_percent,
        truth: r.ground_truth_label,
        eventActive: r.event_active,
        prediction: det?.prediction ?? null,
        status: det?.status ?? "collecting_sequence",
        confidence: det?.confidence ?? null,
      };
    });
  }, [result]);

  const eventMarker = result?.summary.event_start_time_minutes != null
    ? format(parseISO(result.generated_readings[Math.min(
        Math.floor(result.summary.event_start_time_minutes / config.data_frequency_minutes),
        Math.max(0, result.generated_readings.length - 1)
      )]?.timestamp ?? result.generated_readings[0]?.timestamp), "MMM d HH:mm")
    : null;

  const detectionMarker = result?.summary.first_detection_time_minutes == null
    ? null
    : format(parseISO(result.generated_readings[Math.min(
        Math.floor(result.summary.first_detection_time_minutes / config.data_frequency_minutes),
        Math.max(0, result.generated_readings.length - 1)
      )]?.timestamp ?? result.generated_readings[0]?.timestamp), "MMM d HH:mm");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-base">Simulation Config</CardTitle>
          <p className="text-xs text-muted-foreground">
            Realistic suburban sequence simulation. Predictions remain in collecting_sequence until the window fills.
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={`Duration (h): ${config.duration_hours}`}>
              <input
                type="range" min={1} max={168} step={1}
                value={config.duration_hours}
                onChange={(e) => setConfig((c) => ({ ...c, duration_hours: +e.target.value }))}
                className="w-full accent-primary"
              />
            </Field>
            <Field label="Sampling (min)">
              <Select
                value={String(config.data_frequency_minutes)}
                onValueChange={(v) => setConfig((c) => ({ ...c, data_frequency_minutes: +v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 5, 15, 30, 60].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Scenario">
              <Select
                value={config.scenario_type}
                onValueChange={(v) => setConfig((c) => ({ ...c, scenario_type: v as LeakScenarioType }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal operation</SelectItem>
                  <SelectItem value="small_leak">Small leak</SelectItem>
                  <SelectItem value="medium_leak">Medium leak</SelectItem>
                  <SelectItem value="burst_pipe">Burst pipe</SelectItem>
                  <SelectItem value="overflow">Overflow</SelectItem>
                  <SelectItem value="sensor_fault">Sensor fault</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Valve status">
              <Select value={config.valve_status} onValueChange={(v) => setConfig((c) => ({ ...c, valve_status: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="partially_open">Partially open</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="failed_open">Failed open</SelectItem>
                  <SelectItem value="failed_closed">Failed closed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Sensor uncertainty: ${config.sensor_uncertainty.toFixed(2)}`}>
              <input
                type="range" min={0} max={1} step={0.05}
                value={config.sensor_uncertainty}
                onChange={(e) => setConfig((c) => ({ ...c, sensor_uncertainty: +e.target.value }))}
                className="w-full accent-primary"
              />
            </Field>
            <Field label={`Detection window: ${config.detection_sensitivity_window} readings`}>
              <input
                type="range" min={2} max={48} step={1}
                value={config.detection_sensitivity_window}
                onChange={(e) => setConfig((c) => ({ ...c, detection_sensitivity_window: +e.target.value }))}
                className="w-full accent-primary"
              />
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="p-2 rounded bg-muted/40">
              <p className="text-muted-foreground">Window</p>
              <p className="font-mono font-semibold">{config.detection_sensitivity_window} readings</p>
            </div>
            <div className="p-2 rounded bg-muted/40">
              <p className="text-muted-foreground">Sampling</p>
              <p className="font-mono font-semibold">every {config.data_frequency_minutes} min</p>
            </div>
            <div className="p-2 rounded bg-muted/40">
              <p className="text-muted-foreground">Warm-up</p>
              <p className={cn("font-mono font-semibold", warmupWarning && "text-amber-700 dark:text-amber-300")}>
                {warmupTimeMinutes} min / {warmupTimeHours.toFixed(2)} h
              </p>
            </div>
            <div className={cn("p-2 rounded", warmupWarning ? "bg-amber-50/70 dark:bg-amber-500/10" : "bg-muted/40")}>
              <p className="text-muted-foreground">Event starts</p>
              <p className={cn("font-mono font-semibold", warmupWarning && "text-amber-700 dark:text-amber-300")}>
                {config.scenario_type === "normal" ? "—" : `${config.event_start_time_minutes} min`}
              </p>
            </div>
          </div>

          {warmupWarning && (
            <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-200">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              Event starts before warm-up completes. Detection will be collecting during event onset.
            </div>
          )}

          <div className="mt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? "Hide" : "Show"} advanced: baseline, event & hydraulics
            </button>
          </div>

          {showAdvanced && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Baseline pressure min (kPa)">
                <Input type="number" min={0} value={config.baseline_pressure_min_kpa} onChange={(e) => setConfig((c) => ({ ...c, baseline_pressure_min_kpa: +e.target.value }))} />
              </Field>
              <Field label="Baseline pressure max (kPa)">
                <Input type="number" min={0} value={config.baseline_pressure_max_kpa} onChange={(e) => setConfig((c) => ({ ...c, baseline_pressure_max_kpa: +e.target.value }))} />
              </Field>
              <Field label="Connected properties">
                <Input type="number" min={1} value={config.connected_properties_count} onChange={(e) => setConfig((c) => ({ ...c, connected_properties_count: +e.target.value }))} />
              </Field>

              <Field label="Baseline flow min (L/s)">
                <Input type="number" min={0} value={config.baseline_flow_min_lps} onChange={(e) => setConfig((c) => ({ ...c, baseline_flow_min_lps: +e.target.value }))} />
              </Field>
              <Field label="Baseline flow max (L/s)">
                <Input type="number" min={0} value={config.baseline_flow_max_lps} onChange={(e) => setConfig((c) => ({ ...c, baseline_flow_max_lps: +e.target.value }))} />
              </Field>
              <Field label="Pipe diameter (mm)">
                <Select value={String(config.pipe_diameter_mm)} onValueChange={(v) => setConfig((c) => ({ ...c, pipe_diameter_mm: +v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="150">150</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Zone type">
                <Select value={config.zone_type} onValueChange={(v) => setConfig((c) => ({ ...c, zone_type: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Pipe zone" optional>
                <Input value={config.pipe_zone} onChange={(e) => setConfig((c) => ({ ...c, pipe_zone: e.target.value }))} placeholder="e.g. north_residential" />
              </Field>

              <Field label="Event start (min)">
                <Input type="number" min={0} max={totalMinutes} value={config.event_start_time_minutes} onChange={(e) => setConfig((c) => ({ ...c, event_start_time_minutes: +e.target.value }))} />
              </Field>
              <Field label="Event duration (min)">
                <Input type="number" min={1} value={config.event_duration_minutes} onChange={(e) => setConfig((c) => ({ ...c, event_duration_minutes: +e.target.value }))} />
              </Field>
              <Field label="Event severity">
                <Select value={config.event_severity} onValueChange={(v) => setConfig((c) => ({ ...c, event_severity: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Pressure drop rate (kPa/step)">
                <Input type="number" min={0} step={0.1} value={config.pressure_drop_rate_kpa_per_step} onChange={(e) => setConfig((c) => ({ ...c, pressure_drop_rate_kpa_per_step: +e.target.value }))} />
              </Field>
              <Field label="Flow increase rate (L/s/step)">
                <Input type="number" min={0} step={0.1} value={config.flow_increase_rate_lps_per_step} onChange={(e) => setConfig((c) => ({ ...c, flow_increase_rate_lps_per_step: +e.target.value }))} />
              </Field>
              <Field label="Acoustic baseline (dB)">
                <Input type="number" min={0} step={0.1} value={config.acoustic_baseline_db} onChange={(e) => setConfig((c) => ({ ...c, acoustic_baseline_db: +e.target.value }))} />
              </Field>
              <Field label="Acoustic event increase (dB)">
                <Input type="number" min={0} step={0.1} value={config.acoustic_event_increase_db} onChange={(e) => setConfig((c) => ({ ...c, acoustic_event_increase_db: +e.target.value }))} />
              </Field>
              <Field label="Soil moisture baseline (%)">
                <Input type="number" min={0} max={100} step={0.1} value={config.soil_moisture_baseline_percent} onChange={(e) => setConfig((c) => ({ ...c, soil_moisture_baseline_percent: +e.target.value }))} />
              </Field>
              <Field label="Soil moisture increase (%/step)">
                <Input type="number" min={0} step={0.1} value={config.soil_moisture_increase_rate_percent_per_step} onChange={(e) => setConfig((c) => ({ ...c, soil_moisture_increase_rate_percent_per_step: +e.target.value }))} />
              </Field>
              <Field label="Tank level initial (%)">
                <Input type="number" min={0} max={100} step={0.1} value={config.tank_level_initial_percent} onChange={(e) => setConfig((c) => ({ ...c, tank_level_initial_percent: +e.target.value }))} />
              </Field>
              <Field label="Tank inflow (L/s)">
                <Input type="number" min={0} step={0.1} value={config.tank_inflow_lps} onChange={(e) => setConfig((c) => ({ ...c, tank_inflow_lps: +e.target.value }))} />
              </Field>
              <Field label="Tank outflow (L/s)">
                <Input type="number" min={0} step={0.1} value={config.tank_outflow_lps} onChange={(e) => setConfig((c) => ({ ...c, tank_outflow_lps: +e.target.value }))} />
              </Field>
              <Field label="Overflow threshold (%)">
                <Input type="number" min={0} max={100} step={0.1} value={config.overflow_threshold_percent} onChange={(e) => setConfig((c) => ({ ...c, overflow_threshold_percent: +e.target.value }))} />
              </Field>

              <Field label="Time-of-day pattern">
                <Select
                  value={config.enable_time_of_day_pattern ? "on" : "off"}
                  onValueChange={(v) => setConfig((c) => ({ ...c, enable_time_of_day_pattern: v === "on" }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">Enabled</SelectItem>
                    <SelectItem value="off">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Morning peak multiplier">
                <Input type="number" min={0} step={0.05} value={config.morning_peak_multiplier} onChange={(e) => setConfig((c) => ({ ...c, morning_peak_multiplier: +e.target.value }))} />
              </Field>
              <Field label="Evening peak multiplier">
                <Input type="number" min={0} step={0.05} value={config.evening_peak_multiplier} onChange={(e) => setConfig((c) => ({ ...c, evening_peak_multiplier: +e.target.value }))} />
              </Field>
              <Field label="Night low-flow multiplier">
                <Input type="number" min={0} step={0.05} value={config.night_low_flow_multiplier} onChange={(e) => setConfig((c) => ({ ...c, night_low_flow_multiplier: +e.target.value }))} />
              </Field>

              <Field label="Random seed" optional>
                <Input type="number" min={0} value={config.random_seed} onChange={(e) => setConfig((c) => ({ ...c, random_seed: e.target.value }))} placeholder="Leave empty" />
              </Field>
              <Field label="Expected label output" optional>
                <Select value={config.expected_label_output || ""} onValueChange={(v) => setConfig((c) => ({ ...c, expected_label_output: v }))}>
                  <SelectTrigger><SelectValue placeholder="Leave empty" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Leave empty</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="small_leak">Small leak</SelectItem>
                    <SelectItem value="medium_leak">Medium leak</SelectItem>
                    <SelectItem value="burst_pipe">Burst pipe</SelectItem>
                    <SelectItem value="overflow">Overflow</SelectItem>
                    <SelectItem value="sensor_fault">Sensor fault</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <Button onClick={handleRun} disabled={sim.isPending}>
              {sim.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Running...</>
                : <><Play className="h-4 w-4" /> Run simulation</>}
            </Button>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </CardContent>
      </Card>

      {sim.isPending && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
            <Skeleton className="h-72 w-full" />
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Simulation Summary</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatPill label="Scenario" value={result.summary.scenario_type.replace(/_/g, " ")} />
                <StatPill label="Total" value={String(result.summary.total_readings)} />
                <StatPill label="Warm-up" value={`${result.summary.warmup_time_minutes} min`} accent={warmupWarning ? "warn" : "neutral"} />
                <StatPill label="Event start" value={config.scenario_type === "normal" ? "—" : `${result.summary.event_start_time_minutes} min`} />
                <StatPill label="First detection" value={result.summary.first_detection_time_minutes == null ? "—" : `${result.summary.first_detection_time_minutes} min`} accent={result.summary.first_detection_time_minutes == null ? "neutral" : "warn"} />
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatPill label="Latency" value={result.summary.detection_latency_minutes == null ? "—" : `${result.summary.detection_latency_minutes} min`} />
                <StatPill label="Expected" value={(result.summary.expected_label_output ?? "—").replace(/_/g, " ")} />
                <StatPill label="Predicted" value={(result.summary.predicted_label ?? "—").replace(/_/g, " ")} accent={result.summary.predicted_label && result.summary.predicted_label !== "normal" ? "warn" : "neutral"} />
                <StatPill label="Max conf." value={`${Math.round(result.summary.max_confidence * 100)}%`} />
                <StatPill label="FP / FN" value={`${result.summary.false_positive_count} / ${result.summary.false_negative_count}`} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Pressure & Flow</CardTitle>
              <p className="text-xs text-muted-foreground">Markers show event start and first detection when available.</p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11, padding: 8, borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {eventMarker && (
                    <ReferenceLine yAxisId="left" x={eventMarker} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.9} />
                  )}
                  {detectionMarker && (
                    <ReferenceLine yAxisId="left" x={detectionMarker} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.9} />
                  )}
                  <Line yAxisId="left" type="monotone" dataKey="pressure" stroke="#3b82f6" strokeWidth={2} dot={false} name="Pressure (kPa)" />
                  <Line yAxisId="right" type="monotone" dataKey="flow" stroke="#10b981" strokeWidth={2} dot={false} name="Flow (L/s)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Tank, Acoustic &amp; Soil</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11, padding: 8, borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {eventMarker && (
                    <ReferenceLine yAxisId="left" x={eventMarker} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.9} />
                  )}
                  {detectionMarker && (
                    <ReferenceLine yAxisId="left" x={detectionMarker} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.9} />
                  )}
                  <Line yAxisId="left" type="monotone" dataKey="tank" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Tank level (%)" />
                  <Line yAxisId="right" type="monotone" dataKey="acoustic" stroke="#f97316" strokeWidth={2} dot={false} name="Acoustic (dB)" />
                  <Line yAxisId="left" type="monotone" dataKey="soil" stroke="#06b6d4" strokeWidth={2} dot={false} name="Soil moisture (%)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

        </>
      )}
    </div>
  );
}

function ModelStatusTab() {
  const { data, isLoading, error, refetch } = useLeakModelStatus();
  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">LSTM Model Status</CardTitle>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {isLoading && (
          <>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {extractApiError(error, "Failed to load model status.")}
          </p>
        )}
        {data && (
          <>
            <div className="flex items-center gap-3">
              <div className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5",
                data.model_loaded
                  ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                  : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
              )}>
                {data.model_loaded ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {data.model_loaded ? "Model Loaded" : "Not Loaded"}
              </div>
              <Badge variant="outline" className="font-mono">{data.model_version}</Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KV label="Window Size" value={data.window_size} icon={Cpu} />
              <KV label="Training Samples" value={data.training_samples.toLocaleString()} icon={Database} />
              <KV
                label="Validation Precision"
                value={`${(data.validation_precision * 100).toFixed(1)}%`}
                icon={Activity}
              />
              <KV
                label="Last Retrained"
                value={data.last_retrained
                  ? format(parseISO(data.last_retrained), "MMM d, yyyy HH:mm")
                  : "Never"}
                icon={Activity}
              />
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Features
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.features.map((f) => (
                  <Badge key={f} variant="secondary" className="font-mono text-[11px]">
                    {f}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DecisionSupportLeakSimulationTab() {
  const sim = useLeakSimulation();
  const [config, setConfig] = useState({
    duration_hours: 48,
    interval_minutes: 5,
    scenario: "slow_leak" as LeakScenario,
    noise_level: 0.1,
    lstm_window_size: 12,
  });
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setError(null);
    try {
      await sim.mutateAsync(config);
    } catch (err) {
      setError(extractApiError(err, "Simulation failed."));
    }
  }

  const result = sim.data;
  const chartData = useMemo(() => {
    if (!result) return [];
    return result.readings.map((r) => ({
      timeLabel: format(parseISO(r.timestamp), "MMM d HH:mm"),
      pressure: r.pressure_kpa,
      flow: r.flow_rate_lps,
      anomaly: r.anomaly_detected,
      truth: r.is_ground_truth_anomaly,
      confidence: r.confidence_score,
    }));
  }, [result]);

  const timelineEvents = useMemo(() => buildLeakTimeline(result), [result]);
  const interpretation = useMemo(() => {
    if (!result) return null;
    return buildLeakInterpretation(result, config, timelineEvents);
  }, [result, config, timelineEvents]);
  const leakWindow = useMemo(() => {
    const marked = chartData.filter((r) => r.anomaly || r.truth);
    if (marked.length < 2) return null;
    return { start: marked[0].timeLabel, end: marked[marked.length - 1].timeLabel };
  }, [chartData]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-base">Scenario Setup</CardTitle>
          <p className="text-xs text-muted-foreground">
            Configure a readable leak or overflow situation for the simulator.
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
            <Field label="Data frequency" description="How often the sensors send pressure and flow data.">
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
            <Field label="Situation">
              <Select
                value={config.scenario}
                onValueChange={(v) => setConfig((c) => ({ ...c, scenario: v as LeakScenario }))}
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
              description="Simulates how noisy or unreliable sensor data is."
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
            <Field
              label={`Detection sensitivity window: ${config.lstm_window_size}`}
              description="How much past data the system uses to detect patterns."
            >
              <input
                type="range"
                min={4}
                max={48}
                step={1}
                value={config.lstm_window_size}
                onChange={(e) => setConfig((c) => ({ ...c, lstm_window_size: +e.target.value }))}
                className="w-full accent-primary"
              />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={handleRun} disabled={sim.isPending}>
              {sim.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Running...</>
                : <><Play className="h-4 w-4" /> Run simulation</>}
            </Button>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </CardContent>
      </Card>

      {sim.isPending && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
            <Skeleton className="h-72 w-full" />
          </CardContent>
        </Card>
      )}

      {result && interpretation && (
        <>
          <Card className={cn("overflow-hidden", LEAK_STATUS_COPY[interpretation.status].cardClass)}>
            <CardContent className="p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    System Status
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={LEAK_STATUS_COPY[interpretation.status].badgeClass}>
                      Status: {LEAK_STATUS_COPY[interpretation.status].label}
                    </Badge>
                    <Badge variant="outline" className={LEAK_STATUS_COPY[interpretation.status].badgeClass}>
                      {LEAK_STATUS_COPY[interpretation.status].badge}
                    </Badge>
                  </div>
                  <div className="flex gap-3">
                    <div className="mt-1 rounded-full bg-background/70 p-2">
                      {(() => {
                        const Icon = LEAK_STATUS_COPY[interpretation.status].icon;
                        return <Icon className="h-5 w-5" />;
                      })()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold tracking-tight">
                        {LEAK_STATUS_COPY[interpretation.status].label}: {interpretation.headline}
                      </h2>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                        {interpretation.message}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:min-w-[460px] gap-3">
                  <ReadingTile label="Detected events" value={String(result.anomalies_detected)} />
                  <ReadingTile label="Detection confidence" value={interpretation.confidenceLabel} />
                  <ReadingTile label="Detection speed" value={formatLatency(result.summary.avg_detection_latency_min)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Card className="xl:col-span-2">
              <CardHeader className="pb-3 pt-5 px-5">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> What&apos;s happening?
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  {interpretation.explanation}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <ReadingTile label="Situation" value={describeLeakScenario(config.scenario)} />
                  <ReadingTile label="Key signal" value={interpretation.keySignal} />
                  <ReadingTile label="Time window" value={interpretation.windowLabel} />
                  <ReadingTile label="Interpretation" value={interpretation.shortCause} />
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
                <LeakActionList status={interpretation.status} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Detection Summary</CardTitle>
              <p className="text-xs text-muted-foreground">
                A short story of the run before the detailed chart.
              </p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <FriendlyMetric label={`${result.anomalies_detected} unusual readings detected`} value={result.anomalies_detected} helper="Frequent unusual readings indicate unstable pressure conditions, often linked to leaks or flow imbalance." accent={result.anomalies_detected > 0 ? "warn" : "good"} />
                <FriendlyMetric label="Leak pattern timing" value={interpretation.earlyLabel} helper="Shows whether the system noticed the leak pattern quickly." />
                <FriendlyMetric label="Average detection time" value={formatLatency(result.summary.avg_detection_latency_min)} helper="Detection speed indicates how quickly the system identifies a leak after it begins." accent={result.summary.meets_latency_target ? "good" : "bad"} />
                <FriendlyMetric label="Confidence" value={interpretation.confidenceLabel} helper="Based on the strongest detection confidence in this simulation." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-base">Detection Performance</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Metrics translated into operational language.
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "border-transparent",
                    interpretation.targetsMet
                      ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                      : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                  )}
                >
                  {interpretation.targetsMet ? "Meets operational targets" : "Below operational target"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                <FriendlyMetric label="Alert accuracy" value={`${(result.summary.precision * 100).toFixed(1)}%`} helper="How often the system is correct when it raises a leak alert." status={result.summary.meets_precision_target ? "Meets target" : "Below target"} accent={result.summary.meets_precision_target ? "good" : "bad"} />
                <FriendlyMetric label="Issue detection rate" value={`${(result.summary.recall * 100).toFixed(1)}%`} helper="How often real leak events are detected." />
                <FriendlyMetric label="Overall detection score" value={result.summary.f1_score.toFixed(2)} helper="Balanced score across alert accuracy and issue detection." />
                <FriendlyMetric label="Detection speed" value={formatLatency(result.summary.avg_detection_latency_min)} helper="Average time to identify the issue after it begins." status={result.summary.meets_latency_target ? "Meets target" : "Below target"} accent={result.summary.meets_latency_target ? "good" : "bad"} />
                <FriendlyMetric label="Slowest detection time" value={formatLatency(result.summary.max_detection_latency_min)} helper="The longest delay seen in this run." />
              </div>
              <p className={cn(
                "rounded-lg border px-4 py-3 text-xs leading-5",
                interpretation.targetsMet
                  ? "border-green-200 bg-green-50 text-green-800 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-300"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300"
              )}>
                {interpretation.targetsMet
                  ? "System performance meets operational targets for leak detection."
                  : "Detection performance is below target. Results should be verified before taking action."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">System Behavior Over Time</CardTitle>
              <p className="text-xs text-muted-foreground">
                Pressure drops and flow changes can indicate leaks.
              </p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="timeLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip content={<LeakChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {leakWindow && (
                    <ReferenceArea yAxisId="left" x1={leakWindow.start} x2={leakWindow.end} fill="#ef4444" fillOpacity={0.08} strokeOpacity={0} />
                  )}
                  <Line yAxisId="left" type="monotone" dataKey="pressure" stroke="#2563eb" strokeWidth={2} dot={false} name="Pressure (kPa)" />
                  <Line yAxisId="right" type="monotone" dataKey="flow" stroke="#16a34a" strokeWidth={2} dot={false} name="Flow (L/s)" />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="pressure"
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
              <p className="mt-3 text-xs text-muted-foreground">
                Shaded area shows the likely leak development period when unusual readings are present.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-base">Leak Detection Timeline</CardTitle>
              <p className="text-xs text-muted-foreground">
                When each leak event was detected and how quickly.
              </p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {timelineEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No leak events in this run.
                </p>
              ) : (
                <div className="space-y-3">
                  {timelineEvents.map((e, i) => {
                    const total = result.readings.length;
                    const startPct = (e.startIdx / total) * 100;
                    const endPct = ((e.detectIdx ?? total - 1) / total) * 100;
                    const detected = e.detectIdx !== null;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">Leak event #{i + 1}</span>
                          <span className={cn(
                            "tabular-nums",
                            !detected ? "text-red-600 dark:text-red-400"
                            : e.latencyMin! < 60 ? "text-green-600 dark:text-green-400"
                            : "text-amber-600 dark:text-amber-400"
                          )}>
                            {detected ? formatTimelineLatency(e.latencyMin!) : "Not detected in this run"}
                          </span>
                        </div>
                        <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "absolute top-0 h-full rounded-full",
                              !detected ? "bg-red-300 dark:bg-red-500/30"
                              : e.latencyMin! < 60 ? "bg-green-400 dark:bg-green-500/40"
                              : "bg-amber-400 dark:bg-amber-500/40"
                            )}
                            style={{ left: `${startPct}%`, width: `${Math.max(endPct - startPct, 0.5)}%` }}
                          />
                          {detected && (
                            <span className="absolute top-0 h-full w-0.5 bg-foreground" style={{ left: `${endPct}%` }} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <AdvancedLeakMetrics result={result} config={config} />
        </>
      )}
    </div>
  );
}

export default function LeakDetectionPage() {
  return (
    <div className="p-6 space-y-6 min-h-full">
      <Breadcrumb
        items={[
          { label: "Sensors", href: "/sensors" },
          { label: "Leak & Overflow" },
        ]}
      />
      <div className="flex items-start gap-4">
        <div className="rounded-2xl p-3 bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Leak &amp; Overflow Detection
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Get early warnings for leaks and overflows from live sensor readings.
          </p>
        </div>
      </div>

      <Tabs defaultValue="simulation">
        <TabsList>
          <TabsTrigger value="simulation">Simulation</TabsTrigger>
          <TabsTrigger value="model">Model Status</TabsTrigger>
        </TabsList>
        <TabsContent value="simulation"><SimulationSessionTab /></TabsContent>
        <TabsContent value="model"><ModelStatusTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function buildLeakTimeline(result: LeakSimulationResult | undefined) {
  if (!result) return [];
  const events: { startIdx: number; detectIdx: number | null; latencyMin: number | null }[] = [];
  let pendingStart: number | null = null;
  result.readings.forEach((r, i) => {
    if (r.is_ground_truth_anomaly && pendingStart === null) pendingStart = i;
    if (pendingStart !== null && r.anomaly_detected) {
      const latency = (
        new Date(r.timestamp).getTime() -
        new Date(result.readings[pendingStart].timestamp).getTime()
      ) / 60000;
      events.push({ startIdx: pendingStart, detectIdx: i, latencyMin: latency });
      pendingStart = null;
    }
  });
  if (pendingStart !== null) {
    events.push({ startIdx: pendingStart, detectIdx: null, latencyMin: null });
  }
  return events;
}

function buildLeakInterpretation(
  result: LeakSimulationResult,
  config: {
    scenario: LeakScenario;
    noise_level: number;
    lstm_window_size: number;
  },
  timelineEvents: { startIdx: number; detectIdx: number | null; latencyMin: number | null }[]
) {
  const readings = result.readings;
  const first = readings[0];
  const last = readings[readings.length - 1] ?? first;
  const pressureDelta = (last?.pressure_kpa ?? 0) - (first?.pressure_kpa ?? 0);
  const flowDelta = (last?.flow_rate_lps ?? 0) - (first?.flow_rate_lps ?? 0);
  const maxConfidence = Math.max(0, ...readings.map((r) => r.confidence_score ?? 0));
  const anomalyRatio = result.total_readings ? result.anomalies_detected / result.total_readings : 0;

  let status: LeakStatus = "normal";
  if (
    result.anomalies_detected > 0 &&
    (config.scenario === "burst_pipe" || anomalyRatio >= 0.25 || result.summary.max_detection_latency_min >= 60)
  ) {
    status = "critical";
  } else if (result.anomalies_detected > 0 || config.scenario === "slow_leak" || config.scenario === "intermittent_leak") {
    status = "suspected";
  } else if (config.noise_level >= 0.35 || Math.abs(pressureDelta) >= 25 || Math.abs(flowDelta) >= 1) {
    status = "monitor";
  }

  const confidenceLabel = maxConfidence >= 0.75 ? "High" : maxConfidence >= 0.45 ? "Medium" : "Low";
  const keySignal =
    pressureDelta <= -20 && flowDelta >= 0.5 ? "Pressure down, flow up"
    : pressureDelta <= -20 ? "Pressure dropping"
    : flowDelta >= 0.5 ? "Flow increasing"
    : "Mostly stable";
  const shortCause =
    config.scenario === "burst_pipe" ? "Possible burst"
    : config.scenario === "overflow" ? "Overflow risk"
    : keySignal === "Pressure down, flow up" ? "Developing leak"
    : keySignal === "Pressure dropping" ? "Pressure loss"
    : "No clear leak pattern";
  const windowLabel = getConcernWindowLabel(result, timelineEvents);
  const earlyLabel =
    result.summary.avg_detection_latency_min <= 1 ? "Leak pattern detected early"
    : result.summary.avg_detection_latency_min < 60 ? `Detected within ${Math.round(result.summary.avg_detection_latency_min)} minutes`
    : "Detection slower than target";

  const headline =
    status === "normal" ? "No active leak pattern detected"
    : status === "monitor" ? "Pressure and flow should be watched"
    : status === "suspected" ? "Leak pattern detected"
    : "Severe leak pattern detected";

  const signalSentence = describeLeakSignals(pressureDelta, flowDelta);
  const message =
    status === "normal"
      ? "Pressure and flow stayed within expected behavior. Continue monitoring."
      : `${signalSentence} ${result.anomalies_detected} unusual readings detected. Detection confidence is ${confidenceLabel.toLowerCase()}.`;

  const explanation = `Over the simulated period, ${signalSentence.toLowerCase()} The selected situation was ${describeLeakScenario(config.scenario).toLowerCase()}, and the main window of concern was ${windowLabel.toLowerCase()}. ${
    status === "normal"
      ? "This does not suggest an active leak right now."
      : "This pattern is commonly associated with a leak, burst, overflow risk, or flow imbalance and should be checked operationally."
  }`;

  return {
    status,
    headline,
    message,
    explanation,
    confidenceLabel,
    keySignal,
    shortCause,
    windowLabel,
    earlyLabel,
    targetsMet: result.summary.meets_latency_target && result.summary.meets_precision_target,
  };
}

function describeLeakSignals(pressureDelta: number, flowDelta: number) {
  const parts = [];
  if (pressureDelta <= -20) parts.push("pressure has steadily decreased");
  if (pressureDelta >= 20) parts.push("pressure has increased");
  if (flowDelta >= 0.5) parts.push("flow has increased");
  if (flowDelta <= -0.5) parts.push("flow has decreased");
  if (parts.length === 0) return "Pressure and flow stayed mostly stable.";
  return `${parts.join(" while ")}.`;
}

function getConcernWindowLabel(
  result: LeakSimulationResult,
  timelineEvents: { startIdx: number; detectIdx: number | null; latencyMin: number | null }[]
) {
  const firstEvent = timelineEvents[0];
  if (!firstEvent) return "No leak window";
  const start = result.readings[firstEvent.startIdx];
  const end = result.readings[firstEvent.detectIdx ?? Math.min(result.readings.length - 1, firstEvent.startIdx + 1)];
  return `${format(parseISO(start.timestamp), "HH:mm")} to ${format(parseISO(end.timestamp), "HH:mm")}`;
}

function describeLeakScenario(scenario: LeakScenario) {
  return SCENARIOS.find((s) => s.value === scenario)?.label ?? scenario.replace(/_/g, " ");
}

function formatLatency(minutes: number) {
  if (minutes <= 0.5) return "Detected immediately";
  return `Detected within ${minutes.toFixed(1)} minutes`;
}

function formatTimelineLatency(minutes: number) {
  if (minutes <= 0.5) return "Detected immediately after onset";
  return `Detected within ${minutes.toFixed(1)} minutes after onset`;
}

function LeakActionList({ status }: { status: LeakStatus }) {
  const actions: Record<LeakStatus, string[]> = {
    normal: ["No action needed", "Continue monitoring"],
    monitor: ["Check recent pressure and flow trends", "Watch for further drops in pressure"],
    suspected: [
      "Inspect pipeline section for leaks",
      "Verify pressure sensor readings",
      "Dispatch maintenance crew if pattern continues",
    ],
    critical: [
      "Trigger immediate alert",
      "Dispatch emergency repair team",
      "Isolate affected pipeline if possible",
      "Notify operations control",
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
  status,
  accent = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  helper: string;
  status?: string;
  accent?: "good" | "warn" | "bad" | "neutral";
}) {
  const tone = {
    good: "border-green-200 bg-green-50/60 dark:border-green-500/30 dark:bg-green-500/10",
    warn: "border-orange-200 bg-orange-50/60 dark:border-orange-500/30 dark:bg-orange-500/10",
    bad: "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10",
    neutral: "border-border bg-card",
  }[accent];
  return (
    <div className={cn("rounded-lg border p-4", tone)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {status && <Badge variant="outline" className="shrink-0 text-[10px]">{status}</Badge>}
      </div>
      <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{helper}</p>
    </div>
  );
}

function LeakChartTooltip({ active, payload }: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">Time: {row.timeLabel ?? row.t}</p>
      <p className="mt-2">Pressure: {row.pressure.toFixed(0)} kPa</p>
      <p>Flow: {row.flow.toFixed(1)} L/s</p>
      <p className={cn("mt-2 font-medium", row.prediction && row.prediction !== "normal" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
        Status: {row.prediction && row.prediction !== "normal" ? row.prediction.replace(/_/g, " ") : "No unusual reading detected"}
      </p>
    </div>
  );
}

function RiskScoreTooltip({ active, payload }: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">Time: {row.t}</p>
      <p className="mt-2">Risk score: {row.riskPct == null ? "warming up" : `${row.riskPct}%`}</p>
      <p>Prediction: {row.prediction ? row.prediction.replace(/_/g, " ") : "Collecting sequence"}</p>
    </div>
  );
}

function AdvancedLeakMetrics({
  result,
  config,
}: {
  result: LeakSimulationResult;
  config: {
    duration_hours: number;
    interval_minutes: number;
    scenario: LeakScenario;
    noise_level: number;
    lstm_window_size: number;
  };
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4" /> Advanced Metrics
            </span>
            <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="border-t px-5 py-5 space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatPill label="Precision" value={`${(result.summary.precision * 100).toFixed(1)}%`} accent={result.summary.meets_precision_target ? "good" : "bad"} />
              <StatPill label="Recall" value={`${(result.summary.recall * 100).toFixed(1)}%`} />
              <StatPill label="F1" value={result.summary.f1_score.toFixed(2)} />
              <StatPill label="Avg Latency" value={`${result.summary.avg_detection_latency_min.toFixed(1)} m`} accent={result.summary.meets_latency_target ? "good" : "warn"} />
              <StatPill label="Max Latency" value={`${result.summary.max_detection_latency_min.toFixed(1)} m`} />
            </div>
            <div className="rounded-lg border p-4 text-xs text-muted-foreground">
              <p className="mb-2 font-semibold text-foreground">Model parameters</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                <p>Scenario: {config.scenario}</p>
                <p>Duration hours: {config.duration_hours}</p>
                <p>Interval minutes: {config.interval_minutes}</p>
                <p>Noise level: {config.noise_level}</p>
                <p>LSTM window: {config.lstm_window_size}</p>
              </div>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function CollapsibleSection({ title, open, onToggle, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold hover:bg-muted/40 transition-colors"
      >
        <span>{title}</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-3 py-3">
          {children}
        </div>
      )}
    </div>
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

function ReadingTile({ label, value, accent }: { label: string; value: string; accent?: "good" | "warn" | "bad" }) {
  return (
    <div className={cn(
      "rounded-lg border p-3",
      accent === "good" && "border-green-200 bg-green-50/70 dark:border-green-500/25 dark:bg-green-500/10",
      accent === "warn" && "border-amber-200 bg-amber-50/70 dark:border-amber-500/25 dark:bg-amber-500/10",
      accent === "bad" && "border-red-200 bg-red-50/70 dark:border-red-500/25 dark:bg-red-500/10",
    )}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-base font-bold tracking-tight tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function ComplianceBadge({ pass, label }: { pass: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
      pass
        ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
        : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
    )}>
      {pass ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

function KV({ label, value, icon: Icon }: {
  label: string; value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </p>
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
function Td({ children, right, className }: {
  children: React.ReactNode; right?: boolean; className?: string;
}) {
  return (
    <td className={cn("px-3 py-2", right && "text-right", className)}>
      {children}
    </td>
  );
}

"use client";

import { useState, FormEvent } from "react";
import {
  Loader2, CheckCircle, AlertTriangle, FlaskConical,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, RadarChart, PolarGrid,
  PolarAngleAxis, Radar, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitManualReading, type ManualReadingResult } from "@/lib/api";

// ── Field definitions ────────────────────────────────────────────────────────

const FIELDS = [
  { key: "pressure_bar",  label: "Pressure (bar)", min: 0, max: 10,   step: 0.01, placeholder: "e.g. 3.5" },
  { key: "flow_rate_lps", label: "Flow Rate (L/s)", min: 0, max: 100,  step: 0.1,  placeholder: "e.g. 5.0" },
  { key: "turbidity_ntu", label: "Turbidity (NTU)", min: 0, max: 1000, step: 0.1,  placeholder: "e.g. 2.5" },
  { key: "ph",            label: "pH Level",         min: 0, max: 14,   step: 0.1,  placeholder: "e.g. 7.2" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type FormValues = Record<FieldKey, string>;

const EMPTY: FormValues = { pressure_bar: "", flow_rate_lps: "", turbidity_ntu: "", ph: "" };

// ── Safe operating ranges ────────────────────────────────────────────────────

const SAFE: Record<FieldKey, { min: number; max: number; unit: string }> = {
  pressure_bar:  { min: 1.5,  max: 5.0,  unit: "bar" },
  flow_rate_lps: { min: 1.0,  max: 15.0, unit: "L/s" },
  turbidity_ntu: { min: 0.0,  max: 4.0,  unit: "NTU" },
  ph:            { min: 6.5,  max: 8.5,  unit: "pH"  },
};

// Normalise a raw value to 0-100 within [min, max] range for radar chart
function normalise(key: FieldKey, val: number): number {
  const { min, max } = SAFE[key];
  return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
}

// ── Gauge strip ──────────────────────────────────────────────────────────────

function GaugeStrip({ label, value, min, max, unit }: {
  label: string; value: number; min: number; max: number; unit: string;
}) {
  const pct = Math.min(100, Math.max(0, ((value - 0) / (max * 1.1)) * 100));
  const safe_lo = (min / (max * 1.1)) * 100;
  const safe_hi = (max / (max * 1.1)) * 100;
  const outOfRange = value < min || value > max;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">{label}</span>
        <span className={`font-semibold ${outOfRange ? "text-red-600" : "text-green-600"}`}>
          {value.toFixed(2)} {unit} {outOfRange ? "⚠" : "✓"}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        {/* Safe zone highlight */}
        <div
          className="absolute top-0 h-full bg-green-100 dark:bg-green-900/30"
          style={{ left: `${safe_lo}%`, width: `${safe_hi - safe_lo}%` }}
        />
        {/* Value bar */}
        <div
          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-700 ${outOfRange ? "bg-red-500" : "bg-blue-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>0</span>
        <span className="text-green-600">{min}–{max} {unit} (safe)</span>
        <span>{(max * 1.1).toFixed(1)}</span>
      </div>
    </div>
  );
}

// ── Charts panel ─────────────────────────────────────────────────────────────

interface ChartsPanelProps {
  values: FormValues;
  result: ManualReadingResult;
}

function ChartsPanel({ values, result }: ChartsPanelProps) {
  const isAnomaly = result.status === "anomaly";
  const wq = result.water_quality;

  // Bar chart data — actual vs safe max
  const barData = FIELDS.map((f) => {
    const val = parseFloat(values[f.key]);
    const safe = SAFE[f.key];
    return {
      name: f.label.split(" ")[0],   // short label
      value: val,
      safeMax: safe.max,
      outOfRange: val > safe.max || val < safe.min,
    };
  });

  // Radar data — normalised 0-100
  const radarData = FIELDS.map((f) => ({
    metric: f.label.split(" ")[0],
    value: normalise(f.key, parseFloat(values[f.key])),
    safeMax: 100,
  }));

  // Score arc data
  const scorePct = Math.round(result.score * 100);

  return (
    <div className="mt-5 space-y-5">
      {/* ── Status banner ── */}
      <div
        className={[
          "flex items-center gap-3 rounded-lg border-2 px-4 py-3",
          isAnomaly
            ? "border-red-400 bg-red-50 dark:bg-red-950/20"
            : "border-green-400 bg-green-50 dark:bg-green-950/20",
        ].join(" ")}
      >
        {isAnomaly
          ? <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
          : <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
        }
        <div className="flex-1">
          <p className={`font-bold text-base ${isAnomaly ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
            {isAnomaly ? "ANOMALY DETECTED" : "ALL READINGS NORMAL"}
          </p>
          {result.type && (
            <p className="text-xs text-gray-500 mt-0.5 capitalize">Type: {result.type}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-black" style={{ color: isAnomaly ? "#dc2626" : "#16a34a" }}>
            {scorePct}%
          </p>
          <p className="text-[10px] text-gray-400">anomaly score</p>
        </div>
      </div>

      {/* ── Gauge strips ── */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Values vs Safe Range
        </p>
        {FIELDS.map((f) => (
          <GaugeStrip
            key={f.key}
            label={f.label}
            value={parseFloat(values[f.key])}
            min={SAFE[f.key].min}
            max={SAFE[f.key].max}
            unit={SAFE[f.key].unit}
          />
        ))}
      </div>

      {/* ── Bar chart + Radar side by side ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Bar chart */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Reading vs Safe Maximum
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={barData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number, name: string) => [v.toFixed(3), name]}
              />
              {/* Safe max reference */}
              <Bar dataKey="safeMax" fill="#dcfce7" radius={[3, 3, 0, 0]} name="Safe max" />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} name="Reading">
                {barData.map((entry, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={entry.outOfRange ? "#ef4444" : "#3b82f6"}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar chart */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Sensor Profile (normalised)
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
              <Radar
                name="Reading"
                dataKey="value"
                stroke={isAnomaly ? "#ef4444" : "#3b82f6"}
                fill={isAnomaly ? "#ef4444" : "#3b82f6"}
                fillOpacity={0.25}
                strokeWidth={2}
              />
              <Radar
                name="Safe max"
                dataKey="safeMax"
                stroke="#22c55e"
                fill="#22c55e"
                fillOpacity={0.08}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [`${v.toFixed(1)}%`, ""]} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Water quality detail ── */}
      {wq?.is_contamination && (
        <div className="flex items-start gap-2 rounded-md bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-3 py-2">
          <FlaskConical className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
          <div className="text-xs text-orange-800 dark:text-orange-300">
            <p className="font-semibold">Water quality contamination detected</p>
            {wq.reasons.length > 0 && (
              <p className="mt-0.5 text-orange-600 dark:text-orange-400">
                {wq.reasons.map((r) => r.replace(/_/g, " ")).join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManualReadingCard() {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ManualReadingResult | null>(null);
  const [submittedValues, setSubmittedValues] = useState<FormValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleChange(key: FieldKey, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setResult(null);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await submitManualReading({
        sensor_id: "manual-entry",
        pressure_bar: parseFloat(values.pressure_bar),
        flow_rate_lps: parseFloat(values.flow_rate_lps),
        turbidity_ntu: parseFloat(values.turbidity_ntu),
        ph: parseFloat(values.ph),
        water_level_m: 0,
      });
      setResult(res);
      setSubmittedValues({ ...values });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Detection failed — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Manual Sensor Reading — Detection</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Input grid */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {f.label}
                </label>
                <input
                  type="number"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  required
                  placeholder={f.placeholder}
                  value={values[f.key]}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  className={[
                    "w-full rounded-md border px-3 py-2 text-sm",
                    "bg-white dark:bg-gray-900 text-gray-900 dark:text-white",
                    "border-gray-300 dark:border-gray-700",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500 transition",
                  ].join(" ")}
                />
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium px-6 py-2.5 text-sm transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Running detection…" : "Run Detection"}
          </button>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 px-3 py-2">
              {error}
            </p>
          )}
        </form>

        {result && submittedValues && (
          <ChartsPanel values={submittedValues} result={result} />
        )}
      </CardContent>
    </Card>
  );
}

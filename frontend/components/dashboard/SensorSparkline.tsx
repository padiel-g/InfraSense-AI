"use client";
import { useMemo } from "react";
import { useSensorReadings } from "@/hooks/useSensors";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis,
  ReferenceLine, CartesianGrid,
} from "recharts";
import { format, subHours } from "date-fns";
import { cn } from "@/lib/utils";

interface Props {
  metric: "pressure_bar" | "flow_rate_lps" | "turbidity_ntu";
  label: string;
  color: string;
}

// ── Normal operating ranges for visual reference lines ───────────────────────
const NORMAL_RANGE: Record<string, { min: number; max: number; unit: string }> = {
  pressure_bar:  { min: 1.5, max: 5.0,  unit: "bar" },
  flow_rate_lps: { min: 1.0, max: 15.0, unit: "L/s" },
  turbidity_ntu: { min: 0.0, max: 4.0,  unit: "NTU" },
};

// ── Realistic synthetic fallback (seeded by metric so each looks different) ──
function generateFallback(
  metric: string,
  points = 48           // one point per 30 min → 24 h
): { t: string; v: number; anomaly: boolean }[] {
  const { min, max } = NORMAL_RANGE[metric];
  const mid = (min + max) / 2;
  const amp = (max - min) * 0.25;
  const now = new Date();

  let prev = mid;
  return Array.from({ length: points }, (_, i) => {
    const ts = subHours(now, points / 2 - i * 0.5);
    const sine = Math.sin((i / points) * Math.PI * 4) * amp * 0.4;
    const walk = (Math.random() - 0.49) * amp * 0.45;
    const raw = prev + walk + sine * 0.3;
    const v = Math.max(min * 0.7, Math.min(max * 1.15, raw));
    prev = v;
    const anomaly = v > max * 1.08 || v < min * 0.85;
    return {
      t: format(ts, "HH:mm"),
      v: parseFloat(v.toFixed(3)),
      anomaly,
    };
  });
}

/** Skeleton shaped like a sparkline tile while data loads. */
function SparklineSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 skeleton-shimmer rounded" aria-label={label} />
        <div className="h-5 w-16 skeleton-shimmer rounded-md" />
      </div>
      <div className="relative h-24 w-full overflow-hidden rounded-md bg-muted/40">
        <svg
          viewBox="0 0 200 80"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <path
            d="M0,55 C20,45 40,60 60,40 S100,25 130,35 S180,55 200,30"
            fill="none"
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        </svg>
        <div className="absolute inset-0 skeleton-shimmer opacity-60" />
      </div>
      <div className="h-2.5 w-2/3 skeleton-shimmer rounded" />
    </div>
  );
}

export default function SensorSparkline({ metric, label, color }: Props) {
  const since = useMemo(() => subHours(new Date(), 24), []);

  const { data, isLoading } = useSensorReadings({
    start_time: since.toISOString(),
    limit: 200,
  });

  if (isLoading) return <SparklineSkeleton label={label} />;

  const real = (data ?? [])
    .filter((r) => r[metric] !== null)
    .slice(-50)
    .map((r) => ({
      t: format(new Date(r.timestamp), "HH:mm"),
      v: r[metric] as number,
      anomaly: r.is_anomaly,
    }));

  const points = real.length >= 5 ? real : generateFallback(metric);

  const { min: nMin, max: nMax, unit } = NORMAL_RANGE[metric];
  const hasAnomalies = points.some((p) => p.anomaly);

  const vals = points.map((p) => p.v);
  const domMin = Math.min(...vals, nMin) * 0.9;
  const domMax = Math.max(...vals, nMax) * 1.1;

  const lastVal = points[points.length - 1]?.v ?? 0;
  const isOutOfRange = lastVal > nMax || lastVal < nMin;

  const gradientId = `sparkline-grad-${metric}`;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2 transition-shadow duration-200 ease-out-soft hover:shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "text-xs font-semibold px-1.5 py-0.5 rounded tabular-nums",
            isOutOfRange
              ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300"
              : "bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300"
          )}
        >
          {lastVal.toFixed(2)} {unit}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={92}>
        <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <XAxis dataKey="t" hide />
          <YAxis domain={[domMin, domMax]} hide />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--popover))",
              color: "hsl(var(--popover-foreground))",
            }}
            formatter={(v: number) => [`${v.toFixed(3)} ${unit}`, label]}
          />
          {/* Normal range guides */}
          <ReferenceLine y={nMax} stroke="#f97316" strokeDasharray="4 3" strokeWidth={1} strokeOpacity={0.6} />
          <ReferenceLine y={nMin} stroke="#3b82f6" strokeDasharray="4 3" strokeWidth={1} strokeOpacity={0.6} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={(props) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { cx, cy, payload } = props as any;
              if (!payload?.anomaly) return <g key={`dot-${cx}-${cy}`} />;
              return (
                <circle
                  key={`dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill="#ef4444"
                  stroke="#fff"
                  strokeWidth={1}
                />
              );
            }}
            activeDot={{ r: 4 }}
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-muted-foreground/80">
        Normal: {nMin}–{nMax} {unit}
        {hasAnomalies && (
          <span className="ml-2 text-red-500 font-medium">● anomalies detected</span>
        )}
        {real.length < 5 && (
          <span className="ml-2 italic">(simulated — no live data)</span>
        )}
      </p>
    </div>
  );
}

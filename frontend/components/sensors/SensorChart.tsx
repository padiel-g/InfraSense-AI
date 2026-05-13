"use client";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { useSensorHistory } from "@/hooks/useSensors";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

interface Props { sensorId: string; days?: number }

export default function SensorChart({ sensorId, days = 7 }: Props) {
  const { data, isLoading } = useSensorHistory(sensorId, days);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground py-4">No history data available.</p>;

  const points = data.map((r) => ({
    t: format(new Date(r.timestamp), "MM/dd HH:mm"),
    pressure: r.pressure_bar,
    flow: r.flow_rate_lps,
    turbidity: r.turbidity_ntu,
    score: r.anomaly_score,
    anomaly: r.is_anomaly ? r.pressure_bar : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} width={36} />
        <Tooltip contentStyle={{ fontSize: 11 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="pressure" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Pressure (bar)" />
        <Line type="monotone" dataKey="flow" stroke="#10b981" strokeWidth={1.5} dot={false} name="Flow (L/s)" />
        <Line type="monotone" dataKey="turbidity" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Turbidity (NTU)" />
        <Line type="monotone" dataKey="score" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" dot={false} name="Anomaly Score" />
      </LineChart>
    </ResponsiveContainer>
  );
}

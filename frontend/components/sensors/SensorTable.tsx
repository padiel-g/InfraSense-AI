"use client";
import { useSensorReadings } from "@/hooks/useSensors";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { SensorReading } from "@/types";

interface Props {
  filters: { sensor_id?: string; sensor_type?: string; anomalies_only?: boolean };
  onSelect: (sensor: SensorReading) => void;
}

export default function SensorTable({ filters, onSelect }: Props) {
  const { data, isLoading, error, refetch } = useSensorReadings({ ...filters, limit: 100 });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p>Failed to load sensor data</p>
        <button onClick={() => refetch()} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p>No sensor readings found</p>
      </div>
    );
  }

  // Deduplicate to one row per sensor_id (latest reading)
  const latestBySensor = new Map<string, SensorReading>();
  data.forEach((r) => {
    const existing = latestBySensor.get(r.sensor_id);
    if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
      latestBySensor.set(r.sensor_id, r);
    }
  });
  const rows = Array.from(latestBySensor.values());

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Sensor ID</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            <th className="pb-2 pr-4 font-medium">Last Reading</th>
            <th className="pb-2 pr-4 font-medium">Pressure</th>
            <th className="pb-2 pr-4 font-medium">Flow</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b hover:bg-muted/50 transition-colors"
              onClick={() => onSelect(r)}
            >
              <td className="py-3 pr-4 font-mono text-xs">{r.sensor_id}</td>
              <td className="py-3 pr-4">{r.sensor_type}</td>
              <td className="py-3 pr-4 text-muted-foreground">{formatRelativeTime(r.timestamp)}</td>
              <td className="py-3 pr-4">{r.pressure_bar?.toFixed(2) ?? "—"}</td>
              <td className="py-3 pr-4">{r.flow_rate_lps?.toFixed(2) ?? "—"}</td>
              <td className="py-3 pr-4">
                {r.is_anomaly ? (
                  <Badge variant="critical">Anomaly</Badge>
                ) : (
                  <Badge variant="success">Normal</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

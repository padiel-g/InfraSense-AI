"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SensorChart from "./SensorChart";
import { Badge } from "@/components/ui/badge";
import type { SensorReading } from "@/types";
import { formatDate } from "@/lib/utils";

interface Props {
  sensor: SensorReading | null;
  onClose: () => void;
}

export default function SensorDrawer({ sensor, onClose }: Props) {
  if (!sensor) return null;
  return (
    <Dialog open={!!sensor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Sensor: <span className="font-mono">{sensor.sensor_id}</span>
            {sensor.is_anomaly ? (
              <Badge variant="critical">Anomaly</Badge>
            ) : (
              <Badge variant="success">Normal</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div className="rounded-md bg-muted p-3">
            <p className="text-muted-foreground">Type</p>
            <p className="font-medium">{sensor.sensor_type}</p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-muted-foreground">Last Updated</p>
            <p className="font-medium">{formatDate(sensor.timestamp)}</p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-muted-foreground">Pressure</p>
            <p className="font-medium">{sensor.pressure_bar?.toFixed(3) ?? "—"} bar</p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-muted-foreground">Flow Rate</p>
            <p className="font-medium">{sensor.flow_rate_lps?.toFixed(3) ?? "—"} L/s</p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-muted-foreground">Turbidity</p>
            <p className="font-medium">{sensor.turbidity_ntu?.toFixed(3) ?? "—"} NTU</p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-muted-foreground">Anomaly Score</p>
            <p className="font-medium">{sensor.anomaly_score?.toFixed(4) ?? "—"}</p>
          </div>
        </div>

        <p className="text-sm font-medium mb-2">7-Day History</p>
        <SensorChart sensorId={sensor.sensor_id} days={7} />
      </DialogContent>
    </Dialog>
  );
}

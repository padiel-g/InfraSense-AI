"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import SensorTable from "@/components/sensors/SensorTable";
import SensorDrawer from "@/components/sensors/SensorDrawer";
import Breadcrumb from "@/components/layout/Breadcrumb";
import type { SensorReading } from "@/types";

export default function SensorsReadingsPage() {
  const [selected, setSelected] = useState<SensorReading | null>(null);
  const [sensorId, setSensorId] = useState("");
  const [sensorType, setSensorType] = useState<string>("all");
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb
        items={[
          { label: "Sensors", href: "/sensors" },
          { label: "All Readings" },
        ]}
      />
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          All Sensor Readings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse, filter, and inspect every reading ingested across the network.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input
            placeholder="Search sensor ID..."
            className="w-48"
            value={sensorId}
            onChange={(e) => setSensorId(e.target.value)}
          />
          <Select value={sensorType} onValueChange={setSensorType}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="flow">Flow</SelectItem>
              <SelectItem value="pressure">Pressure</SelectItem>
              <SelectItem value="level">Level</SelectItem>
              <SelectItem value="turbidity">Turbidity</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={anomaliesOnly}
              onChange={(e) => setAnomaliesOnly(e.target.checked)}
              className="rounded"
            />
            Anomalies only
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Sensor Readings</CardTitle>
        </CardHeader>
        <CardContent>
          <SensorTable
            filters={{
              sensor_id: sensorId || undefined,
              sensor_type: sensorType !== "all" ? sensorType : undefined,
              anomalies_only: anomaliesOnly || undefined,
            }}
            onSelect={setSelected}
          />
        </CardContent>
      </Card>

      <SensorDrawer sensor={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

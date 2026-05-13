"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchSensorReadings, fetchRecentAnomalies } from "@/lib/api";

export function useSensorReadings(params?: {
  sensor_id?: string;
  sensor_type?: string;
  start_time?: string;
  end_time?: string;
  anomalies_only?: boolean;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["sensorReadings", params],
    queryFn: () => fetchSensorReadings(params),
    refetchInterval: 30000,
  });
}

export function useSensorHistory(sensorId: string, days = 7) {
  const start = new Date();
  start.setDate(start.getDate() - days);
  return useQuery({
    queryKey: ["sensorHistory", sensorId, days],
    queryFn: () =>
      fetchSensorReadings({
        sensor_id: sensorId,
        start_time: start.toISOString(),
        limit: 1000,
      }),
    enabled: !!sensorId,
  });
}

export function useRecentAnomalies(hours = 24) {
  return useQuery({
    queryKey: ["anomalies", hours],
    queryFn: () => fetchRecentAnomalies(hours),
    refetchInterval: 30000,
  });
}

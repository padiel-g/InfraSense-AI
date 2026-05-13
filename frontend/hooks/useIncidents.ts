"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchIncidents,
  fetchIncidentStats,
  createIncident,
  updateIncident,
} from "@/lib/api";
import type { IncidentCreate } from "@/types";

export function useIncidents(params?: {
  status?: string;
  incident_type?: string;
  severity?: string;
  suburb?: string;
}) {
  return useQuery({
    queryKey: ["incidents", params],
    queryFn: () => fetchIncidents(params),
    refetchInterval: 30000,
  });
}

export function useIncidentStats() {
  return useQuery({
    queryKey: ["incidentStats"],
    queryFn: fetchIncidentStats,
  });
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: IncidentCreate) => createIncident(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateIncident(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboardSummary, fetchAlerts, fetchRiskMap } from "@/lib/api";

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: fetchDashboardSummary,
    refetchInterval: 30000,
  });
}

export function useAlerts(hours = 24) {
  return useQuery({
    queryKey: ["alerts", hours],
    queryFn: () => fetchAlerts(hours),
    refetchInterval: 30000,
  });
}

export function useRiskMap(params?: { suburb?: string; min_risk?: number }) {
  return useQuery({
    queryKey: ["riskMap", params],
    queryFn: () => fetchRiskMap(params),
  });
}

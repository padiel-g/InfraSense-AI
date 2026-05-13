"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  submitWaterQualityManual,
  runWaterQualitySimulation,
  runWaterQualitySequenceSimulation,
  fetchWaterQualityThresholds,
  type WQManualEntryInput,
  type WQSimulateInput,
  type WQSequenceSimulateInput,
} from "@/lib/api";

export function useWaterQualityThresholds() {
  return useQuery({
    queryKey: ["water-quality", "thresholds"],
    queryFn: fetchWaterQualityThresholds,
    staleTime: 5 * 60 * 1000, // 5 min — these rarely change
  });
}

export function useWaterQualityManualMutation() {
  return useMutation({
    mutationFn: (input: WQManualEntryInput) => submitWaterQualityManual(input),
  });
}

export function useWaterQualitySimulation() {
  return useMutation({
    mutationFn: (input: WQSimulateInput) => runWaterQualitySimulation(input),
  });
}

export function useWaterQualitySequenceSimulation() {
  return useMutation({
    mutationFn: (input: WQSequenceSimulateInput) => runWaterQualitySequenceSimulation(input),
  });
}

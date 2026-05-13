"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDetectionSessionReading,
  createDetectionSession,
  fetchDetectionSessionReadings,
  fetchDetectionSessions,
  submitLeakManual,
  runDetectionSession,
  runLeakSimulation,
  runLeakSequenceSimulation,
  fetchLeakModelStatus,
  type DetectionSessionCreate,
  type DetectionSessionReadingInput,
  type LeakManualEntryInput,
  type LeakSimulateInput,
  type LeakSimulationRunInput,
} from "@/lib/api";

export function useLeakModelStatus() {
  return useQuery({
    queryKey: ["leak-detection", "model-status"],
    queryFn: fetchLeakModelStatus,
    refetchOnWindowFocus: false,
  });
}

export function useLeakManualMutation() {
  return useMutation({
    mutationFn: (input: LeakManualEntryInput) => submitLeakManual(input),
  });
}

export function useDetectionSessionHistory() {
  return useQuery({
    queryKey: ["detection-sessions"],
    queryFn: fetchDetectionSessions,
    refetchOnWindowFocus: false,
  });
}

export function useDetectionSessionReadings(sessionId?: string) {
  return useQuery({
    queryKey: ["detection-session-readings", sessionId],
    queryFn: () => fetchDetectionSessionReadings(sessionId!),
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: false,
  });
}

export function useCreateDetectionSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input?: DetectionSessionCreate) => createDetectionSession(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["detection-sessions"] });
    },
  });
}

export function useAddDetectionSessionReading() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      input,
    }: {
      sessionId: string;
      input: DetectionSessionReadingInput;
    }) => addDetectionSessionReading(sessionId, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["detection-session-readings", variables.sessionId] });
      queryClient.invalidateQueries({ queryKey: ["detection-sessions"] });
    },
  });
}

export function useRunDetectionSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => runDetectionSession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ["detection-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["detection-session-readings", sessionId] });
    },
  });
}

export function useLeakSimulation() {
  return useMutation({
    mutationFn: (input: LeakSimulateInput) => runLeakSimulation(input),
  });
}

export function useLeakSequenceSimulation() {
  return useMutation({
    mutationFn: (input: LeakSimulationRunInput) => runLeakSequenceSimulation(input),
  });
}

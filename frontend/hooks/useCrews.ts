"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignCrewToIncident, fetchCrews } from "@/lib/api";

export function useCrews() {
  return useQuery({
    queryKey: ["crews"],
    queryFn: fetchCrews,
    refetchInterval: 30000,
  });
}

export function useAssignCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ crewId, incidentId }: { crewId: string; incidentId: string }) =>
      assignCrewToIncident(crewId, incidentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crews"] });
      qc.invalidateQueries({ queryKey: ["dumping"] });
    },
  });
}

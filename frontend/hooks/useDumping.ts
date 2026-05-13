"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteDumpingReportImage,
  fetchDumpingReports,
  reportDumping,
  verifyDumpingReport,
} from "@/lib/api";

export function useDumpingReports(params?: { status?: string; suburb?: string }) {
  return useQuery({
    queryKey: ["dumping", params],
    queryFn: () => fetchDumpingReports(params),
    refetchInterval: 30000,
  });
}

export function useReportDumping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => reportDumping(formData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dumping"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useVerifyDumping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verified }: { id: string; verified: boolean }) =>
      verifyDumpingReport(id, verified),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dumping"] });
    },
  });
}

export function useDeleteDumpingImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDumpingReportImage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dumping"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

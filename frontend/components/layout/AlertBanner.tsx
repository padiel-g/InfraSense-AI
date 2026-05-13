"use client";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { useAlerts } from "@/hooks/useDashboard";

export default function AlertBanner() {
  const { data: alerts } = useAlerts();
  const [dismissed, setDismissed] = useState(false);
  const critical = alerts?.filter(
    (a) => a.severity === "critical" && !a.is_acknowledged
  ) ?? [];

  if (dismissed || critical.length === 0) return null;

  return (
    <div className="flex items-center gap-3 bg-red-600 text-white px-4 py-2 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 font-medium">
        {critical.length} critical alert{critical.length > 1 ? "s" : ""} require immediate attention:{" "}
        {critical[0].message}
      </span>
      <button onClick={() => setDismissed(true)}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

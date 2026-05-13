"use client";
import { useAlerts } from "@/hooks/useDashboard";
import { formatRelativeTime } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle, RefreshCw, ShieldCheck, AlertTriangle,
  Activity, Trash2, Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Severity → palette tokens (left border, badge) */
const SEVERITY: Record<
  string,
  { border: string; badge: string; ring: string }
> = {
  critical: {
    border: "border-l-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    ring: "hover:bg-red-50/50 dark:hover:bg-red-500/[0.04]",
  },
  high: {
    border: "border-l-orange-500",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
    ring: "hover:bg-orange-50/50 dark:hover:bg-orange-500/[0.04]",
  },
  medium: {
    border: "border-l-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    ring: "hover:bg-amber-50/50 dark:hover:bg-amber-500/[0.04]",
  },
  warning: {
    border: "border-l-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    ring: "hover:bg-amber-50/50 dark:hover:bg-amber-500/[0.04]",
  },
  low: {
    border: "border-l-green-500",
    badge: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
    ring: "hover:bg-green-50/50 dark:hover:bg-green-500/[0.04]",
  },
  info: {
    border: "border-l-blue-500",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    ring: "hover:bg-blue-50/50 dark:hover:bg-blue-500/[0.04]",
  },
};

const ALERT_TYPE_ICON: Record<string, typeof Bell> = {
  anomaly: Activity,
  incident: AlertTriangle,
  dumping: Trash2,
};

function severityTokens(sev: string) {
  return SEVERITY[sev?.toLowerCase()] ?? {
    border: "border-l-muted-foreground/40",
    badge: "bg-muted text-muted-foreground",
    ring: "hover:bg-accent",
  };
}

/* ── Engaging empty state ───────────────────────────────────────────────── */
function EmptyAllClear() {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      {/* Concentric calm rings + shield */}
      <div className="relative h-24 w-24 mb-4">
        <span className="absolute inset-0 rounded-full bg-green-500/10 animate-slow-ping" />
        <span
          className="absolute inset-2 rounded-full bg-green-500/15 animate-slow-ping"
          style={{ animationDelay: "0.6s" }}
        />
        <span className="absolute inset-4 rounded-full bg-gradient-to-br from-green-100 to-green-50 dark:from-green-500/20 dark:to-green-500/5 flex items-center justify-center shadow-sm">
          <ShieldCheck
            className="h-9 w-9 text-green-600 dark:text-green-400 animate-soft-pulse"
            strokeWidth={2}
          />
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground">All clear</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[220px]">
        No alerts in the last 48 hours. We&apos;ll surface anything new here in real time.
      </p>
    </div>
  );
}

export default function AlertFeed() {
  const { data: alerts, isLoading, error, refetch } = useAlerts(48);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-lg border border-border/60 p-3"
          >
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">Failed to load alerts</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  if (!alerts?.length) {
    return <EmptyAllClear />;
  }

  return (
    <ul className="space-y-2 overflow-y-auto max-h-[420px] pr-1 -mr-1">
      {alerts.map((alert) => {
        const t = severityTokens(alert.severity);
        const TypeIcon = ALERT_TYPE_ICON[alert.alert_type] ?? Bell;
        return (
          <li
            key={alert.id}
            className={cn(
              "group rounded-lg border bg-card border-l-[3px]",
              "px-3 py-2.5 flex items-start gap-3 cursor-default",
              "transition-colors duration-150 ease-out-soft",
              t.border, t.ring
            )}
          >
            <div className="mt-0.5 shrink-0 rounded-md bg-muted p-1.5 text-muted-foreground">
              <TypeIcon className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5",
                    "text-[10px] font-semibold uppercase tracking-wide",
                    t.badge
                  )}
                >
                  {alert.severity}
                </span>
                <span className="text-[11px] text-muted-foreground capitalize">
                  {alert.alert_type}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                  {formatRelativeTime(alert.timestamp)}
                </span>
              </div>
              <p className="text-sm leading-snug text-foreground line-clamp-2">
                {alert.message}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

"use client";
import dynamic from "next/dynamic";
import {
  AlertTriangle, Activity, Users, Trash2,
  TrendingUp, Clock,
} from "lucide-react";
import { useDashboardSummary } from "@/hooks/useDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DashboardMap = dynamic(() => import("@/components/map/DashboardMap"), { ssr: false });

export default function DashboardPage() {
  const { data: stats, isLoading } = useDashboardSummary();

  // Note: trend deltas would normally come from the API. We render placeholders
  // here that the backend can replace with real day-over-day values.
  return (
    <div className="p-6 space-y-6 bg-background min-h-full">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time overview of Gweru City
        </p>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          title="Active Incidents"
          value={stats?.active_incidents ?? 0}
          icon={AlertTriangle}
          loading={isLoading}
          accent="red"
          trend={{ value: 2, label: "from yesterday", inverse: true }}
        />
        <KpiCard
          title="Anomalies Today"
          value={stats?.anomalies_today ?? 0}
          icon={Activity}
          loading={isLoading}
          accent="amber"
          trend={{ value: -3, label: "vs. avg", inverse: true }}
        />
        <KpiCard
          title="High-Risk Assets"
          value={stats?.high_risk_assets ?? 0}
          icon={TrendingUp}
          loading={isLoading}
          accent="orange"
          trend={{ value: 0, label: "stable", inverse: true }}
        />
        <KpiCard
          title="Dump Reports"
          value={stats?.dumping_reports_pending ?? 0}
          icon={Trash2}
          loading={isLoading}
          accent="purple"
          trend={{ value: 1, label: "new today", inverse: true }}
        />
        <KpiCard
          title="Total Assets"
          value={stats?.total_assets ?? 0}
          icon={Users}
          loading={isLoading}
          accent="blue"
          subtitle="across all wards"
        />
        <KpiCard
          title="Avg Response"
          value={stats ? `${stats.avg_response_time_hours.toFixed(1)}h` : "—"}
          icon={Clock}
          loading={isLoading}
          accent="green"
          trend={{ value: -0.4, label: "faster", inverse: true }}
        />
      </div>

      {/* ── Map ───────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3 pt-4 px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Gweru Smart Route Map</CardTitle>
            <span className="text-xs text-muted-foreground">Gweru, Zimbabwe</span>
          </div>
        </CardHeader>
        <CardContent className="p-0 h-[460px]">
          <DashboardMap />
        </CardContent>
      </Card>
    </div>
  );
}

"use client";
import Link from "next/link";
import {
  Droplets, AlertTriangle, ArrowRight, Database, type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SelectionCardProps {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  description: string;
  badge: string;
  /** Tailwind class for the icon's tinted background (e.g. "bg-blue-100"). */
  iconWrap: string;
  iconColor: string;
  /** Card-edge accent gradient. */
  accent: string;
  /** Ring colour token. */
  ring: string;
}

function SelectionCard({
  href, icon: Icon, title, subtitle, description, badge,
  iconWrap, iconColor, accent, ring,
}: SelectionCardProps) {
  return (
    <Link
      href={href}
      className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
    >
      <Card
        className={cn(
          "relative overflow-hidden ring-1 h-full",
          accent, ring,
          "transition-all duration-200 ease-out-soft",
          "group-hover:shadow-card-hover group-hover:-translate-y-0.5",
        )}
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-50 blur-2xl",
            iconWrap,
          )}
        />

        <CardContent className="relative p-6 md:p-7">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "rounded-2xl p-3 transition-transform duration-200 ease-out-soft",
                "group-hover:scale-105",
                iconWrap, iconColor,
              )}
            >
              <Icon className="h-7 w-7" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                {title}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
            <ArrowRight
              className="h-5 w-5 text-muted-foreground shrink-0 mt-1 transition-transform duration-200 ease-out-soft group-hover:translate-x-1 group-hover:text-foreground"
            />
          </div>

          <p className="text-sm text-muted-foreground/90 mt-5 leading-relaxed">
            {description}
          </p>

          <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 rounded-full", iconColor.replace("text-", "bg-"))} />
            {badge}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function SensorsLandingPage() {
  return (
    <div className="p-6 space-y-6 min-h-full">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          Sensors
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a detection module to inspect, simulate, or run a manual reading.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SelectionCard
          href="/sensors/water-quality"
          icon={Droplets}
          title="Water Quality"
          subtitle="Contamination & Corrosion Detection"
          description="Monitor turbidity, pH, and flow to detect contamination events from pipe corrosion. Combines threshold checks, drift z-scores, and a corrosion-signature heuristic."
          badge="Target: >= 70-75% accuracy"
          iconWrap="bg-blue-100 dark:bg-blue-500/15"
          iconColor="text-blue-600 dark:text-blue-400"
          accent="bg-gradient-to-br from-blue-50/80 via-card to-card dark:from-blue-500/[0.07] dark:via-card dark:to-card"
          ring="ring-blue-100/60 dark:ring-blue-500/10"
        />

        <SelectionCard
          href="/sensors/leak-detection"
          icon={AlertTriangle}
          title="Leak & Overflow"
          subtitle="LSTM Real-Time Anomaly Detection"
          description="Real-time detection of leaks and overflows using pressure, flow, and acoustic data. A trained PyTorch LSTM scores rolling windows of sensor readings for sequence-aware anomalies."
          badge="Target: < 60 min latency, >= 0.7 precision"
          iconWrap="bg-orange-100 dark:bg-orange-500/15"
          iconColor="text-orange-600 dark:text-orange-400"
          accent="bg-gradient-to-br from-orange-50/80 via-card to-card dark:from-orange-500/[0.07] dark:via-card dark:to-card"
          ring="ring-orange-100/60 dark:ring-orange-500/10"
        />
      </div>

      <div className="pt-2">
        <Link
          href="/sensors/readings"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
        >
          <Database className="h-4 w-4" />
          Browse all sensor readings
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

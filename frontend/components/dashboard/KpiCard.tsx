import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiAccent =
  | "red" | "amber" | "orange" | "purple" | "blue" | "green";

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  loading?: boolean;
  /** Semantic colour key — drives icon tint, gradient, and trend chip. */
  accent?: KpiAccent;
  subtitle?: string;
  /** Trend block: positive numbers render green-up, negatives red-down. */
  trend?: {
    value: number;            // signed delta
    label?: string;           // e.g. "from yesterday"
    /** Override colour semantics: by default an increase is "good" for some
     *  metrics (assets) and "bad" for others (incidents). Pass `inverse` for
     *  metrics where lower is better. */
    inverse?: boolean;
    /** Render as a non-numeric pill, e.g. "—" for no change. */
    formatted?: string;
  };
}

/* ── Per-accent design tokens ───────────────────────────────────────────── */
const ACCENTS: Record<
  KpiAccent,
  { icon: string; iconBg: string; gradient: string; ring: string }
> = {
  red: {
    icon: "text-red-600 dark:text-red-400",
    iconBg: "bg-red-100 dark:bg-red-500/15",
    gradient:
      "bg-gradient-to-br from-red-50/80 via-card to-card " +
      "dark:from-red-500/[0.07] dark:via-card dark:to-card",
    ring: "ring-red-100/60 dark:ring-red-500/10",
  },
  amber: {
    icon: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-100 dark:bg-amber-500/15",
    gradient:
      "bg-gradient-to-br from-amber-50/80 via-card to-card " +
      "dark:from-amber-500/[0.07] dark:via-card dark:to-card",
    ring: "ring-amber-100/60 dark:ring-amber-500/10",
  },
  orange: {
    icon: "text-orange-600 dark:text-orange-400",
    iconBg: "bg-orange-100 dark:bg-orange-500/15",
    gradient:
      "bg-gradient-to-br from-orange-50/80 via-card to-card " +
      "dark:from-orange-500/[0.07] dark:via-card dark:to-card",
    ring: "ring-orange-100/60 dark:ring-orange-500/10",
  },
  purple: {
    icon: "text-purple-600 dark:text-purple-400",
    iconBg: "bg-purple-100 dark:bg-purple-500/15",
    gradient:
      "bg-gradient-to-br from-purple-50/80 via-card to-card " +
      "dark:from-purple-500/[0.07] dark:via-card dark:to-card",
    ring: "ring-purple-100/60 dark:ring-purple-500/10",
  },
  blue: {
    icon: "text-blue-600 dark:text-blue-400",
    iconBg: "bg-blue-100 dark:bg-blue-500/15",
    gradient:
      "bg-gradient-to-br from-blue-50/80 via-card to-card " +
      "dark:from-blue-500/[0.07] dark:via-card dark:to-card",
    ring: "ring-blue-100/60 dark:ring-blue-500/10",
  },
  green: {
    icon: "text-green-600 dark:text-green-400",
    iconBg: "bg-green-100 dark:bg-green-500/15",
    gradient:
      "bg-gradient-to-br from-green-50/80 via-card to-card " +
      "dark:from-green-500/[0.07] dark:via-card dark:to-card",
    ring: "ring-green-100/60 dark:ring-green-500/10",
  },
};

function TrendChip({ trend }: { trend: NonNullable<KpiCardProps["trend"]> }) {
  if (trend.formatted) {
    return (
      <p className="text-xs text-muted-foreground/80 mt-1.5 flex items-center gap-1">
        <Minus className="h-3 w-3" />
        {trend.formatted}
      </p>
    );
  }

  const v = trend.value;
  const flat = v === 0;
  const isPositiveDirection = trend.inverse ? v < 0 : v > 0;
  const Icon = flat ? Minus : v > 0 ? TrendingUp : TrendingDown;

  const tone = flat
    ? "text-muted-foreground"
    : isPositiveDirection
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";

  const sign = v > 0 ? "+" : "";
  return (
    <p className={cn("text-xs mt-1.5 flex items-center gap-1 font-medium", tone)}>
      <Icon className="h-3 w-3" />
      <span>{sign}{v}</span>
      {trend.label && (
        <span className="text-muted-foreground font-normal ml-0.5">{trend.label}</span>
      )}
    </p>
  );
}

export default function KpiCard({
  title, value, icon: Icon, loading, accent = "blue", subtitle, trend,
}: KpiCardProps) {
  const a = ACCENTS[accent];

  return (
    <Card
      className={cn(
        "group relative overflow-hidden ring-1",
        a.gradient,
        a.ring,
        "hover:shadow-card-hover hover:-translate-y-0.5",
        "transition-all duration-200 ease-out-soft"
      )}
    >
      <CardContent className="flex items-start gap-4 p-5">
        <div
          className={cn(
            "rounded-xl p-3 shrink-0 transition-transform duration-200 ease-out-soft",
            "group-hover:scale-105",
            a.iconBg, a.icon
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/90 truncate">
            {title}
          </p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-20" />
          ) : (
            <p className="text-3xl font-bold tracking-tight leading-tight mt-0.5 text-foreground">
              {value}
            </p>
          )}
          {subtitle && !trend && (
            <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>
          )}
          {trend && !loading && <TrendChip trend={trend} />}
        </div>
      </CardContent>
    </Card>
  );
}

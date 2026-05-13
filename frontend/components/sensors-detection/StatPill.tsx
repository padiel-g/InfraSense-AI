import { cn } from "@/lib/utils";

export default function StatPill({
  label, value, hint, accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "good" | "warn" | "bad" | "neutral";
}) {
  const tone = {
    good: "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30",
    warn: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30",
    bad:  "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30",
    neutral: "text-foreground bg-card border-border",
  }[accent ?? "neutral"];

  return (
    <div className={cn("rounded-lg border p-3", tone)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-bold tracking-tight tabular-nums mt-1">{value}</p>
      {hint && <p className="text-[11px] mt-0.5 opacity-80">{hint}</p>}
    </div>
  );
}

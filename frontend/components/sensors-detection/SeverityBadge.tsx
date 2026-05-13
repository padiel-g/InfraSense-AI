import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Severity = "low" | "medium" | "high" | "critical";

const SEVERITY_STYLES: Record<Severity, string> = {
  low:      "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  medium:   "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  high:     "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

export default function SeverityBadge({ severity, className }: {
  severity: Severity; className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent capitalize", SEVERITY_STYLES[severity], className)}
    >
      {severity}
    </Badge>
  );
}

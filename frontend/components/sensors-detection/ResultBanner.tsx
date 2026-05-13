import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ResultBanner({
  anomaly, title, message, children,
}: {
  anomaly: boolean;
  title: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border-2 p-4",
        "transition-colors duration-200 ease-out-soft",
        anomaly
          ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10"
          : "border-green-300 bg-green-50 dark:border-green-500/40 dark:bg-green-500/10"
      )}
      role={anomaly ? "alert" : "status"}
    >
      {anomaly ? (
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
      ) : (
        <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
      )}
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm font-bold",
          anomaly ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"
        )}>
          {title}
        </p>
        {message && (
          <p className="text-xs text-foreground/80 mt-1">{message}</p>
        )}
        {children}
      </div>
    </div>
  );
}

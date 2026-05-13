import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–100 */
  value: number;
  /** Tailwind class for the fill colour. Defaults to `bg-primary`. */
  fillClassName?: string;
}

/**
 * Lightweight progress bar with no JS animation — pure CSS width transition.
 * Used for confidence scores, simulation progress, etc.
 */
export function Progress({
  value, fillClassName, className, ...rest
}: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
      {...rest}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          fillClassName ?? "bg-primary"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

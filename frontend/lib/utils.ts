import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalise a FastAPI error response into a plain string.
 *
 * FastAPI raises two distinct shapes:
 *  - HTTPException  → detail is a plain string
 *  - RequestValidationError (Pydantic 422) → detail is an array of
 *    { type, loc, msg, input } objects
 *
 * Rendering either shape directly as a React child will crash when it
 * is an object/array ("Objects are not valid as a React child").
 * This function always returns a displayable string.
 */
export function extractApiError(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })
    ?.response?.data?.detail;

  if (!detail) return fallback;

  // Plain string — e.g. HTTPException(detail="Invalid credentials")
  if (typeof detail === "string") return detail;

  // Pydantic v2 validation array — e.g. [{type, loc, msg, input}, ...]
  if (Array.isArray(detail)) {
    const messages = detail
      .map((e) => {
        if (typeof e === "object" && e !== null && "msg" in e) {
          const loc = (e as { loc?: unknown[] }).loc;
          const field = Array.isArray(loc) ? loc[loc.length - 1] : null;
          const prefix = field && field !== "body" ? `${field}: ` : "";
          return `${prefix}${(e as { msg: string }).msg}`;
        }
        return String(e);
      })
      .join(". ");
    return messages || fallback;
  }

  // Single validation object (rare but possible)
  if (typeof detail === "object" && detail !== null && "msg" in detail) {
    return String((detail as { msg: unknown }).msg);
  }

  return fallback;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function severityColor(severity: string): string {
  const map: Record<string, string> = {
    critical: "bg-red-500 text-white",
    high: "bg-orange-500 text-white",
    medium: "bg-amber-400 text-black",
    low: "bg-green-500 text-white",
    warning: "bg-amber-400 text-black",
    info: "bg-blue-400 text-white",
  };
  return map[severity] || "bg-gray-400 text-white";
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    reported: "bg-blue-100 text-blue-800",
    assigned: "bg-purple-100 text-purple-800",
    in_progress: "bg-amber-100 text-amber-800",
    resolved: "bg-green-100 text-green-800",
    available: "bg-green-100 text-green-800",
    "en-route": "bg-blue-100 text-blue-800",
    "on-site": "bg-amber-100 text-amber-800",
    "off-duty": "bg-gray-100 text-gray-800",
    detected: "bg-red-100 text-red-800",
    verified: "bg-amber-100 text-amber-800",
    cleaned: "bg-green-100 text-green-800",
    rejected: "bg-gray-100 text-gray-800",
  };
  return map[status] || "bg-gray-100 text-gray-800";
}

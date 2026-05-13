export function getSeverityColor(severity: string): string {
  const colors: Record<string, string> = {
    critical: "#ef4444",
    high: "#f97316",
    medium: "#eab308",
    low: "#22c55e",
    normal: "#22c55e",
    warning: "#eab308",
  };
  return colors[severity] ?? "#6b7280";
}

export function getRiskColor(score: number): string {
  if (score >= 0.8) return "#ef4444";
  if (score >= 0.6) return "#f97316";
  if (score >= 0.3) return "#eab308";
  return "#22c55e";
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export const DEFAULT_CENTER: [number, number] = [-19.4500, 29.8167]; // Gweru, Zimbabwe
export const DEFAULT_ZOOM = 13;

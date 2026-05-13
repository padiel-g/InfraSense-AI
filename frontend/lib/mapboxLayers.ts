type MapboxMap = import("mapbox-gl").Map;
type StyleLayer = {
  id: string;
  type?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  ["source-layer"]?: string;
};

function isRoadLabelLayer(layer: StyleLayer) {
  if (layer.type !== "symbol") return false;

  const searchable = [
    layer.id,
    layer["source-layer"] ?? "",
    String(layer.layout?.["text-field"] ?? ""),
  ].join(" ").toLowerCase();

  return (
    searchable.includes("road")
    || searchable.includes("street")
    || searchable.includes("motorway")
    || searchable.includes("highway")
  );
}

export function enableRoadLabels(map: MapboxMap) {
  const layers = (map.getStyle().layers ?? []) as StyleLayer[];

  layers.filter(isRoadLabelLayer).forEach((layer) => {
    if (!map.getLayer(layer.id)) return;

    map.setLayoutProperty(layer.id, "visibility", "visible");

    if (layer.paint && "text-opacity" in layer.paint) {
      map.setPaintProperty(layer.id, "text-opacity", 1);
    }
  });
}

export function getFirstSymbolLayerId(map: MapboxMap) {
  return map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
}

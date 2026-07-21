import type { TransactionLocationDraft } from "../types";

export const KATHMANDU_CENTER: [number, number] = [85.324, 27.7172];
export const KATHMANDU_MAP_MAX_ZOOM = 19;
export const KATHMANDU_BOUNDS = {
  south: 27.63,
  north: 27.82,
  west: 85.20,
  east: 85.40,
} as const;

export function kathmanduMapStyle() {
  return process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";
}

export function applyKathmanduMapTheme(map: import("maplibre-gl").Map) {
  const hideLayers = [
    "building",
    "highway_path",
    "railway_transit",
    "railway_transit_dashline",
    "railway_service",
    "railway_service_dashline",
    "railway",
    "railway_dashline",
    "waterway_line_label",
    "water_name_point_label",
    "water_name_line_label",
    "highway-name-path",
    "highway-name-minor",
    "highway-shield-non-us",
    "highway-shield-us-interstate",
    "road_shield_us",
    "airport",
    "label_state",
    "label_city",
    "label_city_capital",
    "label_country_3",
    "label_country_2",
    "label_country_1",
  ];
  hideLayers.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  });

  const fills: Record<string, string> = {
    background: "#f4f1ea",
    park: "#e4ece2",
    water: "#d9e8ed",
    landuse_residential: "#f2efe8",
    landcover_wood: "#e3ebe0",
  };
  Object.entries(fills).forEach(([id, color]) => {
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, id === "background" ? "background-color" : "fill-color", color);
  });
  if (map.getLayer("waterway")) {
    map.setPaintProperty("waterway", "line-color", "#bfd4db");
    map.setPaintProperty("waterway", "line-opacity", 0.72);
  }
  if (map.getLayer("highway_minor")) {
    map.setPaintProperty("highway_minor", "line-color", "#ffffff");
    map.setPaintProperty("highway_minor", "line-opacity", 0.62);
  }
  [
    "highway_major_casing",
    "highway_motorway_casing",
    "highway_motorway_bridge_casing",
  ].forEach((id) => {
    if (map.getLayer(id)) map.setPaintProperty(id, "line-color", "#d8d3c8");
  });
  [
    "highway_major_inner",
    "highway_motorway_inner",
    "highway_motorway_bridge_inner",
  ].forEach((id) => {
    if (map.getLayer(id)) map.setPaintProperty(id, "line-color", "#fffdf8");
  });
  if (map.getLayer("highway-name-major")) {
    map.setPaintProperty("highway-name-major", "text-color", "#74736f");
    map.setPaintProperty("highway-name-major", "text-halo-color", "#f8f6f1");
    map.setPaintProperty("highway-name-major", "text-halo-width", 1.5);
  }

  const highlightedNames = KATHMANDU_PLACES.map((place) => place.name);
  const excludeHighlighted = [
    "!",
    ["in", ["coalesce", ["get", "name_en"], ["get", "name"]], ["literal", highlightedNames]],
  ];
  const localityLayers = [
    {
      id: "label_other",
      minZoom: 13.2,
      filter: [
        "all",
        ["match", ["get", "class"], ["city", "continent", "country", "state", "town", "village"], false, true],
        excludeHighlighted,
      ],
    },
    { id: "label_town", minZoom: 12.4, filter: ["all", ["==", ["get", "class"], "town"], excludeHighlighted] },
    { id: "label_village", minZoom: 13.8, filter: ["all", ["==", ["get", "class"], "village"], excludeHighlighted] },
  ] as const;
  localityLayers.forEach(({ id, minZoom, filter }) => {
    if (!map.getLayer(id)) return;
    map.setFilter(id, filter as unknown as import("maplibre-gl").FilterSpecification);
    map.setLayerZoomRange(id, minZoom, KATHMANDU_MAP_MAX_ZOOM);
    map.setLayoutProperty(id, "visibility", "visible");
    map.setLayoutProperty(id, "icon-image", "");
    map.setLayoutProperty(id, "text-font", ["Noto Sans Regular"]);
    map.setLayoutProperty(id, "text-letter-spacing", 0.01);
    map.setLayoutProperty(id, "text-transform", "none");
    map.setLayoutProperty(id, "text-size", ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 10.5, 19, 11]);
    map.setPaintProperty(id, "text-color", "#777d7a");
    map.setPaintProperty(id, "text-halo-color", "rgba(248, 246, 241, 0.94)");
    map.setPaintProperty(id, "text-halo-width", 1.15);
    map.setPaintProperty(id, "text-halo-blur", 0.4);
  });
}

export interface KathmanduPlace {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export const KATHMANDU_PLACES: KathmanduPlace[] = [
  { name: "Thamel", address: "Thamel, Kathmandu", latitude: 27.7154, longitude: 85.3123 },
  { name: "New Road", address: "New Road, Kathmandu", latitude: 27.7048, longitude: 85.3116 },
  { name: "Ason", address: "Ason, Kathmandu", latitude: 27.7077, longitude: 85.3120 },
  { name: "Durbar Marg", address: "Durbar Marg, Kathmandu", latitude: 27.7120, longitude: 85.3171 },
  { name: "Putalisadak", address: "Putalisadak, Kathmandu", latitude: 27.7051, longitude: 85.3233 },
  { name: "Lazimpat", address: "Lazimpat, Kathmandu", latitude: 27.7214, longitude: 85.3209 },
  { name: "Baluwatar", address: "Baluwatar, Kathmandu", latitude: 27.7248, longitude: 85.3306 },
  { name: "Maharajgunj", address: "Maharajgunj, Kathmandu", latitude: 27.7390, longitude: 85.3300 },
  { name: "Gongabu", address: "Gongabu, Kathmandu", latitude: 27.7355, longitude: 85.3130 },
  { name: "Chabahil", address: "Chabahil, Kathmandu", latitude: 27.7173, longitude: 85.3465 },
  { name: "Boudha", address: "Boudha, Kathmandu", latitude: 27.7215, longitude: 85.3620 },
  { name: "New Baneshwor", address: "New Baneshwor, Kathmandu", latitude: 27.6915, longitude: 85.3420 },
  { name: "Koteshwor", address: "Koteshwor, Kathmandu", latitude: 27.6780, longitude: 85.3496 },
  { name: "Teku", address: "Teku, Kathmandu", latitude: 27.6951, longitude: 85.3042 },
  { name: "Kalimati", address: "Kalimati, Kathmandu", latitude: 27.6991, longitude: 85.2982 },
  { name: "Kalanki", address: "Kalanki, Kathmandu", latitude: 27.6931, longitude: 85.2810 },
  { name: "Swayambhu", address: "Swayambhu, Kathmandu", latitude: 27.7149, longitude: 85.2904 },
  { name: "Kirtipur", address: "Kirtipur, Kathmandu", latitude: 27.6780, longitude: 85.2774 },
];

export function addKathmanduLabelMarkers(
  map: import("maplibre-gl").Map,
  Marker: typeof import("maplibre-gl").Marker,
) {
  const labels = KATHMANDU_PLACES.map((place, index) => {
    const element = document.createElement("span");
    element.className = `kathmandu-map-label${index >= 8 ? " secondary" : ""}`;
    element.textContent = place.name;
    const marker = new Marker({ element, anchor: "center" })
      .setLngLat([place.longitude, place.latitude])
      .addTo(map);
    return { element, marker };
  });
  const updateLabels = () => {
    const zoom = map.getZoom();
    labels.forEach(({ element }, index) => {
      element.style.display = index < 8 || zoom >= 13.4 ? "" : "none";
      element.style.fontSize = `${Math.min(15, 11.5 + Math.max(0, zoom - 11) * 0.55)}px`;
    });
  };
  updateLabels();
  map.on("zoom", updateLabels);
  return () => {
    map.off("zoom", updateLabels);
    labels.forEach(({ marker }) => marker.remove());
  };
}

export function isInsideKathmandu(latitude: number, longitude: number) {
  return latitude >= KATHMANDU_BOUNDS.south
    && latitude <= KATHMANDU_BOUNDS.north
    && longitude >= KATHMANDU_BOUNDS.west
    && longitude <= KATHMANDU_BOUNDS.east;
}

export function nearestKathmanduPlace(latitude: number, longitude: number) {
  return KATHMANDU_PLACES.reduce((nearest, place) => {
    const distance = ((place.latitude - latitude) ** 2) + ((place.longitude - longitude) ** 2);
    return distance < nearest.distance ? { place, distance } : nearest;
  }, { place: KATHMANDU_PLACES[0], distance: Number.POSITIVE_INFINITY }).place;
}

export function pinnedKathmanduLocation(latitude: number, longitude: number): TransactionLocationDraft {
  const nearest = nearestKathmanduPlace(latitude, longitude);
  return {
    label: `Near ${nearest.name}`,
    address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)} · Kathmandu`,
    latitude,
    longitude,
    accuracy: null,
    source: "pin",
    savedPlaceId: null,
  };
}

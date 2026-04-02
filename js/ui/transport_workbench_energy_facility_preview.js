import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";

function getEnergySubtypeFill(subtype) {
  const normalized = String(subtype || "").trim().toLowerCase();
  if (/solar|pv|photovoltaic/.test(normalized)) return "#f59e0b";
  if (/wind/.test(normalized)) return "#0ea5e9";
  if (/hydro|dam/.test(normalized)) return "#2563eb";
  if (/thermal|coal|lng|gas|oil/.test(normalized)) return "#b45309";
  if (/nuclear/.test(normalized)) return "#dc2626";
  if (/biomass|waste/.test(normalized)) return "#16a34a";
  return "#7c3aed";
}

const controller = createTransportWorkbenchPointPreviewController({
  familyId: "energy_facilities",
  manifestUrl: "data/transport_layers/japan_energy_facilities/manifest.json",
  packKey: "energy_facilities",
  selectionType: "energy_facility",
  fullPackScaleThreshold: 1.14,
  getMarkerStyle(_scale, config) {
    const sizeScale = Math.max(0.74, Math.min(1.42, Number(config?.pointSize || 100) / 100));
    return {
      shape: "square",
      radius: 4.1 * sizeScale,
      cornerRadius: 1.2,
      fill: "#b45309",
      stroke: "#fef3c7",
      strokeWidth: 1.0,
      selectedStroke: "#451a03",
      selectedStrokeWidth: 2.1,
      opacity: Math.max(0.3, Math.min(1, Number(config?.pointOpacity || 86) / 100)),
      labelColor: "#78350f",
      labelSize: 10.2,
      labelWeight: 600,
      labelOffsetX: 8,
      labelOffsetY: 1.5,
    };
  },
  getFeatureMarkerStyle(feature, baseStyle) {
    const fill = getEnergySubtypeFill(feature?.properties?.facility_subtype);
    return {
      ...baseStyle,
      fill,
      labelColor: fill,
    };
  },
  getFeatureCategory(feature) {
    return String(feature?.properties?.facility_subtype || "").trim();
  },
  getFeatureCategoryLabel(categoryValue) {
    return String(categoryValue || "").trim() || "能源设施";
  },
  getAggregateMarkerStyle(aggregateEntry, _scale, config, displayMode) {
    const fill = getEnergySubtypeFill(aggregateEntry?.dominantCategory);
    return {
      shape: "circle",
      radius: Math.min(displayMode === "density" ? 17 : 13.5, 5 + Math.sqrt(aggregateEntry.aggregateCount) * (displayMode === "density" ? 1.12 : 0.9)),
      fill,
      stroke: "#fff7ed",
      strokeWidth: displayMode === "density" ? 0.8 : 1.1,
      selectedStroke: "#431407",
      selectedStrokeWidth: 2.2,
      opacity: displayMode === "density"
        ? Math.max(0.16, Math.min(0.46, Number(config?.pointOpacity || 86) / 190 + aggregateEntry.aggregateCount / 240))
        : Math.max(0.42, Math.min(0.9, Number(config?.pointOpacity || 86) / 120 + aggregateEntry.aggregateCount / 130)),
      labelColor: "#78350f",
      labelSize: 10.2,
      labelWeight: 700,
      labelOffsetX: 10,
      labelOffsetY: 2,
    };
  },
  getHiddenReason(feature, config) {
    if (Array.isArray(config?.facilitySubtypes) && config.facilitySubtypes.length > 0) {
      if (!config.facilitySubtypes.includes(String(feature.properties.facility_subtype || "").trim())) return "facility_subtype_filtered";
    }
    if (Array.isArray(config?.statuses) && config.statuses.length > 0) {
      if (!config.statuses.includes(String(feature.properties.status || "").trim())) return "status_filtered";
    }
    return null;
  },
  shouldShowLabel(_feature, config, scale) {
    return !!config?.showLabels && scale >= 1.08;
  },
  shouldUseFullPack() {
    return false;
  },
  sortFeatures(features) {
    return [...features].sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), "ja"));
  },
});

export const clearJapanEnergyFacilityPreview = controller.clear;
export const destroyJapanEnergyFacilityPreview = controller.destroy;
export const getJapanEnergyFacilityPreviewSnapshot = controller.getSnapshot;
export const renderJapanEnergyFacilityPreview = controller.render;
export const setJapanEnergyFacilityPreviewSelectionListener = controller.setSelectionListener;
export const warmJapanEnergyFacilityPreviewPack = controller.warm;

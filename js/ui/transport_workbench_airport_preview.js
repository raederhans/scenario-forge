import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";

const controller = createTransportWorkbenchPointPreviewController({
  familyId: "airport",
  manifestUrl: "data/transport_layers/japan_airport/manifest.json",
  packKey: "airports",
  selectionType: "airport",
  fullPackScaleThreshold: 1.18,
  importanceOrder: {
    local_connector: 1,
    regional_core: 2,
    national_core: 3,
  },
  getMarkerStyle(_scale, config) {
    return {
      shape: "diamond",
      radius: 5.1,
      fill: "#1d4ed8",
      stroke: "#dbeafe",
      strokeWidth: 1.1,
      selectedStroke: "#0f172a",
      selectedStrokeWidth: 2.2,
      opacity: Math.max(0.35, Math.min(1, Number(config?.baseOpacity || 90) / 100)),
      labelColor: "#15315f",
      labelSize: 10.5,
      labelWeight: 600,
      labelOffsetX: 8,
      labelOffsetY: 1.5,
    };
  },
  getHiddenReason(feature, config) {
    if (!Array.isArray(config?.airportTypes) || !config.airportTypes.includes(feature.properties.airport_type)) {
      return "airport_type_filtered";
    }
    if (!Array.isArray(config?.statuses) || !config.statuses.includes(feature.properties.status_category)) {
      return "status_filtered";
    }
    return null;
  },
  shouldShowLabel(feature, config, scale) {
    if (!config?.showLabels) return false;
    if ((feature.importanceRank || 1) >= 3) return scale >= 1.02;
    return scale >= 1.18;
  },
});

export const clearJapanAirportPreview = controller.clear;
export const destroyJapanAirportPreview = controller.destroy;
export const getJapanAirportPreviewSnapshot = controller.getSnapshot;
export const renderJapanAirportPreview = controller.render;
export const setJapanAirportPreviewSelectionListener = controller.setSelectionListener;
export const warmJapanAirportPreviewPack = controller.warm;

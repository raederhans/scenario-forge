import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";

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
  getHiddenReason(feature, config) {
    if (Array.isArray(config?.facilitySubtypes) && config.facilitySubtypes.length > 0) {
      if (!config.facilitySubtypes.includes(String(feature.properties.facility_subtype || "").trim())) {
        return "facility_subtype_filtered";
      }
    }
    if (Array.isArray(config?.statuses) && config.statuses.length > 0) {
      if (!config.statuses.includes(String(feature.properties.status || "").trim())) {
        return "status_filtered";
      }
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

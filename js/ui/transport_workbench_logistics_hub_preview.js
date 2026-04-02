import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";

const controller = createTransportWorkbenchPointPreviewController({
  familyId: "logistics_hubs",
  manifestUrl: "data/transport_layers/japan_logistics_hubs/manifest.json",
  packKey: "logistics_hubs",
  selectionType: "logistics_hub",
  fullPackScaleThreshold: 1.14,
  importanceOrder: {
    regional_core: 2,
  },
  getMarkerStyle(_scale, config) {
    const sizeScale = Math.max(0.72, Math.min(1.48, Number(config?.pointSize || 100) / 100));
    return {
      shape: "square",
      radius: 3.8 * sizeScale,
      cornerRadius: 1.2,
      fill: "#0f766e",
      stroke: "#ccfbf1",
      strokeWidth: 1.0,
      selectedStroke: "#042f2e",
      selectedStrokeWidth: 2.1,
      opacity: Math.max(0.3, Math.min(1, Number(config?.pointOpacity || 78) / 100)),
      labelColor: "#134e4a",
      labelSize: 10.2,
      labelWeight: 600,
      labelOffsetX: 8,
      labelOffsetY: 1.5,
    };
  },
  getHiddenReason(feature, config) {
    if (Array.isArray(config?.hubTypes) && config.hubTypes.length > 0) {
      if (!config.hubTypes.includes(String(feature.properties.hub_type || "").trim())) {
        return "hub_type_filtered";
      }
    }
    if (Array.isArray(config?.operatorClassifications) && config.operatorClassifications.length > 0) {
      if (!config.operatorClassifications.includes(String(feature.properties.operator_classification || "").trim())) {
        return "operator_classification_filtered";
      }
    }
    return null;
  },
  shouldShowLabel(_feature, config, scale) {
    return !!config?.showLabels && scale >= 1.16;
  },
});

export const clearJapanLogisticsHubPreview = controller.clear;
export const destroyJapanLogisticsHubPreview = controller.destroy;
export const getJapanLogisticsHubPreviewSnapshot = controller.getSnapshot;
export const renderJapanLogisticsHubPreview = controller.render;
export const setJapanLogisticsHubPreviewSelectionListener = controller.setSelectionListener;
export const warmJapanLogisticsHubPreviewPack = controller.warm;

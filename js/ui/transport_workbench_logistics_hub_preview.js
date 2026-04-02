import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";

function getLogisticsHubLabel(categoryValue) {
  const normalized = String(categoryValue || "").trim();
  if (normalized === "air_cargo_terminal") return "\u7a7a\u8fd0\u8d27\u7ad9";
  if (normalized === "bonded_area") return "\u4fdd\u7a0e\u533a";
  if (normalized === "container_terminal") return "\u96c6\u88c5\u7bb1\u7801\u5934";
  if (normalized === "rail_cargo_station") return "\u94c1\u8def\u8d27\u7ad9";
  if (normalized === "truck_terminal") return "\u516c\u8def\u8d27\u8fd0\u7ad9";
  if (normalized === "wholesale_market") return "\u6279\u53d1\u5e02\u573a";
  return normalized || "\u7269\u6d41";
}

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
  getFeatureCategory(feature) {
    return String(feature?.properties?.hub_type || "").trim();
  },
  getFeatureCategoryLabel(categoryValue) {
    return getLogisticsHubLabel(categoryValue);
  },
  getAggregateMarkerStyle(aggregateEntry, _scale, config, displayMode) {
    return {
      shape: "circle",
      radius: Math.min(displayMode === "density" ? 18 : 14, 5 + Math.sqrt(aggregateEntry.aggregateCount) * (displayMode === "density" ? 1.2 : 0.96)),
      fill: "#0f766e",
      stroke: "#ccfbf1",
      strokeWidth: displayMode === "density" ? 0.8 : 1.1,
      selectedStroke: "#042f2e",
      selectedStrokeWidth: 2.1,
      opacity: displayMode === "density"
        ? Math.max(0.16, Math.min(0.44, Number(config?.pointOpacity || 78) / 190 + aggregateEntry.aggregateCount / 210))
        : Math.max(0.42, Math.min(0.88, Number(config?.pointOpacity || 78) / 122 + aggregateEntry.aggregateCount / 130)),
      labelColor: "#134e4a",
      labelSize: 10.2,
      labelWeight: 700,
      labelOffsetX: 10,
      labelOffsetY: 2,
    };
  },
  getHiddenReason(feature, config) {
    if (Array.isArray(config?.hubTypes) && config.hubTypes.length > 0) {
      if (!config.hubTypes.includes(String(feature.properties.hub_type || "").trim())) return "hub_type_filtered";
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

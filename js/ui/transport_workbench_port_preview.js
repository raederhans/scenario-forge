import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";

const controller = createTransportWorkbenchPointPreviewController({
  familyId: "port",
  manifestUrl: "data/transport_layers/japan_port/manifest.json",
  packKey: "ports",
  selectionType: "port",
  fullPackScaleThreshold: 1.18,
  importanceOrder: {
    regional_core: 2,
    national_core: 3,
  },
  getMarkerStyle(_scale, config) {
    return {
      shape: "square",
      radius: 4.6,
      cornerRadius: 0.8,
      fill: "#b45309",
      stroke: "#ffedd5",
      strokeWidth: 1.1,
      selectedStroke: "#451a03",
      selectedStrokeWidth: 2.2,
      opacity: Math.max(0.35, Math.min(1, Number(config?.baseOpacity || 90) / 100)),
      labelColor: "#7c2d12",
      labelSize: 10.3,
      labelWeight: 600,
      labelOffsetX: 8,
      labelOffsetY: 1.5,
    };
  },
  getHiddenReason(feature, config) {
    if (!Array.isArray(config?.legalDesignations) || !config.legalDesignations.includes(feature.properties.legal_designation)) {
      return "designation_filtered";
    }
    if (!Array.isArray(config?.managerTypes) || !config.managerTypes.includes(feature.properties.manager_type_code)) {
      return "manager_type_filtered";
    }
    return null;
  },
  shouldShowLabel(feature, config, scale) {
    if (!config?.showLabels) return false;
    if ((feature.importanceRank || 1) >= 3) return scale >= 1.04;
    return scale >= 1.22;
  },
});

export const clearJapanPortPreview = controller.clear;
export const destroyJapanPortPreview = controller.destroy;
export const getJapanPortPreviewSnapshot = controller.getSnapshot;
export const renderJapanPortPreview = controller.render;
export const setJapanPortPreviewSelectionListener = controller.setSelectionListener;
export const warmJapanPortPreviewPack = controller.warm;

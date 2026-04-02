import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";

const controller = createTransportWorkbenchPointPreviewController({
  familyId: "mineral_resources",
  manifestUrl: "data/transport_layers/japan_mineral_resources/manifest.json",
  packKey: "mineral_resources",
  selectionType: "mineral_resource",
  fullPackScaleThreshold: 1.24,
  getMarkerStyle(_scale, config) {
    const sizeScale = Math.max(0.72, Math.min(1.46, Number(config?.pointSize || 92) / 100));
    return {
      shape: "diamond",
      radius: 3.9 * sizeScale,
      fill: "#7c3aed",
      stroke: "#ede9fe",
      strokeWidth: 1.0,
      selectedStroke: "#2e1065",
      selectedStrokeWidth: 2.1,
      opacity: Math.max(0.28, Math.min(1, Number(config?.pointOpacity || 72) / 100)),
      labelColor: "#4c1d95",
      labelSize: 10.1,
      labelWeight: 600,
      labelOffsetX: 8,
      labelOffsetY: 1.5,
    };
  },
  getHiddenReason() {
    return null;
  },
  shouldShowLabel(_feature, config, scale) {
    return !!config?.showLabels && scale >= 1.3;
  },
  shouldUseFullPack() {
    return false;
  },
  sortFeatures(features) {
    return [...features].sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), "ja"));
  },
});

export const clearJapanMineralResourcePreview = controller.clear;
export const destroyJapanMineralResourcePreview = controller.destroy;
export const getJapanMineralResourcePreviewSnapshot = controller.getSnapshot;
export const renderJapanMineralResourcePreview = controller.render;
export const setJapanMineralResourcePreviewSelectionListener = controller.setSelectionListener;
export const warmJapanMineralResourcePreviewPack = controller.warm;

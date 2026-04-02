import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";

function getMineralGroupColor(group) {
  const normalized = String(group || "").trim().toLowerCase();
  if (normalized === "precious_metals") return "#ca8a04";
  if (normalized === "base_metals") return "#2563eb";
  if (normalized === "ferrous_metals") return "#475569";
  if (normalized === "industrial_minerals") return "#0f766e";
  if (normalized === "construction_materials") return "#78716c";
  if (normalized === "fossil_resources") return "#b45309";
  if (normalized === "specialty_minerals") return "#7c3aed";
  return "#7c3aed";
}

function getMineralGroupLabel(group) {
  const normalized = String(group || "").trim().toLowerCase();
  if (normalized === "precious_metals") return "\u8d35\u91d1\u5c5e";
  if (normalized === "base_metals") return "\u57fa\u7840\u91d1\u5c5e";
  if (normalized === "ferrous_metals") return "\u9ed1\u8272\u4e0e\u5408\u91d1\u91d1\u5c5e";
  if (normalized === "industrial_minerals") return "\u5de5\u4e1a\u77ff\u7269";
  if (normalized === "construction_materials") return "\u5efa\u6750\u77ff\u4ea7";
  if (normalized === "fossil_resources") return "\u5316\u77f3\u8d44\u6e90";
  if (normalized === "specialty_minerals") return "\u7279\u79cd\u77ff\u4ea7";
  return "\u7efc\u5408\u77ff\u4ea7";
}

function getMineralGroupKey(feature) {
  return String(
    feature?.properties?.normalized_resource_group
    || feature?.normalized_resource_group
    || feature?.properties?.resource_type
    || ""
  ).trim();
}

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
  getFeatureMarkerStyle(feature, baseStyle) {
    const fill = getMineralGroupColor(getMineralGroupKey(feature));
    return {
      ...baseStyle,
      fill,
      labelColor: fill,
    };
  },
  getFeatureCategory(feature) {
    return getMineralGroupKey(feature);
  },
  getFeatureCategoryLabel(categoryValue) {
    return getMineralGroupLabel(categoryValue);
  },
  getAggregateMarkerStyle(aggregateEntry, _scale, config, displayMode) {
    const fill = getMineralGroupColor(aggregateEntry?.dominantCategory);
    return {
      shape: "circle",
      radius: Math.min(displayMode === "density" ? 18 : 14, 5 + Math.sqrt(aggregateEntry.aggregateCount) * (displayMode === "density" ? 1.18 : 0.94)),
      fill,
      stroke: "#f5f3ff",
      strokeWidth: displayMode === "density" ? 0.8 : 1.1,
      selectedStroke: "#1e1b4b",
      selectedStrokeWidth: 2.2,
      opacity: displayMode === "density"
        ? Math.max(0.18, Math.min(0.48, Number(config?.pointOpacity || 72) / 180 + aggregateEntry.aggregateCount / 220))
        : Math.max(0.44, Math.min(0.9, Number(config?.pointOpacity || 72) / 120 + aggregateEntry.aggregateCount / 120)),
      labelColor: "#312e81",
      labelSize: 10.2,
      labelWeight: 700,
      labelOffsetX: 10,
      labelOffsetY: 2,
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

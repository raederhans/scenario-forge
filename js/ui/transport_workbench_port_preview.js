import { createTransportWorkbenchPointPreviewController } from "./transport_workbench_point_preview_shared.js";
import {
  getTransportWorkbenchManifestVariantMeta,
  resolveTransportWorkbenchManifestVariantId,
} from "./transport_workbench_manifest_variants.js";

function resolveCoverageVariantId(config, manifest) {
  return resolveTransportWorkbenchManifestVariantId(manifest, config?.coverageTier, "port");
}

function getCoverageVariantMeta(manifest, variantId) {
  if (!variantId) return null;
  return getTransportWorkbenchManifestVariantMeta(manifest, variantId, "port");
}

const controller = createTransportWorkbenchPointPreviewController({
  familyId: "port",
  manifestUrl: "data/transport_layers/japan_port/manifest.json",
  packKey: "ports",
  selectionType: "port",
  fullPackScaleThreshold: 1.18,
  importanceOrder: {
    local_connector: 1,
    regional_core: 2,
    national_core: 3,
  },
  shouldUseFullPack(_config, scale) {
    return scale >= 1.18;
  },
  resolveVariantId: resolveCoverageVariantId,
  getVariantMeta: getCoverageVariantMeta,
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
  getFeatureCategory(feature) {
    return String(feature?.properties?.legal_designation || "").trim();
  },
  getFeatureCategoryLabel(categoryValue) {
    const normalized = String(categoryValue || "").trim();
    if (normalized === "international_strategy") return "\u56fd\u9645\u6218\u7565\u6e2f\u53e3";
    if (normalized === "international_hub") return "\u56fd\u9645\u67a2\u7ebd\u6e2f\u53e3";
    if (normalized === "important") return "\u91cd\u8981\u6e2f\u53e3";
    if (normalized === "local") return "\u5730\u65b9\u6e2f\u53e3";
    if (normalized === "shelter") return "\u907f\u96be / \u7279\u6b8a\u7528\u9014\u6e2f\u53e3";
    return normalized || "\u6e2f\u53e3";
  },
  getAggregateMarkerStyle(aggregateEntry, _scale, config, displayMode) {
    return {
      shape: "circle",
      radius: Math.min(displayMode === "density" ? 18 : 14, 5 + Math.sqrt(aggregateEntry.aggregateCount) * (displayMode === "density" ? 1.16 : 0.94)),
      fill: "#b45309",
      stroke: "#ffedd5",
      strokeWidth: displayMode === "density" ? 0.8 : 1.1,
      selectedStroke: "#451a03",
      selectedStrokeWidth: 2.2,
      opacity: displayMode === "density"
        ? Math.max(0.16, Math.min(0.42, Number(config?.baseOpacity || 90) / 210 + aggregateEntry.aggregateCount / 240))
        : Math.max(0.42, Math.min(0.9, Number(config?.baseOpacity || 90) / 125 + aggregateEntry.aggregateCount / 125)),
      labelColor: "#7c2d12",
      labelSize: 10.3,
      labelWeight: 700,
      labelOffsetX: 10,
      labelOffsetY: 2,
    };
  },
  getHiddenReason(feature, config) {
    if (!Array.isArray(config?.legalDesignations) || !config.legalDesignations.includes(feature.properties.legal_designation)) return "designation_filtered";
    if (!Array.isArray(config?.managerTypes) || !config.managerTypes.includes(feature.properties.manager_type_code)) return "manager_type_filtered";
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

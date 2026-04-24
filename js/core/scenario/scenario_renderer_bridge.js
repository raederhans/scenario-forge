// Internal scenario/startup bridge for renderer-facing transactions.
// Scenario and bootstrap modules should prefer this bridge so their imports stay
// focused on scenario refresh steps, while map_renderer.js keeps the stable
// public facade for app-level UI, tools, and compatibility exports.
import {
  refreshMapDataForScenarioApply as runRendererScenarioApplyRefresh,
  refreshMapDataForScenarioChunkPromotion as runRendererScenarioChunkPromotionRefresh,
} from "../map_renderer.js";

export {
  invalidateContextLayerVisualStateBatch,
  invalidateOceanBackgroundVisualState,
  invalidateOceanWaterInteractionVisualState,
  recomputeDynamicBordersNow,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  refreshScenarioOpeningOwnerBorders,
  setMapData,
} from "../map_renderer.js";

function normalizeLayerKeyList(layerKeys = []) {
  return Array.from(
    new Set(
      (Array.isArray(layerKeys) ? layerKeys : [])
        .map((layerKey) => String(layerKey || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function normalizeStringList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function createRendererRefreshPlan({
  source,
  targetPasses = [],
  refreshOpeningOwnerBorders = true,
  resetWaterCacheReason = "",
} = {}) {
  return {
    kind: "RendererRefreshPlan",
    source: String(source || "scenario-refresh"),
    targetPasses: normalizeStringList(targetPasses),
    refreshOpeningOwnerBorders: refreshOpeningOwnerBorders !== false,
    resetWaterCacheReason: String(resetWaterCacheReason || ""),
  };
}

function createScenarioRefreshPlan({
  source,
  changedLayerKeys = [],
  renderer = {},
} = {}) {
  return {
    kind: "ScenarioRefreshPlan",
    source: String(source || "scenario-refresh"),
    changedLayerKeys: normalizeLayerKeyList(changedLayerKeys),
    renderer: createRendererRefreshPlan({
      source,
      ...renderer,
    }),
  };
}

function createScenarioApplyRefreshPlan({
  refreshOpeningOwnerBorders = true,
} = {}) {
  return createScenarioRefreshPlan({
    source: "scenario-apply",
    renderer: {
      targetPasses: [
        "background",
        "physicalBase",
        "political",
        "contextBase",
        "contextScenario",
        "dayNight",
        "borders",
        "labels",
      ],
      refreshOpeningOwnerBorders,
      resetWaterCacheReason: "scenario-switch-complete",
    },
  });
}

function createScenarioChunkPromotionRefreshPlan({
  changedLayerKeys = [],
  hasPoliticalChange = false,
} = {}) {
  const normalizedChangedLayerKeys = normalizeLayerKeyList(changedLayerKeys);
  return createScenarioRefreshPlan({
    source: "scenario-chunk-promotion",
    changedLayerKeys: normalizedChangedLayerKeys,
    renderer: {
      targetPasses: [],
      refreshOpeningOwnerBorders: !!hasPoliticalChange,
    },
  });
}

function createStartupHydrationRefreshPlan({
  changedLayerKeys = [],
  hasPoliticalChange = true,
} = {}) {
  return createScenarioRefreshPlan({
    source: "startup-hydration",
    changedLayerKeys,
    renderer: {
      targetPasses: [],
      refreshOpeningOwnerBorders: !!hasPoliticalChange,
    },
  });
}

function getRendererRefreshPlan(refreshPlan) {
  if (!refreshPlan || typeof refreshPlan !== "object") return null;
  if (refreshPlan.kind === "RendererRefreshPlan") return refreshPlan;
  if (refreshPlan.renderer && typeof refreshPlan.renderer === "object") {
    return refreshPlan.renderer;
  }
  return null;
}

function refreshMapDataForScenarioApply(options = {}) {
  const refreshPlan = options.refreshPlan || createScenarioApplyRefreshPlan();
  return runRendererScenarioApplyRefresh({
    ...options,
    refreshPlan: getRendererRefreshPlan(refreshPlan),
  });
}

function refreshMapDataForScenarioChunkPromotion(options = {}) {
  const hasPoliticalChange = !!options.hasPoliticalPayloadChange
    || (Array.isArray(options.politicalFeatureIds) && options.politicalFeatureIds.length > 0);
  const refreshPlan = options.refreshPlan || createScenarioChunkPromotionRefreshPlan({
    changedLayerKeys: options.changedLayerKeys,
    hasPoliticalChange,
  });
  return runRendererScenarioChunkPromotionRefresh({
    ...options,
    refreshPlan: getRendererRefreshPlan(refreshPlan),
  });
}

export {
  createScenarioApplyRefreshPlan,
  createScenarioChunkPromotionRefreshPlan,
  createStartupHydrationRefreshPlan,
  refreshMapDataForScenarioApply,
  refreshMapDataForScenarioChunkPromotion,
};

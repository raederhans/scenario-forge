// Internal scenario/startup bridge for renderer-facing transactions.
// Scenario and bootstrap modules should prefer this bridge so their imports stay
// focused on scenario refresh steps, while map_renderer.js keeps the stable
// public facade for app-level UI, tools, and compatibility exports.
import {
  refreshMapDataForScenarioApply as runRendererScenarioApplyRefresh,
  refreshMapDataForScenarioChunkPromotion as runRendererScenarioChunkPromotionRefresh,
} from "../map_renderer.js";
import {
  createScenarioApplyRefreshPlan,
  createScenarioChunkPromotionRefreshPlan,
  createStartupHydrationRefreshPlan,
  getRendererRefreshPlan,
} from "../map_renderer/scenario_refresh_plans.js";

export {
  captureScenarioRefreshState,
  invalidateContextLayerVisualStateBatch,
  invalidateOceanBackgroundVisualState,
  invalidateOceanWaterInteractionVisualState,
  recomputeDynamicBordersNow,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  refreshScenarioOpeningOwnerBorders,
  setMapData,
} from "../map_renderer.js";

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
    firstFrameOnly: !!options.firstFrameOnly,
    hgoPreviewDirty: !!options.hgoPreviewDirty,
  });
  return runRendererScenarioChunkPromotionRefresh({
    ...options,
    changedLayerKeys: options.changedLayerKeys ?? refreshPlan.changedLayerKeys,
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

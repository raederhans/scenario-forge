// Internal scenario/startup bridge for renderer-facing transactions.
// Scenario and bootstrap modules should prefer this bridge so their imports stay
// focused on scenario refresh steps, while map_renderer.js keeps the stable
// public facade for app-level UI, tools, and compatibility exports.
export {
  invalidateContextLayerVisualStateBatch,
  invalidateOceanBackgroundVisualState,
  invalidateOceanWaterInteractionVisualState,
  recomputeDynamicBordersNow,
  refreshColorState,
  refreshMapDataForScenarioApply,
  refreshMapDataForScenarioChunkPromotion,
  refreshResolvedColorsForFeatures,
  refreshScenarioOpeningOwnerBorders,
  setMapData,
} from "../map_renderer.js";

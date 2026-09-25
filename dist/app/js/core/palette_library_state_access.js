import {
  getFeatureIdsForOwnerColorRefresh,
  resolvePaletteLibraryApplyTarget,
} from "./palette_library_queries.js";
import {
  applyPaletteFeatureColorState,
  applyPaletteOwnerColorState,
} from "./state/actions/palette_library_actions.js";

// Bind the live application state once; operations receive only these capabilities.
// Read indexes at call time because scenario activation and import replace them.
export function createPaletteLibraryStateAccess(state) {
  function getApplyTarget() {
    return resolvePaletteLibraryApplyTarget({
      devSelectedHit: state.devSelectedHit,
      hoveredId: state.hoveredId,
      selectedInspectorCountryCode: state.selectedInspectorCountryCode,
      landIndex: state.landIndex,
    });
  }

  function getOwnerFeatureIds(ownerCode) {
    // The old query name is a bridge; only reference inputs enter this scope.
    return getFeatureIdsForOwnerColorRefresh({
      sovereigntyByFeatureId: state.activeScenarioId ? state.scenarioBaselineOwnersByFeatureId : null,
      ownerToFeatureIds: null,
      countryToFeatureIds: state.activeScenarioId && state.mapSemanticMode !== "blank" ? null : state.countryToFeatureIds,
      landIndex: state.landIndex,
    }, ownerCode);
  }

  function applyFeatureColor(featureIds, color) {
    applyPaletteFeatureColorState(state, featureIds, color);
  }

  function applyOwnerColor(ownerCode, color) {
    applyPaletteOwnerColorState(state, ownerCode, color);
  }

  return Object.freeze({ getApplyTarget, getOwnerFeatureIds, applyFeatureColor, applyOwnerColor });
}

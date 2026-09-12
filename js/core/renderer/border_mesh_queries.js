export function getBorderCountryAssignmentRevision(state) {
  return [state.activeScenarioId, state.topologyRevision, state.sovereigntyRevision,
    state.scenarioShellOverlayRevision, state.mapSemanticMode].join("|");
}

export function isAtlantropaCoastlineLandVisible(state) {
  return !!state.showWaterRegions && state.showScenarioAtlantropa !== false
    && (state.scenarioAtlantropaData?.features || []).some(
      (feature) => feature?.properties?.atl_render_layer === "land"
    );
}

export function getBorderWorkerIdentity(state) {
  return [state.activeScenarioId, state.scenarioApplyEpoch, state.sceneGeneration,
    state.scenarioDataGeneration, state.topologyRevision, state.sovereigntyRevision,
    state.scenarioShellOverlayRevision, state.mapSemanticMode,
    state.showScenarioAtlantropa].join("|");
}

export function getDefaultBorderWorkerSources(state) {
  return [
    { key: "detail", topology: state.topologyDetail },
    { key: "primary", topology: state.topologyPrimary || state.topology },
  ];
}

export function hasCachedProvinceBorders(state, country) {
  return state.cachedProvinceBordersByCountry?.has(country);
}

export function hasCachedLocalBorders(state, country) {
  return state.cachedLocalBordersByCountry?.has(country);
}

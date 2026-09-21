// Capture references/revisions, not geometry copies. Only the explicit deferred
// detail transaction may use this scope. Ordinary scenario applies stay full.
const equal = (a, b) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
export function captureScenarioRefreshState(state, projectionIdentity = 0) {
  const composite = state.topologyBundleMode === "composite";
  const primary = state.topologyPrimary || state.topology;
  const runtime = composite ? (state.scenarioRuntimeTopologyData || state.runtimePoliticalTopology) : null;
  const usesRuntime = !!runtime?.objects?.political;
  return Object.freeze({
    scene: Object.freeze([String(state.activeScenarioId || ""), state.sceneGeneration, state.currentScenarioApplyRequestId, state.renderTransactionDiagnostics?.scenarioApplyEpoch]),
    projection: Object.freeze([projectionIdentity, state.width, state.height]),
    ready: !!state.firstVisibleFramePainted && !!state.landDataFull && state.landIndex instanceof Map,
    // This mirrors rebuildPoliticalLandCollections: when runtime political
    // authority exists, loading the default detail topology does not replace it.
    political: Object.freeze([
      usesRuntime ? runtime : primary,
      usesRuntime ? null : (composite ? state.topologyDetail : null),
      usesRuntime ? null : (composite ? state.ruCityOverrides : null),
      state.scenarioPoliticalChunkData, state.scenarioPoliticalVisibleChunkData,
      state.runtimePoliticalMetaSeed, state.mapSemanticMode, state.sovereigntyRevision,
      state.topologyRevision, state.landDataFull, state.landIndex,
      state.scenarioShellOverlayRevision, state.showScenarioAtlantropa,
      state.scenarioAtlantropaData, state.scenarioStrategicValuesRevision, state.strategicChoroplethMetric,
    ]),
    context: Object.freeze([primary, state.topologyDetail, state.topologyBundleMode, state.contextLayerRevision]),
    borders: Object.freeze([primary, state.topologyDetail, state.runtimePoliticalTopology, state.topologyBundleMode]),
    water: Object.freeze([state.waterRegionsData, state.scenarioWaterRegionsData, state.showScenarioAtlantropa, state.scenarioAtlantropaData]),
    special: Object.freeze([state.specialZonesData, state.scenarioSpecialRegionsData]),
    colorRevision: state.colorRevision,
  });
}
export function isScenarioRefreshSceneCurrent(previous, current) {
  return !!previous?.scene && !!current?.scene && equal(previous.scene, current.scene);
}
export function resolveScenarioRefreshScope(previous, current) {
  if (!previous || !current || !isScenarioRefreshSceneCurrent(previous, current)
    || !previous.scene[0] || !previous.ready || !current.ready
    || !equal(previous.projection, current.projection)) {
    return { mode: "full", reason: "missing-or-changed-scene-projection" };
  }
  const politicalChanged = !equal(previous.political, current.political);
  const contextChanged = !equal(previous.context, current.context);
  const bordersChanged = !equal(previous.borders, current.borders);
  const waterChanged = !equal(previous.water, current.water);
  const specialChanged = !equal(previous.special, current.special);
  const styleChanged = previous.colorRevision !== current.colorRevision;
  return { mode: politicalChanged ? "geometry" : contextChanged || bordersChanged || waterChanged || specialChanged
    ? "background" : styleChanged ? "style" : "none",
    reason: "same-scene-deferred-detail", politicalChanged, contextChanged, bordersChanged,
    waterChanged, specialChanged, styleChanged };
}

// Scenario runtime state defaults.
// 这个文件只负责场景运行时默认 shape，保持 state.js 继续做公开 facade。
// 这里收口的是容易在 scenario/chunk/reset/rollback 多条路径里漂移的默认对象。

export function createDefaultActiveScenarioChunksState(scenarioId = "") {
  return {
    scenarioId: String(scenarioId || "").trim(),
    loadedChunkIds: [],
    payloadByChunkId: {},
    mergedLayerPayloads: {},
    lruChunkIds: [],
  };
}

export function createDefaultRuntimeChunkLoadState({ scenarioId = "" } = {}) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  const ready = !!normalizedScenarioId;
  return {
    shellStatus: ready ? "ready" : "idle",
    registryStatus: ready ? "ready" : "idle",
    refreshScheduled: false,
    refreshTimerId: null,
    selectionVersion: 0,
    pendingReason: "",
    pendingDelayMs: null,
    focusCountryOverride: "",
    zoomEndChunkVisibleMetric: null,
    lastZoomEndToChunkVisibleMetric: null,
    pendingVisualPromotion: null,
    pendingInfraPromotion: null,
    pendingPromotion: null,
    promotionTimerId: null,
    promotionScheduled: false,
    promotionRetryCount: 0,
    lastPromotionRetryAt: 0,
    inFlightByChunkId: {},
    errorByChunkId: {},
    lastSelection: null,
    layerSelectionSignatures: {},
    mergedLayerPayloadCache: {},
  };
}

export function createDefaultScenarioDataHealth(minRatio = 0.7) {
  return {
    expectedFeatureCount: 0,
    runtimeFeatureCount: 0,
    ratio: 1,
    minRatio: Number(minRatio) || 0.7,
    warning: "",
    severity: "",
  };
}

export function createDefaultScenarioHydrationHealthGate() {
  return {
    status: "idle",
    reason: "",
    checkedAt: 0,
    attemptedRetry: false,
    ownerFeatureOverlapRatio: 1,
    ownerFeatureOverlapCount: 0,
    ownerFeatureRenderedCount: 0,
    degradedWaterOverlay: false,
  };
}

export function createDefaultScenarioRuntimeState({
  scenarioId = "",
  detailMinRatio = 0.7,
} = {}) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  return {
    scenarioRegistry: null,
    scenarioBundleCacheById: {},
    activeScenarioChunks: createDefaultActiveScenarioChunksState(normalizedScenarioId),
    runtimeChunkLoadState: createDefaultRuntimeChunkLoadState({ scenarioId: normalizedScenarioId }),
    activeScenarioId: normalizedScenarioId,
    scenarioBorderMode: "canonical",
    scenarioViewMode: "ownership",
    activeScenarioManifest: null,
    scenarioCountriesByTag: {},
    scenarioFixedOwnerColors: {},
    scenarioBaselineHash: "",
    scenarioBaselineOwnersByFeatureId: {},
    scenarioControllersByFeatureId: {},
    scenarioAutoShellOwnerByFeatureId: {},
    scenarioAutoShellControllerByFeatureId: {},
    scenarioShellOverlayRevision: 0,
    scenarioBaselineControllersByFeatureId: {},
    scenarioBaselineCoresByFeatureId: {},
    scenarioControllerRevision: 0,
    scenarioReliefOverlayRevision: 0,
    scenarioOwnerControllerDiffCount: 0,
    scenarioParentBorderEnabledBeforeActivate: null,
    scenarioPaintModeBeforeActivate: null,
    scenarioOceanFillBeforeActivate: null,
    scenarioDisplaySettingsBeforeActivate: null,
    activeScenarioPerformanceHints: null,
    activeScenarioMeshPack: null,
    scenarioWaterRegionsData: null,
    scenarioWaterOverlayVersionTag: "",
    scenarioSpecialRegionsData: null,
    scenarioRuntimeTopologyData: null,
    scenarioRuntimeTopologyVersionTag: "",
    scenarioPoliticalChunkData: null,
    scenarioLandMaskData: null,
    scenarioContextLandMaskData: null,
    scenarioLandMaskVersionTag: "",
    scenarioContextLandMaskVersionTag: "",
    scenarioReliefOverlaysData: null,
    scenarioBathymetryTopologyData: null,
    scenarioBathymetryBandsData: null,
    scenarioBathymetryContoursData: null,
    scenarioBathymetryTopologyUrl: "",
    scenarioDistrictGroupsData: null,
    scenarioDistrictGroupByFeatureId: new Map(),
    scenarioDistrictSharedTemplatesData: null,
    scenarioGeoLocalePatchData: null,
    scenarioCityOverridesData: null,
    scenarioImportAudit: null,
    scenarioDataHealth: createDefaultScenarioDataHealth(detailMinRatio),
    scenarioHydrationHealthGate: createDefaultScenarioHydrationHealthGate(),
  };
}

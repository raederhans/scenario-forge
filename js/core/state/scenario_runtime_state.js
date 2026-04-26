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
    zoomEndProtectedChunkIds: [],
    zoomEndProtectedUntil: 0,
    zoomEndProtectedSelectionVersion: 0,
    zoomEndProtectedScenarioId: "",
    zoomEndProtectedFocusCountry: "",
    pendingVisualPromotion: null,
    pendingInfraPromotion: null,
    pendingPromotion: null,
    promotionTimerId: null,
    promotionScheduled: false,
    promotionCommitInFlight: false,
    promotionCommitRunId: 0,
    promotionCommitStatus: "idle",
    promotionCommitScenarioId: "",
    promotionCommitSelectionVersion: 0,
    promotionCommitReason: "",
    promotionCommitStartedAt: 0,
    promotionCommitFinishedAt: 0,
    promotionCommitError: "",
    pendingPostCommitRefresh: null,
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

export function setHydratedScenarioRuntimeTopologyState(
  target,
  {
    runtimeTopologyData = null,
    runtimePoliticalTopology = null,
    runtimePoliticalMetaSeed = null,
    runtimePoliticalFeatureCollectionSeed = null,
    scenarioLandMaskData = null,
    scenarioContextLandMaskData = null,
    scenarioWaterRegionsData = null,
    scenarioRuntimeTopologyVersionTag = "",
    scenarioWaterOverlayVersionTag = "",
    scenarioLandMaskVersionTag = "",
    scenarioContextLandMaskVersionTag = "",
    scenarioSpecialRegionsData = null,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.scenarioRuntimeTopologyData = runtimeTopologyData || null;
  target.runtimePoliticalTopology = runtimePoliticalTopology || null;
  target.runtimePoliticalMetaSeed = runtimePoliticalMetaSeed || null;
  target.runtimePoliticalFeatureCollectionSeed = runtimePoliticalFeatureCollectionSeed || null;
  target.scenarioLandMaskData = scenarioLandMaskData || null;
  target.scenarioContextLandMaskData = scenarioContextLandMaskData || null;
  target.scenarioWaterRegionsData = scenarioWaterRegionsData || null;
  target.scenarioRuntimeTopologyVersionTag = String(scenarioRuntimeTopologyVersionTag || "");
  target.scenarioWaterOverlayVersionTag = String(scenarioWaterOverlayVersionTag || "");
  target.scenarioLandMaskVersionTag = String(scenarioLandMaskVersionTag || "");
  target.scenarioContextLandMaskVersionTag = String(scenarioContextLandMaskVersionTag || "");
  target.scenarioSpecialRegionsData = scenarioSpecialRegionsData || null;
  return target.scenarioRuntimeTopologyData;
}

export function setScenarioRuntimeOptionalLayerState(target, nextState = {}) {
  if (!target || typeof target !== "object") {
    return null;
  }
  const hasOwn = Object.prototype.hasOwnProperty;
  if (hasOwn.call(nextState, "activeScenarioMeshPack")) {
    target.activeScenarioMeshPack = nextState.activeScenarioMeshPack || null;
  }
  if (hasOwn.call(nextState, "scenarioPoliticalChunkData")) {
    target.scenarioPoliticalChunkData = nextState.scenarioPoliticalChunkData || null;
  }
  if (hasOwn.call(nextState, "scenarioDistrictGroupsData")) {
    target.scenarioDistrictGroupsData = nextState.scenarioDistrictGroupsData || null;
  }
  if (hasOwn.call(nextState, "scenarioDistrictGroupByFeatureId")) {
    target.scenarioDistrictGroupByFeatureId =
      nextState.scenarioDistrictGroupByFeatureId instanceof Map
        ? nextState.scenarioDistrictGroupByFeatureId
        : new Map();
  }
  if (hasOwn.call(nextState, "scenarioReliefOverlaysData")) {
    target.scenarioReliefOverlaysData = nextState.scenarioReliefOverlaysData || null;
  }
  return target;
}

export function setScenarioHydrationHealthGateState(target, nextState = {}) {
  if (!target || typeof target !== "object") {
    return createDefaultScenarioHydrationHealthGate();
  }
  const gateState = {
    ...createDefaultScenarioHydrationHealthGate(),
    ...(
      nextState && typeof nextState === "object"
        ? nextState
        : {}
    ),
  };
  gateState.status = String(gateState.status || "idle");
  gateState.reason = String(gateState.reason || "");
  gateState.checkedAt = Number(gateState.checkedAt) || Date.now();
  gateState.attemptedRetry = !!gateState.attemptedRetry;
  gateState.ownerFeatureOverlapRatio = Number(gateState.ownerFeatureOverlapRatio);
  gateState.ownerFeatureOverlapRatio = Number.isFinite(gateState.ownerFeatureOverlapRatio)
    ? gateState.ownerFeatureOverlapRatio
    : 1;
  gateState.ownerFeatureOverlapCount = Number(gateState.ownerFeatureOverlapCount);
  gateState.ownerFeatureOverlapCount = Number.isFinite(gateState.ownerFeatureOverlapCount)
    ? gateState.ownerFeatureOverlapCount
    : 0;
  gateState.ownerFeatureRenderedCount = Number(gateState.ownerFeatureRenderedCount);
  gateState.ownerFeatureRenderedCount = Number.isFinite(gateState.ownerFeatureRenderedCount)
    ? gateState.ownerFeatureRenderedCount
    : 0;
  gateState.degradedWaterOverlay = !!gateState.degradedWaterOverlay;
  target.scenarioHydrationHealthGate = gateState;
  return target.scenarioHydrationHealthGate;
}

export function resetScenarioHydrationOverlayState(target) {
  if (!target || typeof target !== "object") {
    return false;
  }
  const hadScenarioOverlay =
    !!target.scenarioWaterRegionsData
    || !!target.scenarioLandMaskData
    || !!target.scenarioContextLandMaskData;
  target.scenarioWaterRegionsData = null;
  target.scenarioWaterOverlayVersionTag = "";
  target.scenarioLandMaskData = null;
  target.scenarioContextLandMaskData = null;
  target.scenarioLandMaskVersionTag = "";
  target.scenarioContextLandMaskVersionTag = "";
  return hadScenarioOverlay;
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

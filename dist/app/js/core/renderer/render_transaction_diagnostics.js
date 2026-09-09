import {
  ensureRenderTransactionDiagnosticsState as ensureTransactionDiagnosticsState,
  advanceScenarioApplyEpochState,
} from "../state/actions/renderer_transaction_diagnostics_actions.js";

const GLOBAL_RENDER_TRANSACTION_DIAGNOSTICS_NAME = "__scenarioForgeRenderTransactions";
const DEFAULT_SNAPSHOT_LIMIT = 1;
const ENABLED_SNAPSHOT_LIMIT = 200;
const WARNING_LIMIT = 200;

const TRUE_PARAM_VALUES = new Set(["1", "true", "yes", "on"]);

export const RENDER_TRANSACTION_WARNING_CODES = Object.freeze({
  scenarioApplyInflightTargetMismatch: "scenario-apply-inflight-target-mismatch",
  renderSnapshotScenarioMismatch: "render-snapshot-scenario-mismatch",
  visibleRequiredLayerMissing: "visible-required-layer-missing",
  resolvedColorsEmptyWithLand: "resolved-colors-empty-with-land",
  politicalVisibleSubsetEmptyWithRequiredChunks: "political-visible-subset-empty-with-required-chunks",
  renderReuseAcrossDataGeneration: "render-reuse-across-data-generation",
  pendingColorEditClearedWithoutRender: "pending-color-edit-cleared-without-render",
});

const FALLBACK_LAYER_CONFIGS = Object.freeze({
  water: Object.freeze({
    stateField: "scenarioWaterRegionsData",
    visibilityField: "showWaterRegions",
  }),
  scenario_atlantropa: Object.freeze({
    stateField: "scenarioAtlantropaData",
    visibilityField: "showScenarioAtlantropa",
    revisionField: "scenarioAtlantropaRevision",
  }),
  special: Object.freeze({
    stateField: "scenarioSpecialRegionsData",
    visibilityField: "showScenarioSpecialRegions",
  }),
  specialzonelayers: Object.freeze({
    stateField: "specialZoneLayers",
    visibilityField: "showSpecialZones",
  }),
  relief: Object.freeze({
    stateField: "scenarioReliefOverlaysData",
    visibilityField: "showScenarioReliefOverlays",
    revisionField: "scenarioReliefOverlayRevision",
  }),
  cities: Object.freeze({
    stateField: "scenarioCityOverridesData",
    visibilityField: "showCityPoints",
    revisionField: "cityLayerRevision",
  }),
  strategicvalues: Object.freeze({
    stateField: "scenarioStrategicValuesData",
    visibilityField: "showStrategicResourceMarkers",
    revisionField: "scenarioStrategicValuesRevision",
  }),
});

const STABLE_RENDER_TRANSACTION_PHASES = new Set([
  "scenario-post-apply-complete",
  "scenario-chunk-promotion-visual-complete",
  "visible-frame-committed",
  "visible-frame-reused",
  "exact-after-settle-complete",
  "exact-after-settle-focused-refresh-complete",
  "pending-political-color-edit-cleared",
]);

const TRANSIENT_RENDER_TRANSACTION_PHASES = new Set([
  "render-pass-invalidated",
  "scenario-chunk-selection-created",
  "scenario-chunk-refresh-requested",
  "scenario-chunk-refresh-deferred",
  "scenario-detail-prewarm-scheduled",
  "scenario-detail-prewarm-complete",
  "scenario-chunk-promotion-pending-created",
  "scenario-chunk-promotion-commit-scheduled",
  "scenario-chunk-promotion-commit-start",
  "scenario-chunk-promotion-infra-complete",
  "scenario-chunk-promotion-visual-start",
  "scenario-apply-committed",
  "scenario-apply-target-committed",
  "scenario-post-apply-start",
  "scenario-refresh-map-data-start",
]);

const PENDING_COLOR_EDIT_LIFECYCLE_RESET_REASONS = new Set([
  "init-map",
  "set-map-data",
  "stale-scenario-color-rebuild",
]);

function nowMs() {
  return Date.now();
}

function normalizeId(value) {
  return String(value || "").trim();
}

export function classifyRenderTransactionPhaseKind(phase = "") {
  const normalizedPhase = normalizeId(phase);
  if (STABLE_RENDER_TRANSACTION_PHASES.has(normalizedPhase)) return "stable";
  if (TRANSIENT_RENDER_TRANSACTION_PHASES.has(normalizedPhase)) return "transient";
  if (normalizedPhase.startsWith("scenario-apply-prepare")
    || normalizedPhase.startsWith("scenario-apply-precommit")
    || normalizedPhase.startsWith("scenario-apply-runtime-commit")
    || normalizedPhase.startsWith("scenario-apply-postcommit")
    || normalizedPhase.startsWith("scenario-apply-staged")
    || normalizedPhase.startsWith("scenario-apply-bundle")
    || normalizedPhase.startsWith("scenario-apply-pipeline")
  ) {
    return "transient";
  }
  return "unknown";
}

function toBooleanParam(value) {
  return TRUE_PARAM_VALUES.has(String(value || "").trim().toLowerCase());
}

function readSearchParam(searchParams, key) {
  if (!searchParams || typeof searchParams.get !== "function") return "";
  return String(searchParams.get(key) || "");
}

function getObjectSize(value) {
  if (!value) return 0;
  if (value instanceof Map || value instanceof Set) return value.size;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  return 0;
}

function getFeatureCount(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (value instanceof Map || value instanceof Set) return value.size;
  if (Array.isArray(value.features)) return value.features.length;
  if (Array.isArray(value.geometries)) return value.geometries.length;
  if (Array.isArray(value.items)) return value.items.length;
  if (value.by_feature && typeof value.by_feature === "object") return Object.keys(value.by_feature).length;
  if (value.byFeature && typeof value.byFeature === "object") return Object.keys(value.byFeature).length;
  if (value.objects && typeof value.objects === "object") {
    return Object.values(value.objects).reduce((sum, entry) => {
      if (Array.isArray(entry?.geometries)) return sum + entry.geometries.length;
      if (Array.isArray(entry?.features)) return sum + entry.features.length;
      return sum;
    }, 0);
  }
  return 0;
}

function copyStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeId(entry)).filter(Boolean);
}

function getPayloadState(value) {
  if (value === undefined) return "not-owned";
  if (value === null) return "empty";
  if (getFeatureCount(value) > 0 || getObjectSize(value) > 0) return "present";
  if (typeof value === "object") return "empty";
  return "unknown";
}

function hasOwnValue(owner, fieldName) {
  return !!fieldName
    && !!owner
    && typeof owner === "object"
    && Object.prototype.hasOwnProperty.call(owner, fieldName);
}

function getLayerConfigs(runtimeState) {
  const registered = runtimeState?.renderTransactionDiagnostics?.optionalLayerConfigs;
  return registered && typeof registered === "object" ? registered : FALLBACK_LAYER_CONFIGS;
}

function getSearchParamsFromGlobal() {
  try {
    const search = globalThis.location?.search || "";
    return search ? new URLSearchParams(search) : null;
  } catch {
    return null;
  }
}

export function ensureRenderTransactionDiagnosticsState(runtimeState) {
  const state = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  ensureTransactionDiagnosticsState(state);
  const diagnostics = state.renderTransactionDiagnostics;
  return diagnostics;
}

export function registerRenderTransactionOptionalLayerConfigs(runtimeState, layerConfigs = {}) {
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  diagnostics.optionalLayerConfigs = layerConfigs && typeof layerConfigs === "object" ? layerConfigs : null;
  return diagnostics.optionalLayerConfigs;
}

export function isRenderTransactionDiagnosticsEnabled(runtimeState, searchParams = null) {
  const params = searchParams || getSearchParamsFromGlobal();
  return !!(
    runtimeState?.renderTransactionDiagnosticsEnabled
    || runtimeState?.ui?.developerMode
    || runtimeState?.uiState?.developerMode
    || toBooleanParam(readSearchParam(params, "render_diag"))
    || toBooleanParam(readSearchParam(params, "perf_overlay"))
    || toBooleanParam(readSearchParam(params, "runtime_chunk_perf"))
  );
}

export function exposeRenderTransactionDiagnostics(runtimeState, searchParams = null) {
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  diagnostics.enabled = isRenderTransactionDiagnosticsEnabled(runtimeState, searchParams);
  diagnostics.maxSnapshots = diagnostics.enabled ? ENABLED_SNAPSHOT_LIMIT : DEFAULT_SNAPSHOT_LIMIT;
  while (diagnostics.snapshots.length > diagnostics.maxSnapshots) diagnostics.snapshots.shift();
  if (diagnostics.warnings.length > WARNING_LIMIT) {
    diagnostics.warnings.splice(0, diagnostics.warnings.length - WARNING_LIMIT);
  }
  if (diagnostics.enabled) {
    globalThis[GLOBAL_RENDER_TRANSACTION_DIAGNOSTICS_NAME] = {
      enabled: true,
      latest: diagnostics.latestSnapshot,
      latestWarning: diagnostics.latestWarning,
      snapshots: diagnostics.snapshots,
      warnings: diagnostics.warnings,
      state: diagnostics,
    };
  } else if (globalThis[GLOBAL_RENDER_TRANSACTION_DIAGNOSTICS_NAME]?.state === diagnostics) {
    delete globalThis[GLOBAL_RENDER_TRANSACTION_DIAGNOSTICS_NAME];
  }
  return diagnostics;
}

export function nextScenarioApplyEpoch(runtimeState, { scenarioId = "", reason = "" } = {}) {
  const target = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  return advanceScenarioApplyEpochState(target, { scenarioId, reason, recordedAt: nowMs() });
}

export function nextRenderTransactionEpoch(runtimeState, { reason = "" } = {}) {
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  diagnostics.renderTransactionEpoch += 1;
  diagnostics.lastRenderTransactionReason = String(reason || "");
  return diagnostics.renderTransactionEpoch;
}

function readSelectionVersion(runtimeState) {
  return Math.max(0, Number(runtimeState?.runtimeChunkLoadState?.selectionVersion || 0));
}

export function buildRenderTransactionIdentity(runtimeState, extra = {}) {
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  const explicitScenarioApplyEpoch = Math.max(0, Number(extra.scenarioApplyEpoch || 0));
  const scenarioApplyEpochByScenarioId =
    diagnostics.scenarioApplyEpochByScenarioId && typeof diagnostics.scenarioApplyEpochByScenarioId === "object"
      ? diagnostics.scenarioApplyEpochByScenarioId
      : {};
  const scenarioApplyEpoch = explicitScenarioApplyEpoch || [
    normalizeId(extra.expectedScenarioId),
    normalizeId(extra.requestedScenarioId),
    normalizeId(runtimeState?.activeScenarioId),
    normalizeId(runtimeState?.activeScenarioManifest?.scenario_id),
  ].reduce((resolvedEpoch, scenarioId) => {
    if (resolvedEpoch || !scenarioId) return resolvedEpoch;
    return Math.max(0, Number(scenarioApplyEpochByScenarioId[scenarioId] || 0));
  }, 0) || diagnostics.scenarioApplyEpoch || 0;
  return {
    requestedScenarioId: normalizeId(extra.requestedScenarioId),
    expectedScenarioId: normalizeId(extra.expectedScenarioId),
    activeScenarioId: normalizeId(runtimeState?.activeScenarioId),
    activeScenarioManifestId: normalizeId(runtimeState?.activeScenarioManifest?.scenario_id),
    scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
    renderTransactionEpoch: Math.max(0, Number(extra.renderTransactionEpoch || diagnostics.renderTransactionEpoch || 0)),
    sceneGeneration: Math.max(0, Number(extra.sceneGeneration ?? runtimeState?.sceneGeneration ?? 0)),
    scenarioDataGeneration: Math.max(0, Number(extra.scenarioDataGeneration ?? runtimeState?.scenarioDataGeneration ?? 0)),
    scenarioDataGenerationReason: String(extra.scenarioDataGenerationReason || runtimeState?.scenarioDataGenerationReason || "init"),
    topologyRevision: Math.max(0, Number(extra.topologyRevision ?? runtimeState?.topologyRevision ?? 0)),
    colorRevision: Math.max(0, Number(extra.colorRevision ?? runtimeState?.colorRevision ?? 0)),
    selectionVersion: Math.max(0, Number(extra.selectionVersion ?? readSelectionVersion(runtimeState))),
  };
}

function buildFeatureCounts(runtimeState) {
  return {
    landData: getFeatureCount(runtimeState?.landData),
    landDataFull: getFeatureCount(runtimeState?.landDataFull),
    scenarioPoliticalChunkData: getFeatureCount(runtimeState?.scenarioPoliticalChunkData),
    scenarioPoliticalVisibleChunkData: getFeatureCount(runtimeState?.scenarioPoliticalVisibleChunkData),
    landIndex: getObjectSize(runtimeState?.landIndex),
    spatialItems: getFeatureCount(runtimeState?.spatialItems),
    waterSpatialItems: getFeatureCount(runtimeState?.waterSpatialItems),
    specialSpatialItems: getFeatureCount(runtimeState?.specialSpatialItems),
    resolvedColors: getObjectSize(runtimeState?.colors),
  };
}

function inferPoliticalDataStage(runtimeState, counts) {
  if (counts.scenarioPoliticalVisibleChunkData > 0) return "visible-subset";
  if (counts.scenarioPoliticalChunkData > 0) {
    return runtimeState?.runtimeChunkLoadState?.selectionVersion > 0 ? "detail" : "coarse";
  }
  if (counts.landDataFull > counts.landData && counts.landData > 0) return "visible-subset";
  if (counts.landDataFull > 0) return "full";
  if (counts.landData > 0) return runtimeState?.bootBlocking ? "startup-shell" : "full";
  if (runtimeState?.scenarioPoliticalDeferredFullCacheReady) return "deferred-full-cache";
  return "unknown";
}

function buildChunkSnapshot(runtimeState) {
  const loadState = runtimeState?.runtimeChunkLoadState || {};
  const activeChunks = runtimeState?.activeScenarioChunks || {};
  const lastSelection = loadState.lastSelection || {};
  const pendingPromotion = loadState.pendingPromotion || loadState.pendingVisualPromotion || {};
  const requiredChunkIds = copyStringList(lastSelection.requiredChunkIds?.length ? lastSelection.requiredChunkIds : pendingPromotion.requiredChunkIds);
  const optionalChunkIds = copyStringList(lastSelection.optionalChunkIds?.length ? lastSelection.optionalChunkIds : pendingPromotion.optionalChunkIds);
  const evictableChunkIds = copyStringList(lastSelection.evictableChunkIds?.length ? lastSelection.evictableChunkIds : pendingPromotion.evictableChunkIds);
  const retainedActiveChunkIds = copyStringList(lastSelection.retainedActiveChunkIds?.length ? lastSelection.retainedActiveChunkIds : pendingPromotion.retainedActiveChunkIds);
  const cacheOnlyChunkIds = copyStringList(lastSelection.cacheOnlyChunkIds?.length ? lastSelection.cacheOnlyChunkIds : pendingPromotion.cacheOnlyChunkIds);
  return {
    scenarioId: normalizeId(activeChunks.scenarioId || runtimeState?.activeScenarioId),
    shellStatus: String(loadState.shellStatus || "idle"),
    registryStatus: String(loadState.registryStatus || "idle"),
    lastSelectionReason: String(lastSelection.reason || loadState.pendingReason || ""),
    lastSelectionVersion: Math.max(0, Number(lastSelection.selectionVersion || loadState.selectionVersion || 0)),
    requiredChunkIds,
    optionalChunkIds,
    evictableChunkIds,
    retainedActiveChunkIds,
    cacheOnlyChunkIds,
    loadedChunkIds: copyStringList(activeChunks.loadedChunkIds),
    visibleFeatureSubsetSignature: String(lastSelection.visibleFeatureSubsetSignature || pendingPromotion.visibleFeatureSubsetSignature || ""),
    politicalVisibleFeatureSubsetSignature: String(lastSelection.politicalVisibleFeatureSubsetSignature || pendingPromotion.politicalVisibleFeatureSubsetSignature || ""),
    selectedFeatureCountSum: Math.max(0, Number(lastSelection.selectedFeatureCountSum || pendingPromotion.selectedFeatureCountSum || 0)),
    selectedVisibleFeatureCountSum: Math.max(0, Number(lastSelection.selectedVisibleFeatureCountSum || pendingPromotion.selectedVisibleFeatureCountSum || 0)),
    selectedPoliticalFeatureCountSum: Math.max(0, Number(lastSelection.selectedPoliticalFeatureCountSum || pendingPromotion.selectedPoliticalFeatureCountSum || 0)),
    selectedPoliticalVisibleFeatureCountSum: Math.max(0, Number(lastSelection.selectedPoliticalVisibleFeatureCountSum || pendingPromotion.selectedPoliticalVisibleFeatureCountSum || 0)),
    selectedEstimatedPathCostSum: Math.max(0, Number(lastSelection.selectedEstimatedPathCostSum || pendingPromotion.selectedEstimatedPathCostSum || 0)),
  };
}

function getManifestRequiredLayers(runtimeState) {
  const rawLayers = runtimeState?.activeScenarioManifest?.required_semantic_layers;
  if (Array.isArray(rawLayers)) return copyStringList(rawLayers);
  if (rawLayers && typeof rawLayers === "object") return copyStringList(rawLayers.layers);
  return [];
}

function chunkIdsContainLayer(chunkIds, layerKey) {
  const normalizedLayerKey = normalizeId(layerKey);
  if (!normalizedLayerKey) return false;
  return copyStringList(chunkIds).some(
    (chunkId) => chunkId === normalizedLayerKey || chunkId.startsWith(`${normalizedLayerKey}.`)
  );
}

function getLayerChunkIds(chunkIds, layerKey) {
  const normalizedLayerKey = normalizeId(layerKey);
  if (!normalizedLayerKey) return [];
  return copyStringList(chunkIds).filter(
    (chunkId) => chunkId === normalizedLayerKey || chunkId.startsWith(`${normalizedLayerKey}.`)
  );
}

function getRequiredReason({ manifestRequired = false, requiredByRequiredChunk = false } = {}) {
  if (manifestRequired && requiredByRequiredChunk) return "manifest+required-chunk";
  if (manifestRequired) return "manifest";
  if (requiredByRequiredChunk) return "required-chunk";
  return "";
}

function getLayerVisibility(runtimeState, layerKey, config) {
  if (layerKey === "strategicvalues") {
    return !!runtimeState?.showStrategicResourceMarkers || !!normalizeId(runtimeState?.strategicChoroplethMetric);
  }
  const visibilityField = normalizeId(config?.visibilityField);
  if (!visibilityField) return false;
  if (Object.prototype.hasOwnProperty.call(runtimeState || {}, visibilityField)) {
    return !!runtimeState[visibilityField];
  }
  return visibilityField !== "showSpecialZones" && visibilityField !== "showStrategicResourceMarkers";
}

function getActiveScenarioBundle(runtimeState) {
  const activeScenarioId = normalizeId(runtimeState?.activeScenarioId);
  return runtimeState?.activeScenarioBundle
    || (activeScenarioId ? runtimeState?.scenarioBundleCacheById?.[activeScenarioId] : null)
    || null;
}

function getTopologyObjectState(runtimeState, config) {
  const objectName = normalizeId(config?.objectName);
  if (!objectName) return "not-owned";
  const topologyCandidates = [
    runtimeState?.scenarioRuntimeTopologyData,
    runtimeState?.runtimePoliticalTopology,
    runtimeState?.topologyPrimary,
    runtimeState?.topology,
  ];
  const topology = topologyCandidates.find((candidate) => (
    candidate?.objects && Object.prototype.hasOwnProperty.call(candidate.objects, objectName)
  ));
  return topology ? getPayloadState(topology.objects[objectName]) : "not-owned";
}

function getLayerSourceInfo(runtimeState, config, {
  statePayloadState,
  mergedPayload,
  mergedPayloadState,
} = {}) {
  const stateField = normalizeId(config?.stateField);
  const bundleField = normalizeId(config?.bundleField);
  const activeBundle = getActiveScenarioBundle(runtimeState);
  const bundlePayload = hasOwnValue(activeBundle, bundleField) ? activeBundle[bundleField] : undefined;
  const bundlePayloadState = getPayloadState(bundlePayload);
  const topologyObjectState = getTopologyObjectState(runtimeState, config);
  if (statePayloadState === "present") {
    return { sourceKind: "runtime-state", sourceStatus: "present" };
  }
  if (mergedPayloadState === "present") {
    return { sourceKind: "merged-chunk", sourceStatus: "present" };
  }
  if (bundlePayloadState === "present") {
    return { sourceKind: "bundle-payload", sourceStatus: "present" };
  }
  if (topologyObjectState === "present") {
    return { sourceKind: "topology-object", sourceStatus: "present" };
  }
  if (hasOwnValue(runtimeState, stateField) && statePayloadState === "empty") {
    return { sourceKind: "explicit-empty", sourceStatus: "empty" };
  }
  if (mergedPayload !== undefined && mergedPayloadState === "empty") {
    return { sourceKind: "explicit-empty", sourceStatus: "empty" };
  }
  if (bundlePayload !== undefined && bundlePayloadState === "empty") {
    return { sourceKind: "explicit-empty", sourceStatus: "empty" };
  }
  if (topologyObjectState === "empty") {
    return { sourceKind: "explicit-empty", sourceStatus: "empty" };
  }
  if (statePayloadState === "unknown" || mergedPayloadState === "unknown" || bundlePayloadState === "unknown") {
    return { sourceKind: "unknown", sourceStatus: "unknown" };
  }
  return { sourceKind: "not-owned", sourceStatus: "not-owned" };
}

function getMissingReason({
  required = false,
  intentionallyDeferred = false,
  statePayloadState = "not-owned",
  mergedPayloadState = "not-owned",
  sourceKind = "unknown",
  missingChunkIds = [],
} = {}) {
  if (required && missingChunkIds.length > 0) return "not-yet-loaded";
  if (sourceKind === "explicit-empty") return "explicit-empty";
  if (intentionallyDeferred) return "optional-deferred";
  if (missingChunkIds.length > 0) return "not-yet-loaded";
  if (required && statePayloadState === "empty") return "state-empty";
  if (required && mergedPayloadState === "empty") return "merged-empty";
  if (required && mergedPayloadState === "not-owned") return "merged-not-owned";
  if (sourceKind === "unknown") return "payload-malformed";
  return "";
}

function getCoverageStatus({
  visible = false,
  required = false,
  selected = false,
  present = false,
  intentionallyDeferred = false,
  sourceKind = "unknown",
  missingChunkIds = [],
} = {}) {
  if (!visible) return "not-visible";
  if (present) return "present";
  if (required && missingChunkIds.length > 0) return "transient-loading";
  if (required) return "required-missing";
  if (sourceKind === "explicit-empty") return "explicit-empty";
  if (intentionallyDeferred) return "optional-deferred";
  if (!selected) return "not-selected";
  if (sourceKind === "not-owned") return "optional-deferred";
  return "unknown";
}

function buildLayerSnapshot(runtimeState, chunks) {
  const layerConfigs = getLayerConfigs(runtimeState);
  const manifestRequiredLayers = getManifestRequiredLayers(runtimeState);
  const requiredChunkIds = copyStringList(chunks.requiredChunkIds);
  const optionalChunkIds = copyStringList(chunks.optionalChunkIds);
  const loadedChunkIds = copyStringList(chunks.loadedChunkIds);
  return Object.fromEntries(
    Object.entries(layerConfigs)
      .filter(([, config]) => config && typeof config === "object")
      .map(([layerKey, config]) => {
        const stateField = normalizeId(config?.stateField);
        const revisionField = normalizeId(config?.revisionField);
        const normalizedLayerKey = normalizeId(layerKey);
        const statePayload = stateField ? runtimeState?.[stateField] : undefined;
        const mergedPayload = runtimeState?.activeScenarioChunks?.mergedLayerPayloads?.[normalizedLayerKey];
        const statePayloadState = getPayloadState(statePayload);
        const mergedPayloadState = getPayloadState(mergedPayload);
        const manifestRequired = manifestRequiredLayers.includes(normalizedLayerKey);
        const requiredByRequiredChunk = chunkIdsContainLayer(requiredChunkIds, normalizedLayerKey);
        const selectedAsOptionalChunk = chunkIdsContainLayer(optionalChunkIds, normalizedLayerKey);
        const required = manifestRequired || requiredByRequiredChunk;
        const selected = requiredByRequiredChunk || selectedAsOptionalChunk;
        const expectedChunkIds = Array.from(new Set([
          ...getLayerChunkIds(requiredChunkIds, normalizedLayerKey),
          ...getLayerChunkIds(optionalChunkIds, normalizedLayerKey),
        ]));
        const layerLoadedChunkIds = expectedChunkIds.filter((chunkId) => loadedChunkIds.includes(chunkId));
        const missingChunkIds = expectedChunkIds.filter((chunkId) => !loadedChunkIds.includes(chunkId));
        const stateFeatureCount = getFeatureCount(statePayload);
        const mergedFeatureCount = getFeatureCount(mergedPayload);
        const sourceInfo = getLayerSourceInfo(runtimeState, config, {
          statePayloadState,
          mergedPayload,
          mergedPayloadState,
        });
        const visible = getLayerVisibility(runtimeState, normalizedLayerKey, config);
        const present = stateFeatureCount > 0
          || mergedFeatureCount > 0
          || sourceInfo.sourceStatus === "present";
        const intentionallyDeferred = visible
          && !required
          && selectedAsOptionalChunk
          && !present;
        const coverageStatus = getCoverageStatus({
          visible,
          required,
          selected,
          present,
          intentionallyDeferred,
          sourceKind: sourceInfo.sourceKind,
          missingChunkIds,
        });
        const missingReason = getMissingReason({
          required,
          intentionallyDeferred,
          statePayloadState,
          mergedPayloadState,
          sourceKind: sourceInfo.sourceKind,
          missingChunkIds,
        });
        return [layerKey, {
          visible,
          manifestRequired,
          requiredByRequiredChunk,
          selectedAsOptionalChunk,
          required,
          selected,
          intentionallyDeferred,
          stateField,
          stateFeatureCount,
          statePayloadState,
          mergedPayloadState,
          mergedFeatureCount,
          revision: revisionField ? Math.max(0, Number(runtimeState?.[revisionField] || 0)) : 0,
          sourceStatus: sourceInfo.sourceStatus,
          sourceKind: sourceInfo.sourceKind,
          coverageStatus,
          requiredReason: getRequiredReason({ manifestRequired, requiredByRequiredChunk }),
          missingReason,
          expectedChunkIds,
          loadedChunkIds: layerLoadedChunkIds,
          missingChunkIds,
        }];
      })
  );
}

function buildRenderPassSnapshot(runtimeState, extra = {}) {
  const cache = runtimeState?.renderPassCache || {};
  const dirty = cache.dirty && typeof cache.dirty === "object" ? cache.dirty : {};
  const reasons = cache.reasons && typeof cache.reasons === "object" ? cache.reasons : {};
  const dirtyPasses = Object.entries(dirty)
    .filter(([, value]) => !!value)
    .map(([passName]) => passName);
  const invalidation = runtimeState?.renderTransactionDiagnostics?.lastRenderPassInvalidation || null;
  return {
    dirtyPasses,
    lastAction: String(cache.lastAction || extra.lastAction || ""),
    lastInvalidationReason: String(invalidation?.reason || ""),
    lastInvalidatedPasses: copyStringList(invalidation?.passNames),
    referenceTransformStatus: cache.referenceTransform ? "present" : "missing",
    visibleFrameStatus: String(extra.visibleFrameStatus || extra.status || ""),
    visibleFrameCommitKey: String(extra.visibleFrameCommitKey || cache.lastGoodFrame?.commitKeySignature || ""),
    dirtyReasons: Object.fromEntries(dirtyPasses.map((passName) => [passName, String(reasons[passName] || "")])),
  };
}

function appendBounded(list, entry, limit) {
  list.push(entry);
  while (list.length > limit) list.shift();
}

function appendWarning(runtimeState, warning) {
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  diagnostics.latestWarning = warning;
  appendBounded(diagnostics.warnings, warning, WARNING_LIMIT);
  return warning;
}

function maybeConsoleWarn(runtimeState, warning, searchParams = null) {
  const params = searchParams || getSearchParamsFromGlobal();
  if (!isRenderTransactionDiagnosticsEnabled(runtimeState, params)) return;
  if (!runtimeState?.renderTransactionConsoleWarnings && !toBooleanParam(readSearchParam(params, "render_diag"))) return;
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[render-transaction]", warning.code, warning);
  }
}

export function recordRenderInvariantWarning(runtimeState, {
  code,
  severity = "warning",
  phase = "",
  reason = "",
  details = {},
} = {}) {
  const normalizedCode = normalizeId(code);
  if (!normalizedCode) return null;
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  const warning = {
    sequence: diagnostics.sequence + 1,
    recordedAt: nowMs(),
    code: normalizedCode,
    severity: String(severity || "warning"),
    phase: String(phase || ""),
    phaseKind: classifyRenderTransactionPhaseKind(phase),
    reason: String(reason || ""),
    details: details && typeof details === "object" ? { ...details } : {},
  };
  appendWarning(runtimeState, warning);
  maybeConsoleWarn(runtimeState, warning);
  exposeRenderTransactionDiagnostics(runtimeState);
  return warning;
}

function detectSnapshotWarnings(runtimeState, snapshot) {
  const warnings = [];
  const pushWarning = (code, details = {}) => {
    const warning = recordRenderInvariantWarning(runtimeState, {
      code,
      phase: snapshot.phase,
      reason: snapshot.reason,
      details,
    });
    if (warning) warnings.push(warning);
  };

  const activeScenarioId = normalizeId(snapshot.activeScenarioId);
  if (!snapshot.extra?.allowScenarioMismatch) {
    [snapshot.expectedScenarioId, snapshot.requestedScenarioId]
      .map(normalizeId)
      .filter(Boolean)
      .forEach((scenarioId) => {
        if (activeScenarioId && scenarioId !== activeScenarioId) {
          pushWarning(RENDER_TRANSACTION_WARNING_CODES.renderSnapshotScenarioMismatch, {
            expectedScenarioId: snapshot.expectedScenarioId,
            requestedScenarioId: snapshot.requestedScenarioId,
            activeScenarioId,
          });
        }
      });
  }

  Object.entries(snapshot.layers || {}).forEach(([layerKey, layer]) => {
    if (
      layer?.visible
      && layer?.required
      && String(layer.coverageStatus || "") === "required-missing"
    ) {
      pushWarning(RENDER_TRANSACTION_WARNING_CODES.visibleRequiredLayerMissing, {
        layerKey,
        stateFeatureCount: Number(layer.stateFeatureCount || 0),
        mergedPayloadState: String(layer.mergedPayloadState || ""),
        mergedFeatureCount: Number(layer.mergedFeatureCount || 0),
        sourceKind: String(layer.sourceKind || "unknown"),
        coverageStatus: String(layer.coverageStatus || ""),
        requiredReason: String(layer.requiredReason || ""),
        missingReason: String(layer.missingReason || ""),
        manifestRequired: !!layer.manifestRequired,
        requiredByRequiredChunk: !!layer.requiredByRequiredChunk,
        selectedAsOptionalChunk: !!layer.selectedAsOptionalChunk,
      });
    }
  });

  const landCount = Math.max(
    Number(snapshot.featureCounts?.landData || 0),
    Number(snapshot.featureCounts?.landDataFull || 0),
  );
  if (activeScenarioId && landCount > 0 && Number(snapshot.featureCounts?.resolvedColors || 0) <= 0) {
    pushWarning(RENDER_TRANSACTION_WARNING_CODES.resolvedColorsEmptyWithLand, {
      landData: Number(snapshot.featureCounts?.landData || 0),
      landDataFull: Number(snapshot.featureCounts?.landDataFull || 0),
      resolvedColors: Number(snapshot.featureCounts?.resolvedColors || 0),
    });
  }

  const requiredPoliticalChunkIds = copyStringList(snapshot.chunks?.requiredChunkIds)
    .filter((chunkId) => chunkId === "political" || chunkId.startsWith("political."));
  if (
    requiredPoliticalChunkIds.length > 0
    && Number(snapshot.featureCounts?.scenarioPoliticalChunkData || 0) <= 0
    && Number(snapshot.featureCounts?.scenarioPoliticalVisibleChunkData || 0) <= 0
  ) {
    pushWarning(RENDER_TRANSACTION_WARNING_CODES.politicalVisibleSubsetEmptyWithRequiredChunks, {
      requiredPoliticalChunkIds,
      scenarioPoliticalChunkData: Number(snapshot.featureCounts?.scenarioPoliticalChunkData || 0),
      scenarioPoliticalVisibleChunkData: Number(snapshot.featureCounts?.scenarioPoliticalVisibleChunkData || 0),
    });
  }

  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  if (String(snapshot.renderPasses?.visibleFrameStatus || "") === "reused") {
    const previous = diagnostics.lastAcceptedFrameIdentity;
    if (previous && (
      String(previous.activeScenarioId || "") !== String(snapshot.activeScenarioId || "")
      || Number(previous.scenarioApplyEpoch || 0) !== Number(snapshot.scenarioApplyEpoch || 0)
      || Number(previous.scenarioDataGeneration || 0) !== Number(snapshot.scenarioDataGeneration || 0)
      || Number(previous.colorRevision || 0) !== Number(snapshot.colorRevision || 0)
      || Number(previous.selectionVersion || 0) !== Number(snapshot.selectionVersion || 0)
      || Number(previous.topologyRevision || 0) !== Number(snapshot.topologyRevision || 0)
    )) {
      pushWarning(RENDER_TRANSACTION_WARNING_CODES.renderReuseAcrossDataGeneration, {
        previous,
        current: {
          scenarioDataGeneration: snapshot.scenarioDataGeneration,
          colorRevision: snapshot.colorRevision,
          selectionVersion: snapshot.selectionVersion,
          topologyRevision: snapshot.topologyRevision,
          scenarioApplyEpoch: snapshot.scenarioApplyEpoch,
          activeScenarioId: snapshot.activeScenarioId,
        },
      });
    }
  }
  if (["committed", "reused"].includes(String(snapshot.renderPasses?.visibleFrameStatus || ""))) {
    diagnostics.lastAcceptedFrameIdentity = {
      scenarioDataGeneration: snapshot.scenarioDataGeneration,
      colorRevision: snapshot.colorRevision,
      selectionVersion: snapshot.selectionVersion,
      topologyRevision: snapshot.topologyRevision,
      scenarioApplyEpoch: snapshot.scenarioApplyEpoch,
      activeScenarioId: snapshot.activeScenarioId,
      recordedAt: snapshot.recordedAt,
    };
  }
  return warnings;
}

export function recordRenderPassInvalidation(runtimeState, passNames, reason = "unspecified") {
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  diagnostics.lastRenderPassInvalidation = {
    passNames: copyStringList(Array.isArray(passNames) ? passNames : [passNames]),
    reason: String(reason || "unspecified"),
    recordedAt: nowMs(),
  };
  return diagnostics.lastRenderPassInvalidation;
}

export function recordRenderPassInvalidationDiagnostics(runtimeState, passNames, reason = "unspecified") {
  recordRenderPassInvalidation(runtimeState, passNames, reason);
  return recordRenderTransactionSnapshot(runtimeState, {
    phase: "render-pass-invalidated",
    reason,
    expectedScenarioId: runtimeState?.activeScenarioId,
    source: "map_renderer",
    extra: { lastInvalidatedPasses: copyStringList(Array.isArray(passNames) ? passNames : [passNames]) },
  });
}

export function recordRenderTransactionSnapshot(runtimeState, {
  phase = "unknown",
  reason = "",
  requestedScenarioId = "",
  expectedScenarioId = "",
  source = "",
  extra = {},
  searchParams = null,
} = {}) {
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  exposeRenderTransactionDiagnostics(runtimeState, searchParams);
  const sequence = diagnostics.sequence + 1;
  diagnostics.sequence = sequence;
  const identity = buildRenderTransactionIdentity(runtimeState, {
    requestedScenarioId,
    expectedScenarioId,
    ...extra,
  });
  const featureCounts = buildFeatureCounts(runtimeState);
  const chunks = buildChunkSnapshot(runtimeState);
  const layers = buildLayerSnapshot(runtimeState, chunks);
  const snapshot = {
    sequence,
    recordedAt: nowMs(),
    phase: String(phase || "unknown"),
    phaseKind: classifyRenderTransactionPhaseKind(phase),
    reason: String(reason || ""),
    source: String(source || ""),
    ...identity,
    renderPhase: String(runtimeState?.renderPhase || "idle"),
    isInteracting: !!runtimeState?.isInteracting,
    bootBlocking: !!runtimeState?.bootBlocking,
    scenarioApplyInFlight: !!runtimeState?.scenarioApplyInFlight,
    startupReadonly: !!runtimeState?.startupReadonly,
    startupReadonlyUnlockInFlight: !!runtimeState?.startupReadonlyUnlockInFlight,
    mapSemanticMode: String(runtimeState?.mapSemanticMode || ""),
    politicalDataStage: String(extra.politicalDataStage || inferPoliticalDataStage(runtimeState, featureCounts)),
    fullPoliticalReady: !!(extra.fullPoliticalReady ?? runtimeState?.renderPassCache?.politicalPassFullReady),
    finePoliticalCacheReady: !!(extra.finePoliticalCacheReady ?? runtimeState?.renderPassCache?.politicalPassFineCacheReady),
    featureCounts,
    chunks,
    layers,
    renderPasses: buildRenderPassSnapshot(runtimeState, extra),
    warnings: [],
    extra: extra && typeof extra === "object" ? { ...extra } : {},
  };
  snapshot.warnings = detectSnapshotWarnings(runtimeState, snapshot);
  diagnostics.latestSnapshot = snapshot;
  appendBounded(diagnostics.snapshots, snapshot, diagnostics.maxSnapshots);
  exposeRenderTransactionDiagnostics(runtimeState, searchParams);
  return snapshot;
}

function recordRenderTransactionIdentitySnapshot(runtimeState, {
  phase = "unknown",
  reason = "",
  requestedScenarioId = "",
  expectedScenarioId = "",
  source = "",
  extra = {},
  searchParams = null,
} = {}) {
  const diagnostics = ensureRenderTransactionDiagnosticsState(runtimeState);
  exposeRenderTransactionDiagnostics(runtimeState, searchParams);
  const sequence = diagnostics.sequence + 1;
  diagnostics.sequence = sequence;
  const identity = buildRenderTransactionIdentity(runtimeState, {
    requestedScenarioId,
    expectedScenarioId,
    ...extra,
  });
  const snapshot = {
    sequence,
    recordedAt: nowMs(),
    phase: String(phase || "unknown"),
    phaseKind: classifyRenderTransactionPhaseKind(phase),
    reason: String(reason || ""),
    source: String(source || ""),
    ...identity,
    renderPhase: String(runtimeState?.renderPhase || "idle"),
    isInteracting: !!runtimeState?.isInteracting,
    bootBlocking: !!runtimeState?.bootBlocking,
    scenarioApplyInFlight: !!runtimeState?.scenarioApplyInFlight,
    startupReadonly: !!runtimeState?.startupReadonly,
    startupReadonlyUnlockInFlight: !!runtimeState?.startupReadonlyUnlockInFlight,
    mapSemanticMode: String(runtimeState?.mapSemanticMode || ""),
    politicalDataStage: String(extra.politicalDataStage || ""),
    fullPoliticalReady: !!extra.fullPoliticalReady,
    finePoliticalCacheReady: !!extra.finePoliticalCacheReady,
    featureCounts: {},
    chunks: {},
    layers: {},
    renderPasses: buildRenderPassSnapshot(runtimeState, extra),
    warnings: [],
    extra: extra && typeof extra === "object" ? { ...extra } : {},
  };
  snapshot.warnings = detectSnapshotWarnings(runtimeState, snapshot);
  diagnostics.latestSnapshot = snapshot;
  appendBounded(diagnostics.snapshots, snapshot, diagnostics.maxSnapshots);
  exposeRenderTransactionDiagnostics(runtimeState, searchParams);
  return snapshot;
}

export function recordVisibleFrameTransactionDiagnostics(runtimeState, {
  status = "unknown",
  reason = "visible-frame",
  details = {},
  identity = {},
  committedFrameIdentity = {},
  visibleFrameCommitKey = "",
  durationMs = 0,
} = {}) {
  const normalizedStatus = String(status || "").trim() || "unknown";
  const renderTransactionEpoch = nextRenderTransactionEpoch(runtimeState, { reason });
  const extra = {
    renderTransactionEpoch,
    visibleFrameStatus: normalizedStatus,
    visibleFrameCommitKey,
    paintSource: String(details.paintSource || ""),
    blockReason: String(details.blockReason || ""),
    durationMs: Number(durationMs || 0),
    sceneGeneration: Number(details.sceneGeneration ?? identity.sceneGeneration ?? runtimeState?.sceneGeneration ?? 0),
    scenarioDataGeneration: Number(details.scenarioDataGeneration ?? identity.scenarioDataGeneration ?? runtimeState?.scenarioDataGeneration ?? 0),
    topologyRevision: Number(details.topologyRevision ?? identity.topologyRevision ?? runtimeState?.topologyRevision ?? 0),
    colorRevision: Number(details.colorRevision ?? identity.colorRevision ?? runtimeState?.colorRevision ?? 0),
    selectionVersion: Number(details.selectionVersion ?? identity.selectionVersion ?? runtimeState?.runtimeChunkLoadState?.selectionVersion ?? 0),
    politicalDataStage: String(details.politicalDataStage || identity.politicalDataStage || ""),
    fullPoliticalReady: !!(details.fullPoliticalReady ?? identity.fullPoliticalReady),
    finePoliticalCacheReady: !!(details.finePoliticalCacheReady ?? identity.finePoliticalCacheReady),
    committedFrameIdentity,
    status: normalizedStatus,
  };
  const recorder = isRenderTransactionDiagnosticsEnabled(runtimeState)
    ? recordRenderTransactionSnapshot
    : recordRenderTransactionIdentitySnapshot;
  return recorder(runtimeState, {
    phase: `visible-frame-${normalizedStatus}`,
    reason,
    expectedScenarioId: String(details.activeScenarioId || identity.scenarioId || runtimeState?.activeScenarioId || ""),
    source: "map_renderer",
    extra,
  });
}

export function recordPendingPoliticalColorEditClearDiagnostics(runtimeState, {
  resetReason = "pending-edit-cleared",
  pendingFeatureCount = 0,
  pendingReason = "",
  inputLabel = "",
  firstPixelRecorded = false,
  renderedCount = 0,
  renderedIdCount = 0,
  force = false,
  paintSource = "",
} = {}) {
  const clearedWithoutRender = Math.max(0, Number(pendingFeatureCount || 0)) > 0
    && Number(renderedCount || 0) <= 0
    && Math.max(0, Number(renderedIdCount || 0)) <= 0
    && !firstPixelRecorded
    && !(force && PENDING_COLOR_EDIT_LIFECYCLE_RESET_REASONS.has(String(resetReason || "").trim()));
  if (clearedWithoutRender) {
    recordRenderInvariantWarning(runtimeState, {
      code: RENDER_TRANSACTION_WARNING_CODES.pendingColorEditClearedWithoutRender,
      phase: "pending-political-color-edit-cleared",
      reason: resetReason,
      details: {
        pendingFeatureCount: Math.max(0, Number(pendingFeatureCount || 0)),
        pendingReason: String(pendingReason || ""),
        inputLabel: String(inputLabel || ""),
        paintSource: String(paintSource || ""),
      },
    });
  }
  return recordRenderTransactionSnapshot(runtimeState, {
    phase: "pending-political-color-edit-cleared",
    reason: resetReason,
    expectedScenarioId: runtimeState?.activeScenarioId,
    source: "map_renderer",
    extra: {
      pendingFeatureCount: Math.max(0, Number(pendingFeatureCount || 0)),
      pendingReason: String(pendingReason || ""),
      inputLabel: String(inputLabel || ""),
      renderedCount: Math.max(0, Number(renderedCount || 0)),
      renderedIdCount: Math.max(0, Number(renderedIdCount || 0)),
      force: !!force,
      clearedWithoutRender,
      paintSource: String(paintSource || ""),
    },
  });
}

export function recordColorRebuildDiagnostics(runtimeState, {
  phase = "color-rebuild-complete",
  previousColorRevision = 0,
  sourceFeatureCount = 0,
  resolvedColorCount = 0,
  sourceName = "",
} = {}) {
  return recordRenderTransactionSnapshot(runtimeState, {
    phase,
    reason: "rebuild-colors",
    expectedScenarioId: runtimeState?.activeScenarioId,
    source: "map_renderer",
    extra: {
      previousColorRevision,
      colorRevision: Number(runtimeState?.colorRevision || 0),
      sourceFeatureCount: Math.max(0, Number(sourceFeatureCount || 0)),
      resolvedColorCount: Math.max(0, Number(resolvedColorCount || 0)),
      sourceName: String(sourceName || ""),
    },
  });
}

export function recordPoliticalPatchOverlayPaintDiagnostics(runtimeState, {
  inputLabel = "refresh-colors",
  requestedFeatureCount = 0,
  candidateFeatureCount = 0,
  renderedCount = 0,
} = {}) {
  return recordRenderTransactionSnapshot(runtimeState, {
    phase: "political-patch-overlay-painted",
    reason: "refresh-colors",
    expectedScenarioId: runtimeState?.activeScenarioId,
    source: "map_renderer",
    extra: {
      inputLabel: String(inputLabel || "refresh-colors"),
      requestedFeatureCount: Math.max(0, Number(requestedFeatureCount || 0)),
      candidateFeatureCount: Math.max(0, Number(candidateFeatureCount || 0)),
      renderedCount: Math.max(0, Number(renderedCount || 0)),
      colorRevision: Number(runtimeState?.colorRevision || 0),
    },
  });
}

export function recordPartialColorRefreshDiagnostics(runtimeState, {
  requestedFeatureCount = 0,
  pendingRenderFeatureCount = 0,
  renderNow = false,
  inputLabel = "",
} = {}) {
  return recordRenderTransactionSnapshot(runtimeState, {
    phase: "partial-color-refresh-complete",
    reason: "refresh-colors",
    expectedScenarioId: runtimeState?.activeScenarioId,
    source: "map_renderer",
    extra: {
      requestedFeatureCount: Math.max(0, Number(requestedFeatureCount || 0)),
      pendingRenderFeatureCount: Math.max(0, Number(pendingRenderFeatureCount || 0)),
      colorRevision: Number(runtimeState?.colorRevision || 0),
      renderNow: !!renderNow,
      inputLabel: String(inputLabel || ""),
    },
  });
}

export function recordProgressivePoliticalFullCacheReadyDiagnostics(runtimeState, {
  entryCount = 0,
  groupCount = 0,
  builtPathCount = 0,
  reusedPathCount = 0,
  pathlessEntryCount = 0,
  sliceCount = 0,
} = {}) {
  return recordRenderTransactionSnapshot(runtimeState, {
    phase: "progressive-political-full-cache-ready",
    reason: "progressive-political-full-cache-ready",
    expectedScenarioId: runtimeState?.activeScenarioId,
    source: "map_renderer",
    extra: {
      entryCount: Math.max(0, Number(entryCount || 0)),
      groupCount: Math.max(0, Number(groupCount || 0)),
      builtPathCount: Math.max(0, Number(builtPathCount || 0)),
      reusedPathCount: Math.max(0, Number(reusedPathCount || 0)),
      pathlessEntryCount: Math.max(0, Number(pathlessEntryCount || 0)),
      sliceCount: Math.max(0, Number(sliceCount || 0)),
      fullPoliticalReady: true,
    },
  });
}

export function getRenderTransactionGlobalName() {
  return GLOBAL_RENDER_TRANSACTION_DIAGNOSTICS_NAME;
}

export function getRenderTransactionFeatureCountForDiagnostics(value) {
  return getFeatureCount(value);
}

export function getMergedPayloadStateForDiagnostics(value) {
  return getPayloadState(value);
}

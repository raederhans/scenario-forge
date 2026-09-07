import { countryNames, createDefaultScenarioReleasableIndex, defaultCountryPalette, normalizeMapSemanticMode, state as runtimeState } from "./state.js";
import {
  beginScenarioApplyRequestState,
  clearActiveScenarioApplyRequestState,
  setLatestScenarioApplyRequestState,
} from "./state/actions/scenario_apply_request_actions.js";
import { ensureSovereigntyState, markLegacyColorStateDirty } from "./sovereignty_manager.js";
import {
  invalidateOceanBackgroundVisualState,
} from "./scenario/scenario_renderer_bridge.js";
import {
  loadDeferredDetailBundle,
  normalizeCityText,
} from "./data_loader.js";
import {
  getVisibleScenarioChunkLayers,
  mergeScenarioChunkPayloads,
  selectScenarioChunks,
} from "./scenario_chunk_manager.js";
import {
  buildScenarioDistrictGroupByFeatureId,
  normalizeScenarioDistrictGroupsPayload,
} from "./scenario_districts.js";
import { applyActivePaletteState, setActivePaletteSource, syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { markDirty } from "./dirty_state.js";
import {
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
} from "./releasable_manager.js";
import {
  SCENARIO_DETAIL_MIN_RATIO_STRICT,
  evaluateScenarioDataHealth,
  hasUsablePoliticalTopology,
  scenarioNeedsDetailTopology,
} from "./scenario_data_health.js";
import {
  publishScenarioPaletteAndToolbarState,
  runPostRollbackRestoreEffects,
  runPostScenarioApplyEffects,
  runPostScenarioClearEffects,
  runPostScenarioResetEffects,
  shouldSuppressChunkedPostApplyDataHealthSignals,
} from "./scenario_post_apply_effects.js";
import {
  setScenarioAuditUiState,
  syncScenarioUi,
} from "./scenario_ui_sync.js";
import { syncScenarioLocalizationState } from "./scenario_localization_state.js";
import {
  applyBlankScenarioPresentationDefaults,
  awaitInitialScenarioChunkVisualPromotion,
  ensureRuntimeChunkLoadState,
  evaluateScenarioHydrationHealthGateState,
  buildScenarioRuntimeVersionTag,
  hasRenderableScenarioPoliticalTopology,
  getScenarioDecodedCollection,
  getScenarioTopologyFeatureCollection,
  loadScenarioBundle,
  loadScenarioRegistry,
  resetScenarioChunkRuntimeState,
  releaseScenarioAuditPayload,
  scheduleScenarioDeferredBundleMetadataLoad,
  scheduleScenarioChunkRefresh,
  scenarioBundleHasChunkedData,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
} from "./scenario_resources.js";
import { assertScenarioInteractionsAllowed, buildScenarioFatalRecoveryError, clearScenarioFatalRecoveryState, consumeScenarioTestHook, enterScenarioFatalRecovery, formatScenarioFatalRecoveryMessage, getScenarioFatalRecoveryState, validateScenarioRuntimeConsistency } from "./scenario_recovery.js";
import { captureScenarioApplyRollbackSnapshot, restoreScenarioApplyRollbackSnapshot } from "./scenario_rollback.js";
import {
  buildHoi4FarEastSovietOwnerBackfill,
  recordScenarioPerfMetric as sharedRecordScenarioPerfMetric,
} from "./scenario/pure_helpers.js";
import {
  createScenarioPresentationRuntime,
} from "./scenario/presentation_runtime.js";
import {
  createScenarioLifecycleRuntime,
} from "./scenario/lifecycle_runtime.js";
import {
  createScenarioApplyPipeline,
} from "./scenario_apply_pipeline.js";
import {
  nextScenarioApplyEpoch,
  recordRenderInvariantWarning,
  recordRenderTransactionSnapshot,
  RENDER_TRANSACTION_WARNING_CODES,
} from "./renderer/render_transaction_diagnostics.js";
import {
  getSearchParams,
  scenarioBundleSatisfiesLevel,
  normalizeScenarioCoreMap as sharedNormalizeScenarioCoreMap,
  normalizeScenarioId,
  cloneScenarioStateValue,
} from "./scenario/shared.js";
import {
  getScenarioRegistryEntries as getBundleLoaderScenarioRegistryEntries,
  getScenarioDisplayName as getBundleLoaderScenarioDisplayName,
  getScenarioNameMap as getBundleLoaderScenarioNameMap,
  getScenarioFixedOwnerColors as getBundleLoaderScenarioFixedOwnerColors,
  mergeReleasableCatalogs,
  getScenarioMetaById as getBundleLoaderScenarioMetaById,
  getDefaultScenarioId as getBundleLoaderDefaultScenarioId,
  getScenarioManifestSummary as getBundleLoaderScenarioManifestSummary,
  getScenarioBaselineHashFromBundle,
  getScenarioDefaultCountryCode as getBundleLoaderDefaultCountryCode,
} from "./scenario/bundle_loader.js";
import { t } from "./i18n.js";
import { callRuntimeHook } from "./state/index.js";
const state = runtimeState;

function showToast(message, options = {}) {
  callRuntimeHook(null, "showToastFn", message, options);
}

const SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING = 180;
const SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE = 60;
let activeScenarioApplyPromise = null;
let activeScenarioApplyTargetId = "";
let activeScenarioApplyRequestId = 0;
let scenarioApplyRequestSequence = 0;
let latestQueuedScenarioApplyRequest = null;
let queuedScenarioApplyDrainPromise = null;

function getCurrentScenarioApplyRequestId() {
  return Math.max(0, Number(runtimeState.currentScenarioApplyRequestId || 0));
}

function createScenarioApplyRequest(scenarioId, {
  renderNow = true,
  markDirtyReason = "scenario-apply",
  showToastOnComplete = false,
  scenarioApplyEpoch = 0,
} = {}) {
  scenarioApplyRequestSequence += 1;
  return {
    requestId: scenarioApplyRequestSequence,
    scenarioId: normalizeScenarioId(scenarioId),
    renderNow: !!renderNow,
    markDirtyReason,
    showToastOnComplete: !!showToastOnComplete,
    scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
  };
}

function isScenarioApplyRequestCurrent(request) {
  if (!request || typeof request !== "object") return false;
  const requestId = Math.max(0, Number(request.requestId || 0));
  const requestScenarioId = normalizeScenarioId(request.scenarioId);
  if (!requestId || !requestScenarioId) return false;
  const activeOwnerTargetId = normalizeScenarioId(
    activeScenarioApplyTargetId
    || runtimeState.scenarioApplyActiveTargetId
    || runtimeState.activeScenarioId
  );
  const latestRequestedTargetId = normalizeScenarioId(runtimeState.latestScenarioApplyTargetId);
  return (
    getCurrentScenarioApplyRequestId() === requestId
    && activeOwnerTargetId === requestScenarioId
    && (!latestRequestedTargetId || latestRequestedTargetId === requestScenarioId)
  );
}

function recordScenarioApplyRequestSnapshot(request, {
  phase,
  reason = request?.markDirtyReason || "scenario-apply",
  expectedScenarioId = request?.scenarioId || "",
  details = {},
} = {}) {
  if (!phase || !request) return null;
  return recordRenderTransactionSnapshot(runtimeState, {
    phase,
    reason,
    requestedScenarioId: request.scenarioId,
    expectedScenarioId,
    source: "scenario_manager",
    searchParams: getSearchParams(),
    extra: {
      ...details,
      allowScenarioMismatch: true,
      scenarioApplyEpoch: Math.max(0, Number(request.scenarioApplyEpoch || 0)),
      scenarioApplyRequestId: Math.max(0, Number(request.requestId || 0)),
      activeScenarioApplyRequestId,
      activeScenarioApplyTargetId,
      currentScenarioApplyRequestId: getCurrentScenarioApplyRequestId(),
      latestScenarioApplyRequestId: Math.max(0, Number(runtimeState.latestScenarioApplyRequestId || 0)),
      latestScenarioApplyTargetId: normalizeScenarioId(runtimeState.latestScenarioApplyTargetId),
      latestQueuedScenarioApplyRequestId: Math.max(0, Number(latestQueuedScenarioApplyRequest?.requestId || 0)),
      latestQueuedScenarioApplyTargetId: latestQueuedScenarioApplyRequest?.scenarioId || "",
    },
  });
}

/**
 * Cross-module shared high-frequency state fields.
 * - activeScenarioId: active scenario selector used by UI sync, resources, and apply pipeline.
 * - scenarioBundleCacheById: bundle cache keyed by normalized scenario id for startup/full reuse.
 * - scenarioShellOverlayRevision: revision counter for owner shell overlay refresh and dependent UI.
 */

function normalizeScenarioCoreMap(rawMap) {
  return sharedNormalizeScenarioCoreMap(rawMap, { normalizeFeatureText: normalizeCityText });
}

function getScenarioTargetPaletteId(manifest) {
  return normalizeScenarioId(manifest?.palette_id) || "hoi4_vanilla";
}

function hasActiveScenarioPaletteLoaded(paletteId) {
  const targetPaletteId = normalizeScenarioId(paletteId);
  if (!targetPaletteId) {
    return false;
  }
  return normalizeScenarioId(runtimeState.activePaletteId) === targetPaletteId
    && !!runtimeState.activePalettePack
    && !!runtimeState.activePaletteMap;
}

function canReuseActiveScenarioBundle(cachedScenarioBundle, normalizedScenarioId) {
  // 复用只接受“同一场景、完整 bundle、当前 runtime 已完整激活”的情况；startup readonly 和半水合状态继续走正常 apply 链路。
  if (!normalizedScenarioId || normalizeScenarioId(runtimeState.activeScenarioId) !== normalizedScenarioId) {
    return false;
  }
  if (runtimeState.startupReadonly || runtimeState.startupReadonlyUnlockInFlight) {
    return false;
  }
  if (String(runtimeState.topologyBundleMode || "") !== "composite") {
    return false;
  }
  if (!cachedScenarioBundle || !scenarioBundleSatisfiesLevel(cachedScenarioBundle, "full")) {
    return false;
  }

  const cachedManifest = cachedScenarioBundle.manifest || null;
  const cachedManifestId = normalizeScenarioId(cachedManifest?.scenario_id || cachedScenarioBundle?.meta?.scenario_id);
  if (!cachedManifestId || cachedManifestId !== normalizedScenarioId) {
    return false;
  }

  const activeManifestId = normalizeScenarioId(runtimeState.activeScenarioManifest?.scenario_id);
  if (!activeManifestId || activeManifestId !== normalizedScenarioId) {
    return false;
  }

  const activeBaselineHash = String(runtimeState.scenarioBaselineHash || "").trim();
  const cachedBaselineHash = String(getScenarioBaselineHashFromBundle(cachedScenarioBundle) || "").trim();
  if (activeBaselineHash !== cachedBaselineHash) {
    return false;
  }

  const hasShellOwnerMap = Object.keys(runtimeState.scenarioAutoShellOwnerByFeatureId || {}).length > 0;
  const hasBaselineOwnerMap = Object.keys(runtimeState.scenarioBaselineOwnersByFeatureId || {}).length > 0;
  const requiresMeshPack = !!String(cachedManifest?.mesh_pack_url || "").trim();
  const hasMeshPack = !requiresMeshPack || !!runtimeState.activeScenarioMeshPack;
  return (
    hasShellOwnerMap
    && hasBaselineOwnerMap
    && hasMeshPack
  );
}

function recordScenarioPerfMetric(name, durationMs, details = {}) {
  return sharedRecordScenarioPerfMetric(state, name, durationMs, details);
}
const {
  applyScenarioPerformanceHints,
  restoreScenarioDisplaySettingsAfterExit,
  restoreScenarioOceanFillAfterExit,
  syncScenarioOceanFillForActivation,
} = createScenarioPresentationRuntime({
  state,
  invalidateOceanBackgroundVisualState,
});

const {
  applyScenarioPaintMode,
  clearActiveScenario: clearActiveScenarioRuntime,
  disableScenarioParentBorders,
  resetToScenarioBaseline: resetToScenarioBaselineRuntime,
  syncScenarioInspectorSelection,
} = createScenarioLifecycleRuntime({
  state,
  countryNames,
  defaultCountryPalette,
  createDefaultScenarioReleasableIndex,
  ensureSovereigntyState,
  getScenarioDefaultCountryCode,
  getScenarioMapSemanticMode,
  markDirty,
  markLegacyColorStateDirty,
  normalizeScenarioId,
  releaseScenarioAuditPayload,
  resetScenarioChunkRuntimeState,
  restoreScenarioDisplaySettingsAfterExit,
  restoreScenarioOceanFillAfterExit,
  runPostScenarioClearEffects,
  runPostScenarioResetEffects,
  scenarioDetailMinRatioStrict: SCENARIO_DETAIL_MIN_RATIO_STRICT,
  setScenarioAuditUiState,
  syncResolvedDefaultCountryPalette,
  applyBlankScenarioPresentationDefaults,
});

function getScenarioRegistryEntries() {
  return getBundleLoaderScenarioRegistryEntries(state);
}

function getScenarioDisplayName(source, fallbackId = "") {
  return getBundleLoaderScenarioDisplayName(source, fallbackId, t);
}

function getScenarioNameMap(countryMap = {}) {
  return getBundleLoaderScenarioNameMap(countryMap);
}

function getMissingScenarioNameTags(countryMap = {}, scenarioNameMap = {}) {
  const missing = [];
  Object.keys(countryMap || {}).forEach((rawTag) => {
    const normalizedTag = String(rawTag || "").trim().toUpperCase();
    if (!normalizedTag) {
      return;
    }
    const displayName = String(scenarioNameMap?.[normalizedTag] || "").trim();
    if (!displayName) {
      missing.push(normalizedTag);
    }
  });
  return missing;
}

function getScenarioFixedOwnerColors(
  countryMap = {}
) {
  return getBundleLoaderScenarioFixedOwnerColors(countryMap);
}


function getScenarioMetaById(scenarioId) {
  return getBundleLoaderScenarioMetaById(state, normalizeScenarioId, scenarioId);
}

function getDefaultScenarioId() {
  return getBundleLoaderDefaultScenarioId(state, normalizeScenarioId);
}

function getScenarioManifestSummary(manifest = runtimeState.activeScenarioManifest) {
  return getBundleLoaderScenarioManifestSummary(manifest);
}

function getActiveScenarioMergedChunkLayerPayload(layerKey, scenarioId = runtimeState.activeScenarioId) {
  const mergedLayerPayloads = runtimeState.activeScenarioChunks?.mergedLayerPayloads;
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  const normalizedChunkScenarioId = normalizeScenarioId(runtimeState.activeScenarioChunks?.scenarioId);
  // 这里故意保留三态：
  // undefined = chunk runtime 还没有接管这个 layer；
  // null = chunk 明确声明该 layer 当前为空；
  // object = 已有合并后的 layer payload。
  if (
    !normalizedScenarioId
    || normalizedChunkScenarioId !== normalizedScenarioId
    || !mergedLayerPayloads
    || typeof mergedLayerPayloads !== "object"
    || !Object.prototype.hasOwnProperty.call(mergedLayerPayloads, layerKey)
  ) {
    return undefined;
  }
  return mergedLayerPayloads[layerKey] || null;
}


function getScenarioDefaultCountryCode(manifest, countryMap = {}) {
  return getBundleLoaderDefaultCountryCode(manifest, countryMap);
}

function getScenarioMapSemanticMode(manifest, fallback = "political") {
  return normalizeMapSemanticMode(manifest?.map_mode, fallback);
}

function normalizeScenarioFeatureCollection(payload) {
  if (!Array.isArray(payload?.features)) {
    return null;
  }
  return {
    type: "FeatureCollection",
    features: payload.features,
  };
}

function getCachedScenarioBundle(scenarioId = runtimeState.activeScenarioId) {
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  if (!normalizedScenarioId) return null;
  return runtimeState.scenarioBundleCacheById?.[normalizedScenarioId] || null;
}

function setScenarioViewMode(
  viewMode,
  {
    renderNow = true,
    markDirtyReason = "",
  } = {}
) {
  void viewMode;
  void renderNow;
  void markDirtyReason;
  return false;
}

async function prepareScenarioDetailTopologyState({
  targetState = runtimeState,
  loadDetailBundle = loadDeferredDetailBundle,
  hasUsableTopology = hasUsablePoliticalTopology,
  detailSourceFallbackOrder = SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER,
} = {}) {
  const currentPatch = () => ({
    topologyDetail: targetState.topologyDetail,
    topologyBundleMode: targetState.topologyBundleMode,
    detailDeferred: targetState.detailDeferred,
    detailPromotionCompleted: targetState.detailPromotionCompleted,
    detailPromotionInFlight: targetState.detailPromotionInFlight,
    detailSourceRequested: targetState.detailSourceRequested,
  });
  const createResult = (
    detailPromoted,
    patch = currentPatch(),
  ) => ({
    detailPromoted: !!detailPromoted,
    scenarioReadinessPatch: patch,
  });
  const hasDetailNow = hasUsableTopology(targetState.topologyDetail);
  if (hasDetailNow) {
    return createResult(
      targetState.topologyBundleMode !== "composite",
      {
        ...currentPatch(),
        topologyBundleMode: "composite",
        detailDeferred: false,
        detailPromotionCompleted: true,
        detailPromotionInFlight: false,
      },
    );
  }
  if (targetState.detailPromotionInFlight) {
    return createResult(false);
  }
  const detailSourceKeys = Array.from(new Set([
    String(targetState.detailSourceRequested || "").trim(),
    String(targetState.activeScenarioManifest?.detail_source || "").trim(),
    ...(Array.isArray(detailSourceFallbackOrder)
      ? detailSourceFallbackOrder
      : []),
  ].filter(Boolean)));
  try {
    const {
      topologyDetail,
      runtimePoliticalTopology,
      detailSourceUsed,
    } = await loadDetailBundle({
      detailSourceKey:
        detailSourceKeys[0] || targetState.detailSourceRequested,
      detailSourceKeys,
    });
    const runtimeFallback =
      runtimePoliticalTopology
      || targetState.runtimePoliticalTopology
      || null;
    const resolvedDetail = hasUsableTopology(topologyDetail)
      ? topologyDetail
      : (
        hasUsableTopology(runtimeFallback)
          ? runtimeFallback
          : null
      );
    if (!resolvedDetail) {
      return createResult(false, {
        ...currentPatch(),
        detailDeferred: false,
        detailPromotionInFlight: false,
      });
    }
    return createResult(true, {
      topologyDetail: resolvedDetail,
      topologyBundleMode: "composite",
      detailDeferred: false,
      detailPromotionCompleted: true,
      detailPromotionInFlight: false,
      detailSourceRequested:
        detailSourceUsed
        || detailSourceKeys[0]
        || targetState.detailSourceRequested,
    });
  } catch (error) {
    const detailSourceSummary = detailSourceKeys.join(", ") || "(default)";
    const stagingError = new Error(
      `[scenario] Detail topology staging failed. Tried sources: ${detailSourceSummary}.`,
      { cause: error },
    );
    stagingError.code = "SCENARIO_DETAIL_TOPOLOGY_STAGING_FAILED";
    stagingError.detailSourceKeys = [...detailSourceKeys];
    throw stagingError;
  }
}

const {
  prepareScenarioApplyState,
  applyPreparedScenarioState,
} = createScenarioApplyPipeline({
  // prepare 负责解码并构造 staged state，apply 负责集中提交 runtimeState；这个分界把主要运行时写入推迟到 apply，便于 apply 失败后按 rollback 恢复旧场景。
  runtimeState: state,
  countryNames,
  normalizeScenarioId,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  scenarioBundleHasChunkedData,
  prepareScenarioDetailTopologyState,
  hasUsablePoliticalTopology,
  scenarioNeedsDetailTopology,
  getScenarioDisplayName,
  getScenarioTargetPaletteId,
  hasActiveScenarioPaletteLoaded,
  applyActivePaletteState,
  setActivePaletteSource,
  publishScenarioPaletteAndToolbarState,
  getScenarioDefaultCountryCode,
  getScenarioMapSemanticMode,
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
  normalizeScenarioCoreMap,
  normalizeScenarioDistrictGroupsPayload,
  getActiveScenarioMergedChunkLayerPayload,
  getScenarioDecodedCollection,
  getScenarioTopologyFeatureCollection,
  getScenarioNameMap,
  getMissingScenarioNameTags,
  getScenarioFixedOwnerColors,
  buildHoi4FarEastSovietOwnerBackfill,
  buildScenarioRuntimeVersionTag,
  mergeReleasableCatalogs,
  buildScenarioDistrictGroupByFeatureId,
  syncScenarioLocalizationState,
  applyBlankScenarioPresentationDefaults,
  setScenarioAuditUiState,
  getScenarioBaselineHashFromBundle,
  markLegacyColorStateDirty,
  syncScenarioInspectorSelection,
  disableScenarioParentBorders,
  applyScenarioPaintMode,
  syncScenarioOceanFillForActivation,
  applyScenarioPerformanceHints,
  scheduleScenarioChunkRefresh,
  awaitInitialScenarioChunkVisualPromotion,
  resetScenarioChunkRuntimeState,
  ensureRuntimeChunkLoadState,
  hasRenderableScenarioPoliticalTopology,
  normalizeScenarioFeatureCollection,
  cloneScenarioStateValue,
});

async function applyScenarioBundle(
  bundle,
  {
    renderNow = true,
    suppressRender = false,
    markDirtyReason = "scenario-apply",
    syncPalette = true,
    showToastOnComplete = false,
    interactionLevel = "full",
    deferChunkPrewarm = false,
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
    isScenarioApplyRequestCurrent: isScenarioApplyRequestStillCurrent = null,
  } = {}
) {
  const applyStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  if (!bundle?.manifest) {
    throw new Error("Scenario bundle is missing a manifest.");
  }
  const requestedScenarioId = normalizeScenarioId(bundle.manifest?.scenario_id || bundle.meta?.scenario_id);
  const transactionScenarioApplyEpoch = Math.max(0, Number(scenarioApplyEpoch || 0))
    || nextScenarioApplyEpoch(runtimeState, {
      scenarioId: requestedScenarioId,
      reason: markDirtyReason,
    });
  const transactionScenarioApplyRequestId = Math.max(0, Number(scenarioApplyRequestId || 0));
  const canContinueScenarioApplyRequest = () => (
    typeof isScenarioApplyRequestStillCurrent !== "function"
    || isScenarioApplyRequestStillCurrent()
  );
  recordRenderTransactionSnapshot(runtimeState, {
    phase: "scenario-apply-bundle-start",
    reason: markDirtyReason,
    requestedScenarioId,
    source: "scenario_manager",
    searchParams: getSearchParams(),
    extra: {
      allowScenarioMismatch: true,
      suppressRender: !!suppressRender,
      renderNow: !!renderNow,
      interactionLevel,
      deferChunkPrewarm: !!deferChunkPrewarm,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    },
  });
  const rollbackSnapshot = captureScenarioApplyRollbackSnapshot();
  let staged = null;
  let topologyDecodeMs = 0;
  const restoreStaleScenarioApplyRollbackSnapshot = ({ scenarioId, callbackPhase }) => {
    restoreScenarioApplyRollbackSnapshot(rollbackSnapshot);
    runPostRollbackRestoreEffects({ renderNow });
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-stale-rollback-complete",
      reason: markDirtyReason,
      requestedScenarioId: scenarioId,
      expectedScenarioId: rollbackSnapshot?.activeScenarioId || "",
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        allowScenarioMismatch: true,
        callbackPhase,
        resolution: "restored-rollback-snapshot",
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
  };
  try {
    // apply 主链顺序固定：先 stage、再一次性提交 runtimeState、再跑 post-apply 副作用和一致性检查。
    const topologyDecodeStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-prepare-start",
      reason: markDirtyReason,
      requestedScenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        allowScenarioMismatch: true,
        syncPalette: !!syncPalette,
        interactionLevel,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    staged = await prepareScenarioApplyState(bundle, {
      syncPalette,
      interactionLevel,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    });
    topologyDecodeMs = (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - topologyDecodeStartedAt;
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-staged",
      reason: markDirtyReason,
      requestedScenarioId: staged.scenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        allowScenarioMismatch: true,
        topologyDecodeMs,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        runtimeTopologyRenderable: hasRenderableScenarioPoliticalTopology(staged.runtimeTopologyPayload),
        runtimeVersionTag: staged.runtimeVersionTag || "",
        fixedOwnerColorCount: Object.keys(staged.scenarioColorMap || {}).length,
        coarseColorCount: Object.keys(staged.coarseColorMap || {}).length,
        resolvedOwnerCount: Object.keys(staged.resolvedOwners || {}).length,
      },
    });

    if (!canContinueScenarioApplyRequest()) {
      recordScenarioApplyRequestSnapshot({
        requestId: transactionScenarioApplyRequestId,
        scenarioId: staged.scenarioId,
        markDirtyReason,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
      }, {
        phase: "scenario-apply-stale-callback-skipped",
        reason: markDirtyReason,
        expectedScenarioId: staged.scenarioId,
        details: {
          callbackPhase: "commit-start",
          resolution: "skipped-stale-request",
        },
      });
      restoreStaleScenarioApplyRollbackSnapshot({
        scenarioId: staged.scenarioId,
        callbackPhase: "commit-start",
      });
      return;
    }

    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-commit-start",
      reason: markDirtyReason,
      requestedScenarioId: staged.scenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        allowScenarioMismatch: true,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    applyPreparedScenarioState(bundle, staged);
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-committed",
      reason: markDirtyReason,
      requestedScenarioId: staged.scenarioId,
      expectedScenarioId: staged.scenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        runtimeVersionTag: staged.runtimeVersionTag || "",
      },
    });
    recordScenarioApplyRequestSnapshot({
      requestId: transactionScenarioApplyRequestId,
      scenarioId: staged.scenarioId,
      markDirtyReason,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
    }, {
      phase: "scenario-apply-target-committed",
      reason: markDirtyReason,
      expectedScenarioId: staged.scenarioId,
      details: {
        resolution: "target-committed",
      },
    });
    if (Object.keys(staged.scenarioOwnerBackfill).length) {
      console.info(
        `[scenario] Applied HOI4 Far East owner backfill for "${staged.scenarioId}": ${Object.keys(staged.scenarioOwnerBackfill).length} missing RU runtime features -> SOV.`
      );
    }
    bundle.chunkLifecycle = {
      applyStartedAt,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
      politicalCoreReadyRecorded: false,
    };
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-post-apply-start",
      reason: markDirtyReason,
      requestedScenarioId: staged.scenarioId,
      expectedScenarioId: staged.scenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        deferChunkPrewarm: !!deferChunkPrewarm,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    if (!canContinueScenarioApplyRequest()) {
      recordScenarioApplyRequestSnapshot({
        requestId: transactionScenarioApplyRequestId,
        scenarioId: staged.scenarioId,
        markDirtyReason,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
      }, {
        phase: "scenario-apply-stale-callback-skipped",
        reason: markDirtyReason,
        expectedScenarioId: staged.scenarioId,
        details: {
          callbackPhase: "post-apply-start",
          resolution: "skipped-stale-request",
        },
      });
      return;
    }
    const {
      dataHealth,
      scenarioMapRefreshMode,
      hasChunkedRuntime,
      chunkPrewarmAwaited = true,
      chunkPrewarmDeferred = false,
      coarsePrewarmCommitted = false,
      prewarmFailed = false,
    } = await runPostScenarioApplyEffects({
      bundle,
      scenarioId: staged.scenarioId,
      deferChunkPrewarm,
      renderNow,
      suppressRender,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
      isScenarioApplyRequestCurrent: canContinueScenarioApplyRequest,
    });
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-post-apply-complete",
      reason: markDirtyReason,
      requestedScenarioId: staged.scenarioId,
      expectedScenarioId: staged.scenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        scenarioMapRefreshMode,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        hasChunkedRuntime: !!hasChunkedRuntime,
        chunkPrewarmAwaited: !!chunkPrewarmAwaited,
        chunkPrewarmDeferred: !!chunkPrewarmDeferred,
        coarsePrewarmCommitted: !!coarsePrewarmCommitted,
        dataHealth: {
          expectedFeatureCount: Number(dataHealth?.expectedFeatureCount || 0),
          runtimeFeatureCount: Number(dataHealth?.runtimeFeatureCount || 0),
          ratio: Number(dataHealth?.ratio || 0),
          warning: String(dataHealth?.warning || ""),
          severity: String(dataHealth?.severity || ""),
        },
      },
    });
    if (bundle.loadDiagnostics?.startupBundle) {
      const startupHydrationHealth = evaluateScenarioHydrationHealthGateState({
        phase: "startup",
      });
      if (!startupHydrationHealth.ok) {
        throw new Error(
          `[scenario] Startup hydration health gate failed for "${staged.scenarioId}". reason=${
            !startupHydrationHealth.report.healthy
              ? startupHydrationHealth.report.reason
              : startupHydrationHealth.overlayConsistency.reason
          }, overlap=${startupHydrationHealth.report.overlapCount}/${startupHydrationHealth.report.renderedFeatureCount}, ratio=${startupHydrationHealth.report.overlapRatio.toFixed(3)}`
        );
      }
    }
    const currentPoliticalCoreReadyMetric = runtimeState.scenarioPerfMetrics?.timeToPoliticalCoreReady;
    const hasCurrentPoliticalCoreReadyMetric =
      currentPoliticalCoreReadyMetric
      && String(currentPoliticalCoreReadyMetric.scenarioId || "") === staged.scenarioId;
    const postApplyReadyMs = (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt;
    const canRecordPostApplyCoarseMetric = !hasChunkedRuntime || coarsePrewarmCommitted;
    if (chunkPrewarmDeferred) {
      recordScenarioPerfMetric("timeToStartupShellApplyReady", postApplyReadyMs, {
        scenarioId: staged.scenarioId,
        source: "post-apply-startup-shell-ready",
        readinessLevel: "startup-shell-apply-ready",
        hasChunkedRuntime,
        mapRefreshMode: scenarioMapRefreshMode,
        chunkPrewarmAwaited,
        chunkPrewarmDeferred,
        coarsePrewarmCommitted,
      });
    } else if (
      canRecordPostApplyCoarseMetric
      &&
      !hasCurrentPoliticalCoreReadyMetric
      && (
        hasChunkedRuntime
        || !!runtimeState.scenarioPoliticalChunkData
        || hasRenderableScenarioPoliticalTopology(runtimeState.runtimePoliticalTopology)
      )
    ) {
      recordScenarioPerfMetric(
        "timeToPoliticalCoreReady",
        postApplyReadyMs,
        {
          scenarioId: staged.scenarioId,
          source: "post-apply-coarse-ready",
          readinessLevel: "coarse-chunk",
          hasChunkedRuntime,
          mapRefreshMode: scenarioMapRefreshMode,
          chunkPrewarmAwaited,
          chunkPrewarmDeferred,
          coarsePrewarmCommitted,
        }
      );
      if (bundle?.chunkLifecycle) {
        bundle.chunkLifecycle.politicalCoreReadyRecorded = true;
      }
    }
    if (!chunkPrewarmDeferred && canRecordPostApplyCoarseMetric) {
      recordScenarioPerfMetric(
        "timeToInteractiveCoarseFrame",
        postApplyReadyMs,
        {
          scenarioId: staged.scenarioId,
          source: "post-apply-coarse-ready",
          readinessLevel: "coarse-chunk",
          hasChunkedRuntime,
          mapRefreshMode: scenarioMapRefreshMode,
          chunkPrewarmAwaited,
          chunkPrewarmDeferred,
          coarsePrewarmCommitted,
        }
      );
    }
    if (typeof document !== "undefined") {
      const presetSection = document.getElementById("selectedCountryActionsSection");
      if (presetSection && "open" in presetSection) {
        presetSection.open = true;
      }
    }

    // Diagnostic: verify key ownership assignments took effect.
    const spotChecks = [
      "SYR-134",
      "LBN-3022",
      "BY_HIST_POL_VITEBSK_WEST",
      "CN_CITY_17275852B74586174185496",
      "CN_CITY_17275852B2295538790743",
    ];
    if (String(runtimeState.debugMode || "PROD") !== "PROD") {
      spotChecks.forEach((fid) => {
        const owner = runtimeState.sovereigntyByFeatureId[fid];
        if (owner) {
          const color = staged.scenarioColorMap[owner] || "(no color)";
          console.log(`[scenario] Spot-check: ${fid} -> owner=${owner}, color=${color}`);
        }
      });
    }
    const shouldExposeDetailVisibilityWarning =
      !!dataHealth.warning
      && !shouldSuppressChunkedPostApplyDataHealthSignals({
        hasChunkedRuntime,
        prewarmFailed,
        chunkErrorCount: Object.keys(runtimeState.runtimeChunkLoadState?.errorByChunkId || {}).length,
      })
      && !bundle?.loadDiagnostics?.startupBundle
      && !runtimeState.startupReadonly
      && !runtimeState.startupReadonlyUnlockInFlight
      && !runtimeState.detailPromotionInFlight;
    if (shouldExposeDetailVisibilityWarning) {
      console.warn(
        `[scenario] Detail visibility gate triggered for ${staged.scenarioId}: runtime=${dataHealth.runtimeFeatureCount}, expected=${dataHealth.expectedFeatureCount}, ratio=${dataHealth.ratio.toFixed(3)} (min=${dataHealth.minRatio}); hasChunkedRuntime=${!!hasChunkedRuntime}, chunkPrewarmAwaited=${!!chunkPrewarmAwaited}, chunkPrewarmDeferred=${!!chunkPrewarmDeferred}, coarsePrewarmCommitted=${!!coarsePrewarmCommitted}, prewarmFailed=${!!prewarmFailed}.`
      );
    }
    const applyConsistency = validateScenarioRuntimeConsistency({
      expectedScenarioId: staged.scenarioId,
      phase: "apply",
    });
    if (!applyConsistency.ok) {
      throw new Error(
        `[scenario] Scenario state consistency check failed after apply: ${applyConsistency.problems.join(" ")}`
      );
    }
    clearScenarioFatalRecoveryState();
    if (markDirtyReason) {
      markDirty(markDirtyReason);
    }
    if (typeof runtimeState.triggerScenarioGuideFn === "function") {
      runtimeState.triggerScenarioGuideFn();
    }

    if (showToastOnComplete) {
      showToast(
        t("Scenario loaded. Expand the parent country and use Activate to apply releasable territory.", "ui"),
        {
          title: t("Scenario loaded", "ui"),
          tone: "success",
          duration: 4200,
        }
      );
    }
    recordScenarioPerfMetric("applyScenarioBundle", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt, {
      scenarioId: staged.scenarioId,
      expectedFeatureCount: Number(bundle.manifest?.summary?.feature_count || 0),
      runtimeFeatureCount: Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features.length : 0,
      topologyDecodeMs,
      mapRefreshMode: scenarioMapRefreshMode,
      applyMs: (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt,
    });
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-complete",
      reason: markDirtyReason,
      requestedScenarioId: staged.scenarioId,
      expectedScenarioId: staged.scenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        topologyDecodeMs,
        scenarioMapRefreshMode,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
  } catch (error) {
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-rollback-start",
      reason: markDirtyReason,
      requestedScenarioId: staged?.scenarioId || requestedScenarioId,
      expectedScenarioId: rollbackSnapshot?.activeScenarioId || "",
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        error: String(error?.message || error || "Unknown scenario apply error"),
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        allowScenarioMismatch: true,
      },
    });
    // rollback 只恢复 apply 前快照；若快照恢复或恢复后一致性检查失败，进入 fatal recovery，阻止 UI 继续操作半提交状态。
    let rollbackRestoreError = null;
    try {
      restoreScenarioApplyRollbackSnapshot(rollbackSnapshot, {
        shouldFailRestore: consumeScenarioTestHook("failRollbackRestoreOnce"),
      });
      runPostRollbackRestoreEffects({ renderNow });
    } catch (rollbackError) {
      rollbackRestoreError = rollbackError;
      console.error("[scenario] Failed to restore scenario apply rollback snapshot.", rollbackError);
    }
    if (rollbackRestoreError) {
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-apply-rollback-failed",
        reason: markDirtyReason,
        requestedScenarioId: staged?.scenarioId || requestedScenarioId,
        expectedScenarioId: rollbackSnapshot?.activeScenarioId || "",
        source: "scenario_manager",
        searchParams: getSearchParams(),
        extra: {
          error: String(rollbackRestoreError?.message || rollbackRestoreError || "Unknown rollback error"),
          scenarioApplyEpoch: transactionScenarioApplyEpoch,
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
          allowScenarioMismatch: true,
        },
      });
      enterScenarioFatalRecovery({
        phase: "rollback",
        rootError: error,
        rollbackError: rollbackRestoreError,
      });
      const fatalError = buildScenarioFatalRecoveryError("recover the previous scenario state");
      fatalError.cause = error;
      throw fatalError;
    }
    const rollbackConsistency = validateScenarioRuntimeConsistency({
      expectedScenarioId: rollbackSnapshot?.activeScenarioId,
      phase: "rollback",
    });
    if (!rollbackConsistency.ok) {
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-apply-rollback-failed",
        reason: markDirtyReason,
        requestedScenarioId: staged?.scenarioId || requestedScenarioId,
        expectedScenarioId: rollbackSnapshot?.activeScenarioId || "",
        source: "scenario_manager",
        searchParams: getSearchParams(),
        extra: {
          consistencyProblems: rollbackConsistency.problems || [],
          scenarioApplyEpoch: transactionScenarioApplyEpoch,
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
          allowScenarioMismatch: true,
        },
      });
      enterScenarioFatalRecovery({
        phase: "rollback",
        rootError: error,
        consistencyReport: rollbackConsistency,
      });
      const fatalError = buildScenarioFatalRecoveryError("recover the previous scenario state");
      fatalError.cause = error;
      throw fatalError;
    }
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-rollback-complete",
      reason: markDirtyReason,
      requestedScenarioId: staged?.scenarioId || requestedScenarioId,
      expectedScenarioId: rollbackSnapshot?.activeScenarioId || "",
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    throw error;
  }
}

async function runScenarioApplyRequest(request) {
  if (!request?.scenarioId) {
    throw new Error("[scenario] Scenario id is required.");
  }
  if (getScenarioFatalRecoveryState()) {
    recordScenarioApplyRequestSnapshot(request, {
      phase: "scenario-apply-queue-drain-skipped-stale",
      reason: request.markDirtyReason,
      expectedScenarioId: request.scenarioId,
      details: {
        resolution: "fatal-recovery-lock",
      },
    });
    return null;
  }
  beginScenarioApplyRequestState(runtimeState, {
    requestId: request.requestId,
    targetId: request.scenarioId,
  });
  activeScenarioApplyTargetId = request.scenarioId;
  activeScenarioApplyRequestId = request.requestId;
  activeScenarioApplyPromise = (async () => {
    // 同一时刻只允许一个 scenario apply；UI 先同步为“加载中”，finally 再同步结束态，避免控件读到中间状态。
    syncScenarioUi();
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-load-bundle-start",
      reason: request.markDirtyReason,
      requestedScenarioId: request.scenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        scenarioApplyEpoch: request.scenarioApplyEpoch,
        scenarioApplyRequestId: request.requestId,
        allowScenarioMismatch: true,
      },
    });
    const bundle = await loadScenarioBundle(request.scenarioId, { bundleLevel: "full" });
    void scheduleScenarioDeferredBundleMetadataLoad(bundle, {
      scenarioApplyEpoch: request.scenarioApplyEpoch,
      scenarioApplyRequestId: request.requestId,
      isScenarioApplyRequestCurrent: () => isScenarioApplyRequestCurrent(request),
    });
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-load-bundle-complete",
      reason: request.markDirtyReason,
      requestedScenarioId: request.scenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        scenarioApplyEpoch: request.scenarioApplyEpoch,
        scenarioApplyRequestId: request.requestId,
        allowScenarioMismatch: true,
        bundleLevel: String(bundle?.bundleLevel || "full"),
      },
    });
    await applyScenarioBundle(bundle, {
      renderNow: request.renderNow,
      markDirtyReason: request.markDirtyReason,
      showToastOnComplete: request.showToastOnComplete,
      scenarioApplyEpoch: request.scenarioApplyEpoch,
      scenarioApplyRequestId: request.requestId,
      isScenarioApplyRequestCurrent: () => isScenarioApplyRequestCurrent(request),
    });
    return bundle;
  })();
  const requestPromise = activeScenarioApplyPromise;

  try {
    return await requestPromise;
  } finally {
    if (activeScenarioApplyPromise === requestPromise && activeScenarioApplyRequestId === request.requestId) {
      activeScenarioApplyPromise = null;
      activeScenarioApplyTargetId = "";
      activeScenarioApplyRequestId = 0;
      clearActiveScenarioApplyRequestState(runtimeState);
      syncScenarioUi();
    }
  }
}

function queueLatestScenarioApplyRequest(request) {
  const replacedRequest = latestQueuedScenarioApplyRequest;
  if (replacedRequest && replacedRequest.requestId !== request.requestId) {
    recordScenarioApplyRequestSnapshot(replacedRequest, {
      phase: "scenario-apply-queue-drain-skipped-stale",
      reason: replacedRequest.markDirtyReason,
      expectedScenarioId: replacedRequest.scenarioId,
      details: {
        resolution: "replaced-by-latest-request",
        replacedByScenarioApplyRequestId: request.requestId,
        replacedByScenarioId: request.scenarioId,
      },
    });
  }
  latestQueuedScenarioApplyRequest = request;
  recordScenarioApplyRequestSnapshot(request, {
    phase: "scenario-apply-queued-latest-target",
    reason: request.markDirtyReason,
    expectedScenarioId: activeScenarioApplyTargetId || request.scenarioId,
    details: {
      resolution: "queued-latest-request",
      queuedTargetId: request.scenarioId,
    },
  });
}

function drainQueuedScenarioApplyRequests() {
  if (queuedScenarioApplyDrainPromise) {
    return queuedScenarioApplyDrainPromise;
  }
  queuedScenarioApplyDrainPromise = (async () => {
    let finalResult = null;
    const activePromiseAtDrainStart = activeScenarioApplyPromise;
    if (activePromiseAtDrainStart) {
      try {
        await activePromiseAtDrainStart;
      } catch (error) {
        recordRenderTransactionSnapshot(runtimeState, {
          phase: "scenario-apply-queue-drain-active-settled-with-error",
          reason: latestQueuedScenarioApplyRequest?.markDirtyReason || "scenario-apply",
          requestedScenarioId: latestQueuedScenarioApplyRequest?.scenarioId || "",
          expectedScenarioId: activeScenarioApplyTargetId || "",
          source: "scenario_manager",
          searchParams: getSearchParams(),
          extra: {
            allowScenarioMismatch: true,
            error: String(error?.message || error || "Unknown scenario apply error"),
            scenarioApplyEpoch: Math.max(0, Number(latestQueuedScenarioApplyRequest?.scenarioApplyEpoch || 0)),
            scenarioApplyRequestId: Math.max(0, Number(latestQueuedScenarioApplyRequest?.requestId || 0)),
          },
        });
      }
    }
    while (latestQueuedScenarioApplyRequest) {
      const request = latestQueuedScenarioApplyRequest;
      latestQueuedScenarioApplyRequest = null;
      if (getScenarioFatalRecoveryState()) {
        recordScenarioApplyRequestSnapshot(request, {
          phase: "scenario-apply-queue-drain-skipped-stale",
          reason: request.markDirtyReason,
          expectedScenarioId: request.scenarioId,
          details: {
            resolution: "fatal-recovery-lock",
          },
        });
        break;
      }
      const cachedScenarioBundle = runtimeState.scenarioBundleCacheById?.[request.scenarioId] || null;
      if (canReuseActiveScenarioBundle(cachedScenarioBundle, request.scenarioId)) {
        recordScenarioApplyRequestSnapshot(request, {
          phase: "scenario-apply-queue-drain-skipped-stale",
          reason: request.markDirtyReason,
          expectedScenarioId: request.scenarioId,
          details: {
            resolution: "already-current-target",
          },
        });
        finalResult = cachedScenarioBundle;
        continue;
      }
      recordScenarioApplyRequestSnapshot(request, {
        phase: "scenario-apply-queue-drain-started",
        reason: request.markDirtyReason,
        expectedScenarioId: request.scenarioId,
        details: {
          resolution: "started-latest-request",
        },
      });
      finalResult = await runScenarioApplyRequest(request);
      recordScenarioApplyRequestSnapshot(request, {
        phase: "scenario-apply-queue-drain-complete",
        reason: request.markDirtyReason,
        expectedScenarioId: request.scenarioId,
        details: {
          resolution: "completed-latest-request",
          finalActiveScenarioId: normalizeScenarioId(runtimeState.activeScenarioId),
        },
      });
    }
    return finalResult;
  })().finally(() => {
    queuedScenarioApplyDrainPromise = null;
  });
  return queuedScenarioApplyDrainPromise;
}

/**
 * Scenario switch entrypoint for selecting and applying one scenario id.
 * Major state write surface:
 * - runtimeState.scenarioApplyInFlight / activeScenarioApplyPromise lifecycle.
 * - runtimeState.scenarioBundleCacheById reuse via full bundle loading.
 * - active scenario state fields written by applyScenarioBundle pipeline.
 */
async function applyScenarioById(
  scenarioId,
  {
    renderNow = true,
    markDirtyReason = "scenario-apply",
    showToastOnComplete = false,
  } = {}
) {
  assertScenarioInteractionsAllowed("apply a scenario");
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  if (!normalizedScenarioId) {
    throw new Error("[scenario] Scenario id is required.");
  }
  const cachedScenarioBundle = runtimeState.scenarioBundleCacheById?.[normalizedScenarioId] || null;
  const reuseCachedScenarioBundle =
    !runtimeState.scenarioApplyInFlight
    && !activeScenarioApplyPromise
    && canReuseActiveScenarioBundle(
      cachedScenarioBundle,
      normalizedScenarioId,
    );
  const reuseActiveScenarioApply = Boolean(
    runtimeState.scenarioApplyInFlight
    && activeScenarioApplyPromise
    && (
      !activeScenarioApplyTargetId
      || activeScenarioApplyTargetId === normalizedScenarioId
    ),
  );
  const scenarioApplyEpoch =
    reuseCachedScenarioBundle || reuseActiveScenarioApply
      ? 0
      : nextScenarioApplyEpoch(runtimeState, {
        scenarioId: normalizedScenarioId,
        reason: markDirtyReason,
      });
  const request = createScenarioApplyRequest(normalizedScenarioId, {
    renderNow,
    markDirtyReason,
    showToastOnComplete,
    scenarioApplyEpoch,
  });
  setLatestScenarioApplyRequestState(runtimeState, {
    requestId: Number(request.requestId),
    targetId: normalizedScenarioId,
  });
  recordRenderTransactionSnapshot(runtimeState, {
    phase: "scenario-apply-requested",
    reason: markDirtyReason,
    requestedScenarioId: normalizedScenarioId,
    source: "scenario_manager",
    searchParams: getSearchParams(),
    extra: {
      scenarioApplyEpoch,
      scenarioApplyRequestId: request.requestId,
      allowScenarioMismatch: true,
      renderNow: !!renderNow,
      showToastOnComplete: !!showToastOnComplete,
    },
  });
  if (reuseCachedScenarioBundle) {
    latestQueuedScenarioApplyRequest = null;
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-cache-hit",
      reason: markDirtyReason,
      requestedScenarioId: normalizedScenarioId,
      expectedScenarioId: normalizedScenarioId,
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        scenarioApplyEpoch,
        scenarioApplyRequestId: request.requestId,
      },
    });
    return cachedScenarioBundle;
  }
  if (runtimeState.scenarioApplyInFlight && activeScenarioApplyPromise) {
    if (reuseActiveScenarioApply) {
      latestQueuedScenarioApplyRequest = null;
      recordScenarioApplyRequestSnapshot(request, {
        phase: "scenario-apply-reused-active-target",
        reason: markDirtyReason,
        expectedScenarioId:
          activeScenarioApplyTargetId || normalizedScenarioId,
        details: {
          resolution: "reused-active-target",
          reusedScenarioApplyRequestId: activeScenarioApplyRequestId,
        },
      });
      return activeScenarioApplyPromise;
    }
    recordRenderInvariantWarning(runtimeState, {
      code: RENDER_TRANSACTION_WARNING_CODES.scenarioApplyInflightTargetMismatch,
      phase: "scenario-apply-requested",
      reason: markDirtyReason,
      details: {
        activeScenarioApplyTargetId,
        activeScenarioApplyRequestId,
        requestedScenarioId: normalizedScenarioId,
        requestedScenarioApplyRequestId: request.requestId,
        queuedScenarioApplyTargetId: normalizedScenarioId,
        resolution: "queued-latest-request",
      },
    });
    queueLatestScenarioApplyRequest(request);
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-queued-latest-target",
      reason: markDirtyReason,
      requestedScenarioId: normalizedScenarioId,
      expectedScenarioId: activeScenarioApplyTargetId || "",
      source: "scenario_manager",
      searchParams: getSearchParams(),
      extra: {
        scenarioApplyEpoch,
        scenarioApplyRequestId: request.requestId,
        activeScenarioApplyTargetId,
        activeScenarioApplyRequestId,
        queuedScenarioApplyTargetId: request.scenarioId,
        resolution: "queued-latest-request",
        allowScenarioMismatch: true,
      },
    });
    return drainQueuedScenarioApplyRequests();
  }

  return runScenarioApplyRequest(request);
}

async function applyDefaultScenarioOnStartup(
  {
    renderNow = true,
    d3Client = globalThis.d3,
  } = {}
) {
  if (runtimeState.activeScenarioId) {
    return null;
  }
  const registry = await loadScenarioRegistry({ d3Client });
  const defaultScenarioId = normalizeScenarioId(registry?.default_scenario_id);
  if (!defaultScenarioId) {
    return null;
  }
  const meta = getScenarioMetaById(defaultScenarioId);
  if (!meta?.manifest_url) {
    console.warn(`[scenario] Default scenario "${defaultScenarioId}" is not registered.`);
    return null;
  }
  return applyScenarioById(defaultScenarioId, {
    renderNow,
    markDirtyReason: "",
    showToastOnComplete: false,
  });
}

function resetToScenarioBaseline(options = {}) {
  assertScenarioInteractionsAllowed("reset the active scenario");
  const {
    renderNow = true,
    markDirtyReason = "scenario-reset",
    showToastOnComplete = false,
  } = options;
  return resetToScenarioBaselineRuntime({
    renderNow,
    markDirtyReason,
    showToastOnComplete,
    showToast,
    t,
  });
}

function clearActiveScenario(options = {}) {
  const {
    allowDuringBootBlocking = false,
  } = options;
  assertScenarioInteractionsAllowed("exit the active scenario", {
    allowDuringBootBlocking,
  });
  const {
    renderNow = true,
    markDirtyReason = "scenario-clear",
    showToastOnComplete = false,
  } = options;
  return clearActiveScenarioRuntime({
    renderNow,
    markDirtyReason,
    showToastOnComplete,
    showToast,
    t,
  });
}

function formatScenarioStatusText() {
  const fatalState = getScenarioFatalRecoveryState();
  if (fatalState) {
    if (!runtimeState.activeScenarioId || !runtimeState.activeScenarioManifest) {
      return formatScenarioFatalRecoveryMessage(fatalState);
    }
    const displayName = getScenarioDisplayName(runtimeState.activeScenarioManifest, runtimeState.activeScenarioId);
    return `${displayName} - ${formatScenarioFatalRecoveryMessage(fatalState)}`;
  }
  if (!runtimeState.activeScenarioId || !runtimeState.activeScenarioManifest) {
    return t("No scenario active", "ui");
  }
  const displayName = getScenarioDisplayName(runtimeState.activeScenarioManifest, runtimeState.activeScenarioId);
  const liveHealth = evaluateScenarioDataHealth(runtimeState.activeScenarioManifest, {
    minRatio: Number(runtimeState.scenarioDataHealth?.minRatio || SCENARIO_DETAIL_MIN_RATIO_STRICT),
  });
  const warning = String(liveHealth?.warning ?? runtimeState.scenarioDataHealth?.warning ?? "").trim();
  if (
    runtimeState.scenarioHydrationHealthGate?.status === "degraded"
    && String(runtimeState.scenarioHydrationHealthGate?.reason || "").startsWith("runtime-overlay-")
  ) {
    return `${displayName} · ${t("Overlay fallback active; editing remains available.", "ui")}`;
  }
  return warning ? `${displayName} · ${warning}` : displayName;
}

function formatScenarioAuditText() {
  if (getScenarioFatalRecoveryState()) {
    return t("Scenario controls are locked until the page reloads.", "ui");
  }
  if (!runtimeState.activeScenarioId || !runtimeState.activeScenarioManifest) {
    return "";
  }
  return t("Ownership baseline active.", "ui");
}

export {
  applyScenarioBundle,
  applyScenarioById,
  clearActiveScenario,
  formatScenarioAuditText,
  formatScenarioStatusText,
  getDefaultScenarioId,
  getScenarioDisplayName,
  getScenarioRegistryEntries,
  normalizeScenarioId,
  prepareScenarioDetailTopologyState,
  resetToScenarioBaseline,
  setScenarioViewMode,
};

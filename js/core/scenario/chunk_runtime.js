// Chunk runtime controller.
// 这个模块只负责 chunk runtime 的 runtimeState、selection、promotion、refresh/schedule。
// facade、startup cache、hydrate 主交易仍留在 scenario_resources.js。

import {
  getChunkIdListSignature,
  buildScenarioChunkLayerSelectionSignatures,
  buildMergedScenarioChunkLayerPayloads,
} from "./chunk_layer_payloads.js";
import { createScenarioChunkPayloadLoader } from "./chunk_payload_loader.js";

function composeScenarioChunkPayloadLoader(runtimeState, normalizeScenarioId, getScenarioBundleId, loadScenarioChunkFile) {
  const owner = createScenarioChunkPayloadLoader({
    runtimeState, normalizeScenarioId, getScenarioBundleId, loadScenarioChunkFile,
  });
  return owner;
}
import { registerRuntimeHook } from "../state/index.js";
import { setRenderPerfMetricEntryState } from "../state/actions/renderer_diagnostics_actions.js";
import {
  captureScenarioChunkLoadStateContinuation,
  clearScenarioChunkPromotionState,
  commitScenarioChunkPayloadEntriesState,
  commitScenarioChunkSelectionState,
  ensureScenarioChunkRuntimeState,
  evictScenarioChunkPayloadsState,
  patchScenarioChunkLoadState,
  queueScenarioChunkPromotionState,
  replaceScenarioChunkPendingPromotionIdentityState,
  resetScenarioChunkRuntimeState as resetScenarioChunkRuntimeStateAction,
  setScenarioChunkMergedLayerPayloadsState,
  setScenarioChunkPromotionStatusState,
} from "../state/actions/scenario_chunk_runtime_actions.js";
import {
  SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS,
  applyScenarioChunkOptionalLayerState,
  captureScenarioChunkPromotionState,
  restoreScenarioChunkPromotionState,
} from "../state/actions/scenario_activation_actions.js";
import {
  finalizeScenarioChunkCityExternalEffectState,
} from "../state/actions/scenario_presentation_actions.js";
import {
  bumpScenarioChunkDataGenerationState,
  captureScenarioChunkPromotionRootState,
  commitScenarioPoliticalChunkPayloadState,
  restoreScenarioChunkPromotionRootState,
  setScenarioChunkPromotionRenderLockState,
} from "../state/actions/scenario_chunk_promotion_actions.js";
import {
  recordRenderTransactionSnapshot as recordRenderTransactionSnapshotBase,
} from "../renderer/render_transaction_diagnostics.js";

const FOCUS_COUNTRY_OVERRIDE_TTL_MS = 5000;
const STARTUP_INITIAL_VISUAL_READY_TIMEOUT_MS = 8000;
const SCENARIO_CHUNK_FULL_WORLD_BBOX = Object.freeze([-180, -90, 180, 90]);

// zoom-end 之后短时间保留刚刚可见的 detail chunk，避免视图刚停稳就被立即驱逐，
// 造成 detail geometry 闪烁或 post-apply 刷新反复打架。
function clearZoomEndChunkProtectionState(target) {
  const loadState = target?.runtimeChunkLoadState;
  if (!loadState) return;
  patchScenarioChunkLoadState(target, {
    zoomEndProtectedChunkIds: [],
    zoomEndProtectedUntil: 0,
    zoomEndProtectedSelectionVersion: 0,
    zoomEndProtectedScenarioId: "",
    zoomEndProtectedFocusCountry: "",
  });
}

function isZoomEndChunkProtectionContextValid(protectionState = {}, {
  scenarioId = "",
  selectionVersion = 0,
  focusCountry = "",
  normalizeScenarioIdFn = (value) => String(value || "").trim(),
  nowMs = Date.now(),
  ttlMs = 5000,
} = {}) {
  const protectedScenarioId = normalizeScenarioIdFn(protectionState?.scenarioId);
  const requestedScenarioId = normalizeScenarioIdFn(scenarioId);
  const protectedSelectionVersion = Math.max(0, Number(protectionState?.selectionVersion || 0));
  const requestedSelectionVersion = Math.max(0, Number(selectionVersion || 0));
  const protectedFocusCountry = String(protectionState?.focusCountry || "").trim().toUpperCase();
  const requestedFocusCountry = String(focusCountry || "").trim().toUpperCase();
  const recordedAt = Math.max(0, Number(protectionState?.recordedAt || 0));
  const expiresAt = Math.max(
    0,
    Number(protectionState?.expiresAt || 0)
    || (recordedAt > 0 ? recordedAt + Math.max(0, Number(ttlMs || 0)) : 0),
  );
  return (
    expiresAt > 0
    && Number(nowMs || 0) <= expiresAt
    && protectedSelectionVersion === requestedSelectionVersion
    && protectedScenarioId === requestedScenarioId
    && protectedFocusCountry === requestedFocusCountry
  );
}

function protectZoomEndChunksForSelection(target, chunkIds = [], {
  scenarioId = "",
  selectionVersion = 0,
  focusCountry = "",
  normalizeScenarioIdFn = (value) => String(value || "").trim(),
  nowMs = Date.now(),
} = {}) {
  const loadState = target?.runtimeChunkLoadState;
  if (!loadState) return;
  const protectedChunkIds = Array.from(new Set(
    (Array.isArray(chunkIds) ? chunkIds : [])
      .map((chunkId) => String(chunkId || "").trim())
      .filter(Boolean)
      .filter((chunkId) => chunkId.startsWith("political.detail."))
  ));
  patchScenarioChunkLoadState(target, {
    zoomEndProtectedChunkIds: protectedChunkIds,
    zoomEndProtectedUntil:
      protectedChunkIds.length ? Number(nowMs || 0) + 5000 : 0,
    zoomEndProtectedSelectionVersion:
      protectedChunkIds.length
        ? Math.max(0, Number(selectionVersion || 0))
        : 0,
    zoomEndProtectedScenarioId:
      protectedChunkIds.length ? normalizeScenarioIdFn(scenarioId) : "",
    zoomEndProtectedFocusCountry:
      protectedChunkIds.length
        ? String(focusCountry || "").trim().toUpperCase()
        : "",
  });
}

function applyZoomEndChunkProtectionToSelection(selection, target, {
  reason = "",
  previousSelection = null,
  scenarioId = "",
  selectionVersion = 0,
  focusCountry = "",
  normalizeScenarioIdFn = (value) => String(value || "").trim(),
  nowMs = Date.now(),
} = {}, loadState = null) {
  if (!selection || !Array.isArray(selection.evictableChunkIds)) return false;
  const protectedSet = new Set();
  const loadStateProtectedChunkIds = Array.isArray(loadState?.zoomEndProtectedChunkIds)
    ? loadState.zoomEndProtectedChunkIds.map((chunkId) => String(chunkId || "").trim()).filter(Boolean)
    : [];
  const canApplyLoadStateProtection = loadStateProtectedChunkIds.length > 0
    && isZoomEndChunkProtectionContextValid({
      scenarioId: loadState?.zoomEndProtectedScenarioId,
      selectionVersion: loadState?.zoomEndProtectedSelectionVersion,
      focusCountry: loadState?.zoomEndProtectedFocusCountry,
      expiresAt: loadState?.zoomEndProtectedUntil,
    }, {
      scenarioId,
      selectionVersion,
      focusCountry,
      normalizeScenarioIdFn,
      nowMs,
    });
  if (canApplyLoadStateProtection) {
    loadStateProtectedChunkIds.forEach((chunkId) => protectedSet.add(chunkId));
  }
  clearZoomEndChunkProtectionState(target);
  const normalizedReason = String(reason || "").trim().toLowerCase();
  const shouldApplyPreviousSelectionProtection = ["render-phase-idle", "exact-after-settle", "scenario-apply", "scenario-apply-detail-prewarm"]
    .includes(normalizedReason);
  const previousRequiredChunkIds = (Array.isArray(previousSelection?.requiredChunkIds) ? previousSelection.requiredChunkIds : [])
    .map((chunkId) => String(chunkId || "").trim())
    .filter((chunkId) => chunkId.startsWith("political.detail."));
  const previousRetainedActiveChunkIds = (Array.isArray(previousSelection?.retainedActiveChunkIds) ? previousSelection.retainedActiveChunkIds : [])
    .map((chunkId) => String(chunkId || "").trim())
    .filter((chunkId) => chunkId.startsWith("political.detail."));
  const previousProtectedChunkIds = Array.from(new Set([
    ...previousRequiredChunkIds,
    ...previousRetainedActiveChunkIds,
  ]));
  if (
    shouldApplyPreviousSelectionProtection
    && previousProtectedChunkIds.length > 0
    && isZoomEndChunkProtectionContextValid({
      recordedAt: previousSelection?.recordedAt,
      expiresAt: previousSelection?.zoomEndProtectionUntil,
      scenarioId: previousSelection?.scenarioId,
      selectionVersion: previousSelection?.selectionVersion,
      focusCountry: previousSelection?.focusCountry,
    }, {
      scenarioId,
      selectionVersion,
      focusCountry,
      normalizeScenarioIdFn,
      nowMs,
    })
  ) {
    previousProtectedChunkIds.forEach((chunkId) => protectedSet.add(chunkId));
  }
  if (!protectedSet.size) {
    return false;
  }
  const previousEvictableCount = selection.evictableChunkIds.length;
  const retainedActiveChunkIds = [];
  selection.evictableChunkIds = selection.evictableChunkIds.filter((chunkId) => {
    const normalizedChunkId = String(chunkId || "").trim();
    if (!protectedSet.has(normalizedChunkId)) return true;
    if (normalizedChunkId.startsWith("political.detail.")) {
      retainedActiveChunkIds.push(normalizedChunkId);
    }
    return false;
  });
  if (retainedActiveChunkIds.length) {
    selection.retainedActiveChunkIds = Array.from(new Set([
      ...(Array.isArray(selection.retainedActiveChunkIds) ? selection.retainedActiveChunkIds : []),
      ...retainedActiveChunkIds,
    ]));
  }
  const protectedEvictionCount = previousEvictableCount - selection.evictableChunkIds.length;
  return protectedEvictionCount > 0;
}

function shouldSkipStalePostApplyRefreshAfterZoomEnd(loadState, reason = "", {
  scenarioId = "",
  selectionVersion = 0,
  refreshSourceStartedAtMs = 0,
  normalizeScenarioIdFn = (value) => String(value || "").trim(),
  nowMs = Date.now(),
} = {}) {
  const normalizedReason = String(reason || "").trim().toLowerCase();
  if (!["scenario-apply", "scenario-apply-detail-prewarm"].includes(normalizedReason)) {
    return false;
  }
  if (String(loadState?.lastSelection?.reason || "").trim().toLowerCase() !== "zoom-end") {
    return false;
  }
  const metric = loadState?.lastZoomEndToChunkVisibleMetric;
  const recordedAt = Number(metric?.recordedAt || 0);
  if (!(recordedAt > 0 && Math.max(0, Number(nowMs || 0) - recordedAt) <= 5000)) {
    return false;
  }
  if (normalizeScenarioIdFn(metric?.scenarioId) !== normalizeScenarioIdFn(scenarioId)) {
    return false;
  }
  if (Math.max(0, Number(metric?.selectionVersion || 0)) !== Math.max(0, Number(selectionVersion || 0))) {
    return false;
  }
  const sourceStartedAt = Number(refreshSourceStartedAtMs || 0);
  return sourceStartedAt > 0 && sourceStartedAt <= recordedAt;
}

function createScenarioChunkRuntimeController({
  state = null,
  runtimeState: explicitRuntimeState = null,
  getSearchParams,
  normalizeScenarioId,
  normalizeCountryCodeAlias,
  normalizeScenarioPerformanceHints,
  normalizeScenarioFeatureCollection,
  getScenarioFeatureCollectionIdentityList,
  areScenarioFeatureCollectionsEquivalent,
  getScenarioDefaultCountryCode,
  getScenarioBundleId,
  getCachedScenarioBundle,
  getVisibleScenarioChunkLayers,
  resolveRequiredScenarioSemanticLayers = () => [],
  selectScenarioChunks,
  mergeScenarioChunkPayloads,
  mergeScenarioChunkPayloadsForViewport = null,
  normalizeScenarioRenderBudgetHints,
  loadScenarioChunkFile,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  getScenarioOptionalLayerConfig,
  isScenarioOptionalLayerRequestedForVisibility = () => false,
  syncScenarioLocalizationState,
  refreshMapDataForScenarioChunkPromotion,
  flushRenderBoundary,
  recordScenarioPerfMetric,
  ensureScenarioChunkRegistryLoaded,
  refreshDelayInteracting = 180,
  refreshDelayIdle = 60,
} = {}) {
  const runtimeState = explicitRuntimeState || state;
  let promotionCommitPromise = null;
  let promotionCommitRunId = 0;
  const { loadScenarioChunkPayload, resetScenarioChunkRequests } = composeScenarioChunkPayloadLoader(
    runtimeState, normalizeScenarioId, getScenarioBundleId, loadScenarioChunkFile,
  );

  function getScenarioApplyEpochFromDiagnostics(scenarioId = "") {
    const diagnostics = runtimeState?.renderTransactionDiagnostics || {};
    const normalizedScenarioId = normalizeScenarioId(scenarioId || runtimeState?.activeScenarioId);
    const epochByScenarioId =
      diagnostics.scenarioApplyEpochByScenarioId && typeof diagnostics.scenarioApplyEpochByScenarioId === "object"
        ? diagnostics.scenarioApplyEpochByScenarioId
        : {};
    return Math.max(
      0,
      Number(
        (normalizedScenarioId ? epochByScenarioId[normalizedScenarioId] : 0)
        || diagnostics.scenarioApplyEpoch
        || 0
      )
    );
  }

  function getScenarioApplyEpochBySelectionVersion(loadState, selectionVersion = 0) {
    const normalizedSelectionVersion = Math.max(0, Number(selectionVersion || 0));
    const epochBySelectionVersion =
      loadState?.scenarioApplyEpochBySelectionVersion
      && typeof loadState.scenarioApplyEpochBySelectionVersion === "object"
        ? loadState.scenarioApplyEpochBySelectionVersion
        : {};
    return normalizedSelectionVersion > 0
      ? Math.max(0, Number(epochBySelectionVersion[normalizedSelectionVersion] || 0))
      : 0;
  }

  function resolveScenarioChunkApplyEpoch({
    bundle = null,
    scenarioId = "",
    selectionVersion = 0,
    pendingPromotion = null,
    loadState = null,
  } = {}) {
    const normalizedScenarioId = normalizeScenarioId(
      scenarioId
      || pendingPromotion?.scenarioId
      || loadState?.lastSelection?.scenarioId
      || runtimeState?.activeScenarioId
    );
    const normalizedSelectionVersion = Math.max(0, Number(selectionVersion || pendingPromotion?.selectionVersion || 0));
    const pendingEpoch = Math.max(0, Number(pendingPromotion?.scenarioApplyEpoch || 0));
    if (pendingEpoch > 0) return pendingEpoch;
    const loadStateSelectionEpoch = getScenarioApplyEpochBySelectionVersion(loadState, normalizedSelectionVersion);
    if (loadStateSelectionEpoch > 0) return loadStateSelectionEpoch;
    const loadStatePendingPromotion = loadState?.pendingPromotion;
    const loadStatePendingEpoch = loadStatePendingPromotion
      && normalizeScenarioId(loadStatePendingPromotion.scenarioId) === normalizedScenarioId
      && (
        normalizedSelectionVersion <= 0
        || Math.max(0, Number(loadStatePendingPromotion.selectionVersion || 0)) === normalizedSelectionVersion
      )
      ? Math.max(0, Number(loadStatePendingPromotion.scenarioApplyEpoch || 0))
      : 0;
    if (loadStatePendingEpoch > 0) return loadStatePendingEpoch;
    const lastSelection = loadState?.lastSelection;
    const lastSelectionEpoch = normalizeScenarioId(lastSelection?.scenarioId) === normalizedScenarioId
      && (
        normalizedSelectionVersion <= 0
        || Math.max(0, Number(lastSelection?.selectionVersion || 0)) === normalizedSelectionVersion
      )
      ? Math.max(0, Number(lastSelection?.scenarioApplyEpoch || 0))
      : 0;
    if (lastSelectionEpoch > 0) return lastSelectionEpoch;
    const bundleEpoch = Math.max(0, Number(bundle?.chunkLifecycle?.scenarioApplyEpoch || 0));
    if (bundleEpoch > 0) return bundleEpoch;
    return getScenarioApplyEpochFromDiagnostics(normalizedScenarioId);
  }

  function recordRenderTransactionSnapshot(runtimeStateArg, options = {}) {
    const extra = options?.extra && typeof options.extra === "object" ? options.extra : {};
    const loadState = runtimeStateArg?.runtimeChunkLoadState || runtimeState?.runtimeChunkLoadState || null;
    const scenarioApplyEpoch = Math.max(0, Number(extra.scenarioApplyEpoch || 0))
      || resolveScenarioChunkApplyEpoch({
        scenarioId: options.expectedScenarioId || options.requestedScenarioId,
        selectionVersion: extra.selectionVersion,
        loadState,
      });
    return recordRenderTransactionSnapshotBase(runtimeStateArg, {
      ...options,
      extra: {
        ...extra,
        scenarioApplyEpoch,
      },
    });
  }

  function getCurrentScenarioApplyRequestId() {
    return Math.max(0, Number(runtimeState?.currentScenarioApplyRequestId || 0));
  }

  function getScenarioApplyRequestIdBySelectionVersion(loadState, selectionVersion = 0) {
    const normalizedSelectionVersion = Math.max(0, Number(selectionVersion || 0));
    const requestIdBySelectionVersion =
      loadState?.scenarioApplyRequestIdBySelectionVersion
      && typeof loadState.scenarioApplyRequestIdBySelectionVersion === "object"
        ? loadState.scenarioApplyRequestIdBySelectionVersion
        : {};
    return normalizedSelectionVersion > 0
      ? Math.max(0, Number(requestIdBySelectionVersion[normalizedSelectionVersion] || 0))
      : 0;
  }

  function resolveScenarioChunkApplyRequestId({
    scenarioApplyRequestId = 0,
    pendingPromotion = null,
    loadState = null,
    selectionVersion = 0,
  } = {}) {
    const explicitRequestId = Math.max(0, Number(scenarioApplyRequestId || 0));
    if (explicitRequestId > 0) return explicitRequestId;
    const pendingRequestId = Math.max(0, Number(pendingPromotion?.scenarioApplyRequestId || 0));
    if (pendingRequestId > 0) return pendingRequestId;
    const selectionRequestId = getScenarioApplyRequestIdBySelectionVersion(loadState, selectionVersion);
    if (selectionRequestId > 0) return selectionRequestId;
    const lastSelectionRequestId = Math.max(0, Number(loadState?.lastSelection?.scenarioApplyRequestId || 0));
    if (lastSelectionRequestId > 0) return lastSelectionRequestId;
    return getCurrentScenarioApplyRequestId();
  }

  function isScenarioApplyRequestCurrentForScenario({
    scenarioId = "",
    scenarioApplyRequestId = 0,
  } = {}) {
    const normalizedScenarioId = normalizeScenarioId(scenarioId || runtimeState?.activeScenarioId);
    if (!normalizedScenarioId || normalizedScenarioId !== normalizeScenarioId(runtimeState?.activeScenarioId)) {
      return false;
    }
    const currentContinuation =
      captureScenarioChunkLoadStateContinuation(runtimeState);
    const hasSupersedingScenarioApplyRequest =
      currentContinuation.latestScenarioApplyRequestId
      > currentContinuation.currentScenarioApplyRequestId;
    if (
      hasSupersedingScenarioApplyRequest
      && currentContinuation.latestScenarioApplyTargetId
      && currentContinuation.latestScenarioApplyTargetId !== normalizedScenarioId
    ) {
      return false;
    }
    const expectedRequestId = Math.max(0, Number(scenarioApplyRequestId || 0));
    const currentRequestId = getCurrentScenarioApplyRequestId();
    return !(expectedRequestId > 0 && currentRequestId > 0 && expectedRequestId !== currentRequestId);
  }

  function recordScenarioApplyStaleCallbackSkipped({
    callbackPhase = "",
    reason = "scenario-chunk-runtime",
    scenarioId = "",
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
    extra = {},
  } = {}) {
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-stale-callback-skipped",
      reason,
      expectedScenarioId: scenarioId,
      source: "scenario_chunk_runtime",
      searchParams: getSearchParams(),
      extra: {
        ...extra,
        allowScenarioMismatch: true,
        callbackPhase,
        resolution: "skipped-stale-request",
        scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
        scenarioApplyRequestId: Math.max(0, Number(scenarioApplyRequestId || 0)),
        currentScenarioApplyRequestId: getCurrentScenarioApplyRequestId(),
        activeScenarioId: normalizeScenarioId(runtimeState?.activeScenarioId),
      },
    });
  }

  function yieldToFrame() {
    return new Promise((resolve) => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => resolve());
        return;
      }
      globalThis.setTimeout(resolve, 0);
    });
  }

  function ensureRuntimeChunkLoadState() {
    ensureScenarioChunkRuntimeState(runtimeState);
    return runtimeState.runtimeChunkLoadState;
  }

  function clearPendingScenarioChunkRefresh(
    loadState = ensureRuntimeChunkLoadState(),
  ) {
    return patchScenarioChunkLoadState(runtimeState, {
      pendingReason: "",
      pendingDelayMs: null,
      pendingScenarioApplyRequestId: 0,
    }, {
      expectedLoadStateGeneration: loadState.generation,
    });
  }


  function clearZoomEndChunkProtection(loadState) {
    if (runtimeState.runtimeChunkLoadState !== loadState) return;
    clearZoomEndChunkProtectionState(runtimeState);
  }

  function protectZoomEndChunks(loadState, chunkIds = [], {
    scenarioId = "",
    selectionVersion = 0,
    focusCountry = "",
  } = {}) {
    if (runtimeState.runtimeChunkLoadState !== loadState) return;
    protectZoomEndChunksForSelection(runtimeState, chunkIds, {
      scenarioId,
      selectionVersion,
      focusCountry,
      normalizeScenarioIdFn: normalizeScenarioId,
      nowMs: Date.now(),
    });
  }

  function applyZoomEndChunkProtection(selection, loadState, {
    reason = "",
    previousSelection = null,
    scenarioId = "",
    selectionVersion = 0,
    focusCountry = "",
  } = {}) {
    if (runtimeState.runtimeChunkLoadState !== loadState) return false;
    return applyZoomEndChunkProtectionToSelection(selection, runtimeState, {
      reason,
      previousSelection,
      scenarioId,
      selectionVersion,
      focusCountry,
      normalizeScenarioIdFn: normalizeScenarioId,
      nowMs: Date.now(),
    }, loadState);
  }

  function getScenarioChunkActiveMergeIds(chunkState, selection) {
    const cacheOnlyChunkIdSet = new Set((Array.isArray(selection?.cacheOnlyChunkIds) ? selection.cacheOnlyChunkIds : [])
      .map((chunkId) => String(chunkId || "").trim())
      .filter(Boolean));
    // retainedActiveChunkIds keeps zoom-end protected detail chunks in the render/hit input
    // while cacheOnlyChunkIds remains reserved for chunks that only stay warm in memory.
    const retainedActiveChunkIdSet = new Set((Array.isArray(selection?.retainedActiveChunkIds) ? selection.retainedActiveChunkIds : [])
      .map((chunkId) => String(chunkId || "").trim())
      .filter(Boolean));
    return (Array.isArray(chunkState?.loadedChunkIds) ? chunkState.loadedChunkIds : [])
      .map((chunkId) => String(chunkId || "").trim())
      .filter(Boolean)
      .filter((chunkId) => !cacheOnlyChunkIdSet.has(chunkId) || retainedActiveChunkIdSet.has(chunkId));
  }

  function isScenarioChunkLoadStateContinuationCurrent(
    continuationState,
    {
      scenarioId = "",
      scenarioApplyRequestId = 0,
    } = {},
  ) {
    const currentState = captureScenarioChunkLoadStateContinuation(runtimeState);
    if (
      currentState.loadStateGeneration
      !== Math.max(0, Number(continuationState?.loadStateGeneration || 0))
    ) return false;
    const normalizedScenarioId = normalizeScenarioId(
      scenarioId || continuationState?.activeScenarioId,
    );
    if (
      normalizedScenarioId
      && currentState.activeScenarioId !== normalizedScenarioId
    ) return false;
    if (
      normalizedScenarioId
      && currentState.scenarioApplyInFlight
      && currentState.currentScenarioApplyTargetId
      && currentState.currentScenarioApplyTargetId !== normalizedScenarioId
    ) return false;
    if (
      normalizedScenarioId
      && currentState.latestScenarioApplyRequestId
        > currentState.currentScenarioApplyRequestId
      && currentState.latestScenarioApplyTargetId
      && currentState.latestScenarioApplyTargetId !== normalizedScenarioId
    ) return false;
    if (
      currentState.currentScenarioApplyRequestId
      !== Math.max(
        0,
        Number(continuationState?.currentScenarioApplyRequestId || 0),
      )
    ) return false;
    const expectedRequestId = Math.max(
      0,
      Number(scenarioApplyRequestId || 0),
    );
    return !(
      expectedRequestId > 0
      && currentState.currentScenarioApplyRequestId > 0
      && expectedRequestId !== currentState.currentScenarioApplyRequestId
    );
  }

  function isScenarioChunkRefreshCurrent(loadState, {
    scenarioId = "",
    continuationState = null,
    selectionVersion = 0,
    requiredChunkIds = [],
    cacheOnlyChunkIds = [],
    retainedActiveChunkIds = [],
    scenarioApplyRequestId = 0,
  } = {}) {
    if (!isScenarioChunkLoadStateContinuationCurrent(continuationState, {
      scenarioId,
      scenarioApplyRequestId,
    })) return false;
    const normalizedScenarioId = normalizeScenarioId(scenarioId);
    if (Math.max(0, Number(loadState.selectionVersion || 0)) !== Math.max(0, Number(selectionVersion || 0))) return false;
    if (normalizeScenarioId(loadState.lastSelection?.scenarioId) !== normalizedScenarioId) return false;
    if (Math.max(0, Number(loadState.lastSelection?.selectionVersion || 0)) !== Math.max(0, Number(selectionVersion || 0))) return false;
    return (
      getChunkIdListSignature(loadState.lastSelection?.requiredChunkIds) === getChunkIdListSignature(requiredChunkIds)
      && getChunkIdListSignature(loadState.lastSelection?.cacheOnlyChunkIds) === getChunkIdListSignature(cacheOnlyChunkIds)
      && getChunkIdListSignature(loadState.lastSelection?.retainedActiveChunkIds) === getChunkIdListSignature(retainedActiveChunkIds)
    );
  }

  function hasDetailScenarioChunkIds(chunkIds = []) {
    return (Array.isArray(chunkIds) ? chunkIds : []).some((chunkId) =>
      String(chunkId || "").includes(".detail.")
    );
  }

  function markPendingScenarioChunkRefresh(reason = "refresh", delayMs = null, {
    scenarioApplyRequestId = 0,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    const explicitRequestId = Math.max(0, Number(scenarioApplyRequestId || 0));
    const selectionVersion = Math.max(
      0,
      Number(loadState.selectionVersion || 0),
    );
    const selectionRequestId = getScenarioApplyRequestIdBySelectionVersion(
      loadState,
      selectionVersion,
    );
    const lastSelectionRequestId = Math.max(
      0,
      Number(loadState.lastSelection?.scenarioApplyRequestId || 0),
    );
    patchScenarioChunkLoadState(runtimeState, {
      pendingReason: String(reason || "refresh").trim() || "refresh",
      pendingDelayMs: Number.isFinite(Number(delayMs)) ? Number(delayMs) : null,
      pendingScenarioApplyRequestId:
        explicitRequestId
        || selectionRequestId
        || lastSelectionRequestId
        || getCurrentScenarioApplyRequestId(),
    });
    return loadState;
  }

  function setScenarioChunkShellStatus(nextStatus = "", loadState = ensureRuntimeChunkLoadState()) {
    const normalizedStatus = String(nextStatus || "").trim().toLowerCase();
    if (!normalizedStatus) {
      return loadState.shellStatus;
    }
    const patched = patchScenarioChunkLoadState(
      runtimeState,
      { shellStatus: normalizedStatus },
      { expectedLoadStateGeneration: loadState.generation },
    );
    if (patched === false) return false;
    return loadState.shellStatus;
  }

  function shouldZoomEndPromoteImmediately(bundle, reason = "") {
    if (String(reason || "").trim().toLowerCase() !== "zoom-end") {
      return false;
    }
    if (!scenarioBundleUsesChunkedLayer(bundle, "political")) {
      return false;
    }
    const hints = normalizeScenarioRenderBudgetHints(
      bundle?.runtimeShell?.renderBudgetHints || bundle?.manifest?.render_budget_hints || {}
    );
    const zoom = Number(runtimeState.zoomTransform?.k || 1);
    return Number.isFinite(zoom) && zoom >= Number(hints.detail_zoom_threshold || 0);
  }

  function shouldDeferScenarioChunkRefreshFor({
    allowZoomEndSettling = false,
    allowStartupInitialVisual = false,
  } = {}) {
    const renderPhase = String(runtimeState.renderPhase || "idle");
    const startupInitialVisualAllowed = !!(
      allowStartupInitialVisual
      && !runtimeState.scenarioApplyInFlight
      && !!normalizeScenarioId(runtimeState.activeScenarioId)
    );
    const renderPhaseBlocksRefresh = renderPhase !== "idle"
      && !(allowZoomEndSettling && renderPhase === "settling")
      && !startupInitialVisualAllowed;
    const bootBlockingRefresh = !!runtimeState.bootBlocking && !startupInitialVisualAllowed;
    const startupInteractionRefreshBlocked = !!(
      (runtimeState.startupReadonly || runtimeState.startupReadonlyUnlockInFlight)
      && !startupInitialVisualAllowed
    );
    return !!(
      bootBlockingRefresh
      || runtimeState.scenarioApplyInFlight
      || startupInteractionRefreshBlocked
      || runtimeState.isInteracting
      || renderPhaseBlocksRefresh
    );
  }

  function shouldDeferScenarioChunkRefresh() {
    return shouldDeferScenarioChunkRefreshFor();
  }

  function normalizeFocusViewportBounds(bounds) {
    if (!Array.isArray(bounds) || bounds.length < 4) return null;
    const [minLon, minLat, maxLon, maxLat] = bounds.map((value) => Number(value));
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
    return [
      Math.max(-180, Math.min(180, Math.min(minLon, maxLon))),
      Math.max(-90, Math.min(90, Math.min(minLat, maxLat))),
      Math.max(-180, Math.min(180, Math.max(minLon, maxLon))),
      Math.max(-90, Math.min(90, Math.max(minLat, maxLat))),
    ];
  }

  function focusBoundsIntersect(leftBounds, rightBounds) {
    const left = normalizeFocusViewportBounds(leftBounds);
    const right = normalizeFocusViewportBounds(rightBounds);
    if (!left || !right) return true;
    return !(
      left[2] < right[0]
      || right[2] < left[0]
      || left[3] < right[1]
      || right[3] < left[1]
    );
  }

  function isScenarioChunkFocusCountryInViewport(bundle, focusCountry = "", viewportBbox = null) {
    const normalizedViewportBbox = normalizeFocusViewportBounds(viewportBbox);
    if (!normalizedViewportBbox) return true;
    const normalizedFocusCountry = String(focusCountry || "").trim().toUpperCase();
    if (!normalizedFocusCountry) return false;
    const politicalChunks = Array.isArray(bundle?.chunkRegistry?.byLayer?.political)
      ? bundle.chunkRegistry.byLayer.political
      : [];
    if (!politicalChunks.length) return true;
    return politicalChunks.some((chunk) => (
      Array.isArray(chunk?.countryCodes)
      && String(chunk?.lod || "").trim().toLowerCase() === "detail"
      && chunk.countryCodes.includes(normalizedFocusCountry)
      && focusBoundsIntersect(chunk.bounds, normalizedViewportBbox)
    ));
  }

  function resolveScenarioChunkFocusCountry(bundle, loadState = ensureRuntimeChunkLoadState(), {
    viewportBbox = null,
  } = {}) {
    let overrideExpiresAt = Math.max(0, Number(loadState.focusCountryOverrideExpiresAt || 0));
    if (loadState.focusCountryOverride && overrideExpiresAt <= 0) {
      overrideExpiresAt = Date.now() + FOCUS_COUNTRY_OVERRIDE_TTL_MS;
      patchScenarioChunkLoadState(runtimeState, { focusCountryOverrideExpiresAt: overrideExpiresAt });
    }
    if (loadState.focusCountryOverride && overrideExpiresAt > 0 && Date.now() > overrideExpiresAt) {
      clearScenarioChunkFocusCountryOverride(loadState);
    }
    const usesFocusOverride = !!loadState.focusCountryOverride;
    const rawFocusCountry = String(
      loadState.focusCountryOverride
      || runtimeState.activeSovereignCode
      || runtimeState.selectedInspectorCountryCode
      || getScenarioDefaultCountryCode(bundle?.manifest, bundle?.countriesPayload?.countries || {})
      || ""
    ).trim().toUpperCase();
    if (!rawFocusCountry) {
      return "";
    }
    const countries = bundle?.countriesPayload?.countries && typeof bundle.countriesPayload.countries === "object"
      ? bundle.countriesPayload.countries
      : {};
    const focusCountryEntry = countries[rawFocusCountry] && typeof countries[rawFocusCountry] === "object"
      ? countries[rawFocusCountry]
      : null;
    const mappedIso2 = String(
      focusCountryEntry?.lookup_iso2
      || focusCountryEntry?.base_iso2
      || focusCountryEntry?.provenance_iso2
      || ""
    ).trim().toUpperCase();
    const focusCountryCandidates = Array.from(new Set([
      normalizeCountryCodeAlias(rawFocusCountry),
      mappedIso2 ? normalizeCountryCodeAlias(mappedIso2) : "",
    ].filter(Boolean)));
    // Scenario tags such as TNO's GCO can map to modern ISO2 codes for palette data
    // while chunk metadata remains tag-scoped. Try the active scenario tag first.
    const resolvedFocusCountry = focusCountryCandidates.find((candidate) =>
      isScenarioChunkFocusCountryInViewport(bundle, candidate, viewportBbox)
    ) || "";
    if (!resolvedFocusCountry) {
      if (usesFocusOverride) {
        clearScenarioChunkFocusCountryOverride(loadState);
      }
      return "";
    }
    return resolvedFocusCountry;
  }

  function clearScenarioChunkFocusCountryOverride(loadState = ensureRuntimeChunkLoadState()) {
    patchScenarioChunkLoadState(runtimeState, {
      focusCountryOverride: "",
      focusCountryOverrideSource: "",
      focusCountryOverrideExpiresAt: 0,
    });
  }

  function consumeScenarioChunkFocusCountryOverride(loadState = ensureRuntimeChunkLoadState()) {
    if (!loadState.focusCountryOverride) return false;
    clearScenarioChunkFocusCountryOverride(loadState);
    return true;
  }

  function clearPendingScenarioChunkPromotion(loadState = ensureRuntimeChunkLoadState()) {
    if (loadState.promotionTimerId) {
      globalThis.clearTimeout(loadState.promotionTimerId);
      patchScenarioChunkLoadState(runtimeState, { promotionTimerId: null });
    }
    clearScenarioChunkPromotionState(runtimeState);
  }

  function schedulePendingScenarioChunkPromotionCommit({
    delayMs = 0,
    retry = false,
  } = {}) {
    // promotion commit 必须单拥有者串行推进。
    // 这里的 timer 只负责把多次 selection 变化折叠成一次延后提交；
    // 真正拥有提交权的始终是 commitPendingScenarioChunkPromotion()，避免 visual/infra promotion 并发互踩。
    const loadState = ensureRuntimeChunkLoadState();
    if (!loadState.pendingPromotion) {
      clearPendingScenarioChunkPromotion(loadState);
      return false;
    }
    if (loadState.promotionTimerId) {
      globalThis.clearTimeout(loadState.promotionTimerId);
      patchScenarioChunkLoadState(runtimeState, { promotionTimerId: null });
    }
    const resolvedDelayMs = Math.max(0, Number(delayMs) || 0);
    if (retry) {
      patchScenarioChunkLoadState(runtimeState, {
        promotionRetryCount: Math.max(0, Number(loadState.promotionRetryCount || 0)) + 1,
        lastPromotionRetryAt: globalThis.performance?.now ? globalThis.performance.now() : Date.now(),
      });
    }
    const promotionTimerGenerationToken = {};
    let promotionTimerId = promotionTimerGenerationToken;
    patchScenarioChunkLoadState(runtimeState, {
      promotionScheduled: true,
      promotionTimerId: promotionTimerGenerationToken,
    });
    const scheduledPromotionTimerId = globalThis.setTimeout(() => {
      if (
        runtimeState.runtimeChunkLoadState !== loadState
        || loadState.promotionTimerId !== promotionTimerId
      ) return;
      patchScenarioChunkLoadState(runtimeState, {
        promotionTimerId: null,
        promotionScheduled: false,
      });
      void commitPendingScenarioChunkPromotionWithErrorBoundary();
    }, resolvedDelayMs);
    if (
      runtimeState.runtimeChunkLoadState === loadState
      && loadState.promotionTimerId === promotionTimerGenerationToken
    ) {
      promotionTimerId = scheduledPromotionTimerId;
      patchScenarioChunkLoadState(runtimeState, {
        promotionScheduled: true,
        promotionTimerId,
      });
    }
    return true;
  }

  function executeScenarioChunkRefreshNow({
    bundle,
    reason = "refresh",
    flushPending = false,
    allowRefreshStart = false,
    d3Client = globalThis.d3,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    const hasPendingReason = !!allowRefreshStart || !!String(loadState.pendingReason || "").trim();
    // 这里的返回值是调度状态，不是业务成功/失败：
    // promotion-scheduled / promotion-commit-started / refresh-started 等状态会被上层继续串联，
    // 后续新增分支时要保持“调用方可据此决定是否重排”的语义。
    if (!bundle) {
      clearPendingScenarioChunkRefresh(loadState);
      return "noop";
    }
    const pendingScenarioApplyRequestId = resolveScenarioChunkApplyRequestId({
      scenarioApplyRequestId: loadState.pendingScenarioApplyRequestId,
      loadState,
      selectionVersion: loadState.selectionVersion,
    });
    const activeScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    if (pendingScenarioApplyRequestId > 0 && !isScenarioApplyRequestCurrentForScenario({
      scenarioId: activeScenarioId,
      scenarioApplyRequestId: pendingScenarioApplyRequestId,
    })) {
      recordScenarioApplyStaleCallbackSkipped({
        callbackPhase: "chunk-refresh-execute",
        reason,
        scenarioId: activeScenarioId,
        scenarioApplyRequestId: pendingScenarioApplyRequestId,
        extra: {
          selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
        },
      });
      clearPendingScenarioChunkRefresh(loadState);
      return "stale-request";
    }
    if (loadState.pendingPromotion && loadState.promotionScheduled) {
      if (flushPending) {
        if (loadState.promotionTimerId) {
          globalThis.clearTimeout(loadState.promotionTimerId);
          patchScenarioChunkLoadState(runtimeState, { promotionTimerId: null });
        }
        patchScenarioChunkLoadState(runtimeState, { promotionScheduled: false });
      } else {
        return "promotion-scheduled";
      }
    }
    if (loadState.pendingPromotion && !loadState.promotionScheduled && !flushPending) {
      const delayMs = Number.isFinite(Number(loadState.pendingDelayMs))
        ? Math.max(0, Number(loadState.pendingDelayMs))
        : 0;
      schedulePendingScenarioChunkPromotionCommit({ delayMs });
      if (loadState.pendingPromotion && loadState.promotionScheduled) {
        return "promotion-scheduled";
      }
    }
    if (loadState.pendingPromotion) {
      if (promotionCommitPromise || loadState.promotionCommitInFlight) {
        return "promotion-commit-in-flight";
      }
      void commitPendingScenarioChunkPromotionWithErrorBoundary({ bundle });
      return "promotion-commit-started";
    }
    if (!hasPendingReason) {
      return "noop";
    }
    setScenarioChunkShellStatus("loading", loadState);
    void refreshActiveScenarioChunks({
      reason,
      renderNow: true,
      d3Client,
    }).catch((error) => {
      const scenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
      console.warn(`[scenario] Failed to refresh active scenario chunks for "${scenarioId}".`, error);
    });
    return "refresh-started";
  }

  function recordScenarioRenderMetric(name, durationMs, details = {}) {
    setRenderPerfMetricEntryState(runtimeState, {
      name,
      entry: {
        durationMs: Math.max(0, Number(durationMs) || 0),
        recordedAt: Date.now(),
        ...details,
      },
    });
    globalThis.__renderPerfMetrics = runtimeState.renderPerfMetrics;
  }

  function shouldRecordScenarioChunkRuntimeMetric() {
    const developerMode = !!runtimeState?.uiState?.developerMode;
    const perfOverlayEnabled = !!runtimeState?.renderDiagnostics?.perfOverlayEnabled;
    const params = getSearchParams();
    const runtimePerfFlag = String(params?.get("runtime_chunk_perf") || "").trim().toLowerCase();
    return developerMode || perfOverlayEnabled || ["1", "true", "yes", "on"].includes(runtimePerfFlag);
  }

  function recordScenarioChunkRuntimeMetric(name, durationMs, details = {}) {
    if (!shouldRecordScenarioChunkRuntimeMetric()) return;
    recordScenarioRenderMetric(name, durationMs, details);
  }

  function ensureActiveScenarioChunkState() {
    ensureScenarioChunkRuntimeState(runtimeState);
    return runtimeState.activeScenarioChunks;
  }

  function hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey) {
    return !!(
      mergedLayerPayloads
      && typeof mergedLayerPayloads === "object"
      && Object.prototype.hasOwnProperty.call(mergedLayerPayloads, layerKey)
    );
  }

  function getScenarioRuntimeMergedLayerPayloads(bundle = null) {
    const bundleScenarioId = getScenarioBundleId(bundle);
    const activeScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    const chunkScenarioId = normalizeScenarioId(runtimeState.activeScenarioChunks?.scenarioId);
    if (!bundleScenarioId || bundleScenarioId !== activeScenarioId || chunkScenarioId !== bundleScenarioId) {
      return {};
    }
    return ensureActiveScenarioChunkState().mergedLayerPayloads;
  }

  function resetScenarioChunkRuntimeState({ scenarioId = "" } = {}) {
    const normalizedScenarioId = normalizeScenarioId(scenarioId);
    cancelScenarioChunkPromotionCommit("scenario-chunk-runtime-reset");
    resetScenarioChunkRequests(normalizedScenarioId);
    resetScenarioChunkRuntimeStateAction(runtimeState, {
      scenarioId: normalizedScenarioId,
    });
  }

  function getScenarioChunkFeatureIdsFromChunkPayload(payload) {
    const normalizedPayload = normalizeScenarioFeatureCollection(payload);
    return getScenarioFeatureCollectionIdentityList(normalizedPayload);
  }

  function collectScenarioPoliticalFeatureIdsForChunkIds(bundle, chunkIds = []) {
    const uniqueChunkIds = Array.from(new Set((Array.isArray(chunkIds) ? chunkIds : [])
      .map((chunkId) => String(chunkId || "").trim())
      .filter(Boolean)));
    if (!uniqueChunkIds.length) return [];
    const featureIds = [];
    uniqueChunkIds.forEach((chunkId) => {
      const payloadEntry = bundle?.chunkPayloadCacheById?.[chunkId]
        || ensureActiveScenarioChunkState().payloadByChunkId?.[chunkId]
        || null;
      if (!payloadEntry || payloadEntry.layerKey !== "political") return;
      featureIds.push(...getScenarioChunkFeatureIdsFromChunkPayload(payloadEntry.payload || null));
    });
    return Array.from(new Set(featureIds));
  }

  function getScenarioChunkIdSetByLayer(bundle, layerKey = "") {
    const normalizedLayerKey = String(layerKey || "").trim().toLowerCase();
    if (!normalizedLayerKey) return new Set();
    return new Set(
      (Array.isArray(bundle?.chunkRegistry?.byLayer?.[normalizedLayerKey]) ? bundle.chunkRegistry.byLayer[normalizedLayerKey] : [])
        .map((chunk) => String(chunk?.id || "").trim())
        .filter(Boolean)
    );
  }

  function applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, { renderNow = false } = {}) {
    let changed = false;
    const changedLayerKeys = [];
    const renderVisibleChangedLayerKeys = [];
    Object.keys(mergedLayerPayloads || {}).forEach((layerKey) => {
      if (!hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey)) {
        return;
      }
      const normalizedLayerKey = String(layerKey || "").trim().toLowerCase();
      const config = getScenarioOptionalLayerConfig(layerKey);
      if (!config) {
        return;
      }
      const nextPayload = mergedLayerPayloads[layerKey] || null;
      const currentPayload = runtimeState[config.stateField] || null;
      if (nextPayload === currentPayload) return;
      const applyResult = applyScenarioChunkOptionalLayerState(runtimeState, normalizedLayerKey, nextPayload);
      if (applyResult?.externalEffect?.type === "scenario-city-overrides") {
        syncScenarioLocalizationState({ cityOverridesPayload: applyResult.externalEffect.payload });
      }
      if (applyResult?.changed === false && !applyResult?.externalEffect) return;
      changed = true;
      changedLayerKeys.push(layerKey);
      if (isScenarioOptionalLayerRequestedForVisibility(normalizedLayerKey, config)) {
        renderVisibleChangedLayerKeys.push(normalizedLayerKey);
      }
    });
    if (changed && renderNow) {
      flushRenderBoundary("scenario-optional-layer-apply");
    }
    return {
      changed,
      changedLayerKeys,
      renderVisibleChangedLayerKeys: Array.from(new Set(renderVisibleChangedLayerKeys)),
    };
  }

  function applyScenarioPoliticalChunkPayload(bundle, politicalPayload, {
    renderNow = false,
    reason = "refresh",
    changedLayerKeys = [],
    politicalFeatureIds = [],
    primaryPoliticalPayload = null,
    forceRefresh = false,
    firstFrameOnly = false,
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
  } = {}) {
    const startedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const bundleScenarioId = getScenarioBundleId(bundle);
    const transactionScenarioApplyRequestId = resolveScenarioChunkApplyRequestId({
      scenarioApplyRequestId,
    });
    if (!isScenarioApplyRequestCurrentForScenario({
      scenarioId: bundleScenarioId,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    })) {
      recordScenarioApplyStaleCallbackSkipped({
        callbackPhase: "political-chunk-payload-write",
        reason,
        scenarioId: bundleScenarioId,
        scenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      });
      return false;
    }
    const normalizeStartedAt = startedAt;
    const normalizedPayload = normalizeScenarioFeatureCollection(politicalPayload);
    const normalizedPrimaryPayload = normalizeScenarioFeatureCollection(primaryPoliticalPayload);
    const normalizeEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const identityStartedAt = normalizeEndedAt;
    const previousFeatureIds = getScenarioFeatureCollectionIdentityList(runtimeState.scenarioPoliticalChunkData);
    const nextFeatureIds = getScenarioFeatureCollectionIdentityList(normalizedPayload);
    const previousPrimaryFeatureIds = getScenarioFeatureCollectionIdentityList(runtimeState.scenarioPoliticalVisibleChunkData);
    const nextPrimaryFeatureIds = getScenarioFeatureCollectionIdentityList(normalizedPrimaryPayload);
    const identityEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const compareStartedAt = identityEndedAt;
    const samePayload = areScenarioFeatureCollectionsEquivalent(
      runtimeState.scenarioPoliticalChunkData,
      normalizedPayload
    );
    const primaryPayloadHasSubset = normalizedPrimaryPayload
      && Array.isArray(normalizedPrimaryPayload.features)
      && normalizedPrimaryPayload.features.length < nextFeatureIds.length;
    const nextPrimaryPoliticalChunkData = primaryPayloadHasSubset ? normalizedPrimaryPayload : null;
    const samePrimaryPayload = areScenarioFeatureCollectionsEquivalent(
      runtimeState.scenarioPoliticalVisibleChunkData,
      nextPrimaryPoliticalChunkData
    );
    const compareEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    if (samePayload && samePrimaryPayload && !forceRefresh) {
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-political-chunk-payload-unchanged",
        reason,
        expectedScenarioId: getScenarioBundleId(bundle),
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          previousFeatureCount: previousFeatureIds.length,
          nextFeatureCount: nextFeatureIds.length,
          previousPrimaryFeatureCount: previousPrimaryFeatureIds.length,
          nextPrimaryFeatureCount: nextPrimaryFeatureIds.length,
          scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
        },
      });
      recordScenarioRenderMetric("politicalChunkPromotionBreakdown", compareEndedAt - startedAt, {
        scenarioId: getScenarioBundleId(bundle),
        reason: String(reason || "refresh"),
        samePayload: true,
        samePrimaryPayload: true,
        normalizeMs: Math.max(0, normalizeEndedAt - normalizeStartedAt),
        identityMs: Math.max(0, identityEndedAt - identityStartedAt),
        compareMs: Math.max(0, compareEndedAt - compareStartedAt),
        refreshMs: 0,
        previousFeatureCount: previousFeatureIds.length,
        nextFeatureCount: nextFeatureIds.length,
        previousPrimaryFeatureCount: previousPrimaryFeatureIds.length,
        nextPrimaryFeatureCount: nextPrimaryFeatureIds.length,
      });
      return false;
    }
    commitScenarioPoliticalChunkPayloadState(runtimeState, {
      payload: normalizedPayload || null,
      visiblePayload: nextPrimaryPoliticalChunkData || null,
      generationReason: String(reason || "political-chunk-payload"),
    });
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-political-chunk-payload-written",
      reason,
      expectedScenarioId: bundleScenarioId,
      source: "scenario_chunk_runtime",
      searchParams: getSearchParams(),
      extra: {
        forceRefresh: !!forceRefresh,
        firstFrameOnly: !!firstFrameOnly,
        previousFeatureCount: previousFeatureIds.length,
        nextFeatureCount: nextFeatureIds.length,
        previousPrimaryFeatureCount: previousPrimaryFeatureIds.length,
        nextPrimaryFeatureCount: nextPrimaryFeatureIds.length,
        primaryPayloadHasSubset: !!primaryPayloadHasSubset,
        scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    const resolvedPoliticalFeatureIds = Array.from(new Set([
      ...(Array.isArray(politicalFeatureIds) ? politicalFeatureIds : []),
      ...previousFeatureIds,
      ...nextFeatureIds,
      ...previousPrimaryFeatureIds,
      ...nextPrimaryFeatureIds,
    ]));
    const refreshStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    refreshMapDataForScenarioChunkPromotion({
      suppressRender: !renderNow,
      reason,
      changedLayerKeys,
      politicalFeatureIds: resolvedPoliticalFeatureIds,
      hasPoliticalPayloadChange: true,
      firstFrameOnly,
    });
    const finishedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioRenderMetric("politicalChunkPromotionBreakdown", finishedAt - startedAt, {
      scenarioId: getScenarioBundleId(bundle),
      reason: String(reason || "refresh"),
      samePayload: false,
      samePrimaryPayload,
      forcedRefresh: !!forceRefresh,
      normalizeMs: Math.max(0, normalizeEndedAt - normalizeStartedAt),
      identityMs: Math.max(0, identityEndedAt - identityStartedAt),
      compareMs: Math.max(0, compareEndedAt - compareStartedAt),
      refreshMs: Math.max(0, finishedAt - refreshStartedAt),
      previousFeatureCount: previousFeatureIds.length,
      nextFeatureCount: nextFeatureIds.length,
      previousPrimaryFeatureCount: previousPrimaryFeatureIds.length,
      nextPrimaryFeatureCount: nextPrimaryFeatureIds.length,
      resolvedPoliticalFeatureCount: resolvedPoliticalFeatureIds.length,
    });
    const promotedPrimaryFeatureCount = primaryPayloadHasSubset ? nextPrimaryFeatureIds.length : nextFeatureIds.length;
    recordScenarioRenderMetric("politicalChunkPromotionMs", finishedAt - startedAt, {
      scenarioId: getScenarioBundleId(bundle),
      reason: String(reason || "refresh"),
      promotedPoliticalFeatureCount: nextFeatureIds.length,
      promotedPrimaryPoliticalFeatureCount: promotedPrimaryFeatureCount,
      promotedVisibleFeatureCount: promotedPrimaryFeatureCount,
      promotedTotalFeatureCount: nextFeatureIds.length,
      primaryVisibleFeatureCount: promotedPrimaryFeatureCount,
      primaryTotalFeatureCount: nextFeatureIds.length,
    });
    return true;
  }

  function refreshScenarioRenderVisibleOptionalChunkPayloadChange({
    renderNow = false,
    reason = "refresh",
    changedLayerKeys = [],
    renderVisibleChangedLayerKeys = [],
  } = {}) {
    const normalizedRenderVisibleChangedLayerKeys = Array.from(new Set(
      (Array.isArray(renderVisibleChangedLayerKeys) ? renderVisibleChangedLayerKeys : [])
        .map((layerKey) => String(layerKey || "").trim().toLowerCase())
        .filter(Boolean)
    ));
    if (!normalizedRenderVisibleChangedLayerKeys.length) {
      return false;
    }
    const normalizedChangedLayerKeys = Array.from(new Set([
      ...(Array.isArray(changedLayerKeys) ? changedLayerKeys : [])
        .map((layerKey) => String(layerKey || "").trim().toLowerCase())
        .filter(Boolean),
      ...normalizedRenderVisibleChangedLayerKeys,
    ]));
    bumpScenarioChunkDataGenerationState(runtimeState, String(reason || "scenario-optional-layer-payload"));
    refreshMapDataForScenarioChunkPromotion({
      suppressRender: !renderNow,
      reason,
      changedLayerKeys: normalizedChangedLayerKeys,
      politicalFeatureIds: [],
      hasPoliticalPayloadChange: false,
    });
    return true;
  }

  function setPromotionCommitStatus(status, details = {}) {
    return setScenarioChunkPromotionStatusState(runtimeState, status, details);
  }

  async function commitPendingScenarioChunkPromotionWithErrorBoundary({
    bundle = null,
    renderNow = null,
    allowStartupInitialVisual = false,
    rethrow = false,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    let boundaryRunId = promotionCommitRunId;
    try {
      const commitPromise = commitPendingScenarioChunkPromotion({
        bundle,
        renderNow,
        allowStartupInitialVisual,
      });
      boundaryRunId = promotionCommitRunId;
      return (await commitPromise) === true;
    } catch (error) {
      if (
        runtimeState.runtimeChunkLoadState === loadState
        && promotionCommitRunId === boundaryRunId
        && Math.max(0, Number(loadState.promotionCommitRunId || 0)) === boundaryRunId
        // Awaited failures may settle only the run that still owns this load state.
      ) {
        setPromotionCommitStatus("error", {
          inFlight: false,
          finishedAt: Date.now(),
          error: error?.message || String(error || "unknown"),
        });
      }
      console.warn(
        "[scenario] Failed to commit pending scenario chunk promotion.",
        error,
      );
      if (rethrow) throw error;
      return false;
    }
  }

  function captureMergedLayerRuntimeSnapshot(mergedLayerPayloads = {}) {
    const optionalLayerKeys = Object.keys(mergedLayerPayloads || {}).filter((layerKey) =>
      Object.prototype.hasOwnProperty.call(SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS, layerKey)
    );
    return captureScenarioChunkPromotionState(runtimeState, optionalLayerKeys);
  }

  function restoreMergedLayerRuntimeSnapshot(snapshot = []) {
    const externalEffects = [];
    (Array.isArray(snapshot) ? snapshot : []).forEach((entry) => {
      const restoreResult = restoreScenarioChunkPromotionState(runtimeState, [entry]);
      if (!Array.isArray(restoreResult?.externalEffects)) {
        throw new TypeError(
          "[scenario_chunk_runtime] restoreScenarioChunkPromotionState must return an externalEffects array",
        );
      }
      externalEffects.push(...restoreResult.externalEffects);
    });
    externalEffects.forEach((externalEffect) => {
      if (
        externalEffect?.type === "scenario-city-overrides"
        && externalEffect.finalizerToken?.type !== "scenario-city-restore-finalizer"
      ) {
        throw new TypeError(
          "[scenario_chunk_runtime] city restore effect must include a valid finalizer token",
        );
      }
    });
    externalEffects.forEach((externalEffect) => {
      if (externalEffect?.type === "scenario-city-overrides") {
        syncScenarioLocalizationState({ cityOverridesPayload: externalEffect.payload });
        const finalized = finalizeScenarioChunkCityExternalEffectState(
          runtimeState,
          externalEffect.finalizerToken,
        );
        if (finalized !== true) {
          throw new Error(
            "[scenario_chunk_runtime] city restore finalizer rejected its token",
          );
        }
      }
    });
  }

  function resolvePendingScenarioChunkPromotionOwnedScenarioId(
    pendingPromotion,
    loadState,
    { scenarioId = "", runId = 0 } = {},
  ) {
    if (!pendingPromotion || typeof pendingPromotion !== "object") return false;
    if (runtimeState.runtimeChunkLoadState !== loadState) return false;
    if (
      runId > 0
      && (
        promotionCommitRunId !== runId
        || Math.max(0, Number(loadState.promotionCommitRunId || 0))
          !== runId
      )
    ) return false;
    const normalizedScenarioId = normalizeScenarioId(scenarioId || pendingPromotion.scenarioId || runtimeState.activeScenarioId);
    if (!normalizedScenarioId || normalizedScenarioId !== normalizeScenarioId(runtimeState.activeScenarioId)) return false;
    if (loadState.pendingPromotion && loadState.pendingPromotion !== pendingPromotion) return false;
    const pendingSelectionVersion = Math.max(0, Number(pendingPromotion.selectionVersion || 0));
    const currentSelectionVersion = Math.max(0, Number(loadState.selectionVersion || 0));
    if (pendingSelectionVersion > 0 && currentSelectionVersion > 0 && pendingSelectionVersion !== currentSelectionVersion) return false;
    return normalizedScenarioId;
  }

  function isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId = "", runId = 0 } = {}) {
    const ownedScenarioId = resolvePendingScenarioChunkPromotionOwnedScenarioId(
      pendingPromotion,
      loadState,
      { scenarioId, runId },
    );
    if (!ownedScenarioId) return false;
    if (!isScenarioApplyRequestCurrentForScenario({
      scenarioId: ownedScenarioId,
      scenarioApplyRequestId: pendingPromotion.scenarioApplyRequestId,
    })) return false;
    return true;
  }

  async function applyPendingScenarioChunkPromotion(bundle, pendingPromotion, loadState = ensureRuntimeChunkLoadState(), {
    renderNowOverride = null,
    runId = 0,
    allowStartupInitialVisual = false,
  } = {}) {
    if (!pendingPromotion || typeof pendingPromotion !== "object") {
      return false;
    }
    const scenarioId = normalizeScenarioId(pendingPromotion.scenarioId || runtimeState.activeScenarioId);
    const promotionScenarioApplyEpoch = resolveScenarioChunkApplyEpoch({
      bundle,
      scenarioId,
      selectionVersion: pendingPromotion.selectionVersion,
      pendingPromotion,
      loadState,
    });
    const promotionScenarioApplyRequestId = resolveScenarioChunkApplyRequestId({
      pendingPromotion,
      selectionVersion: pendingPromotion.selectionVersion,
    });
    const identifiedPendingPromotion =
      runtimeState.runtimeChunkLoadState.pendingPromotion === pendingPromotion
        ? replaceScenarioChunkPendingPromotionIdentityState(
          runtimeState,
          runtimeState.runtimeChunkLoadState.pendingPromotion,
          {
            scenarioApplyEpoch: promotionScenarioApplyEpoch,
            scenarioApplyRequestId: promotionScenarioApplyRequestId,
          },
        )
        : null;
    if (identifiedPendingPromotion) {
      pendingPromotion = identifiedPendingPromotion;
    }
    if (!isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId, runId })) {
      if (loadState.pendingPromotion === pendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      setPromotionCommitStatus("promotion-skipped-stale", { inFlight: false, finishedAt: Date.now() });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-stale-skip",
        reason: pendingPromotion.reason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          runId,
          selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || 0)),
          scenarioApplyEpoch: promotionScenarioApplyEpoch,
          scenarioApplyRequestId: promotionScenarioApplyRequestId,
          currentSelectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
        },
      });
      return false;
    }
    // pendingPromotion 是一次“已经选好 chunk、等待正式提交”的快照。
    // 这里开始后只消费这个快照，不重新读取 selection，
    // 否则 promotion 过程中视图再次变化时会把两次选择混成一次提交。
    const mergedLayerPayloads =
      pendingPromotion.mergedLayerPayloads && typeof pendingPromotion.mergedLayerPayloads === "object"
        ? pendingPromotion.mergedLayerPayloads
        : {};
    const resolvedRenderNow = renderNowOverride == null ? pendingPromotion.renderNow : renderNowOverride;
    const promotionStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const queuedAt = Math.max(
      0,
      Number(
        pendingPromotion.queuedAt
        || loadState.pendingVisualPromotion?.queuedAt
        || loadState.pendingInfraPromotion?.queuedAt
        || 0
      )
    );
    if (queuedAt > 0) {
      recordScenarioChunkRuntimeMetric("chunkPromotionQueueMs", promotionStartedAt - queuedAt, {
        scenarioId,
        reason: String(pendingPromotion.reason || "refresh"),
        changedLayerCount: Array.isArray(pendingPromotion.changedLayerKeys) ? pendingPromotion.changedLayerKeys.length : 0,
      });
    }
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-chunk-promotion-commit-start",
      reason: pendingPromotion.reason,
      expectedScenarioId: scenarioId,
      source: "scenario_chunk_runtime",
      searchParams: getSearchParams(),
      extra: {
        runId,
        selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || 0)),
        scenarioApplyEpoch: promotionScenarioApplyEpoch,
        scenarioApplyRequestId: promotionScenarioApplyRequestId,
        requiredChunkCount: Array.isArray(pendingPromotion.requiredChunkIds) ? pendingPromotion.requiredChunkIds.length : 0,
        changedLayerCount: Array.isArray(pendingPromotion.changedLayerKeys) ? pendingPromotion.changedLayerKeys.length : 0,
        politicalFeatureCount: Array.isArray(pendingPromotion.politicalFeatureIds) ? pendingPromotion.politicalFeatureIds.length : 0,
      },
    });
    const previousRenderLock = !!runtimeState.scenarioChunkPromotionRenderLocked;
    const mergedLayerSnapshot = captureMergedLayerRuntimeSnapshot(mergedLayerPayloads);
    const promotionRootSnapshot =
      captureScenarioChunkPromotionRootState(runtimeState);
    const promotionContinuationState =
      captureScenarioChunkLoadStateContinuation(runtimeState);
    const canRollbackPromotionContinuation = () => {
      if (runtimeState.runtimeChunkLoadState !== loadState) return false;
      if (
        runId > 0
        && (
          promotionCommitRunId !== runId
          || Math.max(0, Number(loadState.promotionCommitRunId || 0))
            !== runId
        )
      ) return false;
      if (loadState.pendingPromotion !== pendingPromotion) return false;
      const currentContinuationState =
        captureScenarioChunkLoadStateContinuation(runtimeState);
      if (currentContinuationState.activeScenarioId !== scenarioId) return false;
      if (promotionContinuationState.activeScenarioId !== scenarioId) return false;
      const loadStateGeneration = Number(loadState.generation);
      const continuationLoadStateGeneration = Number(
        promotionContinuationState.loadStateGeneration,
      );
      if (
        !Number.isSafeInteger(loadStateGeneration)
        || loadStateGeneration < 0
        || !Number.isSafeInteger(continuationLoadStateGeneration)
        || continuationLoadStateGeneration < 0
        || loadStateGeneration !== continuationLoadStateGeneration
      ) return false;
      const continuationRequestId = Math.max(
        0,
        Number(promotionContinuationState.continuationScenarioApplyRequestId || 0),
      );
      return promotionScenarioApplyRequestId === continuationRequestId;
    };
    const restoreScenarioDataGenerationSnapshot = () => {
      restoreScenarioChunkPromotionRootState(runtimeState, promotionRootSnapshot);
    };
    setScenarioChunkPromotionRenderLockState(runtimeState, true);
    let mergedLayerResult = { changed: false, changedLayerKeys: [] };
    let politicalPayloadChanged = false;
    let politicalMutationStarted = false;
    let promotionApplicationStarted = false;
    let effectiveChangedLayerKeys = Array.isArray(pendingPromotion.changedLayerKeys)
      ? [...pendingPromotion.changedLayerKeys]
      : [];
    let deferredOptionalVisibleRefresh = null;
    try {
      setPromotionCommitStatus("applying-infra", { inFlight: true, runId, scenarioId });
      const infraStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
      promotionApplicationStarted = true;
      mergedLayerResult = applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, { renderNow: false });
      const infraEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
      recordScenarioChunkRuntimeMetric("chunkPromotionCommitInfraMs", infraEndedAt - infraStartedAt, {
        scenarioId,
        reason: String(pendingPromotion.reason || "refresh"),
        changedLayerCount: mergedLayerResult?.changedLayerKeys?.length || 0,
      });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-infra-complete",
        reason: pendingPromotion.reason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          runId,
          selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || 0)),
          scenarioApplyEpoch: promotionScenarioApplyEpoch,
          scenarioApplyRequestId: promotionScenarioApplyRequestId,
          changedLayerKeys: Array.isArray(mergedLayerResult?.changedLayerKeys) ? mergedLayerResult.changedLayerKeys : [],
        },
      });
      // promotion 分成 infra -> visual 两段：
      // 先把 merged layer / localization / runtime payload 写稳，再让出一帧给渲染系统消化，
      // 返回后还要重新验证 current，防止旧 run 在新 selection 之后继续落地。
      await yieldToFrame();
      if (!isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId, runId })) {
        if (canRollbackPromotionContinuation()) {
          restoreMergedLayerRuntimeSnapshot(mergedLayerSnapshot);
          restoreScenarioDataGenerationSnapshot();
        }
        if (
          runtimeState.runtimeChunkLoadState === loadState
          && promotionCommitRunId === runId
          && Math.max(0, Number(loadState.promotionCommitRunId || 0))
            === runId
        ) {
          setPromotionCommitStatus("promotion-skipped-stale", { inFlight: false, finishedAt: Date.now() });
          recordRenderTransactionSnapshot(runtimeState, {
            phase: "scenario-chunk-promotion-stale-after-infra",
            reason: pendingPromotion.reason,
            expectedScenarioId: scenarioId,
            source: "scenario_chunk_runtime",
            searchParams: getSearchParams(),
            extra: {
              runId,
              selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || 0)),
              scenarioApplyEpoch: promotionScenarioApplyEpoch,
              scenarioApplyRequestId: promotionScenarioApplyRequestId,
              currentSelectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
            },
          });
        }
        return false;
      }

      setPromotionCommitStatus("applying-visual", { inFlight: true, runId, scenarioId });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-visual-start",
        reason: pendingPromotion.reason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          runId,
          selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || 0)),
          scenarioApplyEpoch: promotionScenarioApplyEpoch,
          scenarioApplyRequestId: promotionScenarioApplyRequestId,
          politicalFeatureCount: Array.isArray(pendingPromotion.politicalFeatureIds) ? pendingPromotion.politicalFeatureIds.length : 0,
          primaryVisibleFeatureSubsetChanged: !!pendingPromotion.primaryVisibleFeatureSubsetChanged,
        },
      });
      const visualStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
      const primaryMergedLayerPayloads =
        pendingPromotion.primaryMergedLayerPayloads && typeof pendingPromotion.primaryMergedLayerPayloads === "object"
          ? pendingPromotion.primaryMergedLayerPayloads
          : {};
      const shouldForceStartupInitialVisualRefresh = !!allowStartupInitialVisual && (
        getFeatureCount(runtimeState.landData) <= 0
        || getColorCount() <= 0
      );
      effectiveChangedLayerKeys = Array.from(new Set([
        ...(Array.isArray(pendingPromotion.changedLayerKeys) ? pendingPromotion.changedLayerKeys : []),
        ...(Array.isArray(mergedLayerResult?.changedLayerKeys) ? mergedLayerResult.changedLayerKeys : []),
      ]));
      politicalMutationStarted = (
        Object.prototype.hasOwnProperty.call(mergedLayerPayloads, "political")
        || Object.prototype.hasOwnProperty.call(primaryMergedLayerPayloads, "political")
        || effectiveChangedLayerKeys.includes("political")
        || (Array.isArray(pendingPromotion.politicalFeatureIds) && pendingPromotion.politicalFeatureIds.length > 0)
        || shouldForceStartupInitialVisualRefresh
      );
      politicalPayloadChanged = applyScenarioPoliticalChunkPayload(bundle, mergedLayerPayloads.political || null, {
        renderNow: false,
        reason: pendingPromotion.reason,
        changedLayerKeys: effectiveChangedLayerKeys,
        politicalFeatureIds: pendingPromotion.politicalFeatureIds || [],
        primaryPoliticalPayload: primaryMergedLayerPayloads.political || null,
        forceRefresh: !!pendingPromotion.primaryVisibleFeatureSubsetChanged || shouldForceStartupInitialVisualRefresh,
        firstFrameOnly: !!allowStartupInitialVisual,
        scenarioApplyEpoch: promotionScenarioApplyEpoch,
        scenarioApplyRequestId: promotionScenarioApplyRequestId,
      });
      if (!politicalPayloadChanged) {
        deferredOptionalVisibleRefresh = {
          renderNow: false,
          reason: pendingPromotion.reason,
          changedLayerKeys: effectiveChangedLayerKeys,
          renderVisibleChangedLayerKeys: mergedLayerResult.renderVisibleChangedLayerKeys,
        };
      }
      // Keep the render lock across this frame break so a half-applied visual payload
      // cannot be flushed while a newer promotion run is taking ownership.
      await yieldToFrame();
      if (!isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId, runId })) {
        if (canRollbackPromotionContinuation()) {
          restoreMergedLayerRuntimeSnapshot(mergedLayerSnapshot);
          restoreScenarioChunkPromotionRootState(runtimeState, promotionRootSnapshot);
          if (politicalPayloadChanged) {
            refreshMapDataForScenarioChunkPromotion({
              suppressRender: true,
              reason: "scenario-chunk-promotion-stale-rollback",
              changedLayerKeys: effectiveChangedLayerKeys,
              politicalFeatureIds: pendingPromotion.politicalFeatureIds || [],
              hasPoliticalPayloadChange: true,
            });
          }
        }
        if (
          runtimeState.runtimeChunkLoadState === loadState
          && promotionCommitRunId === runId
          && Math.max(0, Number(loadState.promotionCommitRunId || 0))
            === runId
        ) {
          setPromotionCommitStatus("promotion-skipped-stale", { inFlight: false, finishedAt: Date.now() });
          recordRenderTransactionSnapshot(runtimeState, {
            phase: "scenario-chunk-promotion-stale-after-visual",
            reason: pendingPromotion.reason,
            expectedScenarioId: scenarioId,
            source: "scenario_chunk_runtime",
            searchParams: getSearchParams(),
            extra: {
              runId,
              selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || 0)),
              scenarioApplyEpoch: promotionScenarioApplyEpoch,
              scenarioApplyRequestId: promotionScenarioApplyRequestId,
              currentSelectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
              politicalPayloadChanged,
            },
          });
        }
        return false;
      }
      if (deferredOptionalVisibleRefresh) {
        refreshScenarioRenderVisibleOptionalChunkPayloadChange(deferredOptionalVisibleRefresh);
      }
      if (resolvedRenderNow !== false) {
        flushRenderBoundary("scenario-chunk-promotion");
      }
      if (
        runtimeState.runtimeChunkLoadState !== loadState
        || promotionCommitRunId !== runId
        || Math.max(0, Number(loadState.promotionCommitRunId || 0))
          !== runId
      ) {
        return false;
      }
      setScenarioChunkPromotionRenderLockState(runtimeState, previousRenderLock);
      const visualEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
      recordScenarioChunkRuntimeMetric("chunkPromotionCommitVisualMs", visualEndedAt - visualStartedAt, {
        scenarioId,
        reason: String(pendingPromotion.reason || "refresh"),
        politicalFeatureCount: Array.isArray(pendingPromotion.politicalFeatureIds) ? pendingPromotion.politicalFeatureIds.length : 0,
        politicalPayloadChanged,
        renderNow: resolvedRenderNow !== false,
      });
      recordScenarioRenderMetric("chunkPromotionMs", visualEndedAt - promotionStartedAt, {
        scenarioId,
        reason: String(pendingPromotion.reason || "refresh"),
        loadedChunkCount: Array.isArray(runtimeState.activeScenarioChunks?.loadedChunkIds)
          ? runtimeState.activeScenarioChunks.loadedChunkIds.length
          : 0,
      });
      if (
        pendingPromotion.politicalRequired
        && Array.isArray(mergedLayerPayloads?.political?.features)
        && !bundle?.chunkLifecycle?.politicalCoreReadyRecorded
      ) {
        const applyStartedAt = Number(bundle?.chunkLifecycle?.applyStartedAt || 0);
        if (applyStartedAt > 0) {
          const coarseReadyMs = (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt;
          const coarseReadyDetails = {
            scenarioId,
            source: "chunk-promotion-coarse-ready",
            readinessLevel: "coarse-chunk",
            promotedPoliticalFeatureCount: mergedLayerPayloads.political.features.length,
            requiredPoliticalChunkCount: Number(pendingPromotion.requiredPoliticalChunkCount || 0),
          };
          recordScenarioPerfMetric("timeToPoliticalCoreReady", coarseReadyMs, coarseReadyDetails);
          recordScenarioPerfMetric("timeToInteractiveCoarseFrame", coarseReadyMs, coarseReadyDetails);
        }
        if (bundle?.chunkLifecycle) {
          bundle.chunkLifecycle.politicalCoreReadyRecorded = true;
        }
      }
      if (String(pendingPromotion.reason || "").trim().toLowerCase() === "zoom-end") {
        protectZoomEndChunks(loadState, pendingPromotion.requiredChunkIds || [], {
          scenarioId,
          selectionVersion: pendingPromotion.selectionVersion || loadState.selectionVersion || 0,
          focusCountry: loadState.zoomEndChunkVisibleMetric?.focusCountry || "",
        });
        const startedAt = Number(loadState.zoomEndChunkVisibleMetric?.startedAt || 0);
        if (startedAt > 0) {
          const endedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
          const durationMs = Math.max(0, endedAt - startedAt);
          patchScenarioChunkLoadState(runtimeState, { lastZoomEndToChunkVisibleMetric: {
            durationMs,
            recordedAt: Date.now(),
            scenarioId,
            zoom: Number(loadState.zoomEndChunkVisibleMetric?.zoom || 0),
            threshold: Number(loadState.zoomEndChunkVisibleMetric?.threshold || 0),
            focusCountry: String(loadState.zoomEndChunkVisibleMetric?.focusCountry || ""),
            requiredPoliticalChunkCount: Number(pendingPromotion.requiredPoliticalChunkCount || 0),
            selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || loadState.selectionVersion || 0)),
            requiredChunkCount: Array.isArray(pendingPromotion.requiredChunkIds) ? pendingPromotion.requiredChunkIds.length : 0,
            loadedChunkCount: Array.isArray(runtimeState.activeScenarioChunks?.loadedChunkIds)
              ? runtimeState.activeScenarioChunks.loadedChunkIds.length
              : 0,
            promotionRetryCount: Math.max(0, Number(loadState.promotionRetryCount || 0)),
            pendingReason: String(loadState.pendingReason || pendingPromotion.reason || ""),
            activePostReadyTaskKey: String(runtimeState.activePostReadyTaskKey || ""),
          } });
          recordScenarioChunkRuntimeMetric("zoomEndToChunkVisibleMs", durationMs, {
            scenarioId,
            zoom: Number(loadState.zoomEndChunkVisibleMetric?.zoom || 0),
            threshold: Number(loadState.zoomEndChunkVisibleMetric?.threshold || 0),
            focusCountry: String(loadState.zoomEndChunkVisibleMetric?.focusCountry || ""),
            requiredPoliticalChunkCount: Number(pendingPromotion.requiredPoliticalChunkCount || 0),
            selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || loadState.selectionVersion || 0)),
            promotionRetryCount: Math.max(0, Number(loadState.promotionRetryCount || 0)),
            activePostReadyTaskKey: String(runtimeState.activePostReadyTaskKey || ""),
          });
        }
        patchScenarioChunkLoadState(runtimeState, { zoomEndChunkVisibleMetric: null });
      }
      if (
        runtimeState.runtimeChunkLoadState !== loadState
        || promotionCommitRunId !== runId
        || Math.max(0, Number(loadState.promotionCommitRunId || 0))
          !== runId
      ) {
        return false;
      }
      setScenarioChunkShellStatus("ready", loadState);
      clearPendingScenarioChunkPromotion(loadState);
      clearPendingScenarioChunkRefresh(loadState);
      setPromotionCommitStatus("promotion-committed", { inFlight: false, finishedAt: Date.now() });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-visual-complete",
        reason: pendingPromotion.reason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          runId,
          selectionVersion: Math.max(0, Number(pendingPromotion.selectionVersion || 0)),
          scenarioApplyEpoch: promotionScenarioApplyEpoch,
          scenarioApplyRequestId: promotionScenarioApplyRequestId,
          politicalPayloadChanged,
          renderNow: resolvedRenderNow !== false,
          changedLayerCount: Array.isArray(mergedLayerResult?.changedLayerKeys) ? mergedLayerResult.changedLayerKeys.length : 0,
        },
      });
      return true;
    } catch (error) {
      const rollbackIsCurrent = canRollbackPromotionContinuation();
      if (rollbackIsCurrent) {
        try {
          restoreMergedLayerRuntimeSnapshot(mergedLayerSnapshot);
          restoreScenarioDataGenerationSnapshot();
          if (promotionApplicationStarted) {
            refreshMapDataForScenarioChunkPromotion({
              suppressRender: true,
              reason: "scenario-chunk-promotion-error-rollback",
              changedLayerKeys: effectiveChangedLayerKeys,
              politicalFeatureIds: pendingPromotion.politicalFeatureIds || [],
              hasPoliticalPayloadChange: politicalPayloadChanged || politicalMutationStarted,
            });
          }
        } catch (rollbackError) {
          console.warn(
            "[scenario] Failed to restore scenario chunk promotion state after a commit error.",
            rollbackError,
          );
        }
      }
      if (
        rollbackIsCurrent
        && promotionCommitRunId === runId
        && Math.max(0, Number(loadState.promotionCommitRunId || 0)) === runId
      ) {
        setPromotionCommitStatus("error", {
          inFlight: true,
          error: error?.message || String(error || "unknown"),
        });
      }
      throw error;
    } finally {
      if (
        runtimeState.runtimeChunkLoadState === loadState
        && promotionCommitRunId === runId
        && Math.max(0, Number(loadState.promotionCommitRunId || 0))
          === runId
      ) {
        setScenarioChunkPromotionRenderLockState(runtimeState, previousRenderLock);
      }
    }
  }

  async function runPendingScenarioChunkPromotionCommit({
    bundle = null,
    pendingPromotion = null,
    renderNow = null,
    runId = 0,
    allowStartupInitialVisual = false,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    let resolvedPendingPromotion = pendingPromotion || loadState.pendingPromotion;
    if (!resolvedPendingPromotion || typeof resolvedPendingPromotion !== "object") {
      setPromotionCommitStatus("noop", { inFlight: false, finishedAt: Date.now() });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-commit-noop",
        reason: "missing-pending-promotion",
        expectedScenarioId: runtimeState.activeScenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          runId,
        },
      });
      return false;
    }
    const scenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    const resolvedPromotionScenarioApplyEpoch = resolveScenarioChunkApplyEpoch({
      bundle,
      scenarioId,
      selectionVersion: resolvedPendingPromotion.selectionVersion,
      pendingPromotion: resolvedPendingPromotion,
      loadState,
    });
    const resolvedPromotionScenarioApplyRequestId = resolveScenarioChunkApplyRequestId({
      pendingPromotion: resolvedPendingPromotion,
      loadState,
      selectionVersion: resolvedPendingPromotion.selectionVersion,
    });
    const identifiedPendingPromotion =
      runtimeState.runtimeChunkLoadState.pendingPromotion === resolvedPendingPromotion
        ? replaceScenarioChunkPendingPromotionIdentityState(
          runtimeState,
          runtimeState.runtimeChunkLoadState.pendingPromotion,
          {
            scenarioApplyEpoch: resolvedPromotionScenarioApplyEpoch,
            scenarioApplyRequestId: resolvedPromotionScenarioApplyRequestId,
          },
        )
        : null;
    if (identifiedPendingPromotion) {
      resolvedPendingPromotion = identifiedPendingPromotion;
    }
    if (!scenarioId || scenarioId !== normalizeScenarioId(resolvedPendingPromotion.scenarioId)) {
      if (loadState.pendingPromotion === resolvedPendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      setPromotionCommitStatus("promotion-skipped-stale", { inFlight: false, finishedAt: Date.now() });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-commit-stale",
        reason: resolvedPendingPromotion.reason,
        expectedScenarioId: resolvedPendingPromotion.scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          runId,
          scenarioApplyEpoch: resolvedPromotionScenarioApplyEpoch,
          scenarioApplyRequestId: resolvedPromotionScenarioApplyRequestId,
          activeScenarioId: scenarioId,
          pendingScenarioId: normalizeScenarioId(resolvedPendingPromotion.scenarioId),
        },
      });
      return false;
    }
    const resolvedBundle = bundle || getCachedScenarioBundle(scenarioId);
    if (!resolvedBundle) {
      if (loadState.pendingPromotion === resolvedPendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      setPromotionCommitStatus("noop", { inFlight: false, finishedAt: Date.now() });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-commit-noop",
        reason: "missing-bundle",
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          runId,
          selectionVersion: Math.max(0, Number(resolvedPendingPromotion.selectionVersion || 0)),
          scenarioApplyEpoch: resolvedPromotionScenarioApplyEpoch,
          scenarioApplyRequestId: resolvedPromotionScenarioApplyRequestId,
        },
      });
      return false;
    }
    if (shouldDeferScenarioChunkRefreshFor({ allowStartupInitialVisual })) {
      setScenarioChunkShellStatus("loading", loadState);
      const hasExplicitPendingDelayMs =
        loadState.pendingDelayMs != null && Number.isFinite(Number(loadState.pendingDelayMs));
      const retryDelayMs = Math.max(
        0,
        hasExplicitPendingDelayMs
          ? Number(loadState.pendingDelayMs)
          : (runtimeState.isInteracting ? refreshDelayInteracting : refreshDelayIdle),
      );
      markPendingScenarioChunkRefresh(
        resolvedPendingPromotion.reason || loadState.pendingReason || "chunk-promotion-deferred",
        retryDelayMs,
        { scenarioApplyRequestId: resolvedPromotionScenarioApplyRequestId },
      );
      recordScenarioChunkRuntimeMetric("chunkPromotionDeferredRetryMs", retryDelayMs, {
        scenarioId,
        reason: String(resolvedPendingPromotion.reason || "refresh"),
        retryCount: Math.max(0, Number(loadState.promotionRetryCount || 0)) + 1,
      });
      schedulePendingScenarioChunkPromotionCommit({
        delayMs: retryDelayMs,
        retry: true,
      });
      setPromotionCommitStatus("promotion-deferred", { inFlight: false, finishedAt: Date.now() });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-commit-deferred",
        reason: resolvedPendingPromotion.reason || loadState.pendingReason || "chunk-promotion-deferred",
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          runId,
          retryDelayMs,
          scenarioApplyEpoch: resolvedPromotionScenarioApplyEpoch,
          scenarioApplyRequestId: resolvedPromotionScenarioApplyRequestId,
          retryCount: Math.max(0, Number(loadState.promotionRetryCount || 0)) + 1,
        },
      });
      return false;
    }
    return applyPendingScenarioChunkPromotion(resolvedBundle, resolvedPendingPromotion, loadState, {
      renderNowOverride: renderNow,
      runId,
      allowStartupInitialVisual,
    });
  }

  function commitPendingScenarioChunkPromotion({
    bundle = null,
    pendingPromotion = null,
    renderNow = null,
    allowStartupInitialVisual = false,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    // 真正的 promotion transaction 只允许一个 in-flight run。
    // 结束后如果还有新的 refresh 请求，会通过 pendingPostCommitRefresh 重放，
    // 这样可以保留最新选择结果，同时丢掉已经过时的 replay。
    if (runtimeState.runtimeChunkLoadState !== loadState) {
      return Promise.resolve(false);
    }
    if (promotionCommitPromise || loadState.promotionCommitInFlight) {
      setPromotionCommitStatus("promotion-commit-in-flight", { inFlight: true });
      return promotionCommitPromise || Promise.resolve(false);
    }
    const runId = promotionCommitRunId + 1;
    promotionCommitRunId = runId;
    const startedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    let resolvedPendingPromotion = pendingPromotion || loadState.pendingPromotion;
    setPromotionCommitStatus("promotion-commit-started", {
      inFlight: true,
      runId,
      scenarioId: resolvedPendingPromotion?.scenarioId || runtimeState.activeScenarioId,
      selectionVersion: resolvedPendingPromotion?.selectionVersion || loadState.selectionVersion || 0,
      reason: resolvedPendingPromotion?.reason || loadState.pendingReason || "",
      startedAt,
      error: "",
    });
    const commitScenarioApplyEpoch = resolveScenarioChunkApplyEpoch({
      bundle,
      scenarioId: resolvedPendingPromotion?.scenarioId || runtimeState.activeScenarioId,
      selectionVersion: resolvedPendingPromotion?.selectionVersion || loadState.selectionVersion || 0,
      pendingPromotion: resolvedPendingPromotion,
    });
    const commitScenarioApplyRequestId = resolveScenarioChunkApplyRequestId({
      pendingPromotion: resolvedPendingPromotion,
      selectionVersion: resolvedPendingPromotion?.selectionVersion || loadState.selectionVersion || 0,
    });
    if (resolvedPendingPromotion) {
      const identifiedPendingPromotion =
        runtimeState.runtimeChunkLoadState.pendingPromotion === resolvedPendingPromotion
          ? replaceScenarioChunkPendingPromotionIdentityState(
            runtimeState,
            runtimeState.runtimeChunkLoadState.pendingPromotion,
            {
              scenarioApplyEpoch: commitScenarioApplyEpoch,
              scenarioApplyRequestId: commitScenarioApplyRequestId,
            },
          )
          : null;
      if (identifiedPendingPromotion) {
        resolvedPendingPromotion = identifiedPendingPromotion;
      }
    }
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-chunk-promotion-commit-scheduled",
      reason: resolvedPendingPromotion?.reason || loadState.pendingReason || "chunk-promotion",
      expectedScenarioId: resolvedPendingPromotion?.scenarioId || runtimeState.activeScenarioId,
      source: "scenario_chunk_runtime",
      searchParams: getSearchParams(),
      extra: {
        runId,
        selectionVersion: Math.max(0, Number(resolvedPendingPromotion?.selectionVersion || loadState.selectionVersion || 0)),
        scenarioApplyEpoch: commitScenarioApplyEpoch,
        scenarioApplyRequestId: commitScenarioApplyRequestId,
        allowStartupInitialVisual: !!allowStartupInitialVisual,
      },
    });
    let commitFailed = false;
    promotionCommitPromise = runPendingScenarioChunkPromotionCommit({
      bundle,
      pendingPromotion: resolvedPendingPromotion,
      renderNow,
      runId,
      allowStartupInitialVisual,
    }).catch((error) => {
      commitFailed = true;
      throw error;
    }).finally(() => {
      // commit 结束后统一在这里处理“收尾 + 是否重放最新 refresh”。
      // 这样每一轮 promotion 都只有一个出口，避免不同分支分别改 in-flight 标记。
      const commitRunIsOwned = runtimeState.runtimeChunkLoadState === loadState
        && promotionCommitRunId === runId
        && Math.max(0, Number(loadState.promotionCommitRunId || 0)) === runId;
      if (commitRunIsOwned) {
        if (loadState.promotionCommitStatus === "promotion-commit-started" || loadState.promotionCommitStatus === "promotion-commit-in-flight") {
          setPromotionCommitStatus("idle");
        }
        setPromotionCommitStatus(
          String(loadState.promotionCommitStatus || "idle"),
          {
            inFlight: false,
            finishedAt: Date.now(),
          },
        );
      }
      if (promotionCommitRunId === runId) {
        promotionCommitPromise = null;
      }
      if (!commitRunIsOwned) {
        return;
      }
      const pendingPostCommitRefresh = loadState.pendingPostCommitRefresh;
      patchScenarioChunkLoadState(runtimeState, { pendingPostCommitRefresh: null });
      if (commitFailed) {
        return;
      }
      if (
        pendingPostCommitRefresh
        && typeof pendingPostCommitRefresh === "object"
        && runtimeState.runtimeChunkLoadState === loadState
        && !loadState.promotionCommitInFlight
      ) {
        const pendingScenarioId = normalizeScenarioId(pendingPostCommitRefresh.scenarioId || runtimeState.activeScenarioId);
        const pendingSelectionVersion = Math.max(0, Number(pendingPostCommitRefresh.selectionVersion || 0));
        const pendingScenarioApplyRequestId = Math.max(0, Number(pendingPostCommitRefresh.scenarioApplyRequestId || 0));
        const staleReplay = (
          pendingScenarioId !== normalizeScenarioId(runtimeState.activeScenarioId)
          || (pendingSelectionVersion > 0 && pendingSelectionVersion !== Math.max(0, Number(loadState.selectionVersion || 0)))
          || !isScenarioApplyRequestCurrentForScenario({
            scenarioId: pendingScenarioId,
            scenarioApplyRequestId: pendingScenarioApplyRequestId,
          })
        );
        if (staleReplay) {
          recordScenarioChunkRuntimeMetric("staleRefreshDiscardedCount", 1, {
            scenarioId: pendingScenarioId,
            reason: String(pendingPostCommitRefresh.reason || "post-commit-refresh"),
            selectionVersion: pendingSelectionVersion,
            currentSelectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
            source: "post-commit-replay",
          });
          recordScenarioApplyStaleCallbackSkipped({
            callbackPhase: "post-commit-refresh-replay",
            reason: pendingPostCommitRefresh.reason || "post-commit-refresh",
            scenarioId: pendingScenarioId,
            scenarioApplyRequestId: pendingScenarioApplyRequestId,
            extra: {
              selectionVersion: pendingSelectionVersion,
              currentSelectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
            },
          });
          return;
        }
        const replayReason = pendingPostCommitRefresh.reason || "post-commit-refresh";
        recordScenarioChunkRuntimeMetric("postCommitReplayCount", 1, {
          scenarioId: pendingScenarioId,
          reason: String(replayReason || "post-commit-refresh"),
          selectionVersion: pendingSelectionVersion,
        });
        scheduleScenarioChunkRefresh({
          reason: replayReason,
          delayMs: Number.isFinite(Number(pendingPostCommitRefresh.delayMs))
            ? Number(pendingPostCommitRefresh.delayMs)
            : 0,
          refreshSourceStartedAtMs: Number(pendingPostCommitRefresh.refreshSourceStartedAtMs || 0),
          scenarioApplyRequestId: pendingScenarioApplyRequestId,
        });
        return;
      }
      if (loadState.pendingPromotion && !loadState.promotionScheduled && !loadState.promotionCommitInFlight) {
        schedulePendingScenarioChunkPromotionCommit({ delayMs: 0 });
      }
    });
    return promotionCommitPromise;
  }

  function cancelScenarioChunkPromotionCommit(reason = "cancel") {
    setScenarioChunkPromotionRenderLockState(runtimeState, false);
    const loadState = ensureRuntimeChunkLoadState();
    if (loadState.promotionTimerId) {
      globalThis.clearTimeout(loadState.promotionTimerId);
      patchScenarioChunkLoadState(runtimeState, { promotionTimerId: null });
    }
    patchScenarioChunkLoadState(runtimeState, {
      promotionScheduled: false,
      pendingPostCommitRefresh: null,
    });
    promotionCommitRunId += 1;
    promotionCommitPromise = null;
    setPromotionCommitStatus(String(reason || "cancel"), {
      inFlight: false,
      runId: promotionCommitRunId,
      finishedAt: Date.now(),
      error: "",
    });
    return true;
  }

  registerRuntimeHook(
    runtimeState,
    "cancelScenarioChunkPromotionCommitFn",
    (reason) => cancelScenarioChunkPromotionCommit(reason),
  );

  function getCurrentScenarioChunkViewportBbox() {
    return typeof runtimeState.getViewportGeoBoundsFn === "function"
      ? runtimeState.getViewportGeoBoundsFn()
      : [...SCENARIO_CHUNK_FULL_WORLD_BBOX];
  }

  async function preloadScenarioCoarseChunks(
    bundle,
    {
      d3Client = globalThis.d3,
    } = {}
  ) {
    if (!scenarioSupportsChunkedRuntime(bundle?.manifest)) return null;
    const bundleScenarioId = getScenarioBundleId(bundle);
    ensureRuntimeChunkLoadState();
    const prewarmContinuationState =
      captureScenarioChunkLoadStateContinuation(runtimeState);
    const prewarmLoadStateGeneration =
      prewarmContinuationState.loadStateGeneration;
    const prewarmScenarioApplyRequestId =
      prewarmContinuationState.continuationScenarioApplyRequestId;
    const isPrewarmContinuationCurrent = (callbackPhase) => {
      if (isScenarioChunkLoadStateContinuationCurrent(
        prewarmContinuationState,
        {
          scenarioId: bundleScenarioId,
          scenarioApplyRequestId: prewarmScenarioApplyRequestId,
        },
      )) return true;
      recordScenarioApplyStaleCallbackSkipped({
        callbackPhase,
        reason: "coarse-prewarm",
        scenarioId: bundleScenarioId,
        scenarioApplyRequestId: prewarmScenarioApplyRequestId,
        extra: { loadStateGeneration: prewarmLoadStateGeneration },
      });
      return false;
    };
    await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
    if (!isPrewarmContinuationCurrent("coarse-prewarm-after-registry")) {
      return null;
    }
    const visibleLayers = getVisibleScenarioChunkLayers({
      includePoliticalCore: scenarioBundleUsesChunkedLayer(bundle, "political"),
      showWaterRegions: normalizeScenarioPerformanceHints(bundle.manifest).waterRegionsDefault !== false,
      showScenarioSpecialRegions: normalizeScenarioPerformanceHints(bundle.manifest).specialRegionsDefault !== false,
      showScenarioAtlantropa: normalizeScenarioPerformanceHints(bundle.manifest).scenarioAtlantropaDefault !== false,
      showScenarioReliefOverlays: normalizeScenarioPerformanceHints(bundle.manifest).scenarioReliefOverlaysDefault === true,
      requiredSemanticLayers: resolveRequiredScenarioSemanticLayers({
        scenarioId: getScenarioBundleId(bundle),
        manifest: bundle.manifest,
      }),
      // First-frame coarse prewarm keeps the apply transaction focused on
      // political/runtime shell readiness. City chunks continue to load through
      // follow-up visibility refreshes after the scenario is interactive.
      showCityPoints: false,
    });
    const coarseSelection = selectScenarioChunks({
      scenarioId: getScenarioBundleId(bundle),
      chunkRegistry: bundle.chunkRegistry,
      contextLodManifest: bundle.contextLodManifest,
      zoom: 1,
      viewportBbox: [...SCENARIO_CHUNK_FULL_WORLD_BBOX],
      focusCountry: getScenarioDefaultCountryCode(bundle.manifest, bundle.countriesPayload?.countries || {}),
      renderBudgetHints: bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {},
      visibleLayers,
      loadedChunkIds: [],
    });
    const requiredChunksToLoad = coarseSelection.requiredChunks.filter((chunk) => (
      !bundle.chunkPayloadCacheById?.[chunk.id]
    ));
    await Promise.all(
      requiredChunksToLoad.map((chunk) => loadScenarioChunkPayload(bundle, chunk, { d3Client }))
    );
    if (!isPrewarmContinuationCurrent("coarse-prewarm-after-load")) {
      return null;
    }
    bundle.chunkPreloaded = true;
    if (bundleScenarioId && bundleScenarioId === normalizeScenarioId(runtimeState.activeScenarioId)) {
      if (!shouldCommitScenarioCoarsePrewarmImmediately(bundle)) {
        return null;
      }
      ensureScenarioChunkRuntimeState(runtimeState, {
        scenarioId: bundleScenarioId,
      });
      const chunkState = runtimeState.activeScenarioChunks;
      const loadState = ensureRuntimeChunkLoadState();
      if (
        hasDetailScenarioChunkIds(chunkState.loadedChunkIds)
        || Math.max(0, Number(loadState.selectionVersion || 0)) > 0
        || loadState.promotionCommitInFlight
        || loadState.pendingPromotion
      ) {
        return null;
      }
      const scenarioApplyEpoch = resolveScenarioChunkApplyEpoch({
        bundle,
        scenarioId: bundleScenarioId,
        loadState,
      });
      const scenarioApplyRequestId = prewarmScenarioApplyRequestId;
      const committedSelectionVersion = commitScenarioChunkSelectionState(
        runtimeState,
        {
          selectionVersion: loadState.selectionVersion,
          scenarioApplyEpoch,
          scenarioApplyRequestId,
          lastSelection: loadState.lastSelection,
        },
        { expectedLoadStateGeneration: prewarmLoadStateGeneration },
      );
      if (committedSelectionVersion === false) return null;
      commitScenarioChunkPayloadEntriesState(
        runtimeState,
        coarseSelection.requiredChunks
          .map((chunk) => ({
            chunkId: chunk.id,
            payload: bundle.chunkPayloadCacheById?.[chunk.id],
          }))
          .filter((entry) => entry.payload),
      );
      const layerSignatures = buildScenarioChunkLayerSelectionSignatures(bundle, ensureActiveScenarioChunkState(), null);
      const mergedResult = buildMergedScenarioChunkLayerPayloads(bundle, ensureActiveScenarioChunkState(), {
        mergeScenarioChunkPayloads,
        mergeScenarioChunkPayloadsForViewport,
        previousSignatures: {},
        nextSignatures: layerSignatures,
        previousMergedLayerPayloads: {},
        viewportBbox: coarseSelection.viewportBbox || [...SCENARIO_CHUNK_FULL_WORLD_BBOX],
      });
      setScenarioChunkMergedLayerPayloadsState(runtimeState, mergedResult.mergedLayerPayloads);
      const mergedLayerPayloads = mergedResult.mergedLayerPayloads;
      patchScenarioChunkLoadState(runtimeState, {
        layerSelectionSignatures: layerSignatures,
        mergedLayerPayloadCache: mergedLayerPayloads,
      }, {
        expectedLoadStateGeneration: prewarmLoadStateGeneration,
      });
      const mergedLayerResult = applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, { renderNow: false });
      const politicalPayloadChanged = applyScenarioPoliticalChunkPayload(bundle, mergedLayerPayloads.political || null, {
        renderNow: false,
        reason: "coarse-prewarm",
        changedLayerKeys: mergedResult.changedLayerKeys,
        primaryPoliticalPayload: mergedResult.primaryMergedLayerPayloads?.political || null,
        scenarioApplyEpoch: chunkState.scenarioApplyEpoch,
        scenarioApplyRequestId: chunkState.scenarioApplyRequestId,
      });
      if (!politicalPayloadChanged) {
        refreshScenarioRenderVisibleOptionalChunkPayloadChange({
          renderNow: false,
          reason: "coarse-prewarm",
          changedLayerKeys: mergedResult.changedLayerKeys,
          renderVisibleChangedLayerKeys: mergedLayerResult.renderVisibleChangedLayerKeys,
        });
      }
      return mergedLayerPayloads;
    }
    return null;
  }

  function shouldCommitScenarioCoarsePrewarmImmediately(bundle) {
    const featureCount = Number(bundle?.manifest?.summary?.feature_count || 0);
    const hints = normalizeScenarioPerformanceHints(bundle?.manifest);
    return featureCount >= 18_000
      && hints.waterRegionsDefault === false
      && hints.specialRegionsDefault === false
      && hints.scenarioReliefOverlaysDefault === false;
  }

  async function preloadScenarioFocusCountryPoliticalDetailChunk(
    bundle,
    {
      d3Client = globalThis.d3,
    } = {}
  ) {
    if (!scenarioSupportsChunkedRuntime(bundle?.manifest)) return null;
    const bundleScenarioId = getScenarioBundleId(bundle);
    ensureRuntimeChunkLoadState();
    const detailPrewarmContinuationState =
      captureScenarioChunkLoadStateContinuation(runtimeState);
    const detailPrewarmLoadStateGeneration =
      detailPrewarmContinuationState.loadStateGeneration;
    const detailPrewarmScenarioApplyRequestId =
      detailPrewarmContinuationState.continuationScenarioApplyRequestId;
    await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
    if (!isScenarioChunkLoadStateContinuationCurrent(
      detailPrewarmContinuationState,
      {
        scenarioId: bundleScenarioId,
        scenarioApplyRequestId: detailPrewarmScenarioApplyRequestId,
      },
    )) {
      recordScenarioApplyStaleCallbackSkipped({
        callbackPhase: "detail-prewarm-after-registry",
        reason: "focus-country-detail-prewarm",
        scenarioId: bundleScenarioId,
        scenarioApplyRequestId: detailPrewarmScenarioApplyRequestId,
        extra: { loadStateGeneration: detailPrewarmLoadStateGeneration },
      });
      return null;
    }
    const focusCountry = resolveScenarioChunkFocusCountry(bundle);
    if (!focusCountry) return null;
    const politicalChunks = Array.isArray(bundle?.chunkRegistry?.byLayer?.political)
      ? bundle.chunkRegistry.byLayer.political
      : [];
    const targetChunk = politicalChunks.find((chunk) =>
      chunk?.lod === "detail"
      && Array.isArray(chunk.countryCodes)
      && chunk.countryCodes.includes(focusCountry)
    ) || null;
    if (!targetChunk) return null;
    return loadScenarioChunkPayload(bundle, targetChunk, { d3Client });
  }

  async function refreshActiveScenarioChunks({
    reason = "refresh",
    d3Client = globalThis.d3,
    renderNow = true,
    allowStartupInitialVisual = false,
    startupInitialPoliticalOnly = false,
  } = {}) {
    const scenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    if (!scenarioId) return null;
    const bundle = getCachedScenarioBundle(scenarioId);
    if (!bundle) return null;
    const loadState = ensureRuntimeChunkLoadState();
    const refreshContinuationState =
      captureScenarioChunkLoadStateContinuation(runtimeState);
    const refreshLoadStateGeneration =
      refreshContinuationState.loadStateGeneration;
    const refreshScenarioApplyRequestId =
      refreshContinuationState.continuationScenarioApplyRequestId;
    const allowZoomEndSettling = shouldZoomEndPromoteImmediately(bundle, reason);
    if (shouldDeferScenarioChunkRefreshFor({ allowZoomEndSettling, allowStartupInitialVisual })) {
      markPendingScenarioChunkRefresh(reason, null, {
        scenarioApplyRequestId: getCurrentScenarioApplyRequestId(),
      });
      if (loadState.selectionVersion <= 0 && !runtimeState.activeScenarioChunks?.loadedChunkIds?.length) {
        setScenarioChunkShellStatus("loading", loadState);
      }
      return null;
    }
    if (!scenarioBundleUsesChunkedLayer(bundle)) {
      if (!scenarioSupportsChunkedRuntime(bundle?.manifest)) return null;
      await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
      if (!isScenarioChunkLoadStateContinuationCurrent(
        refreshContinuationState,
        {
          scenarioId,
          scenarioApplyRequestId: refreshScenarioApplyRequestId,
        },
      )) {
        recordScenarioApplyStaleCallbackSkipped({
          callbackPhase: "chunk-registry-load-continuation",
          reason,
          scenarioId,
          scenarioApplyRequestId: refreshScenarioApplyRequestId,
          extra: { loadStateGeneration: refreshLoadStateGeneration },
        });
        return null;
      }
      if (!scenarioBundleUsesChunkedLayer(bundle)) return null;
    }
    clearPendingScenarioChunkRefresh(loadState);
    const viewportBbox = getCurrentScenarioChunkViewportBbox();
    const visibleLayers = startupInitialPoliticalOnly
      ? getVisibleScenarioChunkLayers({
        includePoliticalCore: scenarioBundleUsesChunkedLayer(bundle, "political"),
        requiredSemanticLayers: resolveRequiredScenarioSemanticLayers({
          scenarioId,
          manifest: bundle.manifest,
        }),
      })
      : getVisibleScenarioChunkLayers({
        includePoliticalCore: scenarioBundleUsesChunkedLayer(bundle, "political"),
        showWaterRegions: runtimeState.showWaterRegions !== false,
        showScenarioSpecialRegions: runtimeState.showScenarioSpecialRegions !== false,
        showScenarioAtlantropa: runtimeState.showScenarioAtlantropa !== false,
        showScenarioReliefOverlays: runtimeState.showScenarioReliefOverlays !== false,
        showCityPoints: runtimeState.showCityPoints !== false,
        requiredSemanticLayers: resolveRequiredScenarioSemanticLayers({
          scenarioId,
          manifest: bundle.manifest,
        }),
      });
    ensureScenarioChunkRuntimeState(runtimeState, {
      scenarioId,
    });
    const chunkState = runtimeState.activeScenarioChunks;
    setScenarioChunkShellStatus("loading", loadState);
    const focusCountry = resolveScenarioChunkFocusCountry(bundle, loadState, { viewportBbox });
    const selectionStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const selection = selectScenarioChunks({
      scenarioId,
      chunkRegistry: bundle.chunkRegistry,
      contextLodManifest: bundle.contextLodManifest,
      zoom: Number(runtimeState.zoomTransform?.k || 1),
      viewportBbox,
      focusCountry,
      renderBudgetHints: bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {},
      visibleLayers,
      loadedChunkIds: chunkState.loadedChunkIds,
    });
    const previousSelection = loadState.lastSelection;
    const normalizedReason = String(reason || "refresh").trim().toLowerCase();
    if (normalizedReason === "zoom-end") {
      const demotedNonPoliticalDetailOptional = selection.requiredChunks.filter(
        (chunk) => !["political", "scenario_atlantropa"].includes(chunk.layer) && chunk.lod === "detail"
      );
      if (demotedNonPoliticalDetailOptional.length) {
        const demotedIdSet = new Set(demotedNonPoliticalDetailOptional.map((chunk) => chunk.id));
        selection.requiredChunks = selection.requiredChunks.filter((chunk) => !demotedIdSet.has(chunk.id));
        selection.optionalChunks = [
          ...demotedNonPoliticalDetailOptional,
          ...selection.optionalChunks,
        ].filter((chunk, index, array) => array.findIndex((candidate) => candidate.id === chunk.id) === index);
      }
    }
    applyZoomEndChunkProtection(selection, loadState, {
      reason: normalizedReason,
      previousSelection,
      scenarioId,
      selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
      focusCountry,
    });
    const selectionEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioChunkRuntimeMetric("chunkSelectionMs", selectionEndedAt - selectionStartedAt, {
      scenarioId,
      reason: String(reason || "refresh"),
      selectedFeatureCountSum: Math.max(0, Number(selection.selectedFeatureCountSum || 0)),
      selectedVisibleFeatureCountSum: Math.max(0, Number(selection.selectedVisibleFeatureCountSum || 0)),
      selectedPoliticalFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalFeatureCountSum || 0)),
      selectedPoliticalVisibleFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalVisibleFeatureCountSum || 0)),
      selectedByteCountSum: Math.max(0, Number(selection.selectedByteCountSum || 0)),
      selectedCoordCountSum: Math.max(0, Number(selection.selectedCoordCountSum || 0)),
      selectedPartCountSum: Math.max(0, Number(selection.selectedPartCountSum || 0)),
      selectedEstimatedPathCostSum: Math.max(0, Number(selection.selectedEstimatedPathCostSum || 0)),
    });
    recordScenarioChunkRuntimeMetric("selectedFeatureCountSum", selection.selectedFeatureCountSum || 0, {
      scenarioId,
      reason: String(reason || "refresh"),
      selectedVisibleFeatureCountSum: Math.max(0, Number(selection.selectedVisibleFeatureCountSum || 0)),
      selectedPoliticalFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalFeatureCountSum || 0)),
      selectedPoliticalVisibleFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalVisibleFeatureCountSum || 0)),
      selectedByteCountSum: Math.max(0, Number(selection.selectedByteCountSum || 0)),
      selectedCoordCountSum: Math.max(0, Number(selection.selectedCoordCountSum || 0)),
      selectedPartCountSum: Math.max(0, Number(selection.selectedPartCountSum || 0)),
      selectedEstimatedPathCostSum: Math.max(0, Number(selection.selectedEstimatedPathCostSum || 0)),
    });
    const nextRequiredChunkIds = selection.requiredChunks.map((chunk) => chunk.id);
    const nextOptionalChunkIds = selection.optionalChunks.map((chunk) => chunk.id);
    const nextCacheOnlyChunkIds = Array.isArray(selection.cacheOnlyChunkIds) ? [...selection.cacheOnlyChunkIds] : [];
    const nextRetainedActiveChunkIds = Array.isArray(selection.retainedActiveChunkIds) ? [...selection.retainedActiveChunkIds] : [];
    const nextPoliticalVisibleFeatureSubsetSignature = String(selection.politicalVisibleFeatureSubsetSignature || "");
    const previousZoomEndProtectionUntil = Math.max(0, Number(previousSelection?.zoomEndProtectionUntil || 0));
    const shouldCarryZoomEndProtection = nextRetainedActiveChunkIds.length > 0 && previousZoomEndProtectionUntil > Date.now();
    const carriedZoomEndRecordedAt = Math.max(0, Number(previousSelection?.recordedAt || 0));
    const selectionUnchanged =
      normalizeScenarioId(previousSelection?.scenarioId) === scenarioId
      && getChunkIdListSignature(previousSelection?.requiredChunkIds) === getChunkIdListSignature(nextRequiredChunkIds)
      && getChunkIdListSignature(previousSelection?.optionalChunkIds) === getChunkIdListSignature(nextOptionalChunkIds)
      && getChunkIdListSignature(previousSelection?.cacheOnlyChunkIds) === getChunkIdListSignature(nextCacheOnlyChunkIds)
      && getChunkIdListSignature(previousSelection?.retainedActiveChunkIds) === getChunkIdListSignature(nextRetainedActiveChunkIds)
      && String(previousSelection?.politicalVisibleFeatureSubsetSignature || "") === nextPoliticalVisibleFeatureSubsetSignature
      && selection.evictableChunkIds.length === 0
      && nextRequiredChunkIds.every((chunkId) => !!chunkState.payloadByChunkId?.[chunkId]);
    const currentSelectionVersion = Math.max(0, Number(loadState.selectionVersion || 0));
    const nextSelectionVersion = selectionUnchanged ? currentSelectionVersion : currentSelectionVersion + 1;
    const selectionRecordedAt = Date.now();
    const selectionScenarioApplyEpoch = resolveScenarioChunkApplyEpoch({
      bundle,
      scenarioId,
      selectionVersion: nextSelectionVersion,
      loadState,
    });
    const selectionScenarioApplyRequestId = refreshScenarioApplyRequestId;
    const lastSelection = {
      reason: String(reason || "refresh"),
      scenarioId,
      scenarioApplyEpoch: selectionScenarioApplyEpoch,
      scenarioApplyRequestId: selectionScenarioApplyRequestId,
      viewportBbox,
      requiredChunkIds: nextRequiredChunkIds,
      optionalChunkIds: nextOptionalChunkIds,
      cacheOnlyChunkIds: nextCacheOnlyChunkIds,
      retainedActiveChunkIds: nextRetainedActiveChunkIds,
      visibleFeatureSubsetSignature: String(selection.visibleFeatureSubsetSignature || ""),
      politicalVisibleFeatureSubsetSignature: nextPoliticalVisibleFeatureSubsetSignature,
      selectedVisibleFeatureCountSum: Math.max(0, Number(selection.selectedVisibleFeatureCountSum || 0)),
      selectedPoliticalFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalFeatureCountSum || 0)),
      selectedPoliticalVisibleFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalVisibleFeatureCountSum || 0)),
      selectionVersion: nextSelectionVersion,
      focusCountry: String(focusCountry || "").trim().toUpperCase(),
      recordedAt: shouldCarryZoomEndProtection && carriedZoomEndRecordedAt > 0 ? carriedZoomEndRecordedAt : selectionRecordedAt,
      zoomEndProtectionUntil: normalizedReason === "zoom-end"
        ? selectionRecordedAt + 5000
        : (shouldCarryZoomEndProtection ? previousZoomEndProtectionUntil : 0),
    };
    if (!isScenarioChunkLoadStateContinuationCurrent(
      refreshContinuationState,
      {
        scenarioId,
        scenarioApplyRequestId: selectionScenarioApplyRequestId,
      },
    )) {
      recordScenarioApplyStaleCallbackSkipped({
        callbackPhase: "chunk-selection-commit",
        reason,
        scenarioId,
        scenarioApplyRequestId: selectionScenarioApplyRequestId,
        extra: { loadStateGeneration: refreshLoadStateGeneration },
      });
      return null;
    }
    const committedSelectionVersion = commitScenarioChunkSelectionState(
      runtimeState,
      {
        selectionVersion: nextSelectionVersion,
        scenarioApplyEpoch: selectionScenarioApplyEpoch,
        scenarioApplyRequestId: selectionScenarioApplyRequestId,
        lastSelection,
      },
      { expectedLoadStateGeneration: refreshLoadStateGeneration },
    );
    if (committedSelectionVersion === false) {
      recordScenarioApplyStaleCallbackSkipped({
        callbackPhase: "chunk-selection-commit",
        reason,
        scenarioId,
        scenarioApplyRequestId: selectionScenarioApplyRequestId,
        extra: { loadStateGeneration: refreshLoadStateGeneration },
      });
      return null;
    }
    recordRenderTransactionSnapshot(runtimeState, {
      phase: selectionUnchanged ? "scenario-chunk-selection-reused" : "scenario-chunk-selection-created",
      reason,
      expectedScenarioId: scenarioId,
      source: "scenario_chunk_runtime",
      searchParams: getSearchParams(),
      extra: {
        selectionVersion: nextSelectionVersion,
        scenarioApplyEpoch: selectionScenarioApplyEpoch,
        scenarioApplyRequestId: selectionScenarioApplyRequestId,
        requiredChunkCount: nextRequiredChunkIds.length,
        optionalChunkCount: nextOptionalChunkIds.length,
        cacheOnlyChunkCount: nextCacheOnlyChunkIds.length,
        retainedActiveChunkCount: nextRetainedActiveChunkIds.length,
        evictableChunkCount: selection.evictableChunkIds.length,
        selectedVisibleFeatureCountSum: Math.max(0, Number(selection.selectedVisibleFeatureCountSum || 0)),
        selectedPoliticalFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalFeatureCountSum || 0)),
        selectedPoliticalVisibleFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalVisibleFeatureCountSum || 0)),
      },
    });
    if (selectionUnchanged) {
      if (nextRequiredChunkIds.length || chunkState.loadedChunkIds.length) {
        setScenarioChunkShellStatus("ready", loadState);
      }
      if (String(reason || "").trim().toLowerCase() === "zoom-end" && Number(loadState.zoomEndChunkVisibleMetric?.startedAt || 0) > 0) {
        const endedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
        const durationMs = Math.max(0, endedAt - Number(loadState.zoomEndChunkVisibleMetric.startedAt || 0));
        patchScenarioChunkLoadState(runtimeState, { lastZoomEndToChunkVisibleMetric: {
          durationMs,
          recordedAt: Date.now(),
          scenarioId,
          zoom: Number(loadState.zoomEndChunkVisibleMetric.zoom || 0),
          threshold: Number(loadState.zoomEndChunkVisibleMetric.threshold || 0),
          focusCountry: String(loadState.zoomEndChunkVisibleMetric.focusCountry || ""),
          requiredPoliticalChunkCount: selection.requiredChunks.filter((chunk) => chunk.layer === "political").length,
          selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
          requiredChunkCount: selection.requiredChunks.length,
          loadedChunkCount: Array.isArray(chunkState.loadedChunkIds) ? chunkState.loadedChunkIds.length : 0,
          promotionRetryCount: Math.max(0, Number(loadState.promotionRetryCount || 0)),
          pendingReason: String(loadState.pendingReason || reason || ""),
          activePostReadyTaskKey: String(runtimeState.activePostReadyTaskKey || ""),
        } });
        recordScenarioChunkRuntimeMetric("zoomEndToChunkVisibleMs", durationMs, {
          scenarioId,
          zoom: Number(loadState.zoomEndChunkVisibleMetric.zoom || 0),
          threshold: Number(loadState.zoomEndChunkVisibleMetric.threshold || 0),
          focusCountry: String(loadState.zoomEndChunkVisibleMetric.focusCountry || ""),
          requiredPoliticalChunkCount: selection.requiredChunks.filter((chunk) => chunk.layer === "political").length,
          selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
          promotionRetryCount: Math.max(0, Number(loadState.promotionRetryCount || 0)),
          activePostReadyTaskKey: String(runtimeState.activePostReadyTaskKey || ""),
        });
        patchScenarioChunkLoadState(runtimeState, { zoomEndChunkVisibleMetric: null });
      }
      patchScenarioChunkLoadState(runtimeState, {
        pendingReason: "",
        pendingDelayMs: null,
        pendingScenarioApplyRequestId: 0,
      }, {
        expectedLoadStateGeneration: refreshLoadStateGeneration,
      });
      consumeScenarioChunkFocusCountryOverride(loadState);
      return selection;
    }
    const chunkLoadStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    await Promise.all(selection.requiredChunks.map((chunk) => loadScenarioChunkPayload(bundle, chunk, { d3Client })));
    if (!isScenarioChunkRefreshCurrent(loadState, {
      scenarioId,
      continuationState: refreshContinuationState,
      selectionVersion: nextSelectionVersion,
      requiredChunkIds: nextRequiredChunkIds,
      cacheOnlyChunkIds: nextCacheOnlyChunkIds,
      retainedActiveChunkIds: nextRetainedActiveChunkIds,
      scenarioApplyRequestId: selectionScenarioApplyRequestId,
    })) {
      recordScenarioChunkRuntimeMetric("staleRefreshDiscardedCount", 1, {
        scenarioId,
        reason: String(reason || "refresh"),
        selectionVersion: nextSelectionVersion,
        currentSelectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
      });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-selection-stale-after-load",
        reason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          selectionVersion: nextSelectionVersion,
          scenarioApplyEpoch: selectionScenarioApplyEpoch,
          scenarioApplyRequestId: selectionScenarioApplyRequestId,
          currentSelectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
          requiredChunkCount: nextRequiredChunkIds.length,
        },
      });
      return null;
    }
    const chunkLoadEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioChunkRuntimeMetric("chunkLoadMs", chunkLoadEndedAt - chunkLoadStartedAt, {
      scenarioId,
      reason: String(reason || "refresh"),
      requiredChunkCount: selection.requiredChunks.length,
    });
    commitScenarioChunkPayloadEntriesState(
      runtimeState,
      selection.requiredChunks
        .map((chunk) => ({
          chunkId: chunk.id,
          payload: bundle.chunkPayloadCacheById?.[chunk.id],
        }))
        .filter((entry) => entry.payload),
    );
    if (selection.evictableChunkIds.length) {
      evictScenarioChunkPayloadsState(
        runtimeState,
        selection.evictableChunkIds,
      );
      recordScenarioRenderMetric("chunkEvictionCount", selection.evictableChunkIds.length, {
        scenarioId,
        reason: String(reason || "refresh"),
      });
    }
    const previousLayerSignatures = loadState.layerSelectionSignatures || {};
    const activeMergeChunkIds = getScenarioChunkActiveMergeIds(chunkState, selection);
    const nextLayerSignatures = buildScenarioChunkLayerSelectionSignatures(bundle, ensureActiveScenarioChunkState(), activeMergeChunkIds);
    const chunkMergeStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const mergedResult = buildMergedScenarioChunkLayerPayloads(bundle, ensureActiveScenarioChunkState(), {
        mergeScenarioChunkPayloads,
        mergeScenarioChunkPayloadsForViewport,
      previousSignatures: previousLayerSignatures,
      nextSignatures: nextLayerSignatures,
      previousMergedLayerPayloads: loadState.mergedLayerPayloadCache || chunkState.mergedLayerPayloads || {},
      activeChunkIds: activeMergeChunkIds,
      viewportBbox: selection.viewportBbox || viewportBbox,
    });
    setScenarioChunkMergedLayerPayloadsState(runtimeState, mergedResult.mergedLayerPayloads);
    const chunkMergeEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioChunkRuntimeMetric("chunkMergeMs", chunkMergeEndedAt - chunkMergeStartedAt, {
      scenarioId,
      reason: String(reason || "refresh"),
      changedLayerCount: mergedResult.changedLayerKeys.length,
    });
    const mergedLayerPayloads = mergedResult.mergedLayerPayloads;
    const primaryMergedLayerPayloads = mergedResult.primaryMergedLayerPayloads || {};
    const primaryLayerStats = mergedResult.primaryLayerStats || {};
    const primaryVisibleFeatureCount = Array.isArray(primaryMergedLayerPayloads?.political?.features)
      ? primaryMergedLayerPayloads.political.features.length
      : Math.max(0, Number(primaryLayerStats?.political?.visibleFeatureCount || 0));
    const primaryTotalFeatureCount = Math.max(0, Number(primaryLayerStats?.political?.totalFeatureCount || 0));
    patchScenarioChunkLoadState(runtimeState, {
      layerSelectionSignatures: nextLayerSignatures,
      mergedLayerPayloadCache: mergedLayerPayloads,
    });
    const politicalRequired = selection.requiredChunks.some((chunk) => chunk.layer === "political");
    const politicalChunkIdSet = getScenarioChunkIdSetByLayer(bundle, "political");
    const previousRequiredPoliticalChunkIds = (Array.isArray(previousSelection?.requiredChunkIds) ? previousSelection.requiredChunkIds : [])
      .filter((chunkId) => politicalChunkIdSet.has(String(chunkId || "").trim()));
    const nextRequiredPoliticalChunkIds = nextRequiredChunkIds
      .filter((chunkId) => politicalChunkIdSet.has(String(chunkId || "").trim()));
    const cacheOnlyChunkIdSet = new Set((Array.isArray(selection.cacheOnlyChunkIds) ? selection.cacheOnlyChunkIds : [])
      .map((chunkId) => String(chunkId || "").trim())
      .filter(Boolean));
    const retainedActiveChunkIdSet = new Set(nextRetainedActiveChunkIds
      .map((chunkId) => String(chunkId || "").trim())
      .filter(Boolean));
    const changedPoliticalChunkIds = Array.from(new Set([
      ...previousRequiredPoliticalChunkIds.filter((chunkId) => !nextRequiredPoliticalChunkIds.includes(chunkId)),
      ...nextRequiredPoliticalChunkIds.filter((chunkId) => !previousRequiredPoliticalChunkIds.includes(chunkId)),
    ])).filter((chunkId) => {
      const normalizedChunkId = String(chunkId || "").trim();
      return !cacheOnlyChunkIdSet.has(normalizedChunkId) || retainedActiveChunkIdSet.has(normalizedChunkId);
    });
    const politicalFeatureIds = collectScenarioPoliticalFeatureIdsForChunkIds(bundle, changedPoliticalChunkIds);
    const primaryVisibleFeatureSubsetChanged = String(previousSelection?.politicalVisibleFeatureSubsetSignature || "") !== nextPoliticalVisibleFeatureSubsetSignature;
    const effectiveChangedLayerKeys = primaryVisibleFeatureSubsetChanged
      ? Array.from(new Set([...mergedResult.changedLayerKeys, "political"]))
      : mergedResult.changedLayerKeys;
    const hasMergedLayerChange = effectiveChangedLayerKeys.length > 0;
    const hasPoliticalFeatureChange = politicalFeatureIds.length > 0;
    if (!hasMergedLayerChange && !hasPoliticalFeatureChange) {
      clearPendingScenarioChunkPromotion(loadState);
      clearPendingScenarioChunkRefresh(loadState);
      if (nextRequiredChunkIds.length || chunkState.loadedChunkIds.length) {
        setScenarioChunkShellStatus("ready", loadState);
      }
      consumeScenarioChunkFocusCountryOverride(loadState);
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-promotion-not-needed",
        reason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          selectionVersion: nextSelectionVersion,
          scenarioApplyEpoch: selectionScenarioApplyEpoch,
          scenarioApplyRequestId: selectionScenarioApplyRequestId,
          hasMergedLayerChange,
          hasPoliticalFeatureChange,
          requiredChunkCount: nextRequiredChunkIds.length,
        },
      });
      return selection;
    }
    const promotionQueuedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    // chunk promotion 故意拆成 visual / infra 两段 pending 状态：
    // visual 先保证地图能尽快画出新 selection，infra 再补 state signature、overlay 元数据和后续调度需要的 bookkeeping。
    // pendingPromotion 保留两段共享的完整事务快照，提交阶段就不用重新推导“这一轮到底选中了哪些 chunk / political features”。
    const pendingVisualPromotion = {
      scenarioId,
      reason,
      scenarioApplyEpoch: selectionScenarioApplyEpoch,
      scenarioApplyRequestId: selectionScenarioApplyRequestId,
      selectionVersion: nextSelectionVersion,
      requiredChunkIds: nextRequiredChunkIds,
      selectedFeatureCountSum: Math.max(0, Number(selection.selectedFeatureCountSum || 0)),
      selectedVisibleFeatureCountSum: Math.max(0, Number(selection.selectedVisibleFeatureCountSum || 0)),
      selectedPoliticalFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalFeatureCountSum || 0)),
      selectedPoliticalVisibleFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalVisibleFeatureCountSum || 0)),
      primaryVisibleFeatureCount,
      primaryTotalFeatureCount,
      selectedByteCountSum: Math.max(0, Number(selection.selectedByteCountSum || 0)),
      selectedEstimatedPathCostSum: Math.max(0, Number(selection.selectedEstimatedPathCostSum || 0)),
      politicalVisibleFeatureSubsetSignature: nextPoliticalVisibleFeatureSubsetSignature,
      queuedAt: promotionQueuedAt,
      renderNow,
    };
    const pendingInfraPromotion = {
      scenarioId,
      reason,
      scenarioApplyEpoch: selectionScenarioApplyEpoch,
      scenarioApplyRequestId: selectionScenarioApplyRequestId,
      changedLayerKeys: effectiveChangedLayerKeys,
      selectionVersion: nextSelectionVersion,
      queuedAt: promotionQueuedAt,
    };
    const pendingPromotion = {
      scenarioId,
      reason,
      scenarioApplyEpoch: selectionScenarioApplyEpoch,
      scenarioApplyRequestId: selectionScenarioApplyRequestId,
      renderNow,
      mergedLayerPayloads,
      primaryMergedLayerPayloads,
      primaryLayerStats,
      changedLayerKeys: effectiveChangedLayerKeys,
      primaryVisibleFeatureSubsetChanged,
      politicalRequired,
      requiredPoliticalChunkCount: selection.requiredChunks.filter((chunk) => chunk.layer === "political").length,
      requiredChunkIds: nextRequiredChunkIds,
      cacheOnlyChunkIds: Array.isArray(selection.cacheOnlyChunkIds) ? [...selection.cacheOnlyChunkIds] : [],
      retainedActiveChunkIds: nextRetainedActiveChunkIds,
      selectionVersion: nextSelectionVersion,
      selectedFeatureCountSum: Math.max(0, Number(selection.selectedFeatureCountSum || 0)),
      selectedVisibleFeatureCountSum: Math.max(0, Number(selection.selectedVisibleFeatureCountSum || 0)),
      selectedPoliticalFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalFeatureCountSum || 0)),
      selectedPoliticalVisibleFeatureCountSum: Math.max(0, Number(selection.selectedPoliticalVisibleFeatureCountSum || 0)),
      primaryVisibleFeatureCount,
      primaryTotalFeatureCount,
      selectedByteCountSum: Math.max(0, Number(selection.selectedByteCountSum || 0)),
      selectedEstimatedPathCostSum: Math.max(0, Number(selection.selectedEstimatedPathCostSum || 0)),
      politicalVisibleFeatureSubsetSignature: nextPoliticalVisibleFeatureSubsetSignature,
      politicalFeatureIds,
      queuedAt: promotionQueuedAt,
    };
    queueScenarioChunkPromotionState(runtimeState, {
      visualPromotion: pendingVisualPromotion,
      infraPromotion: pendingInfraPromotion,
      promotion: pendingPromotion,
    });
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-chunk-promotion-pending-created",
      reason,
      expectedScenarioId: scenarioId,
      source: "scenario_chunk_runtime",
      searchParams: getSearchParams(),
      extra: {
        selectionVersion: nextSelectionVersion,
        scenarioApplyEpoch: selectionScenarioApplyEpoch,
        scenarioApplyRequestId: selectionScenarioApplyRequestId,
        requiredChunkCount: nextRequiredChunkIds.length,
        changedLayerCount: effectiveChangedLayerKeys.length,
        politicalRequired,
        requiredPoliticalChunkCount: selection.requiredChunks.filter((chunk) => chunk.layer === "political").length,
        politicalFeatureCount: politicalFeatureIds.length,
        primaryVisibleFeatureCount,
        primaryTotalFeatureCount,
        primaryVisibleFeatureSubsetChanged,
      },
    });
    patchScenarioChunkLoadState(runtimeState, {
      promotionRetryCount: 0,
      lastPromotionRetryAt: 0,
    });
    setScenarioChunkShellStatus("loading", loadState);
    if (shouldDeferScenarioChunkRefreshFor({ allowZoomEndSettling, allowStartupInitialVisual })) {
      markPendingScenarioChunkRefresh(reason, null, {
        scenarioApplyRequestId: selectionScenarioApplyRequestId,
      });
      return selection;
    }
    schedulePendingScenarioChunkPromotionCommit({
      delayMs: 0,
    });
    consumeScenarioChunkFocusCountryOverride(loadState);
    return selection;
  }

  function getFeatureCount(collection) {
    return Array.isArray(collection?.features) ? collection.features.length : 0;
  }

  function getColorCount() {
    return Object.keys(runtimeState.colors || {}).length;
  }

  function getMonotonicNowMs() {
    return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  }

  function getRequiredPoliticalChunkCount(bundle, loadState) {
    const politicalChunkIdSet = getScenarioChunkIdSetByLayer(bundle, "political");
    return (Array.isArray(loadState?.lastSelection?.requiredChunkIds) ? loadState.lastSelection.requiredChunkIds : [])
      .filter((chunkId) => politicalChunkIdSet.has(String(chunkId || "").trim()))
      .length;
  }

  function buildInitialScenarioChunkVisualPromotionResult(status, {
    bundle = null,
    loadState = ensureRuntimeChunkLoadState(),
    scenarioId = "",
  } = {}) {
    const expectedScenarioId = normalizeScenarioId(scenarioId || runtimeState.activeScenarioId);
    const activeScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    const scenarioPoliticalChunkFeatureCount = getFeatureCount(runtimeState.scenarioPoliticalChunkData);
    const hasVisiblePoliticalChunkData = Array.isArray(runtimeState.scenarioPoliticalVisibleChunkData?.features);
    const scenarioPoliticalVisibleFeatureCount = hasVisiblePoliticalChunkData
      ? getFeatureCount(runtimeState.scenarioPoliticalVisibleChunkData)
      : scenarioPoliticalChunkFeatureCount;
    const landFeatureCount = getFeatureCount(runtimeState.landData);
    const colorCount = getColorCount();
    const selectionVersion = Math.max(0, Number(loadState?.selectionVersion || 0));
    const pendingPromotion = !!loadState?.pendingPromotion;
    const pendingVisualPromotion = !!loadState?.pendingVisualPromotion;
    const promotionCommitInFlight = !!loadState?.promotionCommitInFlight;
    const requiredPoliticalChunkCount = getRequiredPoliticalChunkCount(bundle, loadState);
    const ready = !!(
      expectedScenarioId
      && expectedScenarioId === activeScenarioId
      && selectionVersion > 0
      && !pendingPromotion
      && !pendingVisualPromotion
      && !promotionCommitInFlight
      && scenarioPoliticalChunkFeatureCount > 0
      && landFeatureCount > 0
      && colorCount > 0
    );
    return {
      ok: status === "not-chunked" ? true : ready,
      status,
      scenarioId: expectedScenarioId,
      activeScenarioId,
      selectionVersion,
      shellStatus: String(loadState?.shellStatus || ""),
      requiredPoliticalChunkCount,
      promotedFeatureCount: scenarioPoliticalChunkFeatureCount,
      promotedPrimaryFeatureCount: scenarioPoliticalVisibleFeatureCount,
      promotedVisibleFeatureCount: scenarioPoliticalVisibleFeatureCount,
      promotedTotalFeatureCount: scenarioPoliticalChunkFeatureCount,
      primaryVisibleFeatureCount: scenarioPoliticalVisibleFeatureCount,
      primaryTotalFeatureCount: scenarioPoliticalChunkFeatureCount,
      landFeatureCount,
      colorCount,
      pendingVisualPromotion,
      pendingPromotion,
      promotionCommitInFlight,
      promotionScheduled: !!loadState?.promotionScheduled,
    };
  }

  async function awaitInitialScenarioChunkVisualPromotion({
    reason = "startup-initial-visual",
    d3Client = globalThis.d3,
    renderNow = true,
  } = {}) {
    const startedAt = getMonotonicNowMs();
    const scenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    if (!scenarioId) {
      const result = buildInitialScenarioChunkVisualPromotionResult("no-active-scenario", { scenarioId });
      result.ok = true;
      return result;
    }
    const bundle = getCachedScenarioBundle(scenarioId);
    const loadState = ensureRuntimeChunkLoadState();
    const initialContinuationState =
      captureScenarioChunkLoadStateContinuation(runtimeState);
    const initialScenarioApplyRequestId =
      initialContinuationState.continuationScenarioApplyRequestId;
    const isInitialScenarioChunkContinuationCurrent = () => (
      isScenarioChunkLoadStateContinuationCurrent(initialContinuationState, {
        scenarioId,
        scenarioApplyRequestId: initialScenarioApplyRequestId,
      })
    );
    if (!bundle) {
      return buildInitialScenarioChunkVisualPromotionResult("missing-bundle", { bundle, loadState, scenarioId });
    }
    if (!scenarioBundleUsesChunkedLayer(bundle)) {
      if (scenarioSupportsChunkedRuntime(bundle?.manifest)) {
        await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
        if (!isInitialScenarioChunkContinuationCurrent()) {
          return buildInitialScenarioChunkVisualPromotionResult("stale", {
            bundle,
            scenarioId,
          });
        }
      }
    }
    if (!scenarioBundleUsesChunkedLayer(bundle)) {
      return buildInitialScenarioChunkVisualPromotionResult("not-chunked", { bundle, loadState, scenarioId });
    }
    const alreadyReady = buildInitialScenarioChunkVisualPromotionResult("already-current", {
      bundle,
      loadState,
      scenarioId,
    });
    if (alreadyReady.ok) return alreadyReady;

    const commitStartupInitialVisualPromotionIfPending = async () => {
      if (!isInitialScenarioChunkContinuationCurrent()) return false;
      if (loadState.promotionTimerId) {
        globalThis.clearTimeout(loadState.promotionTimerId);
        patchScenarioChunkLoadState(runtimeState, {
          promotionTimerId: null,
          promotionScheduled: false,
        });
      }
      if (loadState.pendingPromotion || promotionCommitPromise || loadState.promotionCommitInFlight) {
        await commitPendingScenarioChunkPromotionWithErrorBoundary({
          bundle,
          renderNow,
          allowStartupInitialVisual: true,
          rethrow: true,
        });
      }
    };

    const retryStartupInitialVisualRefreshIfStillUnselected = async () => {
      if (Math.max(0, Number(loadState.selectionVersion || 0)) > 0) return;
      if (loadState.pendingPromotion || loadState.pendingVisualPromotion || loadState.promotionCommitInFlight) return;
      if (loadState.promotionScheduled || runtimeState.scenarioApplyInFlight) return;
      if (!isInitialScenarioChunkContinuationCurrent()) return;
      await refreshActiveScenarioChunks({
        reason,
        d3Client,
        renderNow,
        allowStartupInitialVisual: true,
        startupInitialPoliticalOnly: true,
      });
    };

    await refreshActiveScenarioChunks({
      reason,
      d3Client,
      renderNow,
      allowStartupInitialVisual: true,
      startupInitialPoliticalOnly: true,
    });
    if (!isInitialScenarioChunkContinuationCurrent()) {
      return buildInitialScenarioChunkVisualPromotionResult("stale", {
        bundle,
        scenarioId,
      });
    }
    await commitStartupInitialVisualPromotionIfPending();
    await yieldToFrame();
    let result = buildInitialScenarioChunkVisualPromotionResult("promoted", {
      bundle,
      loadState,
      scenarioId,
    });
    const readinessStartedAt = getMonotonicNowMs();
    while (!result.ok && getMonotonicNowMs() - readinessStartedAt < STARTUP_INITIAL_VISUAL_READY_TIMEOUT_MS) {
      if (!isInitialScenarioChunkContinuationCurrent()) {
        result = buildInitialScenarioChunkVisualPromotionResult("stale", {
          bundle,
          scenarioId,
        });
        break;
      }
      await retryStartupInitialVisualRefreshIfStillUnselected();
      await commitStartupInitialVisualPromotionIfPending();
      await yieldToFrame();
      result = buildInitialScenarioChunkVisualPromotionResult("promoted", {
        bundle,
        loadState,
        scenarioId,
      });
      if (result.status === "stale") break;
    }
    const endedAt = getMonotonicNowMs();
    recordScenarioRenderMetric("initialScenarioChunkVisualPromotion", Math.max(0, endedAt - startedAt), result);
    return result;
  }

  function scheduleScenarioChunkRefresh({
    reason = "refresh",
    delayMs = null,
    flushPending = false,
    refreshSourceStartedAtMs = 0,
    scenarioApplyRequestId = 0,
  } = {}) {
    const scenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    if (!scenarioId) return "noop";
    const bundle = getCachedScenarioBundle(scenarioId);
    if (!bundle || !scenarioBundleUsesChunkedLayer(bundle)) return "noop";
    const loadState = ensureRuntimeChunkLoadState();
    const transactionScenarioApplyRequestId = resolveScenarioChunkApplyRequestId({
      scenarioApplyRequestId,
      loadState,
      selectionVersion: loadState.selectionVersion,
    });
    const hadPendingReason = !!String(loadState.pendingReason || "").trim();
    const nextReason = flushPending && hadPendingReason
      ? String(loadState.pendingReason || "refresh").trim() || "refresh"
      : String(reason || "refresh").trim() || "refresh";
    const explicitDelayMs = Number.isFinite(Number(delayMs)) ? Number(delayMs) : null;
    const nextDelayMs = explicitDelayMs != null
      ? explicitDelayMs
      : (flushPending && Number.isFinite(Number(loadState.pendingDelayMs))
        ? Number(loadState.pendingDelayMs)
        : null);
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-chunk-refresh-requested",
      reason: nextReason,
      expectedScenarioId: scenarioId,
      source: "scenario_chunk_runtime",
      searchParams: getSearchParams(),
      extra: {
        flushPending: !!flushPending,
        delayMs: nextDelayMs,
        selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    if (!isScenarioApplyRequestCurrentForScenario({
      scenarioId,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    })) {
      recordScenarioApplyStaleCallbackSkipped({
        callbackPhase: "chunk-refresh-request",
        reason: nextReason,
        scenarioId,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        extra: {
          selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
        },
      });
      return "stale-request";
    }
    if (shouldSkipStalePostApplyRefreshAfterZoomEnd(loadState, nextReason, {
      scenarioId,
      selectionVersion: loadState.selectionVersion,
      refreshSourceStartedAtMs,
      normalizeScenarioIdFn: normalizeScenarioId,
    })) {
      clearPendingScenarioChunkRefresh(loadState);
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-refresh-stale-post-apply",
        reason: nextReason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
          refreshSourceStartedAtMs,
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
        },
      });
      return "stale-post-apply-after-zoom-end";
    }
    const zoomEndPriorityEnabled = shouldZoomEndPromoteImmediately(bundle, nextReason);
    if (zoomEndPriorityEnabled) {
      const hints = normalizeScenarioRenderBudgetHints(
        bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {}
      );
      const viewportBbox = typeof runtimeState.getViewportGeoBoundsFn === "function"
        ? runtimeState.getViewportGeoBoundsFn()
        : null;
      patchScenarioChunkLoadState(runtimeState, { zoomEndChunkVisibleMetric: {
        startedAt: globalThis.performance?.now ? globalThis.performance.now() : Date.now(),
        scenarioId,
        zoom: Number(runtimeState.zoomTransform?.k || 1),
        threshold: Number(hints.detail_zoom_threshold || 0),
        focusCountry: resolveScenarioChunkFocusCountry(
          bundle,
          undefined,
          { viewportBbox },
        ),
      } });
    }
    if (loadState.refreshTimerId) {
      globalThis.clearTimeout(loadState.refreshTimerId);
      patchScenarioChunkLoadState(runtimeState, {
        refreshTimerId: null,
        refreshScheduled: false,
      });
    }
    if (loadState.promotionCommitInFlight && !flushPending) {
      // promotion 进行中时，不并发起第二条刷新链。
      // 这里只保留“最新一条待重放请求”，等 commit 收尾后再按最新 selectionVersion 重放。
      patchScenarioChunkLoadState(runtimeState, { pendingPostCommitRefresh: {
        scenarioId,
        selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
        reason: nextReason,
        delayMs: nextDelayMs,
        refreshSourceStartedAtMs,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        requestedAt: Date.now(),
      } });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-refresh-post-commit-replay-queued",
        reason: nextReason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          delayMs: nextDelayMs,
          selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
        },
      });
      return "promotion-commit-in-flight";
    }
    if (shouldDeferScenarioChunkRefreshFor({ allowZoomEndSettling: zoomEndPriorityEnabled })) {
      markPendingScenarioChunkRefresh(nextReason, nextDelayMs, {
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      });
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-refresh-deferred",
        reason: nextReason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          delayMs: nextDelayMs,
          selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
        },
      });
      return "deferred";
    }
    clearPendingScenarioChunkRefresh(loadState);
    const resolvedDelayMs = nextDelayMs != null
      ? nextDelayMs
      : (zoomEndPriorityEnabled ? 0
      : (String(nextReason || "").includes("interacting")
        ? refreshDelayInteracting
        : refreshDelayIdle));
    if (flushPending) {
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-chunk-refresh-flush-now",
        reason: nextReason,
        expectedScenarioId: scenarioId,
        source: "scenario_chunk_runtime",
        searchParams: getSearchParams(),
        extra: {
          selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
        },
      });
      return executeScenarioChunkRefreshNow({
        bundle,
        reason: nextReason,
        flushPending,
        allowRefreshStart: hadPendingReason,
      });
    }
    const refreshTimerGenerationToken = {};
    let refreshTimerId = refreshTimerGenerationToken;
    patchScenarioChunkLoadState(runtimeState, {
      refreshScheduled: true,
      refreshTimerId: refreshTimerGenerationToken,
    });
    const scheduledRefreshTimerId = globalThis.setTimeout(() => {
      if (
        runtimeState.runtimeChunkLoadState !== loadState
        || loadState.refreshTimerId !== refreshTimerId
      ) return;
      patchScenarioChunkLoadState(runtimeState, {
        refreshTimerId: null,
        refreshScheduled: false,
      });
      if (shouldDeferScenarioChunkRefreshFor({ allowZoomEndSettling: zoomEndPriorityEnabled })) {
        markPendingScenarioChunkRefresh(nextReason, nextDelayMs, {
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
        });
        return;
      }
      if (!isScenarioApplyRequestCurrentForScenario({
        scenarioId,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      })) {
        recordScenarioApplyStaleCallbackSkipped({
          callbackPhase: "chunk-refresh-timer",
          reason: nextReason,
          scenarioId,
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
          extra: {
            selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
          },
        });
        return;
      }
      executeScenarioChunkRefreshNow({
        bundle,
        reason: nextReason,
        flushPending,
        allowRefreshStart: true,
      });
    }, resolvedDelayMs);
    if (
      runtimeState.runtimeChunkLoadState === loadState
      && loadState.refreshTimerId === refreshTimerGenerationToken
    ) {
      refreshTimerId = scheduledRefreshTimerId;
      patchScenarioChunkLoadState(runtimeState, {
        refreshScheduled: true,
        refreshTimerId,
      });
    }
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-chunk-refresh-scheduled",
      reason: nextReason,
      expectedScenarioId: scenarioId,
      source: "scenario_chunk_runtime",
      searchParams: getSearchParams(),
      extra: {
        delayMs: resolvedDelayMs,
        selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0)),
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        zoomEndPriorityEnabled,
      },
    });
    return "scheduled";
  }

  return {
    ensureRuntimeChunkLoadState,
    hasScenarioMergedLayerPayload,
    getScenarioRuntimeMergedLayerPayloads,
    applyScenarioPoliticalChunkPayload,
    resetScenarioChunkRuntimeState,
    preloadScenarioCoarseChunks,
    preloadScenarioFocusCountryPoliticalDetailChunk,
    awaitInitialScenarioChunkVisualPromotion,
    scheduleScenarioChunkRefresh,
  };
}

export {
  applyZoomEndChunkProtectionToSelection,
  createScenarioChunkRuntimeController,
  protectZoomEndChunksForSelection,
  shouldSkipStalePostApplyRefreshAfterZoomEnd,
};

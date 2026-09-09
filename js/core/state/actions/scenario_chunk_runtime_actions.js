// Canonical scenario chunk runtime-state authority.
// Scheduling, timers, async work, logging, and rendering stay in composition roots.

import {
  createDefaultActiveScenarioChunksState,
  createDefaultRuntimeChunkLoadState,
} from "../scenario_runtime_state.js";

export const SCENARIO_CHUNK_LOAD_STATE_PATCH_KEYS = Object.freeze([
  "shellStatus",
  "registryStatus",
  "refreshScheduled",
  "refreshTimerId",
  "selectionVersion",
  "pendingReason",
  "pendingDelayMs",
  "pendingScenarioApplyRequestId",
  "focusCountryOverride",
  "focusCountryOverrideSource",
  "focusCountryOverrideExpiresAt",
  "zoomEndChunkVisibleMetric",
  "lastZoomEndToChunkVisibleMetric",
  "zoomEndProtectedChunkIds",
  "zoomEndProtectedUntil",
  "zoomEndProtectedSelectionVersion",
  "zoomEndProtectedScenarioId",
  "zoomEndProtectedFocusCountry",
  "pendingVisualPromotion",
  "pendingInfraPromotion",
  "pendingPromotion",
  "promotionTimerId",
  "promotionScheduled",
  "promotionCommitInFlight",
  "promotionCommitRunId",
  "promotionCommitStatus",
  "promotionCommitScenarioId",
  "promotionCommitSelectionVersion",
  "promotionCommitReason",
  "promotionCommitStartedAt",
  "promotionCommitFinishedAt",
  "promotionCommitError",
  "pendingPostCommitRefresh",
  "promotionRetryCount",
  "lastPromotionRetryAt",
  "inFlightByChunkId",
  "errorByChunkId",
  "lastSelection",
  "scenarioApplyEpochBySelectionVersion",
  "scenarioApplyRequestIdBySelectionVersion",
  "layerSelectionSignatures",
  "mergedLayerPayloadCache",
]);

const LOAD_STATE_PATCH_KEY_SET = new Set(SCENARIO_CHUNK_LOAD_STATE_PATCH_KEYS);

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[scenario_chunk_runtime_actions] target must be an object");
  }
}

function normalizeScenarioId(value) {
  return String(value || "").trim();
}

function normalizeChunkId(chunkId) {
  return String(chunkId || "").trim();
}

function normalizeLoadStateGeneration(value) {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0
    ? generation
    : 0;
}

function getLoadStateGeneration(target) {
  return normalizeLoadStateGeneration(
    target?.runtimeChunkLoadState?.generation,
  );
}

function readValidLoadStateGeneration(target) {
  if (
    !target?.runtimeChunkLoadState
    || typeof target.runtimeChunkLoadState !== "object"
    || Array.isArray(target.runtimeChunkLoadState)
  ) {
    return null;
  }
  const rawGeneration = target.runtimeChunkLoadState.generation;
  if (typeof rawGeneration !== "number") return null;
  const generation = Number(rawGeneration);
  return Number.isSafeInteger(generation) && generation >= 0
    ? generation
    : null;
}

function advanceLoadStateGeneration(target, currentGeneration = getLoadStateGeneration(target)) {
  const current = normalizeLoadStateGeneration(
    currentGeneration,
  );
  const next = current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
  target.runtimeChunkLoadState.generation = next;
  return next;
}

function canAssignLoadStateGeneration(loadState) {
  let descriptorTarget = loadState;
  let isOwnDescriptor = true;
  while (descriptorTarget) {
    const descriptor = Object.getOwnPropertyDescriptor(
      descriptorTarget,
      "generation",
    );
    if (descriptor) {
      if (Object.hasOwn(descriptor, "value")) {
        return descriptor.writable === true
          && (isOwnDescriptor || Object.isExtensible(loadState));
      }
      return typeof descriptor.set === "function";
    }
    descriptorTarget = Object.getPrototypeOf(descriptorTarget);
    isOwnDescriptor = false;
  }
  return Object.isExtensible(loadState);
}

function createLoadStateGenerationCandidate(loadState, nextGeneration) {
  if (!canAssignLoadStateGeneration(loadState)) {
    return {
      ...loadState,
      generation: nextGeneration,
    };
  }
  const candidate = Object.create(Object.getPrototypeOf(loadState));
  Object.defineProperties(candidate, Object.getOwnPropertyDescriptors(loadState));
  candidate.generation = nextGeneration;
  return candidate;
}

function isExpectedLoadStateGenerationCurrent(
  target,
  expectedLoadStateGeneration,
) {
  if (
    expectedLoadStateGeneration === null
    || expectedLoadStateGeneration === undefined
  ) return true;
  if (
    typeof expectedLoadStateGeneration !== "number"
    || expectedLoadStateGeneration < 0
    || expectedLoadStateGeneration > Number.MAX_SAFE_INTEGER
    || expectedLoadStateGeneration % 1 !== 0
  ) return false;
  return readValidLoadStateGeneration(target) === expectedLoadStateGeneration;
}

export function captureScenarioChunkLoadStateContinuation(target) {
  assertStateTarget(target);
  const loadState = target.runtimeChunkLoadState;
  const selectionVersion = Math.max(
    0,
    Number(loadState?.selectionVersion || 0),
  );
  const requestIdBySelectionVersion =
    loadState?.scenarioApplyRequestIdBySelectionVersion
    && typeof loadState.scenarioApplyRequestIdBySelectionVersion === "object"
      ? loadState.scenarioApplyRequestIdBySelectionVersion
      : {};
  const currentScenarioApplyRequestId = Math.max(
    0,
    Number(target.currentScenarioApplyRequestId || 0),
  );
  const latestScenarioApplyRequestId = Math.max(
    0,
    Number(target.latestScenarioApplyRequestId || 0),
  );
  const pendingScenarioApplyRequestId = Math.max(
    0,
    Number(loadState?.pendingScenarioApplyRequestId || 0),
  );
  const selectionScenarioApplyRequestId = selectionVersion > 0
    ? Math.max(
      0,
      Number(requestIdBySelectionVersion[selectionVersion] || 0),
    )
    : 0;
  const lastSelectionScenarioApplyRequestId = Math.max(
    0,
    Number(loadState?.lastSelection?.scenarioApplyRequestId || 0),
  );
  return Object.freeze({
    loadStateGeneration: getLoadStateGeneration(target),
    activeScenarioId: normalizeScenarioId(target.activeScenarioId),
    scenarioApplyInFlight: target.scenarioApplyInFlight === true,
    currentScenarioApplyTargetId: normalizeScenarioId(
      target.currentScenarioApplyTargetId,
    ),
    latestScenarioApplyTargetId: normalizeScenarioId(
      target.latestScenarioApplyTargetId,
    ),
    latestScenarioApplyRequestId,
    currentScenarioApplyRequestId,
    continuationScenarioApplyRequestId:
      pendingScenarioApplyRequestId
      || currentScenarioApplyRequestId
      || selectionScenarioApplyRequestId
      || lastSelectionScenarioApplyRequestId,
  });
}

function isRuntimeTimerHandle(value) {
  if (typeof value === "number") {
    return value > -Infinity && value < Infinity;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value.ref === "function"
    || typeof value.unref === "function"
    || typeof value.hasRef === "function"
    || typeof value.refresh === "function"
  );
}

export function ensureScenarioChunkRuntimeState(target, { scenarioId = "" } = {}) {
  assertStateTarget(target);
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  const hadRuntimeChunkLoadState = Boolean(
    target.runtimeChunkLoadState
    && typeof target.runtimeChunkLoadState === "object"
    && !Array.isArray(target.runtimeChunkLoadState),
  );
  const activeDefaults = createDefaultActiveScenarioChunksState(normalizedScenarioId);
  if (!target.activeScenarioChunks || typeof target.activeScenarioChunks !== "object" || Array.isArray(target.activeScenarioChunks)) {
    target.activeScenarioChunks = activeDefaults;
  } else {
    target.activeScenarioChunks.scenarioId = normalizedScenarioId
      || String(target.activeScenarioChunks.scenarioId || "").trim();
    const scenarioApplyEpoch = +target.activeScenarioChunks.scenarioApplyEpoch;
    target.activeScenarioChunks.scenarioApplyEpoch = scenarioApplyEpoch >= 0 && scenarioApplyEpoch < Infinity
      ? scenarioApplyEpoch
      : 0;
    const scenarioApplyRequestId = +target.activeScenarioChunks.scenarioApplyRequestId;
    target.activeScenarioChunks.scenarioApplyRequestId = scenarioApplyRequestId >= 0 && scenarioApplyRequestId < Infinity
      ? scenarioApplyRequestId
      : 0;
    if (!Array.isArray(target.activeScenarioChunks.loadedChunkIds)) target.activeScenarioChunks.loadedChunkIds = [];
    if (!target.activeScenarioChunks.payloadByChunkId || typeof target.activeScenarioChunks.payloadByChunkId !== "object" || Array.isArray(target.activeScenarioChunks.payloadByChunkId)) target.activeScenarioChunks.payloadByChunkId = {};
    if (!target.activeScenarioChunks.mergedLayerPayloads || typeof target.activeScenarioChunks.mergedLayerPayloads !== "object" || Array.isArray(target.activeScenarioChunks.mergedLayerPayloads)) target.activeScenarioChunks.mergedLayerPayloads = {};
    if (!Array.isArray(target.activeScenarioChunks.lruChunkIds)) target.activeScenarioChunks.lruChunkIds = [];
  }

  const loadDefaults = createDefaultRuntimeChunkLoadState({ scenarioId: normalizedScenarioId });
  if (!target.runtimeChunkLoadState || typeof target.runtimeChunkLoadState !== "object" || Array.isArray(target.runtimeChunkLoadState)) {
    target.runtimeChunkLoadState = loadDefaults;
  } else {
    if (!Object.hasOwn(target.runtimeChunkLoadState, "shellStatus") || typeof target.runtimeChunkLoadState.shellStatus !== "string") target.runtimeChunkLoadState.shellStatus = loadDefaults.shellStatus;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "registryStatus") || typeof target.runtimeChunkLoadState.registryStatus !== "string") target.runtimeChunkLoadState.registryStatus = loadDefaults.registryStatus;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "generation")) target.runtimeChunkLoadState.generation = loadDefaults.generation;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "refreshScheduled") || typeof target.runtimeChunkLoadState.refreshScheduled !== "boolean") target.runtimeChunkLoadState.refreshScheduled = loadDefaults.refreshScheduled;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "refreshTimerId")) target.runtimeChunkLoadState.refreshTimerId = loadDefaults.refreshTimerId;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "selectionVersion")) target.runtimeChunkLoadState.selectionVersion = loadDefaults.selectionVersion;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "pendingReason") || typeof target.runtimeChunkLoadState.pendingReason !== "string") target.runtimeChunkLoadState.pendingReason = loadDefaults.pendingReason;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "pendingDelayMs")) target.runtimeChunkLoadState.pendingDelayMs = loadDefaults.pendingDelayMs;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "pendingScenarioApplyRequestId")) target.runtimeChunkLoadState.pendingScenarioApplyRequestId = loadDefaults.pendingScenarioApplyRequestId;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "focusCountryOverride") || typeof target.runtimeChunkLoadState.focusCountryOverride !== "string") target.runtimeChunkLoadState.focusCountryOverride = loadDefaults.focusCountryOverride;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "focusCountryOverrideSource") || typeof target.runtimeChunkLoadState.focusCountryOverrideSource !== "string") target.runtimeChunkLoadState.focusCountryOverrideSource = loadDefaults.focusCountryOverrideSource;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "focusCountryOverrideExpiresAt")) target.runtimeChunkLoadState.focusCountryOverrideExpiresAt = loadDefaults.focusCountryOverrideExpiresAt;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "zoomEndChunkVisibleMetric")) target.runtimeChunkLoadState.zoomEndChunkVisibleMetric = loadDefaults.zoomEndChunkVisibleMetric;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "lastZoomEndToChunkVisibleMetric")) target.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric = loadDefaults.lastZoomEndToChunkVisibleMetric;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "zoomEndProtectedChunkIds")) target.runtimeChunkLoadState.zoomEndProtectedChunkIds = loadDefaults.zoomEndProtectedChunkIds;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "zoomEndProtectedUntil")) target.runtimeChunkLoadState.zoomEndProtectedUntil = loadDefaults.zoomEndProtectedUntil;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "zoomEndProtectedSelectionVersion")) target.runtimeChunkLoadState.zoomEndProtectedSelectionVersion = loadDefaults.zoomEndProtectedSelectionVersion;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "zoomEndProtectedScenarioId") || typeof target.runtimeChunkLoadState.zoomEndProtectedScenarioId !== "string") target.runtimeChunkLoadState.zoomEndProtectedScenarioId = loadDefaults.zoomEndProtectedScenarioId;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "zoomEndProtectedFocusCountry") || typeof target.runtimeChunkLoadState.zoomEndProtectedFocusCountry !== "string") target.runtimeChunkLoadState.zoomEndProtectedFocusCountry = loadDefaults.zoomEndProtectedFocusCountry;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "pendingVisualPromotion")) target.runtimeChunkLoadState.pendingVisualPromotion = loadDefaults.pendingVisualPromotion;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "pendingInfraPromotion")) target.runtimeChunkLoadState.pendingInfraPromotion = loadDefaults.pendingInfraPromotion;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "pendingPromotion")) target.runtimeChunkLoadState.pendingPromotion = loadDefaults.pendingPromotion;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionTimerId")) target.runtimeChunkLoadState.promotionTimerId = loadDefaults.promotionTimerId;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionScheduled") || typeof target.runtimeChunkLoadState.promotionScheduled !== "boolean") target.runtimeChunkLoadState.promotionScheduled = loadDefaults.promotionScheduled;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitInFlight") || typeof target.runtimeChunkLoadState.promotionCommitInFlight !== "boolean") target.runtimeChunkLoadState.promotionCommitInFlight = loadDefaults.promotionCommitInFlight;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitRunId")) target.runtimeChunkLoadState.promotionCommitRunId = loadDefaults.promotionCommitRunId;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitStatus") || typeof target.runtimeChunkLoadState.promotionCommitStatus !== "string") target.runtimeChunkLoadState.promotionCommitStatus = loadDefaults.promotionCommitStatus;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitScenarioId") || typeof target.runtimeChunkLoadState.promotionCommitScenarioId !== "string") target.runtimeChunkLoadState.promotionCommitScenarioId = loadDefaults.promotionCommitScenarioId;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitSelectionVersion")) target.runtimeChunkLoadState.promotionCommitSelectionVersion = loadDefaults.promotionCommitSelectionVersion;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitReason") || typeof target.runtimeChunkLoadState.promotionCommitReason !== "string") target.runtimeChunkLoadState.promotionCommitReason = loadDefaults.promotionCommitReason;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitStartedAt")) target.runtimeChunkLoadState.promotionCommitStartedAt = loadDefaults.promotionCommitStartedAt;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitFinishedAt")) target.runtimeChunkLoadState.promotionCommitFinishedAt = loadDefaults.promotionCommitFinishedAt;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionCommitError") || typeof target.runtimeChunkLoadState.promotionCommitError !== "string") target.runtimeChunkLoadState.promotionCommitError = loadDefaults.promotionCommitError;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "pendingPostCommitRefresh")) target.runtimeChunkLoadState.pendingPostCommitRefresh = loadDefaults.pendingPostCommitRefresh;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "promotionRetryCount")) target.runtimeChunkLoadState.promotionRetryCount = loadDefaults.promotionRetryCount;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "lastPromotionRetryAt")) target.runtimeChunkLoadState.lastPromotionRetryAt = loadDefaults.lastPromotionRetryAt;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "inFlightByChunkId")) target.runtimeChunkLoadState.inFlightByChunkId = loadDefaults.inFlightByChunkId;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "errorByChunkId")) target.runtimeChunkLoadState.errorByChunkId = loadDefaults.errorByChunkId;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "lastSelection")) target.runtimeChunkLoadState.lastSelection = loadDefaults.lastSelection;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "scenarioApplyEpochBySelectionVersion")) target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion = loadDefaults.scenarioApplyEpochBySelectionVersion;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "scenarioApplyRequestIdBySelectionVersion")) target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion = loadDefaults.scenarioApplyRequestIdBySelectionVersion;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "layerSelectionSignatures")) target.runtimeChunkLoadState.layerSelectionSignatures = loadDefaults.layerSelectionSignatures;
    if (!Object.hasOwn(target.runtimeChunkLoadState, "mergedLayerPayloadCache")) target.runtimeChunkLoadState.mergedLayerPayloadCache = loadDefaults.mergedLayerPayloadCache;

    const selectionVersion = +target.runtimeChunkLoadState.selectionVersion;
    target.runtimeChunkLoadState.selectionVersion = selectionVersion >= 0 && selectionVersion < Infinity ? selectionVersion : 0;
    const pendingScenarioApplyRequestId = +target.runtimeChunkLoadState.pendingScenarioApplyRequestId;
    target.runtimeChunkLoadState.pendingScenarioApplyRequestId = pendingScenarioApplyRequestId >= 0 && pendingScenarioApplyRequestId < Infinity ? pendingScenarioApplyRequestId : 0;
    const focusCountryOverrideExpiresAt = +target.runtimeChunkLoadState.focusCountryOverrideExpiresAt;
    target.runtimeChunkLoadState.focusCountryOverrideExpiresAt = focusCountryOverrideExpiresAt >= 0 && focusCountryOverrideExpiresAt < Infinity ? focusCountryOverrideExpiresAt : 0;
    const zoomEndProtectedUntil = +target.runtimeChunkLoadState.zoomEndProtectedUntil;
    target.runtimeChunkLoadState.zoomEndProtectedUntil = zoomEndProtectedUntil >= 0 && zoomEndProtectedUntil < Infinity ? zoomEndProtectedUntil : 0;
    const zoomEndProtectedSelectionVersion = +target.runtimeChunkLoadState.zoomEndProtectedSelectionVersion;
    target.runtimeChunkLoadState.zoomEndProtectedSelectionVersion = zoomEndProtectedSelectionVersion >= 0 && zoomEndProtectedSelectionVersion < Infinity ? zoomEndProtectedSelectionVersion : 0;
    const promotionCommitRunId = +target.runtimeChunkLoadState.promotionCommitRunId;
    target.runtimeChunkLoadState.promotionCommitRunId = promotionCommitRunId >= 0 && promotionCommitRunId < Infinity ? promotionCommitRunId : 0;
    const promotionCommitSelectionVersion = +target.runtimeChunkLoadState.promotionCommitSelectionVersion;
    target.runtimeChunkLoadState.promotionCommitSelectionVersion = promotionCommitSelectionVersion >= 0 && promotionCommitSelectionVersion < Infinity ? promotionCommitSelectionVersion : 0;
    const promotionCommitStartedAt = +target.runtimeChunkLoadState.promotionCommitStartedAt;
    target.runtimeChunkLoadState.promotionCommitStartedAt = promotionCommitStartedAt >= 0 && promotionCommitStartedAt < Infinity ? promotionCommitStartedAt : 0;
    const promotionCommitFinishedAt = +target.runtimeChunkLoadState.promotionCommitFinishedAt;
    target.runtimeChunkLoadState.promotionCommitFinishedAt = promotionCommitFinishedAt >= 0 && promotionCommitFinishedAt < Infinity ? promotionCommitFinishedAt : 0;
    const promotionRetryCount = +target.runtimeChunkLoadState.promotionRetryCount;
    target.runtimeChunkLoadState.promotionRetryCount = promotionRetryCount >= 0 && promotionRetryCount < Infinity ? promotionRetryCount : 0;
    const lastPromotionRetryAt = +target.runtimeChunkLoadState.lastPromotionRetryAt;
    target.runtimeChunkLoadState.lastPromotionRetryAt = lastPromotionRetryAt >= 0 && lastPromotionRetryAt < Infinity ? lastPromotionRetryAt : 0;

    if (target.runtimeChunkLoadState.pendingDelayMs !== null) {
      const pendingDelayMs = +target.runtimeChunkLoadState.pendingDelayMs;
      target.runtimeChunkLoadState.pendingDelayMs = pendingDelayMs > -Infinity && pendingDelayMs < Infinity ? pendingDelayMs : null;
    }
    if (target.runtimeChunkLoadState.refreshTimerId !== null && !isRuntimeTimerHandle(target.runtimeChunkLoadState.refreshTimerId)) target.runtimeChunkLoadState.refreshTimerId = null;
    if (target.runtimeChunkLoadState.promotionTimerId !== null && !isRuntimeTimerHandle(target.runtimeChunkLoadState.promotionTimerId)) target.runtimeChunkLoadState.promotionTimerId = null;
    target.runtimeChunkLoadState.promotionScheduled = target.runtimeChunkLoadState.promotionTimerId !== null;
    if (target.runtimeChunkLoadState.zoomEndChunkVisibleMetric !== null && (!target.runtimeChunkLoadState.zoomEndChunkVisibleMetric || typeof target.runtimeChunkLoadState.zoomEndChunkVisibleMetric !== "object" || Array.isArray(target.runtimeChunkLoadState.zoomEndChunkVisibleMetric))) target.runtimeChunkLoadState.zoomEndChunkVisibleMetric = null;
    if (target.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric !== null && (!target.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric || typeof target.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric !== "object" || Array.isArray(target.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric))) target.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric = null;
    if (target.runtimeChunkLoadState.pendingVisualPromotion !== null && (!target.runtimeChunkLoadState.pendingVisualPromotion || typeof target.runtimeChunkLoadState.pendingVisualPromotion !== "object" || Array.isArray(target.runtimeChunkLoadState.pendingVisualPromotion))) target.runtimeChunkLoadState.pendingVisualPromotion = null;
    if (target.runtimeChunkLoadState.pendingInfraPromotion !== null && (!target.runtimeChunkLoadState.pendingInfraPromotion || typeof target.runtimeChunkLoadState.pendingInfraPromotion !== "object" || Array.isArray(target.runtimeChunkLoadState.pendingInfraPromotion))) target.runtimeChunkLoadState.pendingInfraPromotion = null;
    if (target.runtimeChunkLoadState.pendingPromotion !== null && (!target.runtimeChunkLoadState.pendingPromotion || typeof target.runtimeChunkLoadState.pendingPromotion !== "object" || Array.isArray(target.runtimeChunkLoadState.pendingPromotion))) target.runtimeChunkLoadState.pendingPromotion = null;
    if (target.runtimeChunkLoadState.pendingPostCommitRefresh !== null && (!target.runtimeChunkLoadState.pendingPostCommitRefresh || typeof target.runtimeChunkLoadState.pendingPostCommitRefresh !== "object" || Array.isArray(target.runtimeChunkLoadState.pendingPostCommitRefresh))) target.runtimeChunkLoadState.pendingPostCommitRefresh = null;
    if (target.runtimeChunkLoadState.lastSelection !== null && (!target.runtimeChunkLoadState.lastSelection || typeof target.runtimeChunkLoadState.lastSelection !== "object" || Array.isArray(target.runtimeChunkLoadState.lastSelection))) target.runtimeChunkLoadState.lastSelection = null;
    if (!Array.isArray(target.runtimeChunkLoadState.zoomEndProtectedChunkIds)) target.runtimeChunkLoadState.zoomEndProtectedChunkIds = [];
    if (!target.runtimeChunkLoadState.inFlightByChunkId || typeof target.runtimeChunkLoadState.inFlightByChunkId !== "object" || Array.isArray(target.runtimeChunkLoadState.inFlightByChunkId)) target.runtimeChunkLoadState.inFlightByChunkId = {};
    if (!target.runtimeChunkLoadState.errorByChunkId || typeof target.runtimeChunkLoadState.errorByChunkId !== "object" || Array.isArray(target.runtimeChunkLoadState.errorByChunkId)) target.runtimeChunkLoadState.errorByChunkId = {};
    if (!target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion || typeof target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion !== "object" || Array.isArray(target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion)) target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion = {};
    if (!target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion || typeof target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion !== "object" || Array.isArray(target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion)) target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion = {};
    if (!target.runtimeChunkLoadState.layerSelectionSignatures || typeof target.runtimeChunkLoadState.layerSelectionSignatures !== "object" || Array.isArray(target.runtimeChunkLoadState.layerSelectionSignatures)) target.runtimeChunkLoadState.layerSelectionSignatures = {};
    if (!target.runtimeChunkLoadState.mergedLayerPayloadCache || typeof target.runtimeChunkLoadState.mergedLayerPayloadCache !== "object" || Array.isArray(target.runtimeChunkLoadState.mergedLayerPayloadCache)) target.runtimeChunkLoadState.mergedLayerPayloadCache = {};
    if (normalizedScenarioId) {
      target.runtimeChunkLoadState.shellStatus = "ready";
      target.runtimeChunkLoadState.registryStatus = "ready";
    }
  }
  if (hadRuntimeChunkLoadState) {
    target.runtimeChunkLoadState.generation = getLoadStateGeneration(target);
  } else {
    advanceLoadStateGeneration(target);
  }
  return true;
}

export function resetScenarioChunkRuntimeState(target, { scenarioId = "" } = {}) {
  assertStateTarget(target);
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  const currentLoadStateGeneration = getLoadStateGeneration(target);
  target.activeScenarioChunks = createDefaultActiveScenarioChunksState(normalizedScenarioId);
  target.runtimeChunkLoadState = createDefaultRuntimeChunkLoadState({ scenarioId: normalizedScenarioId });
  advanceLoadStateGeneration(target, currentLoadStateGeneration);
  return true;
}

export function replaceScenarioChunkRuntimeState(target, { activeScenarioChunks, runtimeChunkLoadState } = {}) {
  assertStateTarget(target);
  const currentLoadStateGeneration = getLoadStateGeneration(target);
  const nextLoadStateGeneration = currentLoadStateGeneration
    >= Number.MAX_SAFE_INTEGER
    ? 1
    : currentLoadStateGeneration + 1;
  const nextRuntimeChunkLoadState = createLoadStateGenerationCandidate(
    runtimeChunkLoadState,
    nextLoadStateGeneration,
  );
  target.activeScenarioChunks = activeScenarioChunks;
  target.runtimeChunkLoadState = nextRuntimeChunkLoadState;
  return true;
}

export function patchScenarioChunkLoadState(
  target,
  patch = {},
  {
    expectedLoadStateGeneration = null,
    returnLoadStateGeneration = false,
  } = {},
) {
  assertStateTarget(target);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("[scenario_chunk_runtime_actions] patch must be an object");
  for (const key of Object.keys(patch)) {
    if (!LOAD_STATE_PATCH_KEY_SET.has(key)) throw new Error(`unknown scenario chunk load state key: ${key}`);
  }
  if (!isExpectedLoadStateGenerationCurrent(
    target,
    expectedLoadStateGeneration,
  )) return false;
  ensureScenarioChunkRuntimeState(target);
  if (Object.hasOwn(patch, "shellStatus")) target.runtimeChunkLoadState.shellStatus = patch.shellStatus;
  if (Object.hasOwn(patch, "registryStatus")) target.runtimeChunkLoadState.registryStatus = patch.registryStatus;
  if (Object.hasOwn(patch, "refreshScheduled")) target.runtimeChunkLoadState.refreshScheduled = patch.refreshScheduled;
  if (Object.hasOwn(patch, "refreshTimerId")) target.runtimeChunkLoadState.refreshTimerId = patch.refreshTimerId;
  if (Object.hasOwn(patch, "selectionVersion")) target.runtimeChunkLoadState.selectionVersion = patch.selectionVersion;
  if (Object.hasOwn(patch, "pendingReason")) target.runtimeChunkLoadState.pendingReason = patch.pendingReason;
  if (Object.hasOwn(patch, "pendingDelayMs")) target.runtimeChunkLoadState.pendingDelayMs = patch.pendingDelayMs;
  if (Object.hasOwn(patch, "pendingScenarioApplyRequestId")) target.runtimeChunkLoadState.pendingScenarioApplyRequestId = patch.pendingScenarioApplyRequestId;
  if (Object.hasOwn(patch, "focusCountryOverride")) target.runtimeChunkLoadState.focusCountryOverride = patch.focusCountryOverride;
  if (Object.hasOwn(patch, "focusCountryOverrideSource")) target.runtimeChunkLoadState.focusCountryOverrideSource = patch.focusCountryOverrideSource;
  if (Object.hasOwn(patch, "focusCountryOverrideExpiresAt")) target.runtimeChunkLoadState.focusCountryOverrideExpiresAt = patch.focusCountryOverrideExpiresAt;
  if (Object.hasOwn(patch, "zoomEndChunkVisibleMetric")) target.runtimeChunkLoadState.zoomEndChunkVisibleMetric = patch.zoomEndChunkVisibleMetric;
  if (Object.hasOwn(patch, "lastZoomEndToChunkVisibleMetric")) target.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric = patch.lastZoomEndToChunkVisibleMetric;
  if (Object.hasOwn(patch, "zoomEndProtectedChunkIds")) target.runtimeChunkLoadState.zoomEndProtectedChunkIds = patch.zoomEndProtectedChunkIds;
  if (Object.hasOwn(patch, "zoomEndProtectedUntil")) target.runtimeChunkLoadState.zoomEndProtectedUntil = patch.zoomEndProtectedUntil;
  if (Object.hasOwn(patch, "zoomEndProtectedSelectionVersion")) target.runtimeChunkLoadState.zoomEndProtectedSelectionVersion = patch.zoomEndProtectedSelectionVersion;
  if (Object.hasOwn(patch, "zoomEndProtectedScenarioId")) target.runtimeChunkLoadState.zoomEndProtectedScenarioId = patch.zoomEndProtectedScenarioId;
  if (Object.hasOwn(patch, "zoomEndProtectedFocusCountry")) target.runtimeChunkLoadState.zoomEndProtectedFocusCountry = patch.zoomEndProtectedFocusCountry;
  if (Object.hasOwn(patch, "pendingVisualPromotion")) target.runtimeChunkLoadState.pendingVisualPromotion = patch.pendingVisualPromotion;
  if (Object.hasOwn(patch, "pendingInfraPromotion")) target.runtimeChunkLoadState.pendingInfraPromotion = patch.pendingInfraPromotion;
  if (Object.hasOwn(patch, "pendingPromotion")) target.runtimeChunkLoadState.pendingPromotion = patch.pendingPromotion;
  if (Object.hasOwn(patch, "promotionTimerId")) target.runtimeChunkLoadState.promotionTimerId = patch.promotionTimerId;
  if (Object.hasOwn(patch, "promotionScheduled")) target.runtimeChunkLoadState.promotionScheduled = patch.promotionScheduled;
  if (Object.hasOwn(patch, "promotionCommitInFlight")) target.runtimeChunkLoadState.promotionCommitInFlight = patch.promotionCommitInFlight;
  if (Object.hasOwn(patch, "promotionCommitRunId")) target.runtimeChunkLoadState.promotionCommitRunId = patch.promotionCommitRunId;
  if (Object.hasOwn(patch, "promotionCommitStatus")) target.runtimeChunkLoadState.promotionCommitStatus = patch.promotionCommitStatus;
  if (Object.hasOwn(patch, "promotionCommitScenarioId")) target.runtimeChunkLoadState.promotionCommitScenarioId = patch.promotionCommitScenarioId;
  if (Object.hasOwn(patch, "promotionCommitSelectionVersion")) target.runtimeChunkLoadState.promotionCommitSelectionVersion = patch.promotionCommitSelectionVersion;
  if (Object.hasOwn(patch, "promotionCommitReason")) target.runtimeChunkLoadState.promotionCommitReason = patch.promotionCommitReason;
  if (Object.hasOwn(patch, "promotionCommitStartedAt")) target.runtimeChunkLoadState.promotionCommitStartedAt = patch.promotionCommitStartedAt;
  if (Object.hasOwn(patch, "promotionCommitFinishedAt")) target.runtimeChunkLoadState.promotionCommitFinishedAt = patch.promotionCommitFinishedAt;
  if (Object.hasOwn(patch, "promotionCommitError")) target.runtimeChunkLoadState.promotionCommitError = patch.promotionCommitError;
  if (Object.hasOwn(patch, "pendingPostCommitRefresh")) target.runtimeChunkLoadState.pendingPostCommitRefresh = patch.pendingPostCommitRefresh;
  if (Object.hasOwn(patch, "promotionRetryCount")) target.runtimeChunkLoadState.promotionRetryCount = patch.promotionRetryCount;
  if (Object.hasOwn(patch, "lastPromotionRetryAt")) target.runtimeChunkLoadState.lastPromotionRetryAt = patch.lastPromotionRetryAt;
  if (Object.hasOwn(patch, "inFlightByChunkId")) target.runtimeChunkLoadState.inFlightByChunkId = patch.inFlightByChunkId;
  if (Object.hasOwn(patch, "errorByChunkId")) target.runtimeChunkLoadState.errorByChunkId = patch.errorByChunkId;
  if (Object.hasOwn(patch, "lastSelection")) target.runtimeChunkLoadState.lastSelection = patch.lastSelection;
  if (Object.hasOwn(patch, "scenarioApplyEpochBySelectionVersion")) target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion = patch.scenarioApplyEpochBySelectionVersion;
  if (Object.hasOwn(patch, "scenarioApplyRequestIdBySelectionVersion")) target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion = patch.scenarioApplyRequestIdBySelectionVersion;
  if (Object.hasOwn(patch, "layerSelectionSignatures")) target.runtimeChunkLoadState.layerSelectionSignatures = patch.layerSelectionSignatures;
  if (Object.hasOwn(patch, "mergedLayerPayloadCache")) target.runtimeChunkLoadState.mergedLayerPayloadCache = patch.mergedLayerPayloadCache;
  return returnLoadStateGeneration
    ? getLoadStateGeneration(target)
    : true;
}

export function commitScenarioChunkSelectionState(
  target,
  { selectionVersion = 0, scenarioApplyEpoch = 0, scenarioApplyRequestId = 0, lastSelection = null } = {},
  { expectedLoadStateGeneration = null } = {},
) {
  if (!isExpectedLoadStateGenerationCurrent(
    target,
    expectedLoadStateGeneration,
  )) return false;
  ensureScenarioChunkRuntimeState(target);
  const version = Math.max(0, Number(selectionVersion) || 0);
  const epoch = Math.max(0, Number(scenarioApplyEpoch) || 0);
  const requestId = Math.max(0, Number(scenarioApplyRequestId) || 0);
  target.runtimeChunkLoadState.selectionVersion = version;
  target.runtimeChunkLoadState.lastSelection = lastSelection;
  target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion = Object.fromEntries([
    ...Object.entries(target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion),
    [String(version), epoch],
  ]);
  target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion = Object.fromEntries([
    ...Object.entries(target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion),
    [String(version), requestId],
  ]);
  target.activeScenarioChunks.scenarioApplyEpoch = epoch;
  target.activeScenarioChunks.scenarioApplyRequestId = requestId;
  return version;
}

export function beginScenarioChunkLoadState(
  target,
  chunkId,
  { expectedLoadStateGeneration = null } = {},
) {
  const normalizedChunkId = normalizeChunkId(chunkId);
  if (!normalizedChunkId) return false;
  if (!isExpectedLoadStateGenerationCurrent(
    target,
    expectedLoadStateGeneration,
  )) return false;
  ensureScenarioChunkRuntimeState(target);
  target.runtimeChunkLoadState.inFlightByChunkId = Object.fromEntries([
    ...Object.entries(target.runtimeChunkLoadState.inFlightByChunkId),
    [normalizedChunkId, true],
  ]);
  return true;
}

export function completeScenarioChunkLoadState(
  target,
  chunkId,
  { expectedLoadStateGeneration = null } = {},
) {
  const normalizedChunkId = normalizeChunkId(chunkId);
  if (!normalizedChunkId) return false;
  if (!isExpectedLoadStateGenerationCurrent(
    target,
    expectedLoadStateGeneration,
  )) return false;
  ensureScenarioChunkRuntimeState(target);
  target.runtimeChunkLoadState.errorByChunkId = Object.fromEntries(
    Object.entries(target.runtimeChunkLoadState.errorByChunkId).filter(([key]) => key !== normalizedChunkId),
  );
  return true;
}

export function failScenarioChunkLoadState(
  target,
  chunkId,
  errorMessage,
  { expectedLoadStateGeneration = null } = {},
) {
  const normalizedChunkId = normalizeChunkId(chunkId);
  if (!normalizedChunkId) return "";
  if (!isExpectedLoadStateGenerationCurrent(
    target,
    expectedLoadStateGeneration,
  )) return false;
  const message = String(errorMessage?.message || errorMessage || "");
  ensureScenarioChunkRuntimeState(target);
  target.runtimeChunkLoadState.errorByChunkId = Object.fromEntries([
    ...Object.entries(target.runtimeChunkLoadState.errorByChunkId),
    [normalizedChunkId, message],
  ]);
  return message;
}

export function finishScenarioChunkLoadState(
  target,
  chunkId,
  { expectedLoadStateGeneration = null } = {},
) {
  const normalizedChunkId = normalizeChunkId(chunkId);
  if (!normalizedChunkId) return false;
  if (!isExpectedLoadStateGenerationCurrent(
    target,
    expectedLoadStateGeneration,
  )) return false;
  ensureScenarioChunkRuntimeState(target);
  target.runtimeChunkLoadState.inFlightByChunkId = Object.fromEntries(
    Object.entries(target.runtimeChunkLoadState.inFlightByChunkId).filter(([key]) => key !== normalizedChunkId),
  );
  return true;
}

export function commitScenarioChunkPayloadEntriesState(target, entries = []) {
  ensureScenarioChunkRuntimeState(target);
  const payloadByChunkId = Object.fromEntries(Object.entries(target.activeScenarioChunks.payloadByChunkId));
  const loadedChunkIds = new Set(Object.values(target.activeScenarioChunks.loadedChunkIds));
  const lruChunkIds = new Set(Object.values(target.activeScenarioChunks.lruChunkIds));
  for (const entry of Array.isArray(entries) ? entries : []) {
    const chunkId = String(entry?.chunkId || "").trim();
    if (!chunkId) continue;
    Object.defineProperty(payloadByChunkId, chunkId, {
      value: entry?.payload, enumerable: true, configurable: true, writable: true,
    });
    loadedChunkIds.add(chunkId);
    lruChunkIds.delete(chunkId);
    lruChunkIds.add(chunkId);
  }
  target.activeScenarioChunks.payloadByChunkId = payloadByChunkId;
  target.activeScenarioChunks.loadedChunkIds = [...loadedChunkIds];
  target.activeScenarioChunks.lruChunkIds = [...lruChunkIds];
  return true;
}

export function evictScenarioChunkPayloadsState(target, chunkIds = []) {
  ensureScenarioChunkRuntimeState(target);
  const requestedChunkIds = [];
  for (const chunkId of Array.isArray(chunkIds) ? chunkIds : []) {
    const normalizedChunkId = String(chunkId || "").trim();
    if (normalizedChunkId && !requestedChunkIds.includes(normalizedChunkId)) requestedChunkIds.push(normalizedChunkId);
  }
  const evictedChunkIds = Object.values(target.activeScenarioChunks.loadedChunkIds)
    .filter((chunkId) => requestedChunkIds.includes(chunkId));
  target.activeScenarioChunks.payloadByChunkId = Object.fromEntries(
    Object.entries(target.activeScenarioChunks.payloadByChunkId)
      .filter(([chunkId]) => !requestedChunkIds.includes(chunkId)),
  );
  target.activeScenarioChunks.loadedChunkIds = Object.values(target.activeScenarioChunks.loadedChunkIds)
    .filter((chunkId) => !requestedChunkIds.includes(chunkId));
  target.activeScenarioChunks.lruChunkIds = Object.values(target.activeScenarioChunks.lruChunkIds)
    .filter((chunkId) => !requestedChunkIds.includes(chunkId));
  return Object.freeze(evictedChunkIds);
}

export function setScenarioChunkMergedLayerPayloadsState(target, payloads = {}) {
  ensureScenarioChunkRuntimeState(target);
  target.activeScenarioChunks.mergedLayerPayloads = payloads;
  return payloads;
}

export function replaceScenarioChunkPendingPromotionIdentityState(target, expectedPromotion, identity = {}) {
  ensureScenarioChunkRuntimeState(target);
  if (target.runtimeChunkLoadState.pendingPromotion !== expectedPromotion) return null;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new TypeError("[scenario_chunk_runtime_actions] promotion identity must be an object");
  const replacement = Object.freeze({
    ...(expectedPromotion && typeof expectedPromotion === "object" ? expectedPromotion : {}),
    ...identity,
  });
  target.runtimeChunkLoadState.pendingPromotion = replacement;
  return replacement;
}

export function queueScenarioChunkPromotionState(target, { visualPromotion = null, infraPromotion = null, promotion = null } = {}) {
  ensureScenarioChunkRuntimeState(target);
  target.runtimeChunkLoadState.pendingVisualPromotion = visualPromotion;
  target.runtimeChunkLoadState.pendingInfraPromotion = infraPromotion;
  target.runtimeChunkLoadState.pendingPromotion = promotion;
  return true;
}

export function setScenarioChunkPromotionStatusState(target, status, details = {}) {
  ensureScenarioChunkRuntimeState(target);
  const normalizedStatus = String(status || "idle");
  target.runtimeChunkLoadState.promotionCommitStatus = normalizedStatus;
  if (Object.hasOwn(details, "inFlight")) target.runtimeChunkLoadState.promotionCommitInFlight = details.inFlight;
  if (Object.hasOwn(details, "runId")) target.runtimeChunkLoadState.promotionCommitRunId = details.runId;
  if (Object.hasOwn(details, "scenarioId")) target.runtimeChunkLoadState.promotionCommitScenarioId = normalizeScenarioId(details.scenarioId);
  if (Object.hasOwn(details, "selectionVersion")) target.runtimeChunkLoadState.promotionCommitSelectionVersion = details.selectionVersion;
  if (Object.hasOwn(details, "reason")) target.runtimeChunkLoadState.promotionCommitReason = details.reason;
  if (Object.hasOwn(details, "startedAt")) target.runtimeChunkLoadState.promotionCommitStartedAt = details.startedAt;
  if (Object.hasOwn(details, "finishedAt")) target.runtimeChunkLoadState.promotionCommitFinishedAt = details.finishedAt;
  if (Object.hasOwn(details, "error")) target.runtimeChunkLoadState.promotionCommitError = details.error;
  return normalizedStatus;
}

export function clearScenarioChunkPromotionState(target) {
  ensureScenarioChunkRuntimeState(target);
  target.runtimeChunkLoadState.promotionTimerId = null;
  target.runtimeChunkLoadState.promotionScheduled = false;
  target.runtimeChunkLoadState.pendingVisualPromotion = null;
  target.runtimeChunkLoadState.pendingInfraPromotion = null;
  target.runtimeChunkLoadState.pendingPromotion = null;
  target.runtimeChunkLoadState.promotionRetryCount = 0;
  target.runtimeChunkLoadState.lastPromotionRetryAt = 0;
  return true;
}

export function setScenarioChunkRuntimeHooksState(target, { scheduleScenarioChunkRefreshFn = null, awaitInitialScenarioChunkVisualPromotionFn = null } = {}) {
  assertStateTarget(target);
  target.scheduleScenarioChunkRefreshFn = scheduleScenarioChunkRefreshFn;
  target.awaitInitialScenarioChunkVisualPromotionFn = awaitInitialScenarioChunkVisualPromotionFn;
  return true;
}

// Chunk runtime controller.
// 这个模块只负责 chunk runtime 的 runtimeState、selection、promotion、refresh/schedule。
// facade、startup cache、hydrate 主交易仍留在 scenario_resources.js。

import {
  createDefaultActiveScenarioChunksState,
  createDefaultRuntimeChunkLoadState,
} from "../state/scenario_runtime_state.js";
import { registerRuntimeHook } from "../state/index.js";

function clearZoomEndChunkProtectionState(loadState) {
  if (!loadState) return;
  loadState.zoomEndProtectedChunkIds = [];
  loadState.zoomEndProtectedUntil = 0;
  loadState.zoomEndProtectedSelectionVersion = 0;
  loadState.zoomEndProtectedScenarioId = "";
  loadState.zoomEndProtectedFocusCountry = "";
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

function protectZoomEndChunksForSelection(loadState, chunkIds = [], {
  scenarioId = "",
  selectionVersion = 0,
  focusCountry = "",
  normalizeScenarioIdFn = (value) => String(value || "").trim(),
  nowMs = Date.now(),
} = {}) {
  if (!loadState) return;
  const protectedChunkIds = Array.from(new Set(
    (Array.isArray(chunkIds) ? chunkIds : [])
      .map((chunkId) => String(chunkId || "").trim())
      .filter(Boolean)
      .filter((chunkId) => chunkId.startsWith("political.detail."))
  ));
  loadState.zoomEndProtectedChunkIds = protectedChunkIds;
  loadState.zoomEndProtectedUntil = protectedChunkIds.length ? Number(nowMs || 0) + 5000 : 0;
  loadState.zoomEndProtectedSelectionVersion = protectedChunkIds.length ? Math.max(0, Number(selectionVersion || 0)) : 0;
  loadState.zoomEndProtectedScenarioId = protectedChunkIds.length ? normalizeScenarioIdFn(scenarioId) : "";
  loadState.zoomEndProtectedFocusCountry = protectedChunkIds.length ? String(focusCountry || "").trim().toUpperCase() : "";
}

function applyZoomEndChunkProtectionToSelection(selection, loadState, {
  reason = "",
  previousSelection = null,
  scenarioId = "",
  selectionVersion = 0,
  focusCountry = "",
  normalizeScenarioIdFn = (value) => String(value || "").trim(),
  nowMs = Date.now(),
} = {}) {
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
  clearZoomEndChunkProtectionState(loadState);
  const normalizedReason = String(reason || "").trim().toLowerCase();
  const shouldApplyPreviousSelectionProtection = ["render-phase-idle", "exact-after-settle", "scenario-apply", "scenario-apply-detail-prewarm"]
    .includes(normalizedReason);
  const previousRequiredChunkIds = (Array.isArray(previousSelection?.requiredChunkIds) ? previousSelection.requiredChunkIds : [])
    .map((chunkId) => String(chunkId || "").trim())
    .filter((chunkId) => chunkId.startsWith("political.detail."));
  if (
    shouldApplyPreviousSelectionProtection
    && String(previousSelection?.reason || "").trim().toLowerCase() === "zoom-end"
    && previousRequiredChunkIds.length > 0
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
    previousRequiredChunkIds.forEach((chunkId) => protectedSet.add(chunkId));
  }
  if (!protectedSet.size) {
    return false;
  }
  const previousEvictableCount = selection.evictableChunkIds.length;
  selection.evictableChunkIds = selection.evictableChunkIds.filter((chunkId) => !protectedSet.has(String(chunkId || "").trim()));
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
  selectScenarioChunks,
  mergeScenarioChunkPayloads,
  normalizeScenarioRenderBudgetHints,
  loadScenarioChunkFile,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  getScenarioOptionalLayerConfig,
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

  function yieldToFrame() {
    return new Promise((resolve) => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => resolve());
        return;
      }
      globalThis.setTimeout(resolve, 0);
    });
  }

  function isTimerHandle(value) {
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    if (!value || typeof value !== "object") {
      return false;
    }
    return (
      typeof value.ref === "function"
      || typeof value.unref === "function"
      || typeof value.hasRef === "function"
      || typeof value.refresh === "function"
    );
  }

  function ensureRuntimeChunkLoadState() {
    if (!runtimeState.runtimeChunkLoadState || typeof runtimeState.runtimeChunkLoadState !== "object") {
      runtimeState.runtimeChunkLoadState = createDefaultRuntimeChunkLoadState();
    }
    if (runtimeState.runtimeChunkLoadState.refreshTimerId && !isTimerHandle(runtimeState.runtimeChunkLoadState.refreshTimerId)) {
      runtimeState.runtimeChunkLoadState.refreshTimerId = null;
    }
    runtimeState.runtimeChunkLoadState.inFlightByChunkId =
      runtimeState.runtimeChunkLoadState.inFlightByChunkId && typeof runtimeState.runtimeChunkLoadState.inFlightByChunkId === "object"
        ? runtimeState.runtimeChunkLoadState.inFlightByChunkId
        : {};
    runtimeState.runtimeChunkLoadState.errorByChunkId =
      runtimeState.runtimeChunkLoadState.errorByChunkId && typeof runtimeState.runtimeChunkLoadState.errorByChunkId === "object"
        ? runtimeState.runtimeChunkLoadState.errorByChunkId
        : {};
    runtimeState.runtimeChunkLoadState.pendingReason =
      typeof runtimeState.runtimeChunkLoadState.pendingReason === "string"
        ? runtimeState.runtimeChunkLoadState.pendingReason
        : "";
    runtimeState.runtimeChunkLoadState.pendingDelayMs =
      Number.isFinite(Number(runtimeState.runtimeChunkLoadState.pendingDelayMs))
        ? Number(runtimeState.runtimeChunkLoadState.pendingDelayMs)
        : null;
    runtimeState.runtimeChunkLoadState.focusCountryOverride =
      typeof runtimeState.runtimeChunkLoadState.focusCountryOverride === "string"
        ? runtimeState.runtimeChunkLoadState.focusCountryOverride
        : "";
    runtimeState.runtimeChunkLoadState.zoomEndChunkVisibleMetric =
      runtimeState.runtimeChunkLoadState.zoomEndChunkVisibleMetric
      && typeof runtimeState.runtimeChunkLoadState.zoomEndChunkVisibleMetric === "object"
        ? runtimeState.runtimeChunkLoadState.zoomEndChunkVisibleMetric
        : null;
    runtimeState.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric =
      runtimeState.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric
      && typeof runtimeState.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric === "object"
        ? runtimeState.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric
        : null;
    runtimeState.runtimeChunkLoadState.selectionVersion = Math.max(
      0,
      Number(runtimeState.runtimeChunkLoadState.selectionVersion || 0),
    );
    runtimeState.runtimeChunkLoadState.pendingVisualPromotion =
      runtimeState.runtimeChunkLoadState.pendingVisualPromotion && typeof runtimeState.runtimeChunkLoadState.pendingVisualPromotion === "object"
        ? runtimeState.runtimeChunkLoadState.pendingVisualPromotion
        : null;
    runtimeState.runtimeChunkLoadState.pendingInfraPromotion =
      runtimeState.runtimeChunkLoadState.pendingInfraPromotion && typeof runtimeState.runtimeChunkLoadState.pendingInfraPromotion === "object"
        ? runtimeState.runtimeChunkLoadState.pendingInfraPromotion
        : null;
    if (runtimeState.runtimeChunkLoadState.promotionTimerId && !isTimerHandle(runtimeState.runtimeChunkLoadState.promotionTimerId)) {
      runtimeState.runtimeChunkLoadState.promotionTimerId = null;
    }
    runtimeState.runtimeChunkLoadState.promotionScheduled = runtimeState.runtimeChunkLoadState.promotionTimerId != null;
    runtimeState.runtimeChunkLoadState.promotionCommitInFlight =
      !!runtimeState.runtimeChunkLoadState.promotionCommitInFlight;
    runtimeState.runtimeChunkLoadState.promotionCommitRunId = Math.max(
      0,
      Number(runtimeState.runtimeChunkLoadState.promotionCommitRunId || 0),
    );
    runtimeState.runtimeChunkLoadState.promotionCommitStatus =
      typeof runtimeState.runtimeChunkLoadState.promotionCommitStatus === "string"
        ? runtimeState.runtimeChunkLoadState.promotionCommitStatus
        : "idle";
    runtimeState.runtimeChunkLoadState.promotionCommitScenarioId =
      typeof runtimeState.runtimeChunkLoadState.promotionCommitScenarioId === "string"
        ? runtimeState.runtimeChunkLoadState.promotionCommitScenarioId
        : "";
    runtimeState.runtimeChunkLoadState.promotionCommitSelectionVersion = Math.max(
      0,
      Number(runtimeState.runtimeChunkLoadState.promotionCommitSelectionVersion || 0),
    );
    runtimeState.runtimeChunkLoadState.promotionCommitReason =
      typeof runtimeState.runtimeChunkLoadState.promotionCommitReason === "string"
        ? runtimeState.runtimeChunkLoadState.promotionCommitReason
        : "";
    runtimeState.runtimeChunkLoadState.promotionCommitStartedAt = Math.max(
      0,
      Number(runtimeState.runtimeChunkLoadState.promotionCommitStartedAt || 0),
    );
    runtimeState.runtimeChunkLoadState.promotionCommitFinishedAt = Math.max(
      0,
      Number(runtimeState.runtimeChunkLoadState.promotionCommitFinishedAt || 0),
    );
    runtimeState.runtimeChunkLoadState.promotionCommitError =
      typeof runtimeState.runtimeChunkLoadState.promotionCommitError === "string"
        ? runtimeState.runtimeChunkLoadState.promotionCommitError
        : "";
    runtimeState.runtimeChunkLoadState.pendingPostCommitRefresh =
      runtimeState.runtimeChunkLoadState.pendingPostCommitRefresh
      && typeof runtimeState.runtimeChunkLoadState.pendingPostCommitRefresh === "object"
        ? runtimeState.runtimeChunkLoadState.pendingPostCommitRefresh
        : null;
    runtimeState.runtimeChunkLoadState.promotionRetryCount = Math.max(
      0,
      Number(runtimeState.runtimeChunkLoadState.promotionRetryCount || 0),
    );
    runtimeState.runtimeChunkLoadState.lastPromotionRetryAt = Math.max(
      0,
      Number(runtimeState.runtimeChunkLoadState.lastPromotionRetryAt || 0),
    );
    runtimeState.runtimeChunkLoadState.pendingPromotion =
      runtimeState.runtimeChunkLoadState.pendingPromotion && typeof runtimeState.runtimeChunkLoadState.pendingPromotion === "object"
        ? runtimeState.runtimeChunkLoadState.pendingPromotion
        : null;
    runtimeState.runtimeChunkLoadState.layerSelectionSignatures =
      runtimeState.runtimeChunkLoadState.layerSelectionSignatures
      && typeof runtimeState.runtimeChunkLoadState.layerSelectionSignatures === "object"
        ? runtimeState.runtimeChunkLoadState.layerSelectionSignatures
        : {};
    runtimeState.runtimeChunkLoadState.mergedLayerPayloadCache =
      runtimeState.runtimeChunkLoadState.mergedLayerPayloadCache
      && typeof runtimeState.runtimeChunkLoadState.mergedLayerPayloadCache === "object"
        ? runtimeState.runtimeChunkLoadState.mergedLayerPayloadCache
        : {};
    return runtimeState.runtimeChunkLoadState;
  }

  function clearPendingScenarioChunkRefresh(loadState = ensureRuntimeChunkLoadState()) {
    loadState.pendingReason = "";
    loadState.pendingDelayMs = null;
  }


  function clearZoomEndChunkProtection(loadState) {
    clearZoomEndChunkProtectionState(loadState);
  }

  function protectZoomEndChunks(loadState, chunkIds = [], {
    scenarioId = "",
    selectionVersion = 0,
    focusCountry = "",
  } = {}) {
    protectZoomEndChunksForSelection(loadState, chunkIds, {
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
    applyZoomEndChunkProtectionToSelection(selection, loadState, {
      reason,
      previousSelection,
      scenarioId,
      selectionVersion,
      focusCountry,
      normalizeScenarioIdFn: normalizeScenarioId,
      nowMs: Date.now(),
    });
  }

  function getChunkIdListSignature(chunkIds = []) {
    return (Array.isArray(chunkIds) ? chunkIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("|");
  }

  function hasDetailScenarioChunkIds(chunkIds = []) {
    return (Array.isArray(chunkIds) ? chunkIds : []).some((chunkId) =>
      String(chunkId || "").includes(".detail.")
    );
  }

  function markPendingScenarioChunkRefresh(reason = "refresh", delayMs = null) {
    const loadState = ensureRuntimeChunkLoadState();
    loadState.pendingReason = String(reason || "refresh").trim() || "refresh";
    loadState.pendingDelayMs = Number.isFinite(Number(delayMs)) ? Number(delayMs) : null;
    return loadState;
  }

  function setScenarioChunkShellStatus(nextStatus = "", loadState = ensureRuntimeChunkLoadState()) {
    const normalizedStatus = String(nextStatus || "").trim().toLowerCase();
    if (!normalizedStatus) {
      return loadState.shellStatus;
    }
    loadState.shellStatus = normalizedStatus;
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

  function shouldDeferScenarioChunkRefreshFor() {
    return !!(
      runtimeState.bootBlocking
      || runtimeState.scenarioApplyInFlight
      || runtimeState.startupReadonly
      || runtimeState.startupReadonlyUnlockInFlight
      || runtimeState.isInteracting
      || String(runtimeState.renderPhase || "idle") !== "idle"
    );
  }

  function shouldDeferScenarioChunkRefresh() {
    return shouldDeferScenarioChunkRefreshFor();
  }

  function resolveScenarioChunkFocusCountry(bundle, loadState = ensureRuntimeChunkLoadState()) {
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
    if (mappedIso2) {
      return normalizeCountryCodeAlias(mappedIso2);
    }
    return normalizeCountryCodeAlias(rawFocusCountry);
  }

  function clearPendingScenarioChunkPromotion(loadState = ensureRuntimeChunkLoadState()) {
    if (loadState.promotionTimerId) {
      globalThis.clearTimeout(loadState.promotionTimerId);
      loadState.promotionTimerId = null;
    }
    loadState.promotionScheduled = false;
    loadState.pendingVisualPromotion = null;
    loadState.pendingInfraPromotion = null;
    loadState.pendingPromotion = null;
    loadState.promotionRetryCount = 0;
    loadState.lastPromotionRetryAt = 0;
  }

  function schedulePendingScenarioChunkPromotionCommit({
    delayMs = 0,
    retry = false,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    if (!loadState.pendingPromotion) {
      clearPendingScenarioChunkPromotion(loadState);
      return false;
    }
    if (loadState.promotionTimerId) {
      globalThis.clearTimeout(loadState.promotionTimerId);
      loadState.promotionTimerId = null;
    }
    const resolvedDelayMs = Math.max(0, Number(delayMs) || 0);
    if (retry) {
      loadState.promotionRetryCount = Math.max(0, Number(loadState.promotionRetryCount || 0)) + 1;
      loadState.lastPromotionRetryAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    }
    loadState.promotionScheduled = true;
    loadState.promotionTimerId = globalThis.setTimeout(() => {
      loadState.promotionTimerId = null;
      loadState.promotionScheduled = false;
      void commitPendingScenarioChunkPromotion().catch((error) => {
        loadState.promotionCommitStatus = "error";
        loadState.promotionCommitInFlight = false;
        console.warn("[scenario] Failed to commit pending scenario chunk promotion.", error);
      });
    }, resolvedDelayMs);
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
    if (!bundle) {
      clearPendingScenarioChunkRefresh(loadState);
      return "noop";
    }
    if (loadState.pendingPromotion && loadState.promotionScheduled) {
      if (flushPending) {
        if (loadState.promotionTimerId) {
          globalThis.clearTimeout(loadState.promotionTimerId);
          loadState.promotionTimerId = null;
        }
        loadState.promotionScheduled = false;
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
      void commitPendingScenarioChunkPromotion({
        bundle,
        pendingPromotion: loadState.pendingPromotion,
      }).catch((error) => {
        loadState.promotionCommitStatus = "error";
        loadState.promotionCommitInFlight = false;
        console.warn("[scenario] Failed to commit pending scenario chunk promotion.", error);
      });
      return "promotion-commit-started";
    }
    if (!flushPending || !hasPendingReason) {
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
    if (!runtimeState.renderPerfMetrics || typeof runtimeState.renderPerfMetrics !== "object") {
      runtimeState.renderPerfMetrics = {};
    }
    runtimeState.renderPerfMetrics[String(name || "").trim()] = {
      durationMs: Math.max(0, Number(durationMs) || 0),
      recordedAt: Date.now(),
      ...details,
    };
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
    if (!runtimeState.activeScenarioChunks || typeof runtimeState.activeScenarioChunks !== "object") {
      runtimeState.activeScenarioChunks = createDefaultActiveScenarioChunksState();
    }
    runtimeState.activeScenarioChunks.loadedChunkIds = Array.isArray(runtimeState.activeScenarioChunks.loadedChunkIds)
      ? runtimeState.activeScenarioChunks.loadedChunkIds
      : [];
    runtimeState.activeScenarioChunks.payloadByChunkId =
      runtimeState.activeScenarioChunks.payloadByChunkId && typeof runtimeState.activeScenarioChunks.payloadByChunkId === "object"
        ? runtimeState.activeScenarioChunks.payloadByChunkId
        : {};
    runtimeState.activeScenarioChunks.mergedLayerPayloads =
      runtimeState.activeScenarioChunks.mergedLayerPayloads && typeof runtimeState.activeScenarioChunks.mergedLayerPayloads === "object"
        ? runtimeState.activeScenarioChunks.mergedLayerPayloads
        : {};
    runtimeState.activeScenarioChunks.lruChunkIds = Array.isArray(runtimeState.activeScenarioChunks.lruChunkIds)
      ? runtimeState.activeScenarioChunks.lruChunkIds
      : [];
    return runtimeState.activeScenarioChunks;
  }

  function ensureScenarioChunkPayloadCache(bundle) {
    if (!bundle || typeof bundle !== "object") {
      return {};
    }
    bundle.chunkPayloadCacheById = bundle.chunkPayloadCacheById && typeof bundle.chunkPayloadCacheById === "object"
      ? bundle.chunkPayloadCacheById
      : {};
    return bundle.chunkPayloadCacheById;
  }

  function ensureScenarioChunkPromiseCache(bundle) {
    if (!bundle || typeof bundle !== "object") {
      return {};
    }
    bundle.chunkPayloadPromisesById = bundle.chunkPayloadPromisesById && typeof bundle.chunkPayloadPromisesById === "object"
      ? bundle.chunkPayloadPromisesById
      : {};
    return bundle.chunkPayloadPromisesById;
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

  function touchScenarioChunkLru(chunkId) {
    const chunkState = ensureActiveScenarioChunkState();
    const normalizedChunkId = String(chunkId || "").trim();
    if (!normalizedChunkId) return;
    chunkState.lruChunkIds = chunkState.lruChunkIds.filter((entry) => entry !== normalizedChunkId);
    chunkState.lruChunkIds.push(normalizedChunkId);
  }

  function resetScenarioChunkRuntimeState({ scenarioId = "" } = {}) {
    const normalizedScenarioId = normalizeScenarioId(scenarioId);
    runtimeState.activeScenarioChunks = createDefaultActiveScenarioChunksState(normalizedScenarioId);
    runtimeState.runtimeChunkLoadState = createDefaultRuntimeChunkLoadState({
      scenarioId: normalizedScenarioId,
    });
  }

  function getScenarioChunkIdsByLayer(chunkState, layerKey) {
    return chunkState.loadedChunkIds
      .map((chunkId) => ({ chunkId, entry: chunkState.payloadByChunkId?.[chunkId] || null }))
      .filter(({ entry }) => entry && entry.layerKey === layerKey)
      .map(({ chunkId }) => chunkId);
  }

  function buildScenarioChunkLayerSelectionSignatures(bundle) {
    const chunkState = ensureActiveScenarioChunkState();
    const layerKeys = new Set([
      ...Object.keys(bundle?.chunkRegistry?.byLayer || {}),
      ...Object.keys(chunkState.mergedLayerPayloads || {}),
    ]);
    const signatures = {};
    layerKeys.forEach((layerKey) => {
      const chunkIds = getScenarioChunkIdsByLayer(chunkState, layerKey);
      signatures[layerKey] = getChunkIdListSignature(chunkIds);
    });
    return signatures;
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
    Object.keys(mergedLayerPayloads || {}).forEach((layerKey) => {
      if (!hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey)) {
        return;
      }
      const config = getScenarioOptionalLayerConfig(layerKey);
      if (!config) {
        return;
      }
      const nextPayload = mergedLayerPayloads[layerKey] || null;
      const currentPayload = runtimeState[config.stateField] || null;
      if (nextPayload === currentPayload) return;
      if (config.stateField === "scenarioCityOverridesData") {
        syncScenarioLocalizationState({ cityOverridesPayload: nextPayload });
        changed = true;
        changedLayerKeys.push(layerKey);
        return;
      }
      runtimeState[config.stateField] = nextPayload;
      if (config.revisionField) {
        runtimeState[config.revisionField] = (Number(runtimeState[config.revisionField]) || 0) + 1;
      }
      changed = true;
      changedLayerKeys.push(layerKey);
    });
    if (changed && renderNow) {
      flushRenderBoundary("scenario-optional-layer-apply");
    }
    return {
      changed,
      changedLayerKeys,
    };
  }

  function applyScenarioPoliticalChunkPayload(bundle, politicalPayload, {
    renderNow = false,
    reason = "refresh",
    changedLayerKeys = [],
    politicalFeatureIds = [],
  } = {}) {
    const startedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const normalizedPayload = normalizeScenarioFeatureCollection(politicalPayload);
    const previousFeatureIds = getScenarioFeatureCollectionIdentityList(runtimeState.scenarioPoliticalChunkData);
    const nextFeatureIds = getScenarioFeatureCollectionIdentityList(normalizedPayload);
    const samePayload = areScenarioFeatureCollectionsEquivalent(
      runtimeState.scenarioPoliticalChunkData,
      normalizedPayload
    );
    if (samePayload) {
      return false;
    }
    runtimeState.scenarioPoliticalChunkData = normalizedPayload || null;
    const resolvedPoliticalFeatureIds = Array.isArray(politicalFeatureIds) && politicalFeatureIds.length
      ? Array.from(new Set(politicalFeatureIds))
      : Array.from(new Set([
        ...previousFeatureIds,
        ...nextFeatureIds,
      ]));
    refreshMapDataForScenarioChunkPromotion({
      suppressRender: !renderNow,
      reason,
      changedLayerKeys,
      politicalFeatureIds: resolvedPoliticalFeatureIds,
      hasPoliticalPayloadChange: true,
    });
    recordScenarioRenderMetric("politicalChunkPromotionMs", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - startedAt, {
      scenarioId: getScenarioBundleId(bundle),
      reason: String(reason || "refresh"),
      promotedPoliticalFeatureCount: nextFeatureIds.length,
    });
    return true;
  }

  function setPromotionCommitStatus(loadState, status, details = {}) {
    loadState.promotionCommitStatus = String(status || "idle");
    if (Object.prototype.hasOwnProperty.call(details, "inFlight")) {
      loadState.promotionCommitInFlight = !!details.inFlight;
    }
    if (Object.prototype.hasOwnProperty.call(details, "runId")) {
      loadState.promotionCommitRunId = Math.max(0, Number(details.runId || 0));
    }
    if (Object.prototype.hasOwnProperty.call(details, "scenarioId")) {
      loadState.promotionCommitScenarioId = normalizeScenarioId(details.scenarioId);
    }
    if (Object.prototype.hasOwnProperty.call(details, "selectionVersion")) {
      loadState.promotionCommitSelectionVersion = Math.max(0, Number(details.selectionVersion || 0));
    }
    if (Object.prototype.hasOwnProperty.call(details, "reason")) {
      loadState.promotionCommitReason = String(details.reason || "");
    }
    if (Object.prototype.hasOwnProperty.call(details, "startedAt")) {
      loadState.promotionCommitStartedAt = Math.max(0, Number(details.startedAt || 0));
    }
    if (Object.prototype.hasOwnProperty.call(details, "finishedAt")) {
      loadState.promotionCommitFinishedAt = Math.max(0, Number(details.finishedAt || 0));
    }
    if (Object.prototype.hasOwnProperty.call(details, "error")) {
      loadState.promotionCommitError = String(details.error || "");
    }
    return loadState.promotionCommitStatus;
  }

  function captureMergedLayerRuntimeSnapshot(mergedLayerPayloads = {}) {
    return Object.keys(mergedLayerPayloads || {}).map((layerKey) => {
      const config = getScenarioOptionalLayerConfig(layerKey);
      if (!config?.stateField) return null;
      return {
        stateField: config.stateField,
        revisionField: config.revisionField || "",
        value: runtimeState[config.stateField],
        revision: config.revisionField ? runtimeState[config.revisionField] : undefined,
      };
    }).filter(Boolean);
  }

  function restoreMergedLayerRuntimeSnapshot(snapshot = []) {
    (Array.isArray(snapshot) ? snapshot : []).forEach((entry) => {
      if (!entry?.stateField) return;
      runtimeState[entry.stateField] = entry.value;
      if (entry.revisionField) {
        runtimeState[entry.revisionField] = entry.revision;
      }
    });
  }

  function isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId = "", runId = 0 } = {}) {
    if (!pendingPromotion || typeof pendingPromotion !== "object") return false;
    if (runtimeState.runtimeChunkLoadState !== loadState) return false;
    if (runId > 0 && Math.max(0, Number(loadState.promotionCommitRunId || 0)) !== runId) return false;
    const normalizedScenarioId = normalizeScenarioId(scenarioId || pendingPromotion.scenarioId || runtimeState.activeScenarioId);
    if (!normalizedScenarioId || normalizedScenarioId !== normalizeScenarioId(runtimeState.activeScenarioId)) return false;
    if (loadState.pendingPromotion && loadState.pendingPromotion !== pendingPromotion) return false;
    const pendingSelectionVersion = Math.max(0, Number(pendingPromotion.selectionVersion || 0));
    const currentSelectionVersion = Math.max(0, Number(loadState.selectionVersion || 0));
    if (pendingSelectionVersion > 0 && currentSelectionVersion > 0 && pendingSelectionVersion !== currentSelectionVersion) return false;
    return true;
  }

  async function applyPendingScenarioChunkPromotion(bundle, pendingPromotion, loadState = ensureRuntimeChunkLoadState(), {
    renderNowOverride = null,
    runId = 0,
  } = {}) {
    if (!pendingPromotion || typeof pendingPromotion !== "object") {
      return false;
    }
    const scenarioId = normalizeScenarioId(pendingPromotion.scenarioId || runtimeState.activeScenarioId);
    if (!isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId, runId })) {
      if (loadState.pendingPromotion === pendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      setPromotionCommitStatus(loadState, "promotion-skipped-stale", { inFlight: false, finishedAt: Date.now() });
      return false;
    }
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
    const previousRenderLock = !!runtimeState.scenarioChunkPromotionRenderLocked;
    const mergedLayerSnapshot = captureMergedLayerRuntimeSnapshot(mergedLayerPayloads);
    const previousPoliticalChunkData = runtimeState.scenarioPoliticalChunkData;
    runtimeState.scenarioChunkPromotionRenderLocked = true;
    let mergedLayerResult = { changed: false, changedLayerKeys: [] };
    let politicalPayloadChanged = false;
    try {
      setPromotionCommitStatus(loadState, "applying-infra", { inFlight: true, runId, scenarioId });
      const infraStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
      mergedLayerResult = applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, { renderNow: false });
      const infraEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
      recordScenarioChunkRuntimeMetric("chunkPromotionCommitInfraMs", infraEndedAt - infraStartedAt, {
        scenarioId,
        reason: String(pendingPromotion.reason || "refresh"),
        changedLayerCount: mergedLayerResult?.changedLayerKeys?.length || 0,
      });
      await yieldToFrame();
      if (!isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId, runId })) {
        restoreMergedLayerRuntimeSnapshot(mergedLayerSnapshot);
        setPromotionCommitStatus(loadState, "promotion-skipped-stale", { inFlight: false, finishedAt: Date.now() });
        return false;
      }

      setPromotionCommitStatus(loadState, "applying-visual", { inFlight: true, runId, scenarioId });
      const visualStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
      politicalPayloadChanged = applyScenarioPoliticalChunkPayload(bundle, mergedLayerPayloads.political || null, {
        renderNow: false,
        reason: pendingPromotion.reason,
        changedLayerKeys: mergedLayerResult?.changedLayerKeys || [],
        politicalFeatureIds: pendingPromotion.politicalFeatureIds || [],
      });
      // Keep the render lock across this frame break so a half-applied visual payload
      // cannot be flushed while a newer promotion run is taking ownership.
      await yieldToFrame();
      if (!isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId, runId })) {
        runtimeState.scenarioPoliticalChunkData = previousPoliticalChunkData;
        refreshMapDataForScenarioChunkPromotion({
          suppressRender: true,
          reason: "scenario-chunk-promotion-stale-rollback",
          changedLayerKeys: mergedLayerResult?.changedLayerKeys || [],
          politicalFeatureIds: pendingPromotion.politicalFeatureIds || [],
          hasPoliticalPayloadChange: true,
        });
        setPromotionCommitStatus(loadState, "promotion-skipped-stale", { inFlight: false, finishedAt: Date.now() });
        return false;
      }
      if (resolvedRenderNow !== false) {
        flushRenderBoundary("scenario-chunk-promotion");
      }
      runtimeState.scenarioChunkPromotionRenderLocked = previousRenderLock;
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
          recordScenarioPerfMetric("timeToPoliticalCoreReady", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt, {
            scenarioId,
            promotedPoliticalFeatureCount: mergedLayerPayloads.political.features.length,
            requiredPoliticalChunkCount: Number(pendingPromotion.requiredPoliticalChunkCount || 0),
          });
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
          loadState.lastZoomEndToChunkVisibleMetric = {
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
          };
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
        loadState.zoomEndChunkVisibleMetric = null;
      }
      setScenarioChunkShellStatus("ready", loadState);
      clearPendingScenarioChunkPromotion(loadState);
      clearPendingScenarioChunkRefresh(loadState);
      setPromotionCommitStatus(loadState, "promotion-committed", { inFlight: false, finishedAt: Date.now() });
      return true;
    } finally {
      runtimeState.scenarioChunkPromotionRenderLocked = previousRenderLock;
    }
  }

  async function runPendingScenarioChunkPromotionCommit({
    bundle = null,
    pendingPromotion = null,
    renderNow = null,
    runId = 0,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    const resolvedPendingPromotion = pendingPromotion || loadState.pendingPromotion;
    if (!resolvedPendingPromotion || typeof resolvedPendingPromotion !== "object") {
      setPromotionCommitStatus(loadState, "noop", { inFlight: false, finishedAt: Date.now() });
      return false;
    }
    const scenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    if (!scenarioId || scenarioId !== normalizeScenarioId(resolvedPendingPromotion.scenarioId)) {
      if (loadState.pendingPromotion === resolvedPendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      setPromotionCommitStatus(loadState, "promotion-skipped-stale", { inFlight: false, finishedAt: Date.now() });
      return false;
    }
    const resolvedBundle = bundle || getCachedScenarioBundle(scenarioId);
    if (!resolvedBundle) {
      if (loadState.pendingPromotion === resolvedPendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      setPromotionCommitStatus(loadState, "noop", { inFlight: false, finishedAt: Date.now() });
      return false;
    }
    if (shouldDeferScenarioChunkRefresh()) {
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
      setPromotionCommitStatus(loadState, "promotion-deferred", { inFlight: false, finishedAt: Date.now() });
      return false;
    }
    return applyPendingScenarioChunkPromotion(resolvedBundle, resolvedPendingPromotion, loadState, {
      renderNowOverride: renderNow,
      runId,
    });
  }

  function commitPendingScenarioChunkPromotion({
    bundle = null,
    pendingPromotion = null,
    renderNow = null,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    if (promotionCommitPromise || loadState.promotionCommitInFlight) {
      setPromotionCommitStatus(loadState, "promotion-commit-in-flight", { inFlight: true });
      return promotionCommitPromise || Promise.resolve(false);
    }
    const runId = promotionCommitRunId + 1;
    promotionCommitRunId = runId;
    const startedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const resolvedPendingPromotion = pendingPromotion || loadState.pendingPromotion;
    setPromotionCommitStatus(loadState, "promotion-commit-started", {
      inFlight: true,
      runId,
      scenarioId: resolvedPendingPromotion?.scenarioId || runtimeState.activeScenarioId,
      selectionVersion: resolvedPendingPromotion?.selectionVersion || loadState.selectionVersion || 0,
      reason: resolvedPendingPromotion?.reason || loadState.pendingReason || "",
      startedAt,
      error: "",
    });
    promotionCommitPromise = runPendingScenarioChunkPromotionCommit({
      bundle,
      pendingPromotion: resolvedPendingPromotion,
      renderNow,
      runId,
    }).catch((error) => {
      setPromotionCommitStatus(loadState, "error", {
        inFlight: false,
        runId,
        finishedAt: Date.now(),
        error: error?.message || String(error || "unknown"),
      });
      throw error;
    }).finally(() => {
      if (Math.max(0, Number(loadState.promotionCommitRunId || 0)) === runId) {
        loadState.promotionCommitInFlight = false;
        if (loadState.promotionCommitStatus === "promotion-commit-started" || loadState.promotionCommitStatus === "promotion-commit-in-flight") {
          loadState.promotionCommitStatus = "idle";
        }
        loadState.promotionCommitFinishedAt = Date.now();
      }
      if (promotionCommitRunId === runId) {
        promotionCommitPromise = null;
      }
      const pendingPostCommitRefresh = loadState.pendingPostCommitRefresh;
      loadState.pendingPostCommitRefresh = null;
      if (
        pendingPostCommitRefresh
        && typeof pendingPostCommitRefresh === "object"
        && runtimeState.runtimeChunkLoadState === loadState
        && !loadState.promotionCommitInFlight
      ) {
        const committedReason = String(loadState.promotionCommitReason || "").trim().toLowerCase();
        const replayReason = committedReason === "zoom-end"
          ? "zoom-end"
          : (pendingPostCommitRefresh.reason || "post-commit-refresh");
        scheduleScenarioChunkRefresh({
          reason: replayReason,
          delayMs: Number.isFinite(Number(pendingPostCommitRefresh.delayMs))
            ? Number(pendingPostCommitRefresh.delayMs)
            : 0,
          refreshSourceStartedAtMs: Number(pendingPostCommitRefresh.refreshSourceStartedAtMs || 0),
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
    const loadState = ensureRuntimeChunkLoadState();
    if (loadState.promotionTimerId) {
      globalThis.clearTimeout(loadState.promotionTimerId);
      loadState.promotionTimerId = null;
    }
    loadState.promotionScheduled = false;
    loadState.pendingPostCommitRefresh = null;
    promotionCommitRunId += 1;
    promotionCommitPromise = null;
    runtimeState.scenarioChunkPromotionRenderLocked = false;
    setPromotionCommitStatus(loadState, String(reason || "cancel"), {
      inFlight: false,
      runId: promotionCommitRunId,
      finishedAt: Date.now(),
      error: "",
    });
    return true;
  }

  registerRuntimeHook(runtimeState, "cancelScenarioChunkPromotionCommitFn", cancelScenarioChunkPromotionCommit);

  function buildMergedScenarioChunkLayerPayloads(bundle, {
    previousSignatures = {},
    nextSignatures = {},
    previousMergedLayerPayloads = {},
  } = {}) {
    const chunkState = ensureActiveScenarioChunkState();
    const mergedLayerPayloads = {};
    const changedLayerKeys = [];
    const layerKeys = new Set([
      ...Object.keys(bundle?.chunkRegistry?.byLayer || {}),
      ...Object.keys(previousMergedLayerPayloads || {}),
    ]);
    layerKeys.forEach((layerKey) => {
      const previousSignature = String(previousSignatures?.[layerKey] || "");
      const nextSignature = String(nextSignatures?.[layerKey] || "");
      if (
        previousSignature === nextSignature
        && Object.prototype.hasOwnProperty.call(previousMergedLayerPayloads || {}, layerKey)
      ) {
        mergedLayerPayloads[layerKey] = previousMergedLayerPayloads[layerKey] || null;
        return;
      }
      const layerChunkPayloads = chunkState.loadedChunkIds
        .map((chunkId) => chunkState.payloadByChunkId?.[chunkId] || null)
        .filter((entry) => entry && entry.layerKey === layerKey)
        .map((entry) => entry.payload)
        .filter(Boolean);
      if (!layerChunkPayloads.length) {
        mergedLayerPayloads[layerKey] = null;
        changedLayerKeys.push(layerKey);
        return;
      }
      mergedLayerPayloads[layerKey] = mergeScenarioChunkPayloads(layerKey, layerChunkPayloads);
      changedLayerKeys.push(layerKey);
    });
    chunkState.mergedLayerPayloads = mergedLayerPayloads;
    return {
      mergedLayerPayloads,
      changedLayerKeys,
    };
  }

  async function loadScenarioChunkPayload(bundle, chunkMeta, { d3Client = globalThis.d3 } = {}) {
    const normalizedChunkId = String(chunkMeta?.id || "").trim();
    if (!bundle || !normalizedChunkId) return null;
    const payloadCache = ensureScenarioChunkPayloadCache(bundle);
    if (payloadCache[normalizedChunkId]) {
      return payloadCache[normalizedChunkId];
    }
    const promiseCache = ensureScenarioChunkPromiseCache(bundle);
    if (promiseCache[normalizedChunkId]) {
      return promiseCache[normalizedChunkId];
    }
    const loadState = ensureRuntimeChunkLoadState();
    loadState.inFlightByChunkId[normalizedChunkId] = true;
    const loadPromise = (async () => {
      try {
        const result = await loadScenarioChunkFile(chunkMeta.url, {
          d3Client,
          scenarioId: getScenarioBundleId(bundle),
          resourceLabel: `chunk:${chunkMeta.layer}:${normalizedChunkId}`,
        });
        const payload = {
          layerKey: chunkMeta.layer,
          payload: result?.payload || null,
        };
        payloadCache[normalizedChunkId] = payload;
        delete loadState.errorByChunkId[normalizedChunkId];
        return payload;
      } catch (error) {
        loadState.errorByChunkId[normalizedChunkId] = String(error?.message || error || "Unknown chunk load error.");
        throw error;
      } finally {
        delete promiseCache[normalizedChunkId];
        delete loadState.inFlightByChunkId[normalizedChunkId];
      }
    })();
    promiseCache[normalizedChunkId] = loadPromise;
    return loadPromise;
  }

  async function preloadScenarioCoarseChunks(
    bundle,
    {
      d3Client = globalThis.d3,
    } = {}
  ) {
    if (!scenarioSupportsChunkedRuntime(bundle?.manifest)) return null;
    await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
    const visibleLayers = getVisibleScenarioChunkLayers({
      includePoliticalCore: scenarioBundleUsesChunkedLayer(bundle, "political"),
      showWaterRegions: normalizeScenarioPerformanceHints(bundle.manifest).waterRegionsDefault !== false,
      showScenarioSpecialRegions: normalizeScenarioPerformanceHints(bundle.manifest).specialRegionsDefault !== false,
      showScenarioReliefOverlays: normalizeScenarioPerformanceHints(bundle.manifest).scenarioReliefOverlaysDefault === true,
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
      viewportBbox: [-180, -90, 180, 90],
      focusCountry: getScenarioDefaultCountryCode(bundle.manifest, bundle.countriesPayload?.countries || {}),
      renderBudgetHints: bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {},
      visibleLayers,
      loadedChunkIds: [],
    });
    await Promise.all(
      coarseSelection.requiredChunks.map((chunk) => loadScenarioChunkPayload(bundle, chunk, { d3Client }))
    );
    bundle.chunkPreloaded = true;
    const bundleScenarioId = getScenarioBundleId(bundle);
    if (bundleScenarioId && bundleScenarioId === normalizeScenarioId(runtimeState.activeScenarioId)) {
      const chunkState = ensureActiveScenarioChunkState();
      const loadState = ensureRuntimeChunkLoadState();
      if (
        hasDetailScenarioChunkIds(chunkState.loadedChunkIds)
        || Math.max(0, Number(loadState.selectionVersion || 0)) > 0
        || loadState.promotionCommitInFlight
        || loadState.pendingPromotion
      ) {
        return null;
      }
      chunkState.scenarioId = bundleScenarioId;
      coarseSelection.requiredChunks.forEach((chunk) => {
        const payload = bundle.chunkPayloadCacheById?.[chunk.id];
        if (!payload) return;
        chunkState.payloadByChunkId[chunk.id] = payload;
        if (!chunkState.loadedChunkIds.includes(chunk.id)) {
          chunkState.loadedChunkIds.push(chunk.id);
        }
        touchScenarioChunkLru(chunk.id);
      });
      const layerSignatures = buildScenarioChunkLayerSelectionSignatures(bundle);
      const mergedResult = buildMergedScenarioChunkLayerPayloads(bundle, {
        previousSignatures: {},
        nextSignatures: layerSignatures,
        previousMergedLayerPayloads: {},
      });
      const mergedLayerPayloads = mergedResult.mergedLayerPayloads;
      loadState.layerSelectionSignatures = layerSignatures;
      loadState.mergedLayerPayloadCache = mergedLayerPayloads;
      applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, { renderNow: false });
      applyScenarioPoliticalChunkPayload(bundle, mergedLayerPayloads.political || null, {
        renderNow: false,
        reason: "coarse-prewarm",
      });
      return mergedLayerPayloads;
    }
    return null;
  }

  async function preloadScenarioFocusCountryPoliticalDetailChunk(
    bundle,
    {
      d3Client = globalThis.d3,
    } = {}
  ) {
    if (!scenarioSupportsChunkedRuntime(bundle?.manifest)) return null;
    await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
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
  } = {}) {
    const scenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    if (!scenarioId) return null;
    const bundle = getCachedScenarioBundle(scenarioId);
    if (!bundle || !scenarioBundleUsesChunkedLayer(bundle)) return null;
    const loadState = ensureRuntimeChunkLoadState();
    if (shouldDeferScenarioChunkRefreshFor()) {
      markPendingScenarioChunkRefresh(reason);
      if (loadState.selectionVersion <= 0 && !runtimeState.activeScenarioChunks?.loadedChunkIds?.length) {
        setScenarioChunkShellStatus("loading", loadState);
      }
      return null;
    }
    clearPendingScenarioChunkRefresh(loadState);
    await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
    const viewportBbox = typeof runtimeState.getViewportGeoBoundsFn === "function"
      ? runtimeState.getViewportGeoBoundsFn()
      : [-180, -90, 180, 90];
    const visibleLayers = getVisibleScenarioChunkLayers({
      includePoliticalCore: scenarioBundleUsesChunkedLayer(bundle, "political"),
      showWaterRegions: runtimeState.showWaterRegions !== false,
      showScenarioSpecialRegions: runtimeState.showScenarioSpecialRegions !== false,
      showScenarioReliefOverlays: runtimeState.showScenarioReliefOverlays !== false,
      showCityPoints: runtimeState.showCityPoints !== false,
    });
    const chunkState = ensureActiveScenarioChunkState();
    chunkState.scenarioId = scenarioId;
    setScenarioChunkShellStatus("loading", loadState);
    const focusCountry = resolveScenarioChunkFocusCountry(bundle, loadState);
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
        (chunk) => chunk.layer !== "political" && chunk.lod === "detail"
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
    });
    const nextRequiredChunkIds = selection.requiredChunks.map((chunk) => chunk.id);
    const nextOptionalChunkIds = selection.optionalChunks.map((chunk) => chunk.id);
    const selectionUnchanged =
      normalizeScenarioId(previousSelection?.scenarioId) === scenarioId
      && getChunkIdListSignature(previousSelection?.requiredChunkIds) === getChunkIdListSignature(nextRequiredChunkIds)
      && getChunkIdListSignature(previousSelection?.optionalChunkIds) === getChunkIdListSignature(nextOptionalChunkIds)
      && selection.evictableChunkIds.length === 0
      && nextRequiredChunkIds.every((chunkId) => !!chunkState.payloadByChunkId?.[chunkId]);
    const currentSelectionVersion = Math.max(0, Number(loadState.selectionVersion || 0));
    const nextSelectionVersion = selectionUnchanged ? currentSelectionVersion : currentSelectionVersion + 1;
    const selectionRecordedAt = Date.now();
    loadState.lastSelection = {
      reason: String(reason || "refresh"),
      scenarioId,
      viewportBbox,
      requiredChunkIds: nextRequiredChunkIds,
      optionalChunkIds: nextOptionalChunkIds,
      selectionVersion: nextSelectionVersion,
      focusCountry: String(focusCountry || "").trim().toUpperCase(),
      recordedAt: selectionRecordedAt,
      zoomEndProtectionUntil: normalizedReason === "zoom-end" ? selectionRecordedAt + 5000 : 0,
    };
    if (selectionUnchanged) {
      if (nextRequiredChunkIds.length || chunkState.loadedChunkIds.length) {
        setScenarioChunkShellStatus("ready", loadState);
      }
      if (String(reason || "").trim().toLowerCase() === "zoom-end" && Number(loadState.zoomEndChunkVisibleMetric?.startedAt || 0) > 0) {
        const endedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
        const durationMs = Math.max(0, endedAt - Number(loadState.zoomEndChunkVisibleMetric.startedAt || 0));
        loadState.lastZoomEndToChunkVisibleMetric = {
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
        };
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
        loadState.zoomEndChunkVisibleMetric = null;
      }
      clearPendingScenarioChunkRefresh();
      return selection;
    }
    loadState.selectionVersion = nextSelectionVersion;
    const chunkLoadStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    await Promise.all(selection.requiredChunks.map((chunk) => loadScenarioChunkPayload(bundle, chunk, { d3Client })));
    const chunkLoadEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioChunkRuntimeMetric("chunkLoadMs", chunkLoadEndedAt - chunkLoadStartedAt, {
      scenarioId,
      reason: String(reason || "refresh"),
      requiredChunkCount: selection.requiredChunks.length,
    });
    selection.requiredChunks.forEach((chunk) => {
      const payload = bundle.chunkPayloadCacheById?.[chunk.id];
      if (!payload) return;
      chunkState.payloadByChunkId[chunk.id] = payload;
      if (!chunkState.loadedChunkIds.includes(chunk.id)) {
        chunkState.loadedChunkIds.push(chunk.id);
      }
      touchScenarioChunkLru(chunk.id);
    });
    if (selection.evictableChunkIds.length) {
      selection.evictableChunkIds.forEach((chunkId) => {
        delete chunkState.payloadByChunkId[chunkId];
        chunkState.loadedChunkIds = chunkState.loadedChunkIds.filter((entry) => entry !== chunkId);
        chunkState.lruChunkIds = chunkState.lruChunkIds.filter((entry) => entry !== chunkId);
      });
      recordScenarioRenderMetric("chunkEvictionCount", selection.evictableChunkIds.length, {
        scenarioId,
        reason: String(reason || "refresh"),
      });
    }
    const previousLayerSignatures = loadState.layerSelectionSignatures || {};
    const nextLayerSignatures = buildScenarioChunkLayerSelectionSignatures(bundle);
    const chunkMergeStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const mergedResult = buildMergedScenarioChunkLayerPayloads(bundle, {
      previousSignatures: previousLayerSignatures,
      nextSignatures: nextLayerSignatures,
      previousMergedLayerPayloads: loadState.mergedLayerPayloadCache || chunkState.mergedLayerPayloads || {},
    });
    const chunkMergeEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioChunkRuntimeMetric("chunkMergeMs", chunkMergeEndedAt - chunkMergeStartedAt, {
      scenarioId,
      reason: String(reason || "refresh"),
      changedLayerCount: mergedResult.changedLayerKeys.length,
    });
    const mergedLayerPayloads = mergedResult.mergedLayerPayloads;
    loadState.layerSelectionSignatures = nextLayerSignatures;
    loadState.mergedLayerPayloadCache = mergedLayerPayloads;
    const politicalRequired = selection.requiredChunks.some((chunk) => chunk.layer === "political");
    const politicalChunkIdSet = getScenarioChunkIdSetByLayer(bundle, "political");
    const previousRequiredPoliticalChunkIds = (Array.isArray(previousSelection?.requiredChunkIds) ? previousSelection.requiredChunkIds : [])
      .filter((chunkId) => politicalChunkIdSet.has(String(chunkId || "").trim()));
    const nextRequiredPoliticalChunkIds = nextRequiredChunkIds
      .filter((chunkId) => politicalChunkIdSet.has(String(chunkId || "").trim()));
    const changedPoliticalChunkIds = Array.from(new Set([
      ...previousRequiredPoliticalChunkIds.filter((chunkId) => !nextRequiredPoliticalChunkIds.includes(chunkId)),
      ...nextRequiredPoliticalChunkIds.filter((chunkId) => !previousRequiredPoliticalChunkIds.includes(chunkId)),
    ]));
    const politicalFeatureIds = collectScenarioPoliticalFeatureIdsForChunkIds(bundle, changedPoliticalChunkIds);
    const hasMergedLayerChange = mergedResult.changedLayerKeys.length > 0;
    const hasPoliticalFeatureChange = politicalFeatureIds.length > 0;
    if (!hasMergedLayerChange && !hasPoliticalFeatureChange) {
      clearPendingScenarioChunkPromotion(loadState);
      clearPendingScenarioChunkRefresh(loadState);
      if (nextRequiredChunkIds.length || chunkState.loadedChunkIds.length) {
        setScenarioChunkShellStatus("ready", loadState);
      }
      return selection;
    }
    const promotionQueuedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    loadState.pendingVisualPromotion = {
      scenarioId,
      reason,
      selectionVersion: nextSelectionVersion,
      requiredChunkIds: nextRequiredChunkIds,
      queuedAt: promotionQueuedAt,
      renderNow,
    };
    loadState.pendingInfraPromotion = {
      scenarioId,
      reason,
      changedLayerKeys: mergedResult.changedLayerKeys,
      selectionVersion: nextSelectionVersion,
      queuedAt: promotionQueuedAt,
    };
    loadState.pendingPromotion = {
      scenarioId,
      reason,
      renderNow,
      mergedLayerPayloads,
      changedLayerKeys: mergedResult.changedLayerKeys,
      politicalRequired,
      requiredPoliticalChunkCount: selection.requiredChunks.filter((chunk) => chunk.layer === "political").length,
      requiredChunkIds: nextRequiredChunkIds,
      selectionVersion: nextSelectionVersion,
      politicalFeatureIds,
      queuedAt: promotionQueuedAt,
    };
    loadState.promotionRetryCount = 0;
    loadState.lastPromotionRetryAt = 0;
    setScenarioChunkShellStatus("loading", loadState);
    if (shouldDeferScenarioChunkRefreshFor()) {
      markPendingScenarioChunkRefresh(reason);
      return selection;
    }
    schedulePendingScenarioChunkPromotionCommit({
      delayMs: 0,
    });
    return selection;
  }

  function scheduleScenarioChunkRefresh({
    reason = "refresh",
    delayMs = null,
    flushPending = false,
    refreshSourceStartedAtMs = 0,
  } = {}) {
    const scenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
    if (!scenarioId) return "noop";
    const bundle = getCachedScenarioBundle(scenarioId);
    if (!bundle || !scenarioBundleUsesChunkedLayer(bundle)) return "noop";
    const loadState = ensureRuntimeChunkLoadState();
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
    if (shouldSkipStalePostApplyRefreshAfterZoomEnd(loadState, nextReason, {
      scenarioId,
      selectionVersion: loadState.selectionVersion,
      refreshSourceStartedAtMs,
      normalizeScenarioIdFn: normalizeScenarioId,
    })) {
      clearPendingScenarioChunkRefresh(loadState);
      return "stale-post-apply-after-zoom-end";
    }
    const zoomEndPriorityEnabled = shouldZoomEndPromoteImmediately(bundle, nextReason);
    if (zoomEndPriorityEnabled) {
      const hints = normalizeScenarioRenderBudgetHints(
        bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {}
      );
      loadState.zoomEndChunkVisibleMetric = {
        startedAt: globalThis.performance?.now ? globalThis.performance.now() : Date.now(),
        scenarioId,
        zoom: Number(runtimeState.zoomTransform?.k || 1),
        threshold: Number(hints.detail_zoom_threshold || 0),
        focusCountry: resolveScenarioChunkFocusCountry(bundle, loadState),
      };
    }
    if (loadState.refreshTimerId) {
      globalThis.clearTimeout(loadState.refreshTimerId);
      loadState.refreshTimerId = null;
      loadState.refreshScheduled = false;
    }
    if (loadState.promotionCommitInFlight && !flushPending) {
      loadState.pendingPostCommitRefresh = {
        reason: nextReason,
        delayMs: nextDelayMs,
        refreshSourceStartedAtMs,
        requestedAt: Date.now(),
      };
      return "promotion-commit-in-flight";
    }
    if (shouldDeferScenarioChunkRefreshFor()) {
      markPendingScenarioChunkRefresh(nextReason, nextDelayMs);
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
      return executeScenarioChunkRefreshNow({
        bundle,
        reason: nextReason,
        flushPending,
        allowRefreshStart: hadPendingReason,
      });
    }
    loadState.refreshScheduled = true;
    loadState.refreshTimerId = globalThis.setTimeout(() => {
      loadState.refreshTimerId = null;
      loadState.refreshScheduled = false;
      if (shouldDeferScenarioChunkRefreshFor()) {
        markPendingScenarioChunkRefresh(nextReason, nextDelayMs);
        return;
      }
      executeScenarioChunkRefreshNow({
        bundle,
        reason: nextReason,
        flushPending,
        allowRefreshStart: flushPending && hadPendingReason,
      });
    }, resolvedDelayMs);
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
    scheduleScenarioChunkRefresh,
  };
}

export {
  applyZoomEndChunkProtectionToSelection,
  createScenarioChunkRuntimeController,
  protectZoomEndChunksForSelection,
  shouldSkipStalePostApplyRefreshAfterZoomEnd,
};

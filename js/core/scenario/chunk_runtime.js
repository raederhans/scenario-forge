// Chunk runtime controller.
// 这个模块只负责 chunk runtime 的 state、selection、promotion、refresh/schedule。
// facade、startup cache、hydrate 主交易仍留在 scenario_resources.js。

import {
  createDefaultActiveScenarioChunksState,
  createDefaultRuntimeChunkLoadState,
} from "../state/scenario_runtime_state.js";

function createScenarioChunkRuntimeController({
  state,
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
    if (!state.runtimeChunkLoadState || typeof state.runtimeChunkLoadState !== "object") {
      state.runtimeChunkLoadState = createDefaultRuntimeChunkLoadState();
    }
    if (state.runtimeChunkLoadState.refreshTimerId && !isTimerHandle(state.runtimeChunkLoadState.refreshTimerId)) {
      state.runtimeChunkLoadState.refreshTimerId = null;
    }
    state.runtimeChunkLoadState.inFlightByChunkId =
      state.runtimeChunkLoadState.inFlightByChunkId && typeof state.runtimeChunkLoadState.inFlightByChunkId === "object"
        ? state.runtimeChunkLoadState.inFlightByChunkId
        : {};
    state.runtimeChunkLoadState.errorByChunkId =
      state.runtimeChunkLoadState.errorByChunkId && typeof state.runtimeChunkLoadState.errorByChunkId === "object"
        ? state.runtimeChunkLoadState.errorByChunkId
        : {};
    state.runtimeChunkLoadState.pendingReason =
      typeof state.runtimeChunkLoadState.pendingReason === "string"
        ? state.runtimeChunkLoadState.pendingReason
        : "";
    state.runtimeChunkLoadState.pendingDelayMs =
      Number.isFinite(Number(state.runtimeChunkLoadState.pendingDelayMs))
        ? Number(state.runtimeChunkLoadState.pendingDelayMs)
        : null;
    state.runtimeChunkLoadState.focusCountryOverride =
      typeof state.runtimeChunkLoadState.focusCountryOverride === "string"
        ? state.runtimeChunkLoadState.focusCountryOverride
        : "";
    state.runtimeChunkLoadState.zoomEndChunkVisibleMetric =
      state.runtimeChunkLoadState.zoomEndChunkVisibleMetric
      && typeof state.runtimeChunkLoadState.zoomEndChunkVisibleMetric === "object"
        ? state.runtimeChunkLoadState.zoomEndChunkVisibleMetric
        : null;
    state.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric =
      state.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric
      && typeof state.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric === "object"
        ? state.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric
        : null;
    state.runtimeChunkLoadState.selectionVersion = Math.max(
      0,
      Number(state.runtimeChunkLoadState.selectionVersion || 0),
    );
    state.runtimeChunkLoadState.pendingVisualPromotion =
      state.runtimeChunkLoadState.pendingVisualPromotion && typeof state.runtimeChunkLoadState.pendingVisualPromotion === "object"
        ? state.runtimeChunkLoadState.pendingVisualPromotion
        : null;
    state.runtimeChunkLoadState.pendingInfraPromotion =
      state.runtimeChunkLoadState.pendingInfraPromotion && typeof state.runtimeChunkLoadState.pendingInfraPromotion === "object"
        ? state.runtimeChunkLoadState.pendingInfraPromotion
        : null;
    if (state.runtimeChunkLoadState.promotionTimerId && !isTimerHandle(state.runtimeChunkLoadState.promotionTimerId)) {
      state.runtimeChunkLoadState.promotionTimerId = null;
    }
    state.runtimeChunkLoadState.promotionScheduled = state.runtimeChunkLoadState.promotionTimerId != null;
    state.runtimeChunkLoadState.promotionRetryCount = Math.max(
      0,
      Number(state.runtimeChunkLoadState.promotionRetryCount || 0),
    );
    state.runtimeChunkLoadState.lastPromotionRetryAt = Math.max(
      0,
      Number(state.runtimeChunkLoadState.lastPromotionRetryAt || 0),
    );
    state.runtimeChunkLoadState.pendingPromotion =
      state.runtimeChunkLoadState.pendingPromotion && typeof state.runtimeChunkLoadState.pendingPromotion === "object"
        ? state.runtimeChunkLoadState.pendingPromotion
        : null;
    state.runtimeChunkLoadState.layerSelectionSignatures =
      state.runtimeChunkLoadState.layerSelectionSignatures
      && typeof state.runtimeChunkLoadState.layerSelectionSignatures === "object"
        ? state.runtimeChunkLoadState.layerSelectionSignatures
        : {};
    state.runtimeChunkLoadState.mergedLayerPayloadCache =
      state.runtimeChunkLoadState.mergedLayerPayloadCache
      && typeof state.runtimeChunkLoadState.mergedLayerPayloadCache === "object"
        ? state.runtimeChunkLoadState.mergedLayerPayloadCache
        : {};
    return state.runtimeChunkLoadState;
  }

  function clearPendingScenarioChunkRefresh(loadState = ensureRuntimeChunkLoadState()) {
    loadState.pendingReason = "";
    loadState.pendingDelayMs = null;
  }

  function getChunkIdListSignature(chunkIds = []) {
    return (Array.isArray(chunkIds) ? chunkIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("|");
  }

  function markPendingScenarioChunkRefresh(reason = "refresh", delayMs = null) {
    const loadState = ensureRuntimeChunkLoadState();
    loadState.pendingReason = String(reason || "refresh").trim() || "refresh";
    loadState.pendingDelayMs = Number.isFinite(Number(delayMs)) ? Number(delayMs) : null;
    return loadState;
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
    const zoom = Number(state.zoomTransform?.k || 1);
    return Number.isFinite(zoom) && zoom >= Number(hints.detail_zoom_threshold || 0);
  }

  function shouldDeferScenarioChunkRefreshFor() {
    return !!(
      state.bootBlocking
      || state.scenarioApplyInFlight
      || state.startupReadonly
      || state.startupReadonlyUnlockInFlight
      || state.isInteracting
      || String(state.renderPhase || "idle") !== "idle"
    );
  }

  function shouldDeferScenarioChunkRefresh() {
    return shouldDeferScenarioChunkRefreshFor();
  }

  function resolveScenarioChunkFocusCountry(bundle, loadState = ensureRuntimeChunkLoadState()) {
    const rawFocusCountry = String(
      state.activeSovereignCode
      || state.selectedInspectorCountryCode
      || loadState.focusCountryOverride
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
      commitPendingScenarioChunkPromotion();
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
      return "promotion-scheduled";
    }
    if (loadState.pendingPromotion && !loadState.promotionScheduled) {
      const delayMs = Number.isFinite(Number(loadState.pendingDelayMs))
        ? Math.max(0, Number(loadState.pendingDelayMs))
        : 0;
      schedulePendingScenarioChunkPromotionCommit({ delayMs });
      if (loadState.pendingPromotion && loadState.promotionScheduled) {
        return "promotion-scheduled";
      }
    }
    if (loadState.pendingPromotion && commitPendingScenarioChunkPromotion({
      bundle,
      pendingPromotion: loadState.pendingPromotion,
    })) {
      return "promotion-committed";
    }
    if (!flushPending || !hasPendingReason) {
      return "noop";
    }
    void refreshActiveScenarioChunks({
      reason,
      renderNow: true,
      d3Client,
    }).catch((error) => {
      const scenarioId = normalizeScenarioId(state.activeScenarioId);
      console.warn(`[scenario] Failed to refresh active scenario chunks for "${scenarioId}".`, error);
    });
    return "refresh-started";
  }

  function recordScenarioRenderMetric(name, durationMs, details = {}) {
    if (!state.renderPerfMetrics || typeof state.renderPerfMetrics !== "object") {
      state.renderPerfMetrics = {};
    }
    state.renderPerfMetrics[String(name || "").trim()] = {
      durationMs: Math.max(0, Number(durationMs) || 0),
      recordedAt: Date.now(),
      ...details,
    };
    globalThis.__renderPerfMetrics = state.renderPerfMetrics;
  }

  function shouldRecordScenarioChunkRuntimeMetric() {
    const developerMode = !!state?.uiState?.developerMode;
    const perfOverlayEnabled = !!state?.renderDiagnostics?.perfOverlayEnabled;
    const params = getSearchParams();
    const runtimePerfFlag = String(params?.get("runtime_chunk_perf") || "").trim().toLowerCase();
    return developerMode || perfOverlayEnabled || ["1", "true", "yes", "on"].includes(runtimePerfFlag);
  }

  function recordScenarioChunkRuntimeMetric(name, durationMs, details = {}) {
    if (!shouldRecordScenarioChunkRuntimeMetric()) return;
    recordScenarioRenderMetric(name, durationMs, details);
  }

  function ensureActiveScenarioChunkState() {
    if (!state.activeScenarioChunks || typeof state.activeScenarioChunks !== "object") {
      state.activeScenarioChunks = createDefaultActiveScenarioChunksState();
    }
    state.activeScenarioChunks.loadedChunkIds = Array.isArray(state.activeScenarioChunks.loadedChunkIds)
      ? state.activeScenarioChunks.loadedChunkIds
      : [];
    state.activeScenarioChunks.payloadByChunkId =
      state.activeScenarioChunks.payloadByChunkId && typeof state.activeScenarioChunks.payloadByChunkId === "object"
        ? state.activeScenarioChunks.payloadByChunkId
        : {};
    state.activeScenarioChunks.mergedLayerPayloads =
      state.activeScenarioChunks.mergedLayerPayloads && typeof state.activeScenarioChunks.mergedLayerPayloads === "object"
        ? state.activeScenarioChunks.mergedLayerPayloads
        : {};
    state.activeScenarioChunks.lruChunkIds = Array.isArray(state.activeScenarioChunks.lruChunkIds)
      ? state.activeScenarioChunks.lruChunkIds
      : [];
    return state.activeScenarioChunks;
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
    const activeScenarioId = normalizeScenarioId(state.activeScenarioId);
    const chunkScenarioId = normalizeScenarioId(state.activeScenarioChunks?.scenarioId);
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
    state.activeScenarioChunks = createDefaultActiveScenarioChunksState(normalizedScenarioId);
    state.runtimeChunkLoadState = createDefaultRuntimeChunkLoadState({
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
      const currentPayload = state[config.stateField] || null;
      if (nextPayload === currentPayload) return;
      if (config.stateField === "scenarioCityOverridesData") {
        syncScenarioLocalizationState({ cityOverridesPayload: nextPayload });
        changed = true;
        changedLayerKeys.push(layerKey);
        return;
      }
      state[config.stateField] = nextPayload;
      if (config.revisionField) {
        state[config.revisionField] = (Number(state[config.revisionField]) || 0) + 1;
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
    const previousFeatureIds = getScenarioFeatureCollectionIdentityList(state.scenarioPoliticalChunkData);
    const nextFeatureIds = getScenarioFeatureCollectionIdentityList(normalizedPayload);
    const samePayload = areScenarioFeatureCollectionsEquivalent(
      state.scenarioPoliticalChunkData,
      normalizedPayload
    );
    if (samePayload) {
      return false;
    }
    state.scenarioPoliticalChunkData = normalizedPayload || null;
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

  function applyPendingScenarioChunkPromotion(bundle, pendingPromotion, loadState = ensureRuntimeChunkLoadState()) {
    if (!pendingPromotion || typeof pendingPromotion !== "object") {
      return false;
    }
    const pendingSelectionVersion = Math.max(0, Number(pendingPromotion.selectionVersion || 0));
    const currentSelectionVersion = Math.max(0, Number(loadState.selectionVersion || 0));
    if (pendingSelectionVersion > 0 && currentSelectionVersion > 0 && pendingSelectionVersion !== currentSelectionVersion) {
      if (loadState.pendingPromotion === pendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      return false;
    }
    const scenarioId = normalizeScenarioId(pendingPromotion.scenarioId || state.activeScenarioId);
    if (!scenarioId || scenarioId !== normalizeScenarioId(state.activeScenarioId)) {
      if (loadState.pendingPromotion === pendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      return false;
    }
    const mergedLayerPayloads =
      pendingPromotion.mergedLayerPayloads && typeof pendingPromotion.mergedLayerPayloads === "object"
        ? pendingPromotion.mergedLayerPayloads
        : {};
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
    const infraStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const mergedLayerResult = applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, {
      renderNow: false,
    });
    const infraEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioChunkRuntimeMetric("chunkPromotionInfraMs", infraEndedAt - infraStartedAt, {
      scenarioId,
      reason: String(pendingPromotion.reason || "refresh"),
      changedLayerCount: mergedLayerResult?.changedLayerKeys?.length || 0,
    });
    const visualStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const politicalPayloadChanged = applyScenarioPoliticalChunkPayload(bundle, mergedLayerPayloads.political || null, {
      renderNow: false,
      reason: pendingPromotion.reason,
      changedLayerKeys: mergedLayerResult?.changedLayerKeys || [],
      politicalFeatureIds: pendingPromotion.politicalFeatureIds || [],
    });
    if (pendingPromotion.renderNow !== false) {
      flushRenderBoundary("scenario-chunk-promotion");
    }
    const visualEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioChunkRuntimeMetric("chunkPromotionVisualMs", visualEndedAt - visualStartedAt, {
      scenarioId,
      reason: String(pendingPromotion.reason || "refresh"),
      politicalFeatureCount: Array.isArray(pendingPromotion.politicalFeatureIds) ? pendingPromotion.politicalFeatureIds.length : 0,
      politicalPayloadChanged,
      renderNow: pendingPromotion.renderNow !== false,
    });
    recordScenarioRenderMetric(
      "chunkPromotionMs",
      visualEndedAt - promotionStartedAt,
      {
        scenarioId,
        reason: String(pendingPromotion.reason || "refresh"),
        loadedChunkCount: Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
          ? state.activeScenarioChunks.loadedChunkIds.length
          : 0,
      }
    );
    if (
      pendingPromotion.politicalRequired
      && Array.isArray(mergedLayerPayloads?.political?.features)
      && !bundle?.chunkLifecycle?.politicalCoreReadyRecorded
    ) {
      const applyStartedAt = Number(bundle?.chunkLifecycle?.applyStartedAt || 0);
      if (applyStartedAt > 0) {
        recordScenarioPerfMetric(
          "timeToPoliticalCoreReady",
          (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt,
          {
            scenarioId,
            promotedPoliticalFeatureCount: mergedLayerPayloads.political.features.length,
            requiredPoliticalChunkCount: Number(pendingPromotion.requiredPoliticalChunkCount || 0),
          }
        );
      }
      if (bundle?.chunkLifecycle) {
        bundle.chunkLifecycle.politicalCoreReadyRecorded = true;
      }
    }
    if (String(pendingPromotion.reason || "").trim().toLowerCase() === "zoom-end") {
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
        };
        recordScenarioChunkRuntimeMetric("zoomEndToChunkVisibleMs", durationMs, {
          scenarioId,
          zoom: Number(loadState.zoomEndChunkVisibleMetric?.zoom || 0),
          threshold: Number(loadState.zoomEndChunkVisibleMetric?.threshold || 0),
          focusCountry: String(loadState.zoomEndChunkVisibleMetric?.focusCountry || ""),
          requiredPoliticalChunkCount: Number(pendingPromotion.requiredPoliticalChunkCount || 0),
        });
      }
      loadState.zoomEndChunkVisibleMetric = null;
    }
    clearPendingScenarioChunkPromotion(loadState);
    clearPendingScenarioChunkRefresh(loadState);
    return true;
  }

  function commitPendingScenarioChunkPromotion({
    bundle = null,
    pendingPromotion = null,
    renderNow = null,
  } = {}) {
    const loadState = ensureRuntimeChunkLoadState();
    const resolvedPendingPromotion = pendingPromotion || loadState.pendingPromotion;
    if (!resolvedPendingPromotion || typeof resolvedPendingPromotion !== "object") {
      return false;
    }
    const scenarioId = normalizeScenarioId(state.activeScenarioId);
    if (!scenarioId || scenarioId !== normalizeScenarioId(resolvedPendingPromotion.scenarioId)) {
      if (loadState.pendingPromotion === resolvedPendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      return false;
    }
    const resolvedBundle = bundle || getCachedScenarioBundle(scenarioId);
    if (!resolvedBundle) {
      if (loadState.pendingPromotion === resolvedPendingPromotion) {
        clearPendingScenarioChunkPromotion(loadState);
      }
      return false;
    }
    if (shouldDeferScenarioChunkRefresh()) {
      const hasExplicitPendingDelayMs =
        loadState.pendingDelayMs != null && Number.isFinite(Number(loadState.pendingDelayMs));
      const retryDelayMs = Math.max(
        0,
        hasExplicitPendingDelayMs
          ? Number(loadState.pendingDelayMs)
          : (state.isInteracting ? refreshDelayInteracting : refreshDelayIdle),
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
      return false;
    }
    return applyPendingScenarioChunkPromotion(
      resolvedBundle,
      {
        ...resolvedPendingPromotion,
        renderNow: renderNow == null ? resolvedPendingPromotion.renderNow : renderNow,
      },
      loadState,
    );
  }

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
      showCityPoints: state.showCityPoints !== false,
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
    if (bundleScenarioId && bundleScenarioId === normalizeScenarioId(state.activeScenarioId)) {
      const chunkState = ensureActiveScenarioChunkState();
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
      const loadState = ensureRuntimeChunkLoadState();
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
    const scenarioId = normalizeScenarioId(state.activeScenarioId);
    if (!scenarioId) return null;
    const bundle = getCachedScenarioBundle(scenarioId);
    if (!bundle || !scenarioBundleUsesChunkedLayer(bundle)) return null;
    if (shouldDeferScenarioChunkRefreshFor()) {
      markPendingScenarioChunkRefresh(reason);
      return null;
    }
    clearPendingScenarioChunkRefresh();
    await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
    const viewportBbox = typeof state.getViewportGeoBoundsFn === "function"
      ? state.getViewportGeoBoundsFn()
      : [-180, -90, 180, 90];
    const visibleLayers = getVisibleScenarioChunkLayers({
      includePoliticalCore: scenarioBundleUsesChunkedLayer(bundle, "political"),
      showWaterRegions: state.showWaterRegions !== false,
      showScenarioSpecialRegions: state.showScenarioSpecialRegions !== false,
      showScenarioReliefOverlays: state.showScenarioReliefOverlays !== false,
      showCityPoints: state.showCityPoints !== false,
    });
    const chunkState = ensureActiveScenarioChunkState();
    chunkState.scenarioId = scenarioId;
    const loadState = ensureRuntimeChunkLoadState();
    const focusCountry = resolveScenarioChunkFocusCountry(bundle, loadState);
    const selectionStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const selection = selectScenarioChunks({
      scenarioId,
      chunkRegistry: bundle.chunkRegistry,
      contextLodManifest: bundle.contextLodManifest,
      zoom: Number(state.zoomTransform?.k || 1),
      viewportBbox,
      focusCountry,
      renderBudgetHints: bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {},
      visibleLayers,
      loadedChunkIds: chunkState.loadedChunkIds,
    });
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
      const politicalRequired = selection.requiredChunks.filter((chunk) => chunk.layer === "political");
      if (politicalRequired.length > 1) {
        const focusMatchedPoliticalRequired = politicalRequired.filter((chunk) => chunk.countryCodes.includes(focusCountry));
        const retainedPoliticalRequired = focusMatchedPoliticalRequired.length
          ? focusMatchedPoliticalRequired.slice(0, 1)
          : politicalRequired.slice(0, 1);
        const retainedPoliticalIdSet = new Set(retainedPoliticalRequired.map((chunk) => chunk.id));
        const demotedPoliticalOptional = politicalRequired.filter((chunk) => !retainedPoliticalIdSet.has(chunk.id));
        selection.requiredChunks = [
          ...selection.requiredChunks.filter((chunk) => chunk.layer !== "political"),
          ...retainedPoliticalRequired,
        ];
        selection.optionalChunks = [
          ...demotedPoliticalOptional,
          ...selection.optionalChunks,
        ].filter((chunk, index, array) => array.findIndex((candidate) => candidate.id === chunk.id) === index);
      }
    }
    const selectionEndedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    recordScenarioChunkRuntimeMetric("chunkSelectionMs", selectionEndedAt - selectionStartedAt, {
      scenarioId,
      reason: String(reason || "refresh"),
    });
    const previousSelection = loadState.lastSelection;
    const nextRequiredChunkIds = selection.requiredChunks.map((chunk) => chunk.id);
    const nextOptionalChunkIds = selection.optionalChunks.map((chunk) => chunk.id);
    const selectionUnchanged =
      normalizeScenarioId(previousSelection?.scenarioId) === scenarioId
      && getChunkIdListSignature(previousSelection?.requiredChunkIds) === getChunkIdListSignature(nextRequiredChunkIds)
      && getChunkIdListSignature(previousSelection?.optionalChunkIds) === getChunkIdListSignature(nextOptionalChunkIds)
      && selection.evictableChunkIds.length === 0
      && nextRequiredChunkIds.every((chunkId) => !!chunkState.payloadByChunkId?.[chunkId]);
    loadState.lastSelection = {
      reason: String(reason || "refresh"),
      scenarioId,
      viewportBbox,
      requiredChunkIds: nextRequiredChunkIds,
      optionalChunkIds: nextOptionalChunkIds,
    };
    if (selectionUnchanged) {
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
        };
        recordScenarioChunkRuntimeMetric("zoomEndToChunkVisibleMs", durationMs, {
          scenarioId,
          zoom: Number(loadState.zoomEndChunkVisibleMetric.zoom || 0),
          threshold: Number(loadState.zoomEndChunkVisibleMetric.threshold || 0),
          focusCountry: String(loadState.zoomEndChunkVisibleMetric.focusCountry || ""),
          requiredPoliticalChunkCount: selection.requiredChunks.filter((chunk) => chunk.layer === "political").length,
        });
        loadState.zoomEndChunkVisibleMetric = null;
      }
      clearPendingScenarioChunkRefresh();
      return selection;
    }
    const nextSelectionVersion = Math.max(0, Number(loadState.selectionVersion || 0)) + 1;
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
      selectionVersion: nextSelectionVersion,
      politicalFeatureIds,
      queuedAt: promotionQueuedAt,
    };
    loadState.promotionRetryCount = 0;
    loadState.lastPromotionRetryAt = 0;
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
  } = {}) {
    const scenarioId = normalizeScenarioId(state.activeScenarioId);
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
    const zoomEndPriorityEnabled = shouldZoomEndPromoteImmediately(bundle, nextReason);
    if (zoomEndPriorityEnabled) {
      const hints = normalizeScenarioRenderBudgetHints(
        bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {}
      );
      loadState.zoomEndChunkVisibleMetric = {
        startedAt: globalThis.performance?.now ? globalThis.performance.now() : Date.now(),
        scenarioId,
        zoom: Number(state.zoomTransform?.k || 1),
        threshold: Number(hints.detail_zoom_threshold || 0),
        focusCountry: resolveScenarioChunkFocusCountry(bundle, loadState),
      };
    }
    if (loadState.refreshTimerId) {
      globalThis.clearTimeout(loadState.refreshTimerId);
      loadState.refreshTimerId = null;
      loadState.refreshScheduled = false;
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
    if (flushPending && resolvedDelayMs <= 0) {
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
  createScenarioChunkRuntimeController,
};

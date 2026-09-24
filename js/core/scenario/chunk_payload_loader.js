import { pageResourceBudget } from "../runtime_resource_budget.js";
import { createChunkLoadScheduler, estimateChunkLoadBytes } from "./chunk_load_scheduler.js";
import {
  beginScenarioChunkLoadState,
  completeScenarioChunkLoadState,
  ensureScenarioChunkRuntimeState,
  failScenarioChunkLoadState,
  finishScenarioChunkLoadState,
} from "../state/actions/scenario_chunk_runtime_actions.js";
import { recordScenarioChunkPayloadSourceBytes, touchScenarioChunkPayloadCache, trimScenarioChunkPayloadCache } from "./bundle_cache.js";
import { getScenarioChunkPayloadEvictionIds, getScenarioChunkPayloadRetentionStats } from "./bundle_cache_policy.js";
import {
  clearScenarioBundleChunkProtectionState,
  removeScenarioBundleChunkPayloadState,
} from "../state/actions/scenario_activation_actions.js";

function ensureScenarioChunkPayloadCache(bundle) {
  if (!bundle || typeof bundle !== "object") return {};
  bundle.chunkPayloadCacheById = bundle.chunkPayloadCacheById && typeof bundle.chunkPayloadCacheById === "object"
    ? bundle.chunkPayloadCacheById : {};
  return bundle.chunkPayloadCacheById;
}

function ensureScenarioChunkPromiseCache(bundle) {
  if (!bundle || typeof bundle !== "object") return {};
  bundle.chunkPayloadPromisesById = bundle.chunkPayloadPromisesById && typeof bundle.chunkPayloadPromisesById === "object"
    ? bundle.chunkPayloadPromisesById : {};
  return bundle.chunkPayloadPromisesById;
}

// Owns bundle caches and in-flight requests; selection and promotion stay in the controller.
export function createScenarioChunkPayloadLoader({ runtimeState, normalizeScenarioId, getScenarioBundleId, loadScenarioChunkFile, loadScheduler = null, onLoadMetric = () => {}, resourceBudget = pageResourceBudget }) {
  const chunkRequestsByRequest = new Map();
  const scheduler = loadScheduler || createChunkLoadScheduler({ onMetric: onLoadMetric, resourceBudget });
  const cacheResourceOwner = Symbol("scenario-chunk-payloads");
  let pressureEvictions = 0;
  let activeRequestScenarioId = normalizeScenarioId(String(runtimeState.activeScenarioChunks?.scenarioId || runtimeState.activeScenarioId || ""));

  function ownedBundles(extraBundle = null) {
    return [...new Set([
      ...Object.values(runtimeState.scenarioBundleCacheById || {}),
      ...[...chunkRequestsByRequest.values()].map((entry) => entry.bundle),
      ...(extraBundle ? [extraBundle] : []),
    ])];
  }

  function refreshResourceAccounting(extraBundle = null) {
    const stats = getScenarioChunkPayloadRetentionStats(ownedBundles(extraBundle));
    if (stats.payloadCount) resourceBudget.update(cacheResourceOwner, {
      mainChunkPayload: stats.unknownPayloads ? null : stats.knownSourceBytes,
    });
    else resourceBudget.release(cacheResourceOwner);
    return stats;
  }

  function activePayloadIds(bundle) {
    return getScenarioBundleId(bundle) === activeRequestScenarioId
      && getScenarioBundleId(bundle) === normalizeScenarioId(String(runtimeState.activeScenarioChunks?.scenarioId || ""))
      ? Object.keys(runtimeState.activeScenarioChunks?.payloadByChunkId || {}) : [];
  }

  function releaseInactivePayloadsUnderPressure(extraBundle = null, extraProtectedIds = []) {
    refreshResourceAccounting(extraBundle);
    if (!resourceBudget.snapshot().pressure) return;
    // Only this cache owner's references are removed. Active renderer geometry,
    // returned snapshots, required selection pins and in-flight loads survive.
    for (const bundle of ownedBundles(extraBundle)) {
      const protectedIds = [...activePayloadIds(bundle), ...(bundle === extraBundle ? extraProtectedIds : [])];
      for (const id of getScenarioChunkPayloadEvictionIds(bundle, protectedIds, { pressure: true })) {
        delete bundle.chunkPayloadCacheById[id];
        pressureEvictions++;
      }
    }
    refreshResourceAccounting(extraBundle);
  }

  async function loadScenarioChunkPayloadEntries(bundle, chunks, options) {
    // Persist the latest selection through prewarm -> apply and load -> promotion.
    // Older concurrent callers own their returned entries and cannot lose them
    // when a newer selection replaces these pins.
    bundle.chunkPayloadProtectedIds = chunks.map((chunk) => String(chunk.id));
    const selected = new Set(bundle.chunkPayloadProtectedIds);
    for (const [request, entry] of chunkRequestsByRequest) {
      if (entry.bundle === bundle) scheduler.reprioritize(request, selected.has(entry.chunkId) ? 1 : -1);
    }
    trimScenarioChunkPayloadCache(bundle, activePayloadIds(bundle));
    releaseInactivePayloadsUnderPressure(bundle, [...selected]);
    return Promise.all(chunks.map(async (chunk) => ({
      chunkId: chunk.id,
      payload: await loadScenarioChunkPayload(bundle, chunk, { priority: 1, ...options }),
    })));
  }

  function resetScenarioChunkRequests(scenarioId) {
    const outgoingScenarioId = String(activeRequestScenarioId
      || normalizeScenarioId(String(runtimeState.activeScenarioChunks?.scenarioId || "")));
    if (outgoingScenarioId && outgoingScenarioId !== scenarioId) {
      const outgoingBundle = runtimeState.scenarioBundleCacheById?.[outgoingScenarioId];
      if (outgoingBundle) {
        clearScenarioBundleChunkProtectionState(runtimeState, outgoingScenarioId);
        for (const chunkId of getScenarioChunkPayloadEvictionIds(outgoingBundle)) {
          removeScenarioBundleChunkPayloadState(runtimeState, outgoingScenarioId, chunkId);
        }
      }
      // The active ID may already be incoming; track every replaced outgoing bundle.
      for (const [request, { bundle, chunkId }] of chunkRequestsByRequest) {
        if (getScenarioBundleId(bundle) !== outgoingScenarioId) continue;
        chunkRequestsByRequest.delete(request);
        const promiseCache = ensureScenarioChunkPromiseCache(bundle);
        if (promiseCache[chunkId] === request.promise) delete promiseCache[chunkId];
        request.controller.abort();
      }
    }
    activeRequestScenarioId = scenarioId;
    releaseInactivePayloadsUnderPressure();
  }

  async function loadScenarioChunkPayload(bundle, chunkMeta, { d3Client = globalThis.d3, priority = 0, speculative = false } = {}) {
    const chunkId = String(chunkMeta?.id || "").trim();
    if (!bundle || !chunkId) return null;
    releaseInactivePayloadsUnderPressure(bundle, [chunkId]);
    const payloadCache = ensureScenarioChunkPayloadCache(bundle);
    if (payloadCache[chunkId]) {
      const payload = payloadCache[chunkId];
      recordScenarioChunkPayloadSourceBytes(payload, chunkMeta);
      touchScenarioChunkPayloadCache(bundle, chunkId, activePayloadIds(bundle));
      refreshResourceAccounting(bundle);
      return payload;
    }
    const promiseCache = ensureScenarioChunkPromiseCache(bundle);
    ensureScenarioChunkRuntimeState(runtimeState);
    if (!activeRequestScenarioId) activeRequestScenarioId = normalizeScenarioId(String(runtimeState.activeScenarioId || ""));
    const generation = Math.max(0, Number(runtimeState.runtimeChunkLoadState?.generation || 0));
    beginScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration: generation });
    if (promiseCache[chunkId]) {
      for (const [request, entry] of chunkRequestsByRequest) {
        // Joining a visible request from speculative prewarm must not demote it.
        // Only a new selection above may explicitly lower obsolete priorities.
        if (entry.bundle === bundle && entry.chunkId === chunkId) scheduler.promote(request, priority);
      }
      try {
        const payload = await promiseCache[chunkId];
        completeScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration: generation });
        return payload;
      } catch (error) {
        failScenarioChunkLoadState(runtimeState, chunkId,
          String(error?.message || error || "Unknown chunk load error."),
          { expectedLoadStateGeneration: generation });
        throw error;
      } finally {
        finishScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration: generation });
      }
    }
    const request = { controller: new AbortController(), promise: null };
    chunkRequestsByRequest.set(request, { bundle, chunkId });
    let loadStarted = false;
    // Keep cache publication and generation settlement in the fetch continuation,
    // inside admission; the scheduler must not add an observer-visible gap.
    const loadPromise = scheduler.schedule(async () => {
      loadStarted = true;
      try {
        const result = await loadScenarioChunkFile(chunkMeta.url, {
          d3Client,
          scenarioId: getScenarioBundleId(bundle),
          resourceLabel: `chunk:${chunkMeta.layer}:${chunkId}`,
          signal: request.controller.signal,
        });
        request.controller.signal.throwIfAborted();
        const payload = { layerKey: chunkMeta.layer, payload: result?.payload || null };
        recordScenarioChunkPayloadSourceBytes(payload, chunkMeta);
        payloadCache[chunkId] = payload;
        completeScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration: generation });
        return payload;
      } catch (error) {
        failScenarioChunkLoadState(runtimeState, chunkId,
          String(error?.message || error || "Unknown chunk load error."),
          { expectedLoadStateGeneration: generation });
        throw error;
      } finally {
        finishScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration: generation });
      }
    }, { key: request, bytes: estimateChunkLoadBytes(chunkMeta), priority, speculative,
      signal: request.controller.signal }).catch((error) => {
      // Queued cancellation never enters the operation's try/finally.
      if (!loadStarted) {
        failScenarioChunkLoadState(runtimeState, chunkId,
          String(error?.message || error || "Unknown chunk load error."),
          { expectedLoadStateGeneration: generation });
        finishScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration: generation });
      }
      throw error;
    });
    request.promise = loadPromise;
    promiseCache[chunkId] = loadPromise;
    const clearCachedLoadPromise = () => {
      if (promiseCache[chunkId] === loadPromise) delete promiseCache[chunkId];
      chunkRequestsByRequest.delete(request);
      if (payloadCache[chunkId]) touchScenarioChunkPayloadCache(bundle, chunkId, activePayloadIds(bundle));
      refreshResourceAccounting();
    };
    void loadPromise.then(clearCachedLoadPromise, clearCachedLoadPromise);
    return loadPromise;
  }

  const getLoadSchedulerStats = () => {
    const payloadRetention = refreshResourceAccounting();
    return { ...scheduler.getStats(), payloadRetention, pressureEvictions };
  };
  return Object.freeze({ loadScenarioChunkPayload, loadScenarioChunkPayloadEntries, resetScenarioChunkRequests, getLoadSchedulerStats });
}

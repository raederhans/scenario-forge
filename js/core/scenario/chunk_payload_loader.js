import {
  beginScenarioChunkLoadState,
  completeScenarioChunkLoadState,
  ensureScenarioChunkRuntimeState,
  failScenarioChunkLoadState,
  finishScenarioChunkLoadState,
} from "../state/actions/scenario_chunk_runtime_actions.js";

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
export function createScenarioChunkPayloadLoader({ runtimeState, normalizeScenarioId, getScenarioBundleId, loadScenarioChunkFile }) {
  const chunkRequestsByRequest = new Map();
  let activeRequestScenarioId = normalizeScenarioId(String(runtimeState.activeScenarioChunks?.scenarioId || runtimeState.activeScenarioId || ""));

  function resetScenarioChunkRequests(scenarioId) {
    const outgoingScenarioId = activeRequestScenarioId
      || normalizeScenarioId(String(runtimeState.activeScenarioChunks?.scenarioId || ""));
    if (outgoingScenarioId && outgoingScenarioId !== scenarioId) {
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
  }

  function beginObservedLoad(chunkId, expectedLoadStateGeneration) {
    beginScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration });
    return {
      complete(payload) {
        completeScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration });
        return payload;
      },
      fail(error) {
        failScenarioChunkLoadState(runtimeState, chunkId,
          String(error?.message || error || "Unknown chunk load error."),
          { expectedLoadStateGeneration });
        throw error;
      },
      finish() {
        finishScenarioChunkLoadState(runtimeState, chunkId, { expectedLoadStateGeneration });
      },
    };
  }

  async function loadScenarioChunkPayload(bundle, chunkMeta, { d3Client = globalThis.d3 } = {}) {
    const chunkId = String(chunkMeta?.id || "").trim();
    if (!bundle || !chunkId) return null;
    const payloadCache = ensureScenarioChunkPayloadCache(bundle);
    if (payloadCache[chunkId]) return payloadCache[chunkId];
    const promiseCache = ensureScenarioChunkPromiseCache(bundle);
    ensureScenarioChunkRuntimeState(runtimeState);
    if (!activeRequestScenarioId) activeRequestScenarioId = normalizeScenarioId(String(runtimeState.activeScenarioId || ""));
    const generation = Math.max(0, Number(runtimeState.runtimeChunkLoadState?.generation || 0));
    const observer = beginObservedLoad(chunkId, generation);
    if (promiseCache[chunkId]) {
      return promiseCache[chunkId].then(observer.complete, observer.fail).finally(observer.finish);
    }
    const request = { controller: new AbortController(), promise: null };
    chunkRequestsByRequest.set(request, { bundle, chunkId });
    const loadPromise = (async () => {
      try {
        const result = await loadScenarioChunkFile(chunkMeta.url, {
          d3Client,
          scenarioId: getScenarioBundleId(bundle),
          resourceLabel: `chunk:${chunkMeta.layer}:${chunkId}`,
          signal: request.controller.signal,
        });
        request.controller.signal.throwIfAborted();
        const payload = { layerKey: chunkMeta.layer, payload: result?.payload || null };
        payloadCache[chunkId] = payload;
        return observer.complete(payload);
      } catch (error) {
        return observer.fail(error);
      } finally {
        observer.finish();
      }
    })();
    request.promise = loadPromise;
    promiseCache[chunkId] = loadPromise;
    const clearCachedLoadPromise = () => {
      if (promiseCache[chunkId] === loadPromise) delete promiseCache[chunkId];
      chunkRequestsByRequest.delete(request);
    };
    void loadPromise.then(clearCachedLoadPromise, clearCachedLoadPromise);
    return loadPromise;
  }

  return Object.freeze({ loadScenarioChunkPayload, resetScenarioChunkRequests });
}

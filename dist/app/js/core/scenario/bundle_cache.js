export const SCENARIO_BUNDLE_CACHE_LIMIT = 3;
export const SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT = 32;
// Manifest source bytes are a cheap retention weight, not a JS heap estimate.
// Required/active/in-flight payloads may exceed both targets until released.
export const SCENARIO_CHUNK_PAYLOAD_CACHE_BYTE_LIMIT = 64 * 1024 * 1024;
const sourceBytesByPayloadEntry = new WeakMap();

export function recordScenarioChunkPayloadSourceBytes(entry, chunkMeta) {
  if (!entry || typeof entry !== "object") return;
  const bytes = Number(chunkMeta?.byteSize ?? chunkMeta?.byte_size);
  if (Number.isFinite(bytes) && bytes > 0) sourceBytesByPayloadEntry.set(entry, Math.ceil(bytes));
}

export function trimScenarioBundleCache(state, recency, targetId) {
  const cache = state.scenarioBundleCacheById || {};
  let cacheSize = Object.keys(cache).length;
  for (const id of recency.keys()) if (!cache[id]) recency.delete(id);
  for (const id of Object.keys(cache)) if (!recency.has(id)) recency.set(id, true);
  recency.delete(targetId);
  recency.set(targetId, true);
  // An apply can still need the outgoing bundle for rollback. Defer trimming
  // until a subsequent load/cache hit outside that transaction.
  if (state.scenarioApplyInFlight) return;
  for (const id of recency.keys()) {
    const bundle = cache[id];
    if (id === targetId || id === String(state.activeScenarioId || "").trim()) continue;
    if ((bundle?.deferredMetadataLoadPromise && !bundle.deferredMetadataLoadSettled)
      || Object.values(bundle?.optionalLayerPromises || {}).some(Boolean)
      || Object.values(bundle?.chunkPayloadPromisesById || {}).some(Boolean)) continue;
    if (!bundle) continue;
    bundle.chunkPayloadProtectedIds = [];
    trimScenarioChunkPayloadCache(bundle);
    if (cacheSize <= SCENARIO_BUNDLE_CACHE_LIMIT) continue;
    delete cache[id];
    cacheSize -= 1;
    recency.delete(id);
  }
}

export function trimScenarioChunkPayloadCache(bundle, protectedIds = []) {
  const cache = bundle.chunkPayloadCacheById || {};
  const protectedSet = new Set([...protectedIds, ...(bundle.chunkPayloadProtectedIds || [])]);
  const cacheIds = Object.keys(cache);
  let cacheSize = cacheIds.length;
  let knownSourceBytes = 0;
  for (const id of cacheIds) knownSourceBytes += sourceBytesByPayloadEntry.get(cache[id]) || 0;
  for (const id of cacheIds) {
    if (cacheSize <= SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT
      && knownSourceBytes <= SCENARIO_CHUNK_PAYLOAD_CACHE_BYTE_LIMIT) break;
    if (protectedSet.has(id) || bundle.chunkPayloadPromisesById?.[id]) continue;
    knownSourceBytes -= sourceBytesByPayloadEntry.get(cache[id]) || 0;
    delete cache[id];
    cacheSize -= 1;
  }
}

export function touchScenarioChunkPayloadCache(bundle, chunkId, protectedIds = []) {
  const cache = bundle.chunkPayloadCacheById;
  // Property insertion order supplies LRU order without another payload owner.
  const entry = cache[chunkId];
  delete cache[chunkId];
  cache[chunkId] = entry;
  trimScenarioChunkPayloadCache(bundle, protectedIds);
}

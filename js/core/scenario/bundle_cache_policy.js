export const SCENARIO_BUNDLE_CACHE_LIMIT = 3;

export const SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT = 32;
// Pre-encoding source bytes are a retention weight, not a JS heap estimate.
// Transfer compression must not make the same decoded payload cheaper to retain.
// Required/active/in-flight payloads may exceed both targets until released.
export const SCENARIO_CHUNK_PAYLOAD_CACHE_BYTE_LIMIT = 64 * 1024 * 1024;
const sourceBytesByPayloadEntry = new WeakMap();

export function recordScenarioChunkPayloadSourceBytes(entry, chunkMeta) {
  if (!entry || typeof entry !== "object") return;
  const bytes = [
    chunkMeta?.cacheByteSize ?? chunkMeta?.cache_byte_size,
    chunkMeta?.decodedByteSize ?? chunkMeta?.decoded_byte_size,
    chunkMeta?.byteSize ?? chunkMeta?.byte_size,
  ].map(Number).find((value) => Number.isFinite(value) && value > 0);
  if (Number.isFinite(bytes) && bytes > 0) sourceBytesByPayloadEntry.set(entry, Math.ceil(bytes));
}

export function getScenarioChunkPayloadEvictionIds(bundle, protectedIds = []) {
  const cache = bundle.chunkPayloadCacheById || {};
  const protectedSet = new Set([...protectedIds, ...(bundle.chunkPayloadProtectedIds || [])]);
  const cacheIds = Object.keys(cache);
  let cacheSize = cacheIds.length;
  let knownSourceBytes = 0;
  const evictedIds = [];
  for (const id of cacheIds) knownSourceBytes += sourceBytesByPayloadEntry.get(cache[id]) || 0;
  for (const id of cacheIds) {
    if (cacheSize <= SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT
      && knownSourceBytes <= SCENARIO_CHUNK_PAYLOAD_CACHE_BYTE_LIMIT) break;
    if (protectedSet.has(id) || bundle.chunkPayloadPromisesById?.[id]) continue;
    knownSourceBytes -= sourceBytesByPayloadEntry.get(cache[id]) || 0;
    evictedIds.push(id);
    cacheSize -= 1;
  }
  return evictedIds;
}

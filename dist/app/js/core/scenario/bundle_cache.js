import { trimScenarioBundleCacheState } from "../state/actions/scenario_activation_actions.js";

import {
  getScenarioChunkPayloadEvictionIds,
} from "./bundle_cache_policy.js";
export {
  SCENARIO_BUNDLE_CACHE_LIMIT,
  SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT,
  SCENARIO_CHUNK_PAYLOAD_CACHE_BYTE_LIMIT,
  recordScenarioChunkPayloadSourceBytes,
} from "./bundle_cache_policy.js";
export function trimScenarioBundleCache(state, recency, targetId) {
  const retainedIds = trimScenarioBundleCacheState(state, Array.from(recency.keys()), targetId);
  recency.clear();
  for (const id of retainedIds) recency.set(id, true);
}

export function trimScenarioChunkPayloadCache(bundle, protectedIds = []) {
  for (const id of getScenarioChunkPayloadEvictionIds(bundle, protectedIds)) {
    delete bundle.chunkPayloadCacheById[id];
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

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
const topologyObjectsByDecodedCollection = {
  politicalData: ["political"],
  scenarioLandMaskData: ["land_mask", "land"],
  scenarioContextLandMaskData: ["context_land_mask"],
  scenarioWaterRegionsData: ["scenario_water"],
  scenarioSpecialRegionsData: ["scenario_special_land"],
  scenarioAtlantropaData: ["scenario_atlantropa"],
};

export function trimScenarioBundleCache(state, recency, targetId, { releaseDerived = true } = {}) {
  const retainedIds = trimScenarioBundleCacheState(state, Array.from(recency.keys()), targetId);
  recency.clear();
  for (const id of retainedIds) recency.set(id, true);
  if (!releaseDerived || state.scenarioApplyInFlight) return;
  for (const [id, bundle] of Object.entries(state.scenarioBundleCacheById || {})) {
    if (!bundle || id === targetId || id === String(state.activeScenarioId || "").trim()) continue;
    if ((bundle.deferredMetadataLoadPromise && !bundle.deferredMetadataLoadSettled)
      || Object.values(bundle.optionalLayerPromises || {}).some(Boolean)
      || Object.values(bundle.chunkPayloadPromisesById || {}).some(Boolean)) continue;
    const topology = bundle.runtimeTopologyPayload;
    const objects = topology?.objects;
    if (topology?.type !== "Topology" || !Array.isArray(topology.arcs) || !objects) continue;
    if (bundle.runtimeDecodedCollections) {
      // A decoded-only layer has no replacement source: keep it. Only discard
      // worker derivations that can be rebuilt from this bundle's own Topology.
      const retained = Object.entries(bundle.runtimeDecodedCollections).filter(([key, collection]) =>
        collection && !topologyObjectsByDecodedCollection[key]?.some(name => objects[name]));
      bundle.runtimeDecodedCollections = retained.length ? Object.fromEntries(retained) : null;
    }
    bundle.runtimeDecodedTopologyCache?.clear();
    delete bundle.runtimeDecodedTopologyCache;
  }
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

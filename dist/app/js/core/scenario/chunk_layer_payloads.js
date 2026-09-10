// Derives layer payloads from a captured chunk state. The controller owns state commits.

// Viewport merge is more expensive than selecting the already merged layer. Keep
// a one-entry cache per bundle, keyed by the viewport and the exact payload
// objects participating in the merge. Object identity makes invalidation safe
// when a chunk is replaced while avoiding another state surface.
const primaryViewportMergeCacheByBundle = new WeakMap();
const payloadIdentityByObject = new WeakMap();
let nextPayloadIdentity = 1;

function getPayloadIdentity(payload) {
  if (!payload || typeof payload !== "object") return 0;
  if (!payloadIdentityByObject.has(payload)) payloadIdentityByObject.set(payload, nextPayloadIdentity++);
  return payloadIdentityByObject.get(payload);
}

function getChunkIdListSignature(chunkIds = []) {
  return (Array.isArray(chunkIds) ? chunkIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("|");
}

function getScenarioChunkIdsByLayer(chunkState, layerKey, activeChunkIdSet = null) {
  return chunkState.loadedChunkIds
    .filter((chunkId) => !activeChunkIdSet || activeChunkIdSet.has(String(chunkId || "").trim()))
    .map((chunkId) => ({ chunkId, entry: chunkState.payloadByChunkId?.[chunkId] || null }))
    .filter(({ entry }) => entry && entry.layerKey === layerKey)
    .map(({ chunkId }) => chunkId);
}

function buildScenarioChunkMetaIndex(bundle) {
  const byId = new Map();
  const byLayer = bundle?.chunkRegistry?.byLayer && typeof bundle.chunkRegistry.byLayer === "object"
    ? bundle.chunkRegistry.byLayer
    : {};
  for (const chunks of Object.values(byLayer)) {
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      const id = String(chunk?.id || "").trim();
      if (id && !byId.has(id)) byId.set(id, chunk);
    }
  }
  return byId;
}

function getScenarioChunkPayloadEntriesForLayer(chunkState, layerKey, activeChunkIdSet = null) {
  return chunkState.loadedChunkIds
    .filter((chunkId) => !activeChunkIdSet || activeChunkIdSet.has(String(chunkId || "").trim()))
    .map((chunkId) => ({
      chunkId,
      entry: chunkState.payloadByChunkId?.[chunkId] || null,
    }))
    .filter(({ entry }) => entry && entry.layerKey === layerKey);
}

export function buildScenarioChunkLayerSelectionSignatures(bundle, chunkState, activeChunkIds = null) {
  const activeChunkIdSet = Array.isArray(activeChunkIds)
    ? new Set(activeChunkIds.map((chunkId) => String(chunkId || "").trim()).filter(Boolean))
    : null;
  const layerKeys = new Set([
    ...Object.keys(bundle?.chunkRegistry?.byLayer || {}),
    ...Object.keys(chunkState.mergedLayerPayloads || {}),
  ]);
  const signatures = {};
  layerKeys.forEach((layerKey) => {
    const chunkIds = getScenarioChunkIdsByLayer(chunkState, layerKey, activeChunkIdSet);
    // Chunk IDs describe selection, not the content of a replaced chunk. The
    // runtime owns immutable payload objects; replacements need a new merge.
    signatures[layerKey] = chunkIds.map((id) => `${id}@${getPayloadIdentity(chunkState.payloadByChunkId[id]?.payload)}`).join("|");
  });
  return signatures;
}

export function buildMergedScenarioChunkLayerPayloads(bundle, chunkState, {
  previousSignatures = {},
  nextSignatures = {},
  previousMergedLayerPayloads = {},
  activeChunkIds = null,
  viewportBbox = null,
  mergeScenarioChunkPayloads,
  mergeScenarioChunkPayloadsForViewport = null,
} = {}) {
  const activeChunkIdSet = Array.isArray(activeChunkIds)
    ? new Set(activeChunkIds.map((chunkId) => String(chunkId || "").trim()).filter(Boolean))
    : null;
  const mergedLayerPayloads = {};
  const primaryMergedLayerPayloads = {};
  const primaryLayerStats = {};
  const changedLayerKeys = [];
  // Local to this merge: registry entries can be edited in place. Build only
  // when political merging needs metadata, rather than search per chunk/layer.
  let chunkMetaById = null;
  const layerKeys = new Set([
    ...Object.keys(bundle?.chunkRegistry?.byLayer || {}),
    ...Object.keys(previousMergedLayerPayloads || {}),
  ]);
  layerKeys.forEach((layerKey) => {
    const layerChunkPayloadEntries = getScenarioChunkPayloadEntriesForLayer(chunkState, layerKey, activeChunkIdSet);
    if (layerKey === "political") {
      chunkMetaById ||= buildScenarioChunkMetaIndex(bundle);
      // mergeScenarioChunkPayloads keeps the first feature with each ID.
      layerChunkPayloadEntries.sort((left, right) => (
        Number(chunkMetaById.get(right.chunkId)?.lod === "detail")
        - Number(chunkMetaById.get(left.chunkId)?.lod === "detail")
      ));
    }
    const previousSignature = String(previousSignatures?.[layerKey] || "");
    const nextSignature = String(nextSignatures?.[layerKey] || "");
    const canReuse = previousSignature === nextSignature
      && Object.prototype.hasOwnProperty.call(previousMergedLayerPayloads || {}, layerKey);
    if (canReuse) {
      mergedLayerPayloads[layerKey] = previousMergedLayerPayloads[layerKey] || null;
    } else {
      const layerChunkPayloads = layerChunkPayloadEntries
        .map(({ entry }) => entry?.payload || null)
        .filter(Boolean);
      changedLayerKeys.push(layerKey);
      if (!layerChunkPayloads.length) {
        if (layerKey === "political") primaryViewportMergeCacheByBundle.delete(bundle);
        mergedLayerPayloads[layerKey] = null;
        primaryMergedLayerPayloads[layerKey] = null;
        primaryLayerStats[layerKey] = null;
        return;
      }
      mergedLayerPayloads[layerKey] = mergeScenarioChunkPayloads(layerKey, layerChunkPayloads);
    }
    const hasPersistentPoliticalBase = layerKey === "political" && layerChunkPayloadEntries.some(({ chunkId, entry }) => {
      const chunk = chunkMetaById.get(chunkId);
      return entry?.payload && chunk?.globalCoverage === true && chunk.lod === "coarse";
    });
    if (hasPersistentPoliticalBase) {
      // Complete coverage already exists. Keep one geometry collection for
      // rendering and hit testing; their spatial indexes own viewport culling.
      const mergedPayload = mergedLayerPayloads[layerKey];
      // The renderer must not supplement a complete scenario with modern
      // country polygons merely because their topology IDs differ.
      const payload = mergedPayload?.globalCoverage === true
        ? mergedPayload : { ...mergedPayload, globalCoverage: true };
      mergedLayerPayloads[layerKey] = payload;
      const featureCount = Array.isArray(payload?.features) ? payload.features.length : 0;
      primaryMergedLayerPayloads[layerKey] = payload;
      primaryLayerStats[layerKey] = {
        coverageMode: "full",
        visibleFeatureCount: featureCount,
        totalFeatureCount: featureCount,
        clippedChunkCount: 0,
        fullChunkCount: layerChunkPayloadEntries.filter(({ entry }) => entry?.payload).length,
        unboundedChunkCount: 0,
      };
      primaryViewportMergeCacheByBundle.delete(bundle);
    } else if (layerKey === "political" && typeof mergeScenarioChunkPayloadsForViewport === "function") {
      chunkMetaById ||= buildScenarioChunkMetaIndex(bundle);
      const viewportKey = Array.isArray(viewportBbox)
        ? viewportBbox.join(",")
        : "";
      const politicalEntries = layerChunkPayloadEntries.map(({ chunkId, entry }) => ({
        chunk: chunkMetaById.get(String(chunkId || "").trim()) || null,
        payload: entry?.payload || null,
      }));
      const previousViewportCache = primaryViewportMergeCacheByBundle.get(bundle);
      const canReusePrimaryViewport = previousViewportCache
        && previousViewportCache.merge === mergeScenarioChunkPayloadsForViewport
        && previousViewportCache.key === `${nextSignature}|${viewportKey}`
        && previousViewportCache.entries.length === politicalEntries.length
        && previousViewportCache.entries.every((entry, index) => (
          entry.chunk === politicalEntries[index].chunk
          && entry.payload === politicalEntries[index].payload
        ));
      if (canReusePrimaryViewport) {
        primaryMergedLayerPayloads[layerKey] = previousViewportCache.payload;
        primaryLayerStats[layerKey] = previousViewportCache.stats;
      } else {
        const primaryResult = mergeScenarioChunkPayloadsForViewport(
          layerKey,
          politicalEntries,
          viewportBbox || [-180, -90, 180, 90],
        );
        primaryMergedLayerPayloads[layerKey] = primaryResult?.payload || null;
        primaryLayerStats[layerKey] = primaryResult?.stats || null;
        primaryViewportMergeCacheByBundle.set(bundle, {
          merge: mergeScenarioChunkPayloadsForViewport,
          key: `${nextSignature}|${viewportKey}`,
          entries: politicalEntries,
          payload: primaryMergedLayerPayloads[layerKey],
          stats: primaryLayerStats[layerKey],
        });
      }
    }
  });
  return {
    mergedLayerPayloads,
    primaryMergedLayerPayloads,
    primaryLayerStats,
    changedLayerKeys,
  };
}

export { getChunkIdListSignature };

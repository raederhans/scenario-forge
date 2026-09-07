// Derives layer payloads from a captured chunk state. The controller owns state commits.

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

function getScenarioChunkMetaById(bundle, chunkId = "") {
  const normalizedChunkId = String(chunkId || "").trim();
  if (!normalizedChunkId) return null;
  const byLayer = bundle?.chunkRegistry?.byLayer && typeof bundle.chunkRegistry.byLayer === "object"
    ? bundle.chunkRegistry.byLayer
    : {};
  for (const chunks of Object.values(byLayer)) {
    const match = (Array.isArray(chunks) ? chunks : [])
      .find((chunk) => String(chunk?.id || "").trim() === normalizedChunkId);
    if (match) return match;
  }
  return null;
}

function getScenarioChunkPayloadEntriesForLayer(bundle, chunkState, layerKey, activeChunkIdSet = null) {
  return chunkState.loadedChunkIds
    .filter((chunkId) => !activeChunkIdSet || activeChunkIdSet.has(String(chunkId || "").trim()))
    .map((chunkId) => ({
      chunkId,
      chunk: getScenarioChunkMetaById(bundle, chunkId),
      entry: chunkState.payloadByChunkId?.[chunkId] || null,
    }))
    .filter(({ entry }) => entry && entry.layerKey === layerKey);
}

function buildScenarioChunkLayerSelectionSignatures(bundle, chunkState, activeChunkIds = null) {
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
    signatures[layerKey] = getChunkIdListSignature(chunkIds);
  });
  return signatures;
}

function buildMergedScenarioChunkLayerPayloads(bundle, chunkState, {
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
  const layerKeys = new Set([
    ...Object.keys(bundle?.chunkRegistry?.byLayer || {}),
    ...Object.keys(previousMergedLayerPayloads || {}),
  ]);
  layerKeys.forEach((layerKey) => {
    const layerChunkPayloadEntries = getScenarioChunkPayloadEntriesForLayer(bundle, chunkState, layerKey, activeChunkIdSet);
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
        mergedLayerPayloads[layerKey] = null;
        primaryMergedLayerPayloads[layerKey] = null;
        primaryLayerStats[layerKey] = null;
        return;
      }
      mergedLayerPayloads[layerKey] = mergeScenarioChunkPayloads(layerKey, layerChunkPayloads);
    }
    if (layerKey === "political" && typeof mergeScenarioChunkPayloadsForViewport === "function") {
      const primaryResult = mergeScenarioChunkPayloadsForViewport(layerKey, layerChunkPayloadEntries.map(({ chunk, entry }) => ({
        chunk,
        payload: entry?.payload || null,
      })), viewportBbox || [-180, -90, 180, 90]);
      primaryMergedLayerPayloads[layerKey] = primaryResult?.payload || null;
      primaryLayerStats[layerKey] = primaryResult?.stats || null;
    }
  });
  return {
    mergedLayerPayloads,
    primaryMergedLayerPayloads,
    primaryLayerStats,
    changedLayerKeys,
  };
}

export { getChunkIdListSignature, buildScenarioChunkLayerSelectionSignatures, buildMergedScenarioChunkLayerPayloads };

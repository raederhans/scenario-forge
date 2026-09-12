// Pure continuation fence. IDs are normalized by the controller; identities stay borrowed.
export function getScenarioChunkActiveMergeIds(inputs) {
  const { loadedChunkIds, cacheOnlyChunkIds, retainedActiveChunkIds } = inputs;
  const cacheOnlyChunkIdSet = new Set((Array.isArray(cacheOnlyChunkIds) ? cacheOnlyChunkIds : [])
    .map((chunkId) => String(chunkId || "").trim())
    .filter(Boolean));
  // Protected active detail participates in render/hit input even while warm-cache
  // selection would otherwise exclude it. Loaded order and duplicates are retained.
  const retainedActiveChunkIdSet = new Set((Array.isArray(retainedActiveChunkIds) ? retainedActiveChunkIds : [])
    .map((chunkId) => String(chunkId || "").trim())
    .filter(Boolean));
  return (Array.isArray(loadedChunkIds) ? loadedChunkIds : [])
    .map((chunkId) => String(chunkId || "").trim())
    .filter(Boolean)
    .filter((chunkId) => !cacheOnlyChunkIdSet.has(chunkId) || retainedActiveChunkIdSet.has(chunkId));
}

export function isPendingScenarioChunkPromotionCurrent(inputs) {
  const {
  pendingPromotion, loadState, currentLoadState,
  scenarioId, activeScenarioId, runId = 0, promotionCommitRunId = 0,
  currentScenarioApplyRequestId = 0, latestScenarioApplyRequestId = 0,
  latestScenarioApplyTargetId = "",
  } = inputs;
  if (!pendingPromotion || typeof pendingPromotion !== "object") return false;
  if (currentLoadState !== loadState) return false;
  if (runId > 0 && (
    promotionCommitRunId !== runId
    || Math.max(0, Number(loadState.promotionCommitRunId || 0)) !== runId
  )) return false;
  if (!scenarioId || scenarioId !== activeScenarioId) return false;
  if (loadState.pendingPromotion && loadState.pendingPromotion !== pendingPromotion) return false;
  const pendingSelectionVersion = Math.max(0, Number(pendingPromotion.selectionVersion || 0));
  const currentSelectionVersion = Math.max(0, Number(loadState.selectionVersion || 0));
  if (pendingSelectionVersion > 0 && currentSelectionVersion > 0 && pendingSelectionVersion !== currentSelectionVersion) return false;
  const currentRequestId = Math.max(0, Number(currentScenarioApplyRequestId || 0));
  const latestRequestId = Math.max(0, Number(latestScenarioApplyRequestId || 0));
  if (latestRequestId > currentRequestId && latestScenarioApplyTargetId && latestScenarioApplyTargetId !== scenarioId) return false;
  const expectedRequestId = Math.max(0, Number(pendingPromotion.scenarioApplyRequestId || 0));
  return !(expectedRequestId > 0 && currentRequestId > 0 && expectedRequestId !== currentRequestId);
}

// Opt-in whole-shard LOD families. Every variant must contain the same IDs;
// the asset builder preserves shard perimeters so neighbours may differ in LOD.
export function getPoliticalLodRank(chunk) {
  return ({ coarse: 0, world: 1, regional: 2, detail: 3 })[chunk?.lod] ?? 0;
}

export function selectPoliticalLodFamilies(chunks, loadedChunkIds = []) {
  const loaded = new Set(loadedChunkIds);
  const families = new Map();
  for (const chunk of chunks) {
    if (!chunk.lodGroupId) continue;
    const previous = families.get(chunk.lodGroupId);
    // Overlapping min/max zoom intervals implement hysteresis: a resident
    // variant survives until it exits its interval. On a cold view prefer
    // the most detailed eligible variant. Never omit non-family legacy data.
    if (!previous || Number(loaded.has(chunk.id)) > Number(loaded.has(previous.id))
      || (loaded.has(chunk.id) === loaded.has(previous.id)
        && getPoliticalLodRank(chunk) > getPoliticalLodRank(previous))) families.set(chunk.lodGroupId, chunk);
  }
  return chunks.filter((chunk) => !chunk.lodGroupId || families.get(chunk.lodGroupId) === chunk);
}

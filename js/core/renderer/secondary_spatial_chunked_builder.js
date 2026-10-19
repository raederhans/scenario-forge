import {
  iterateWaterSpatialItems,
  iterateSpecialSpatialItems,
  iterateSpatialGridSnapshot,
} from "./spatial_index_runtime_builders.js";

// Only local containers are written here. The owner decides whether the result
// still belongs to the current generation before publishing both layers.
export async function prepareSecondarySpatialSnapshotChunked({
  waterFeatures, specialFeatures, reusableSnapshots, cacheIdentity,
  gridOptions, allowComputeMissingBounds, helpers, isCurrent, yieldControl,
  sliceMs = 6, maxSliceSteps = 400,
}) {
  const { getFeatureId, getSecondarySpatialCacheIdentity, getLogicalCanvasDimensions,
    getEffectiveWaterRegionFeatures, getEffectiveSpecialRegionFeatures, getSecondarySpatialSourceIdentity, nowMs } = helpers;
  const sourceIdentity = getSecondarySpatialSourceIdentity?.();
  const capture = (features) => features.map((feature) => ({
    feature, geometry: feature.geometry, properties: feature.properties,
    id: getFeatureId(feature), source: feature.properties?.__source,
  }));
  const waterSources = capture(waterFeatures);
  const specialSources = capture(specialFeatures);
  const sameSources = (getFeatures, sources) => {
    const current = getFeatures();
    return current.length === sources.length && sources.every((source, index) =>
      current[index] === source.feature && source.feature.geometry === source.geometry
      && source.feature.properties === source.properties && getFeatureId(source.feature) === source.id
      && source.feature.properties?.__source === source.source);
  };
  const valid = (full = false) => {
    const [width, height] = getLogicalCanvasDimensions();
    const currentIdentity = sourceIdentity ? getSecondarySpatialSourceIdentity() : null;
    return isCurrent() && getSecondarySpatialCacheIdentity() === cacheIdentity
      && width === gridOptions.canvasWidth && height === gridOptions.canvasHeight
      && (!sourceIdentity || (currentIdentity?.length === sourceIdentity.length
        && sourceIdentity.every((value, index) => value === currentIdentity[index])))
      // Source refs/revisions are cheap cancellation guards between slices. A
      // complete feature-level check still guards initial work and publication,
      // including in-place edits that did not replace a source collection.
      && ((!full && sourceIdentity) || (sameSources(getEffectiveWaterRegionFeatures, waterSources)
        && sameSources(getEffectiveSpecialRegionFeatures, specialSources)));
  };
  let yieldCount = 0;
  let maxSliceMs = 0;
  let sliceStartedAt = nowMs();
  const checkpoint = async () => {
    maxSliceMs = Math.max(maxSliceMs, nowMs() - sliceStartedAt);
    yieldCount += 1;
    await yieldControl();
    sliceStartedAt = nowMs();
    return valid();
  };
  const nextEntries = cacheIdentity == null ? null : new Map();
  function* prepare() {
    const waterItems = yield* iterateWaterSpatialItems({
      ...helpers, features: waterFeatures,
      previousEntries: reusableSnapshots.map((snapshot) => snapshot.entries), nextEntries,
    });
    let exactSnapshot = null;
    for (const snapshot of reusableSnapshots) {
      if (snapshot.canvasWidth !== gridOptions.canvasWidth
        || snapshot.canvasHeight !== gridOptions.canvasHeight
        || snapshot.items.length !== waterItems.length) continue;
      let matches = true;
      for (let index = 0; index < waterItems.length; index += 1) {
        yield;
        if (snapshot.items[index] !== waterItems[index]) { matches = false; break; }
      }
      if (matches) { exactSnapshot = snapshot; break; }
    }
    const waterGrid = exactSnapshot?.gridSnapshot
      || (yield* iterateSpatialGridSnapshot({ ...gridOptions, items: waterItems }));
    const specialItems = yield* iterateSpecialSpatialItems({
      ...helpers, features: specialFeatures, allowComputeMissingBounds,
    });
    const specialGrid = yield* iterateSpatialGridSnapshot({ ...gridOptions, items: specialItems });
    return {
      water: { items: waterItems, ...waterGrid }, special: { items: specialItems, ...specialGrid },
      waterSnapshot: { identity: cacheIdentity, entries: nextEntries, items: waterItems,
        gridSnapshot: waterGrid, canvasWidth: gridOptions.canvasWidth, canvasHeight: gridOptions.canvasHeight },
      exactSnapshot,
    };
  }
  const result = (status, snapshot = null) => ({ status, yieldCount, validate: () => valid(true),
    maxSliceMs: Math.max(maxSliceMs, nowMs() - sliceStartedAt), snapshot });
  if (!valid(true) || !await checkpoint()) return result("cancelled");
  const iterator = prepare();
  let steps = 0;
  while (true) {
    const step = iterator.next();
    if (step.done) return valid(true) ? result("prepared", step.value) : result("cancelled");
    steps += 1;
    if (steps >= maxSliceSteps || nowMs() - sliceStartedAt >= sliceMs) {
      if (!await checkpoint()) return result("cancelled");
      steps = 0;
    }
  }
}

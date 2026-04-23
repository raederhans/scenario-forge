export function deriveRuntimePrimaryFeaturePayload({
  feature,
  id,
  canvasWidth = 1,
  canvasHeight = 1,
  projectedBoundsCache = null,
  computeProjectedFeatureBounds = () => null,
  shouldSkipFeature = () => false,
  getResolvedFeatureColor = () => null,
} = {}) {
  const bounds = computeProjectedFeatureBounds(feature);
  if (bounds && projectedBoundsCache?.set) {
    projectedBoundsCache.set(id, bounds);
  }
  if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) {
    return {
      bounds,
      resolvedColor: null,
      skipped: true,
    };
  }
  return {
    bounds,
    resolvedColor: getResolvedFeatureColor(feature, id) || null,
    skipped: false,
  };
}

export function createSpatialIndexPerfPayload({
  landCount = 0,
  spatialItems = 0,
  waterItems = 0,
  specialItems = 0,
  skipped = false,
  chunked,
} = {}) {
  const payload = {
    landCount: Number(landCount) || 0,
    spatialItems: Number(spatialItems) || 0,
    waterItems: Number(waterItems) || 0,
    specialItems: Number(specialItems) || 0,
    skipped: !!skipped,
  };
  if (typeof chunked === 'boolean') {
    payload.chunked = chunked;
  }
  return payload;
}
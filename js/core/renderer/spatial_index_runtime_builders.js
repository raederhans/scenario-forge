export function appendLandIndexEntriesRange({
  state,
  features = [],
  start = 0,
  end = features.length,
  getFeatureId = () => "",
  shouldExcludePoliticalInteractionFeature = () => false,
  getFeatureCountryCodeNormalized = () => "",
  onLandFeatureIndexed = null,
} = {}) {
  for (let index = start; index < end; index += 1) {
    const feature = features[index];
    const id = getFeatureId(feature) || `feature-${index}`;
    state.landIndex.set(id, feature);
    if (typeof onLandFeatureIndexed === "function") {
      onLandFeatureIndexed({ feature, id, index });
    }
    if (shouldExcludePoliticalInteractionFeature(feature, id)) continue;
    const countryCode = getFeatureCountryCodeNormalized(feature);
    if (countryCode) {
      const ids = state.countryToFeatureIds.get(countryCode) || [];
      ids.push(id);
      state.countryToFeatureIds.set(countryCode, ids);
    }
    const key = index + 1;
    state.idToKey.set(id, key);
    state.keyToId.set(key, id);
  }
}

export function appendLandSpatialItemsRange({
  targetItems,
  features = [],
  start = 0,
  end = features.length,
  canvasWidth = 1,
  canvasHeight = 1,
  allowComputeMissingBounds = true,
  getFeatureId = () => "",
  shouldExcludePoliticalInteractionFeature = () => false,
  shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature,
  shouldSkipFeature = () => false,
  getProjectedFeatureBounds = () => null,
  getFeatureCountryCodeNormalized = () => "",
  getFeatureBorderMeshCountryCodeNormalized = null,
} = {}) {
  const resolveBorderMeshCountryCode =
    typeof getFeatureBorderMeshCountryCodeNormalized === "function"
      ? getFeatureBorderMeshCountryCodeNormalized
      : getFeatureCountryCodeNormalized;
  for (let index = start; index < end; index += 1) {
    const feature = features[index];
    const id = getFeatureId(feature);
    if (!id) continue;
    if (shouldExcludePoliticalVisualFeature(feature, id)) continue;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) continue;
    const bounds = getProjectedFeatureBounds(feature, {
      featureId: id,
      allowCompute: allowComputeMissingBounds,
    });
    if (!bounds) continue;
    targetItems.push({
      id,
      drawOrder: index,
      feature,
      interactive: !shouldExcludePoliticalInteractionFeature(feature, id),
      countryCode: getFeatureCountryCodeNormalized(feature),
      borderMeshCountryCode: resolveBorderMeshCountryCode(feature),
      source: String(feature?.properties?.__source || "primary"),
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      bboxArea: bounds.area,
    });
  }
}

export function buildWaterSpatialItems({
  features = [],
  getFeatureId = () => "",
  collectFeatureHitGeometries = () => [],
  computeProjectedGeoBounds = () => null,
  shouldExcludeWaterHitGeometry = () => false,
} = {}) {
  const items = [];
  features.forEach((feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    const hitGeometries = collectFeatureHitGeometries(feature);
    hitGeometries.forEach((hitGeometry, partIndex) => {
      if (shouldExcludeWaterHitGeometry(hitGeometry, feature, id)) return;
      const bounds = computeProjectedGeoBounds(hitGeometry);
      if (!bounds) return;
      items.push({
        id: `${id}::part:${partIndex}`,
        featureId: id,
        feature,
        hitGeometry,
        countryCode: "",
        source: String(feature?.properties?.__source || "primary"),
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
        bboxArea: bounds.area,
      });
    });
  });
  return items;
}

export function buildSpecialSpatialItems({
  features = [],
  allowComputeMissingBounds = true,
  getFeatureId = () => "",
  getProjectedFeatureBounds = () => null,
} = {}) {
  const items = [];
  features.forEach((feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    const resolvedBounds = getProjectedFeatureBounds(feature, {
      featureId: id,
      allowCompute: allowComputeMissingBounds,
    });
    if (!resolvedBounds) return;
    items.push({
      id,
      feature,
      countryCode: "",
      source: String(feature?.properties?.__source || "scenario"),
      minX: resolvedBounds.minX,
      minY: resolvedBounds.minY,
      maxX: resolvedBounds.maxX,
      maxY: resolvedBounds.maxY,
      bboxArea: resolvedBounds.area,
    });
  });
  return items;
}

export function captureSpatialGridBuild({
  state,
  items,
  canvasWidth = 1,
  canvasHeight = 1,
  buildSpatialGrid = () => {},
} = {}) {
  const previousItems = state.spatialItems;
  const previousGrid = state.spatialGrid;
  const previousGridMeta = state.spatialGridMeta;
  const previousItemsById = state.spatialItemsById;
  state.spatialItems = items;
  buildSpatialGrid(items, canvasWidth, canvasHeight);
  const snapshot = {
    grid: state.spatialGrid,
    gridMeta: state.spatialGridMeta,
    itemsById: state.spatialItemsById,
  };
  state.spatialItems = previousItems;
  state.spatialGrid = previousGrid;
  state.spatialGridMeta = previousGridMeta;
  state.spatialItemsById = previousItemsById;
  return snapshot;
}

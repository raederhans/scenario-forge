export function createSpatialIndexRuntimeOwner({
  state,
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const {
    chunkedIndexBuildSliceSize = 1000,
    chunkedSpatialBuildSliceSize = 400,
  } = constants;

  const {
    getPathSvg = () => null,
  } = getters;

  const {
    getLogicalCanvasDimensions = () => [1, 1],
    computeProjectedFeatureBounds = () => null,
    shouldSkipFeature = () => false,
    queueIndexUiRefresh = () => {},
    finalizeIndexBuildEffects = () => {},
    getFeatureId = () => "",
    getFeatureCountryCodeNormalized = () => "",
    getProjectedFeatureBounds = () => null,
    shouldExcludePoliticalInteractionFeature = () => false,
    buildSpatialGrid = () => {},
    nowMs = () => 0,
    recordRenderPerfMetric = () => {},
    setInteractionInfrastructureState = () => {},
    yieldToMain = async () => {},
    getEffectiveWaterRegionFeatures = () => [],
    getEffectiveSpecialRegionFeatures = () => [],
    collectFeatureHitGeometries = () => [],
    computeProjectedGeoBounds = () => null,
  } = helpers;

  function buildIndex({ scheduleUiMode = "immediate" } = {}) {
    state.landIndex.clear();
    state.countryToFeatureIds.clear();
    state.idToKey.clear();
    state.keyToId.clear();
    rebuildAuxiliaryRegionIndexes();

    if (!state.landData || !state.landData.features) {
      queueIndexUiRefresh({
        renderWaterRegionList: true,
        renderSpecialRegionList: true,
      }, scheduleUiMode);
      return;
    }
    state.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      state.landIndex.set(id, feature);
      if (shouldExcludePoliticalInteractionFeature(feature, id)) return;
      const countryCode = getFeatureCountryCodeNormalized(feature);
      if (countryCode) {
        const ids = state.countryToFeatureIds.get(countryCode) || [];
        ids.push(id);
        state.countryToFeatureIds.set(countryCode, ids);
      }
      const key = index + 1;
      state.idToKey.set(id, key);
      state.keyToId.set(key, id);
    });

    queueIndexUiRefresh({
      renderCountryList: true,
      renderWaterRegionList: true,
      renderSpecialRegionList: true,
    }, scheduleUiMode);
    finalizeIndexBuildEffects();
  }

  function resetSecondarySpatialIndexState() {
    state.waterSpatialItems = [];
    state.waterSpatialIndex = null;
    state.waterSpatialGrid = new Map();
    state.waterSpatialGridMeta = null;
    state.waterSpatialItemsById = new Map();
    state.specialSpatialItems = [];
    state.specialSpatialIndex = null;
    state.specialSpatialGrid = new Map();
    state.specialSpatialGridMeta = null;
    state.specialSpatialItemsById = new Map();
  }

  function buildSecondarySpatialIndexes({
    allowComputeMissingBounds = true,
  } = {}) {
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    const buildSecondarySpatialGrid = (items, assign) => {
      const previousGrid = state.spatialGrid;
      const previousGridMeta = state.spatialGridMeta;
      const previousItemsById = state.spatialItemsById;
      buildSpatialGrid(items, canvasWidth, canvasHeight);
      assign();
      state.spatialGrid = previousGrid;
      state.spatialGridMeta = previousGridMeta;
      state.spatialItemsById = previousItemsById;
    };

    getEffectiveWaterRegionFeatures().forEach((feature) => {
      const id = getFeatureId(feature);
      if (!id) return;
      const hitGeometries = collectFeatureHitGeometries(feature);
      hitGeometries.forEach((hitGeometry, partIndex) => {
        const bounds = computeProjectedGeoBounds(hitGeometry);
        if (!bounds) return;
        state.waterSpatialItems.push({
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
    buildSecondarySpatialGrid(state.waterSpatialItems, () => {
      state.waterSpatialGrid = state.spatialGrid;
      state.waterSpatialGridMeta = state.spatialGridMeta;
      state.waterSpatialItemsById = state.spatialItemsById;
    });

    getEffectiveSpecialRegionFeatures().forEach((feature) => {
      const id = getFeatureId(feature);
      if (!id) return;
      const resolvedBounds = getProjectedFeatureBounds(feature, {
        featureId: id,
        allowCompute: allowComputeMissingBounds,
      });
      if (!resolvedBounds) return;
      state.specialSpatialItems.push({
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
    buildSecondarySpatialGrid(state.specialSpatialItems, () => {
      state.specialSpatialGrid = state.spatialGrid;
      state.specialSpatialGridMeta = state.spatialGridMeta;
      state.specialSpatialItemsById = state.spatialItemsById;
    });
  }

  function buildSpatialIndex({
    includeSecondary = true,
    allowComputeMissingBounds = true,
  } = {}) {
    const startedAt = nowMs();
    state.spatialItems = [];
    state.spatialIndex = null;
    state.spatialGrid = new Map();
    state.spatialGridMeta = null;
    state.spatialItemsById = new Map();
    resetSecondarySpatialIndexState();
    if (!state.landData || !state.landData.features || !getPathSvg()) {
      recordRenderPerfMetric("buildSpatialIndex", nowMs() - startedAt, {
        landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
        spatialItems: 0,
        waterItems: 0,
        specialItems: 0,
        skipped: true,
      });
      return;
    }
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

    for (const [drawOrder, feature] of state.landData.features.entries()) {
      const id = getFeatureId(feature);
      if (!id) continue;
      if (shouldExcludePoliticalInteractionFeature(feature, id)) continue;
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) continue;
      const bounds = getProjectedFeatureBounds(feature, {
        featureId: id,
        allowCompute: allowComputeMissingBounds,
      });
      if (!bounds) continue;

      state.spatialItems.push({
        id,
        drawOrder,
        feature,
        countryCode: getFeatureCountryCodeNormalized(feature),
        source: String(feature?.properties?.__source || "primary"),
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
        bboxArea: bounds.area,
      });
    }

    buildSpatialGrid(state.spatialItems, canvasWidth, canvasHeight);
    state.spatialIndex = null;
    if (includeSecondary) {
      buildSecondarySpatialIndexes({
        allowComputeMissingBounds,
      });
    }
    state.hitCanvasDirty = true;
    recordRenderPerfMetric("buildSpatialIndex", nowMs() - startedAt, {
      landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
      spatialItems: state.spatialItems.length,
      waterItems: state.waterSpatialItems.length,
      specialItems: state.specialSpatialItems.length,
      skipped: false,
    });
  }

  async function buildIndexChunked({
    scheduleUiMode = "immediate",
    keepReady = false,
  } = {}) {
    setInteractionInfrastructureState("building-index", {
      ready: keepReady ? true : false,
      inFlight: true,
    });
    await yieldToMain();
    state.landIndex.clear();
    state.countryToFeatureIds.clear();
    state.idToKey.clear();
    state.keyToId.clear();
    rebuildAuxiliaryRegionIndexes();

    const features = Array.isArray(state.landData?.features) ? state.landData.features : [];
    if (!features.length) {
      queueIndexUiRefresh({
        renderCountryList: true,
        renderWaterRegionList: true,
        renderSpecialRegionList: true,
      }, scheduleUiMode);
      finalizeIndexBuildEffects();
      await yieldToMain();
      return;
    }

    for (let start = 0; start < features.length; start += chunkedIndexBuildSliceSize) {
      const end = Math.min(features.length, start + chunkedIndexBuildSliceSize);
      for (let index = start; index < end; index += 1) {
        const feature = features[index];
        const id = getFeatureId(feature) || `feature-${index}`;
        state.landIndex.set(id, feature);
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
      if (end < features.length) {
        await yieldToMain();
      }
    }

    queueIndexUiRefresh({
      renderCountryList: true,
      renderWaterRegionList: true,
      renderSpecialRegionList: true,
    }, scheduleUiMode);
    finalizeIndexBuildEffects();
    await yieldToMain();
  }

  async function buildSpatialIndexChunked({
    includeSecondary = true,
    allowComputeMissingBounds = true,
    keepReady = false,
  } = {}) {
    setInteractionInfrastructureState("building-spatial", {
      ready: keepReady ? true : false,
      inFlight: true,
    });
    await yieldToMain();
    const startedAt = nowMs();
    const features = Array.isArray(state.landData?.features) ? state.landData.features : [];
    if (!features.length || !getPathSvg()) {
      recordRenderPerfMetric("buildSpatialIndex", nowMs() - startedAt, {
        landCount: features.length,
        spatialItems: 0,
        waterItems: 0,
        specialItems: 0,
        skipped: true,
        chunked: true,
      });
      await yieldToMain();
      return;
    }

    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    const nextSpatialItems = [];
    for (let start = 0; start < features.length; start += chunkedSpatialBuildSliceSize) {
      const end = Math.min(features.length, start + chunkedSpatialBuildSliceSize);
      for (let index = start; index < end; index += 1) {
        const feature = features[index];
        const id = getFeatureId(feature);
        if (!id) continue;
        if (shouldExcludePoliticalInteractionFeature(feature, id)) continue;
        if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) continue;
        const bounds = getProjectedFeatureBounds(feature, {
          featureId: id,
          allowCompute: allowComputeMissingBounds,
        });
        if (!bounds) continue;
        nextSpatialItems.push({
          id,
          drawOrder: index,
          feature,
          countryCode: getFeatureCountryCodeNormalized(feature),
          source: String(feature?.properties?.__source || "primary"),
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY,
          bboxArea: bounds.area,
        });
      }
      if (end < features.length) {
        await yieldToMain();
      }
    }

    const previousItems = state.spatialItems;
    const previousGrid = state.spatialGrid;
    const previousGridMeta = state.spatialGridMeta;
    const previousItemsById = state.spatialItemsById;
    state.spatialItems = nextSpatialItems;
    buildSpatialGrid(nextSpatialItems, canvasWidth, canvasHeight);
    const nextGrid = state.spatialGrid;
    const nextGridMeta = state.spatialGridMeta;
    const nextItemsById = state.spatialItemsById;
    state.spatialItems = previousItems;
    state.spatialGrid = previousGrid;
    state.spatialGridMeta = previousGridMeta;
    state.spatialItemsById = previousItemsById;

    state.spatialItems = nextSpatialItems;
    state.spatialIndex = null;
    state.spatialGrid = nextGrid;
    state.spatialGridMeta = nextGridMeta;
    state.spatialItemsById = nextItemsById;
    resetSecondarySpatialIndexState();
    if (includeSecondary) {
      buildSecondarySpatialIndexes({
        allowComputeMissingBounds,
      });
    }
    state.hitCanvasDirty = true;
    recordRenderPerfMetric("buildSpatialIndex", nowMs() - startedAt, {
      landCount: features.length,
      spatialItems: state.spatialItems.length,
      waterItems: state.waterSpatialItems.length,
      specialItems: state.specialSpatialItems.length,
      skipped: false,
      chunked: true,
    });
    await yieldToMain();
  }

  return {
    buildIndex,
    resetSecondarySpatialIndexState,
    buildSecondarySpatialIndexes,
    buildSpatialIndex,
    buildIndexChunked,
    buildSpatialIndexChunked,
  };
}

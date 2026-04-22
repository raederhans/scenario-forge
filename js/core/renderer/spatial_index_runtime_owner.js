import {
  createDefaultSecondarySpatialIndexState,
  createDefaultSpatialIndexState,
} from "../state/spatial_index_state.js";

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
    rebuildAuxiliaryRegionIndexes = () => {},
    getLogicalCanvasDimensions = () => [1, 1],
    computeProjectedFeatureBounds = () => null,
    getResolvedFeatureColor = () => null,
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

  // buildIndex 负责主索引映射层（landIndex/countryToFeatureIds/idToKey/keyToId），
  // 为渲染与交互提供 feature-id 级别的稳定检索键；空间网格由 buildSpatialIndex 系列负责。
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
    const defaults = createDefaultSecondarySpatialIndexState();
    state.waterSpatialItems = defaults.waterSpatialItems;
    state.waterSpatialIndex = defaults.waterSpatialIndex;
    state.waterSpatialGrid = defaults.waterSpatialGrid;
    state.waterSpatialGridMeta = defaults.waterSpatialGridMeta;
    state.waterSpatialItemsById = defaults.waterSpatialItemsById;
    state.specialSpatialItems = defaults.specialSpatialItems;
    state.specialSpatialIndex = defaults.specialSpatialIndex;
    state.specialSpatialGrid = defaults.specialSpatialGrid;
    state.specialSpatialGridMeta = defaults.specialSpatialGridMeta;
    state.specialSpatialItemsById = defaults.specialSpatialItemsById;
  }

  function rebuildRuntimePrimaryIndex({
    projectedBoundsCache = null,
    collectResolvedColor = () => {},
  } = {}) {
    state.landIndex.clear();
    state.countryToFeatureIds.clear();
    state.idToKey.clear();
    state.keyToId.clear();
    rebuildAuxiliaryRegionIndexes();

    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

    if (state.landData?.features?.length) {
      state.landData.features.forEach((feature, index) => {
        const id = getFeatureId(feature) || `feature-${index}`;
        if (!id) return;
        state.landIndex.set(id, feature);
        if (!shouldExcludePoliticalInteractionFeature(feature, id)) {
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
        const bounds = computeProjectedFeatureBounds(feature);
        if (bounds && projectedBoundsCache?.set) {
          projectedBoundsCache.set(id, bounds);
        }
        if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) {
          return;
        }
        const resolvedColor = getResolvedFeatureColor(feature, id);
        if (resolvedColor) {
          collectResolvedColor(id, resolvedColor);
        }
      });
    }

    if (state.riversData?.features?.length && projectedBoundsCache?.set) {
      state.riversData.features.forEach((feature) => {
        const featureId = getFeatureId(feature);
        if (!featureId) return;
        const bounds = computeProjectedFeatureBounds(feature);
        if (!bounds) return;
        projectedBoundsCache.set(featureId, bounds);
      });
    }
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

  // buildSpatialIndex 负责主空间索引（state.spatialItems + state.spatialGrid + spatialGridMeta），
  // 并在 includeSecondary=true 时追加 water/special 次级索引，确保命中测试共享统一网格语义。
  function buildSpatialIndex({
    includeSecondary = true,
    allowComputeMissingBounds = true,
  } = {}) {
    const startedAt = nowMs();
    const defaults = createDefaultSpatialIndexState();
    state.spatialItems = defaults.spatialItems;
    state.spatialIndex = defaults.spatialIndex;
    state.spatialGrid = defaults.spatialGrid;
    state.spatialGridMeta = defaults.spatialGridMeta;
    state.spatialItemsById = defaults.spatialItemsById;
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

  // buildSpatialIndexChunked 与 buildSpatialIndex 产物一致，差异在于分片构建与让出主线程；
  // 它先在临时容器生成 nextSpatialItems/nextGrid/spatialGridMeta，再原子替换到 state，
  // 这样 UI 在大数据量下保持响应，同时延续主索引与次级索引的同一失效策略。
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
    rebuildRuntimePrimaryIndex,
    resetSecondarySpatialIndexState,
    buildSecondarySpatialIndexes,
    buildSpatialIndex,
    buildIndexChunked,
    buildSpatialIndexChunked,
  };
}

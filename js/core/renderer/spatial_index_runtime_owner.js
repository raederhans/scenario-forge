import {
  createDefaultSecondarySpatialIndexState,
  createDefaultSpatialIndexState,
} from "../state/spatial_index_state.js";
import {
  appendLandIndexEntriesRange,
  appendLandSpatialItemsRange,
  buildSpecialSpatialItems,
  buildWaterSpatialItems,
  captureSpatialGridBuild,
} from "./spatial_index_runtime_builders.js";

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
    appendLandIndexEntriesRange({
      state,
      features: state.landData.features,
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
      getFeatureCountryCodeNormalized,
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
    appendLandIndexEntriesRange({
      state,
      features: Array.isArray(state.landData?.features) ? state.landData.features : [],
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
      getFeatureCountryCodeNormalized,
      onLandFeatureIndexed: ({ feature, id }) => {
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
      },
    });

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
    state.waterSpatialItems = buildWaterSpatialItems({
      features: getEffectiveWaterRegionFeatures(),
      getFeatureId,
      collectFeatureHitGeometries,
      computeProjectedGeoBounds,
    });
    const waterGridSnapshot = captureSpatialGridBuild({
      state,
      items: state.waterSpatialItems,
      canvasWidth,
      canvasHeight,
      buildSpatialGrid,
    });
    state.waterSpatialGrid = waterGridSnapshot.grid;
    state.waterSpatialGridMeta = waterGridSnapshot.gridMeta;
    state.waterSpatialItemsById = waterGridSnapshot.itemsById;

    state.specialSpatialItems = buildSpecialSpatialItems({
      features: getEffectiveSpecialRegionFeatures(),
      allowComputeMissingBounds,
      getFeatureId,
      getProjectedFeatureBounds,
    });
    const specialGridSnapshot = captureSpatialGridBuild({
      state,
      items: state.specialSpatialItems,
      canvasWidth,
      canvasHeight,
      buildSpatialGrid,
    });
    state.specialSpatialGrid = specialGridSnapshot.grid;
    state.specialSpatialGridMeta = specialGridSnapshot.gridMeta;
    state.specialSpatialItemsById = specialGridSnapshot.itemsById;
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

    appendLandSpatialItemsRange({
      targetItems: state.spatialItems,
      features: state.landData.features,
      canvasWidth,
      canvasHeight,
      allowComputeMissingBounds,
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
      shouldSkipFeature,
      getProjectedFeatureBounds,
      getFeatureCountryCodeNormalized,
    });

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
      appendLandIndexEntriesRange({
        state,
        features,
        start,
        end,
        getFeatureId,
        shouldExcludePoliticalInteractionFeature,
        getFeatureCountryCodeNormalized,
      });
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
      appendLandSpatialItemsRange({
        targetItems: nextSpatialItems,
        features,
        start,
        end,
        canvasWidth,
        canvasHeight,
        allowComputeMissingBounds,
        getFeatureId,
        shouldExcludePoliticalInteractionFeature,
        shouldSkipFeature,
        getProjectedFeatureBounds,
        getFeatureCountryCodeNormalized,
      });
      if (end < features.length) {
        await yieldToMain();
      }
    }
    const nextGridSnapshot = captureSpatialGridBuild({
      state,
      items: nextSpatialItems,
      canvasWidth,
      canvasHeight,
      buildSpatialGrid,
    });

    state.spatialItems = nextSpatialItems;
    state.spatialIndex = null;
    state.spatialGrid = nextGridSnapshot.grid;
    state.spatialGridMeta = nextGridSnapshot.gridMeta;
    state.spatialItemsById = nextGridSnapshot.itemsById;
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

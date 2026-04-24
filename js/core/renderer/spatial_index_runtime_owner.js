import {
  appendLandIndexEntriesRange,
  appendLandSpatialItemsRange,
  buildSpecialSpatialItems,
  buildWaterSpatialItems,
  captureSpatialGridBuild,
} from "./spatial_index_runtime_builders.js";
import {
  applyPrimarySpatialSnapshot,
  applySecondarySpatialSnapshot,
  clearPrimaryIndexMaps,
  resetPrimarySpatialState,
  resetSecondarySpatialState,
} from "./spatial_index_runtime_state_ops.js";
import {
  createSpatialIndexPerfPayload,
  deriveRuntimePrimaryFeaturePayload,
} from "./spatial_index_runtime_derivation.js";

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
    getFeatureBorderMeshCountryCodeNormalized = () => "",
    getProjectedFeatureBounds = () => null,
    shouldExcludePoliticalInteractionFeature = () => false,
    shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature,
    buildSpatialGrid = () => {},
    nowMs = () => 0,
    recordRenderPerfMetric = () => {},
    setInteractionInfrastructureState = () => {},
    yieldToMain = async () => {},
    getEffectiveWaterRegionFeatures = () => [],
    getEffectiveSpecialRegionFeatures = () => [],
    collectFeatureHitGeometries = () => [],
    computeProjectedGeoBounds = () => null,
    shouldExcludeWaterHitGeometry = () => false,
  } = helpers;

  // buildIndex 负责主索引映射层（landIndex/countryToFeatureIds/idToKey/keyToId），
  // 为渲染与交互提供 feature-id 级别的稳定检索键；空间网格由 buildSpatialIndex 系列负责。
  function buildIndex({ scheduleUiMode = "immediate" } = {}) {
    clearPrimaryIndexMaps(state);
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
    resetSecondarySpatialState(state);
  }

  function rebuildRuntimePrimaryIndex({
    projectedBoundsCache = null,
    collectResolvedColor = () => {},
  } = {}) {
    clearPrimaryIndexMaps(state);
    rebuildAuxiliaryRegionIndexes();

    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    appendLandIndexEntriesRange({
      state,
      features: Array.isArray(state.landData?.features) ? state.landData.features : [],
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
      getFeatureCountryCodeNormalized,
      onLandFeatureIndexed: ({ feature, id }) => {
        const payload = deriveRuntimePrimaryFeaturePayload({
          feature,
          id,
          canvasWidth,
          canvasHeight,
          projectedBoundsCache,
          computeProjectedFeatureBounds,
          shouldSkipFeature,
          getResolvedFeatureColor,
        });
        if (payload.skipped) {
          return;
        }
        if (payload.resolvedColor) {
          collectResolvedColor(id, payload.resolvedColor);
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
    const waterItems = buildWaterSpatialItems({
      features: getEffectiveWaterRegionFeatures(),
      getFeatureId,
      collectFeatureHitGeometries,
      computeProjectedGeoBounds,
      shouldExcludeWaterHitGeometry,
    });
    const waterGridSnapshot = captureSpatialGridBuild({
      state,
      items: waterItems,
      canvasWidth,
      canvasHeight,
      buildSpatialGrid,
    });

    const specialItems = buildSpecialSpatialItems({
      features: getEffectiveSpecialRegionFeatures(),
      allowComputeMissingBounds,
      getFeatureId,
      getProjectedFeatureBounds,
    });
    const specialGridSnapshot = captureSpatialGridBuild({
      state,
      items: specialItems,
      canvasWidth,
      canvasHeight,
      buildSpatialGrid,
    });
    applySecondarySpatialSnapshot(state, {
      water: {
        items: waterItems,
        grid: waterGridSnapshot.grid,
        gridMeta: waterGridSnapshot.gridMeta,
        itemsById: waterGridSnapshot.itemsById,
      },
      special: {
        items: specialItems,
        grid: specialGridSnapshot.grid,
        gridMeta: specialGridSnapshot.gridMeta,
        itemsById: specialGridSnapshot.itemsById,
      },
    });
  }

  // buildSpatialIndex 负责主空间索引（state.spatialItems + state.spatialGrid + spatialGridMeta），
  // 并在 includeSecondary=true 时追加 water/special 次级索引，确保命中测试共享统一网格语义。
  function buildSpatialIndex({
    includeSecondary = true,
    allowComputeMissingBounds = true,
  } = {}) {
    const startedAt = nowMs();
    resetPrimarySpatialState(state);
    resetSecondarySpatialState(state);
    if (!state.landData || !state.landData.features || !getPathSvg()) {
      recordRenderPerfMetric(
        "buildSpatialIndex",
        nowMs() - startedAt,
        createSpatialIndexPerfPayload({
          landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
          skipped: true,
        }),
      );
      return;
    }
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

    const nextSpatialItems = [];
    appendLandSpatialItemsRange({
      targetItems: nextSpatialItems,
      features: state.landData.features,
      canvasWidth,
      canvasHeight,
      allowComputeMissingBounds,
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
      shouldExcludePoliticalVisualFeature,
      shouldSkipFeature,
      getProjectedFeatureBounds,
      getFeatureCountryCodeNormalized,
      getFeatureBorderMeshCountryCodeNormalized,
    });
    const nextGridSnapshot = captureSpatialGridBuild({
      state,
      items: nextSpatialItems,
      canvasWidth,
      canvasHeight,
      buildSpatialGrid,
    });
    applyPrimarySpatialSnapshot(state, {
      items: nextSpatialItems,
      grid: nextGridSnapshot.grid,
      gridMeta: nextGridSnapshot.gridMeta,
      itemsById: nextGridSnapshot.itemsById,
    });
    if (includeSecondary) {
      buildSecondarySpatialIndexes({
        allowComputeMissingBounds,
      });
    }
    state.hitCanvasDirty = true;
    recordRenderPerfMetric(
      "buildSpatialIndex",
      nowMs() - startedAt,
      createSpatialIndexPerfPayload({
        landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
        spatialItems: state.spatialItems.length,
        waterItems: state.waterSpatialItems.length,
        specialItems: state.specialSpatialItems.length,
      }),
    );
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
    clearPrimaryIndexMaps(state);
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
      recordRenderPerfMetric(
        "buildSpatialIndex",
        nowMs() - startedAt,
        createSpatialIndexPerfPayload({
          landCount: features.length,
          skipped: true,
          chunked: true,
        }),
      );
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
        shouldExcludePoliticalVisualFeature,
        shouldSkipFeature,
        getProjectedFeatureBounds,
        getFeatureCountryCodeNormalized,
        getFeatureBorderMeshCountryCodeNormalized,
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
    applyPrimarySpatialSnapshot(state, {
      items: nextSpatialItems,
      grid: nextGridSnapshot.grid,
      gridMeta: nextGridSnapshot.gridMeta,
      itemsById: nextGridSnapshot.itemsById,
    });
    resetSecondarySpatialState(state);
    if (includeSecondary) {
      buildSecondarySpatialIndexes({
        allowComputeMissingBounds,
      });
    }
    state.hitCanvasDirty = true;
    recordRenderPerfMetric(
      "buildSpatialIndex",
      nowMs() - startedAt,
      createSpatialIndexPerfPayload({
        landCount: features.length,
        spatialItems: state.spatialItems.length,
        waterItems: state.waterSpatialItems.length,
        specialItems: state.specialSpatialItems.length,
        chunked: true,
      }),
    );
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

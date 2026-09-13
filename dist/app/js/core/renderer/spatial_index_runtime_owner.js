import {
  appendLandIndexEntriesRange,
  appendLandSpatialItemsRange,
  buildSpecialSpatialItems,
  buildWaterSpatialItems,
  captureSpatialGridBuild,
  reconcileSpatialGridSnapshot,
} from "./spatial_index_runtime_builders.js";
import {
  applyPrimarySpatialSnapshot,
  applySecondarySpatialSnapshot,
  clearPrimaryIndexMaps,
  markSecondarySpatialBuildPending,
  resetPrimarySpatialState,
} from "./spatial_index_runtime_state_ops.js";
import {
  createSpatialIndexPerfPayload,
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
    hitGridTargetCols,
    hitGridMinCellPx,
    hitGridMaxCellPx,
    hitMaxCellsPerItem,
  } = constants;

  const {
    getPathSvg = () => null,
  } = getters;

  const {
    rebuildAuxiliaryRegionIndexes = () => {},
    getLogicalCanvasDimensions = () => [1, 1],
    computeProjectedFeatureBounds = () => null,
    shouldSkipFeature = () => false,
    queueIndexUiRefresh = () => {},
    finalizeIndexBuildEffects = () => {},
    getFeatureId = () => "",
    getFeatureCountryCodeNormalized = () => "",
    getFeatureBorderMeshCountryCodeNormalized = () => "",
    getProjectedFeatureBounds = () => null,
    shouldExcludePoliticalInteractionFeature = () => false,
    shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature,
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

  function resetSecondarySpatialIndexState({
    preserveCurrent = false,
    reason = "secondary-spatial-reset",
  } = {}) {
    markSecondarySpatialBuildPending(state, {
      reason,
      preserveCurrent,
    });
  }

  function rebuildRuntimePrimaryIndex({
    projectedBoundsCache = null,
  } = {}) {
    clearPrimaryIndexMaps(state);
    rebuildAuxiliaryRegionIndexes();

    // This phase prepares IDs and bounds. Culling belongs to spatial item creation,
    // where its result is consumed, rather than this unconditional index rebuild.
    const cacheFeatureBounds = (feature, id) => {
      if (!id || !projectedBoundsCache?.set) return;
      const bounds = computeProjectedFeatureBounds(feature);
      if (bounds) projectedBoundsCache.set(id, bounds);
    };
    appendLandIndexEntriesRange({
      state,
      features: Array.isArray(state.landData?.features) ? state.landData.features : [],
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
      getFeatureCountryCodeNormalized,
      onLandFeatureIndexed: ({ feature, id }) => {
        cacheFeatureBounds(feature, id);
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

  function reconcileRuntimePrimaryIndex({ projectedBoundsCache = null } = {}) {
    if (![state.landIndex, state.countryToFeatureIds, state.idToKey, state.keyToId].every((map) => map instanceof Map)) {
      rebuildRuntimePrimaryIndex({ projectedBoundsCache });
      return;
    }
    const features = Array.isArray(state.landData?.features) ? state.landData.features : [];
    const nextIds = new Set();
    const nextKeys = new Map();
    const countries = new Map();
    for (let index = 0; index < features.length; index += 1) {
      const feature = features[index];
      const id = getFeatureId(feature) || `feature-${index}`;
      nextIds.add(id);
      if (state.landIndex.get(id) !== feature) state.landIndex.set(id, feature);
      const bounds = getProjectedFeatureBounds(feature, { featureId: id, allowCompute: true });
      if (bounds) projectedBoundsCache?.set(id, bounds);
      if (shouldExcludePoliticalInteractionFeature(feature, id)) continue;
      const country = getFeatureCountryCodeNormalized(feature);
      if (country) {
        if (!countries.has(country)) countries.set(country, []);
        countries.get(country).push(id);
      }
      nextKeys.set(id, index + 1);
    }
    for (const id of state.landIndex.keys()) if (!nextIds.has(id)) state.landIndex.delete(id);
    for (const id of state.idToKey.keys()) if (!nextKeys.has(id)) state.idToKey.delete(id);
    const keyIds = new Map();
    for (const [id, key] of nextKeys) {
      if (state.idToKey.get(id) !== key) state.idToKey.set(id, key);
      keyIds.set(key, id);
      if (state.keyToId.get(key) !== id) state.keyToId.set(key, id);
    }
    for (const key of state.keyToId.keys()) if (!keyIds.has(key)) state.keyToId.delete(key);
    for (const country of state.countryToFeatureIds.keys()) if (!countries.has(country)) state.countryToFeatureIds.delete(country);
    for (const [country, ids] of countries) {
      const previous = state.countryToFeatureIds.get(country);
      if (!previous || previous.length !== ids.length || previous.some((id, index) => id !== ids[index])) {
        state.countryToFeatureIds.set(country, ids);
      }
    }
    for (const feature of state.riversData?.features || []) {
      const id = getFeatureId(feature);
      if (!id) continue;
      const bounds = getProjectedFeatureBounds(feature, { featureId: id, allowCompute: true });
      if (bounds) projectedBoundsCache?.set(id, bounds);
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
      items: waterItems,
      canvasWidth,
      canvasHeight,
      hitGridTargetCols,
      hitGridMinCellPx,
      hitGridMaxCellPx,
      hitMaxCellsPerItem,
    });

    const specialItems = buildSpecialSpatialItems({
      features: getEffectiveSpecialRegionFeatures(),
      allowComputeMissingBounds,
      getFeatureId,
      getProjectedFeatureBounds,
    });
    const specialGridSnapshot = captureSpatialGridBuild({
      items: specialItems,
      canvasWidth,
      canvasHeight,
      hitGridTargetCols,
      hitGridMinCellPx,
      hitGridMaxCellPx,
      hitMaxCellsPerItem,
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
      reason: "secondary-spatial-build",
    });
  }

  // buildSpatialIndex 负责主空间索引（state.spatialItems + state.spatialGrid + spatialGridMeta），
  // 并在 includeSecondary=true 时追加 water/special 次级索引，确保命中测试共享统一网格语义。
  function buildSpatialIndex({
    includeSecondary = true,
    allowComputeMissingBounds = true,
    reuseExisting = false,
  } = {}) {
    const startedAt = nowMs();
    const previous = reuseExisting ? { grid: state.spatialGrid, gridMeta: state.spatialGridMeta, itemsById: state.spatialItemsById } : null;
    if (!reuseExisting) resetPrimarySpatialState(state);
    markSecondarySpatialBuildPending(state, {
      reason: "primary-spatial-rebuild",
      preserveCurrent: true,
    });
    if (!state.landData || !state.landData.features || !getPathSvg()) {
      if (reuseExisting) resetPrimarySpatialState(state);
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
    const appendOptions = {
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
    };
    const sameLayout = previous?.gridMeta?.width === Math.max(1, canvasWidth || 1)
      && previous?.gridMeta?.height === Math.max(1, canvasHeight || 1);
    let reusedItems = 0;
    if (!sameLayout) appendLandSpatialItemsRange(appendOptions);
    for (let index = 0; sameLayout && index < state.landData.features.length; index += 1) {
      const feature = state.landData.features[index];
      const item = sameLayout ? previous?.itemsById?.get(getFeatureId(feature)) : null;
      if (item && item.feature === feature) {
        // Inserting an earlier chunk shifts draw order without changing bounds.
        nextSpatialItems.push(item.drawOrder === index ? item : { ...item, drawOrder: index });
        reusedItems += 1;
      } else {
        appendLandSpatialItemsRange({ ...appendOptions, start: index, end: index + 1 });
      }
    }
    const gridOptions = {
      items: nextSpatialItems,
      canvasWidth,
      canvasHeight,
      hitGridTargetCols,
      hitGridMinCellPx,
      hitGridMaxCellPx,
      hitMaxCellsPerItem,
    };
    const nextGridSnapshot = reuseExisting
      ? reconcileSpatialGridSnapshot(previous, gridOptions)
      : captureSpatialGridBuild(gridOptions);
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
    if (reuseExisting) recordRenderPerfMetric("reconcileSpatialIndex", nowMs() - startedAt, {
      reusedItems, rebuiltItems: nextSpatialItems.length - reusedItems,
    });
    recordRenderPerfMetric(
      "buildSpatialIndex",
      nowMs() - startedAt,
      createSpatialIndexPerfPayload({
        landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
        spatialItems: state.spatialItems.length,
        waterItems: state.waterSpatialItems.length,
        specialItems: state.specialSpatialItems.length,
        spatialGridCells: state.spatialGrid?.size || 0,
        spatialGridGlobals: state.spatialGridMeta?.globals?.length || 0,
        waterGridCells: state.waterSpatialGrid?.size || 0,
        waterGridGlobals: state.waterSpatialGridMeta?.globals?.length || 0,
        specialGridCells: state.specialSpatialGrid?.size || 0,
        specialGridGlobals: state.specialSpatialGridMeta?.globals?.length || 0,
      }),
    );
  }

  async function buildIndexChunked({
    scheduleUiMode = "immediate",
    keepReady = false,
    isCurrent = () => true,
    yieldControl = yieldToMain,
  } = {}) {
    if (!isCurrent()) return false;
    setInteractionInfrastructureState("building-index", {
      ready: keepReady ? true : false,
      inFlight: true,
    });
    await yieldControl();
    if (!isCurrent()) return false;
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
      await yieldControl();
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
        await yieldControl();
        if (!isCurrent()) return false;
      }
    }

    queueIndexUiRefresh({
      renderCountryList: true,
      renderWaterRegionList: true,
      renderSpecialRegionList: true,
    }, scheduleUiMode);
    finalizeIndexBuildEffects();
    await yieldControl();
  }

  // buildSpatialIndexChunked 与 buildSpatialIndex 产物一致，差异在于分片构建与让出主线程；
  // 它先在临时容器生成 nextSpatialItems/nextGrid/spatialGridMeta，再原子替换到 state，
  // 这样 UI 在大数据量下保持响应，同时延续主索引与次级索引的同一失效策略。
  async function buildSpatialIndexChunked({
    includeSecondary = true,
    allowComputeMissingBounds = true,
    keepReady = false,
    isCurrent = () => true,
    yieldControl = yieldToMain,
  } = {}) {
    if (!isCurrent()) return false;
    setInteractionInfrastructureState("building-spatial", {
      ready: keepReady ? true : false,
      inFlight: true,
    });
    await yieldControl();
    if (!isCurrent()) return false;
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
      await yieldControl();
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
        await yieldControl();
        if (!isCurrent()) return false;
      }
    }
    const nextGridSnapshot = captureSpatialGridBuild({
      items: nextSpatialItems,
      canvasWidth,
      canvasHeight,
      hitGridTargetCols,
      hitGridMinCellPx,
      hitGridMaxCellPx,
      hitMaxCellsPerItem,
    });
    applyPrimarySpatialSnapshot(state, {
      items: nextSpatialItems,
      grid: nextGridSnapshot.grid,
      gridMeta: nextGridSnapshot.gridMeta,
      itemsById: nextGridSnapshot.itemsById,
    });
    markSecondarySpatialBuildPending(state, {
      reason: "primary-spatial-chunked-rebuild",
      preserveCurrent: true,
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
        landCount: features.length,
        spatialItems: state.spatialItems.length,
        waterItems: state.waterSpatialItems.length,
        specialItems: state.specialSpatialItems.length,
        spatialGridCells: state.spatialGrid?.size || 0,
        spatialGridGlobals: state.spatialGridMeta?.globals?.length || 0,
        waterGridCells: state.waterSpatialGrid?.size || 0,
        waterGridGlobals: state.waterSpatialGridMeta?.globals?.length || 0,
        specialGridCells: state.specialSpatialGrid?.size || 0,
        specialGridGlobals: state.specialSpatialGridMeta?.globals?.length || 0,
        chunked: true,
      }),
    );
    await yieldControl();
  }

  return {
    buildIndex,
    rebuildRuntimePrimaryIndex,
    reconcileRuntimePrimaryIndex,
    resetSecondarySpatialIndexState,
    buildSecondarySpatialIndexes,
    buildSpatialIndex,
    buildIndexChunked,
    buildSpatialIndexChunked,
  };
}

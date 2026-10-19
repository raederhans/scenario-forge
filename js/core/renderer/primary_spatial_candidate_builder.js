import { appendLandSpatialItemsRange, iterateSpatialGridSnapshot } from "./spatial_index_runtime_builders.js";

const MAX_PICKING_KEY = 0xffffff;
const PRIMARY_FIELDS = ["landIndex", "countryToFeatureIds", "idToKey", "keyToId",
  "spatialItems", "spatialGrid", "spatialGridMeta", "spatialItemsById", "projectedBoundsById"];

// Preparation owns only new containers. The caller's isCurrent must cover the
// scene/projection, source collection and semantic/paint revisions it captures.
export function createPrimarySpatialCandidateBuilder({ state, helpers, gridConstants, getPathSvg, publish }) {
  let generation = 0;
  const prepared = new WeakMap();
  const invalidate = () => { generation += 1; };
  const { getLogicalCanvasDimensions, getFeatureId, computeProjectedFeatureBounds,
    shouldExcludePoliticalInteractionFeature, nowMs, yieldToMain } = helpers;

  async function preparePrimarySpatialCandidateChunked({
    features = [], riverFeatures = [], incrementalDelta = null,
    projectedBoundsCache = state.projectedBoundsById,
    isCurrent = () => true, yieldControl = yieldToMain,
  } = {}) {
    const version = ++generation;
    const featureCount = features.length, riverCount = riverFeatures.length;
    const featureSources = features.slice(), riverSources = riverFeatures.slice();
    const basis = PRIMARY_FIELDS.map((key) => state[key]);
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    const path = getPathSvg();
    const current = () => version === generation && isCurrent() && getPathSvg() === path
      && getLogicalCanvasDimensions()[0] === canvasWidth && getLogicalCanvasDimensions()[1] === canvasHeight
      && PRIMARY_FIELDS.every((key, index) => state[key] === basis[index]);
    const candidate = { landIndex: new Map(), countryToFeatureIds: new Map(),
      idToKey: new Map(), keyToId: new Map(), projectedBoundsById: new Map(), spatialItems: [] };
    const sources = [];
    const changedIds = incrementalDelta ? new Set(incrementalDelta.changedIds) : null;
    let reusedItems = 0, computedBounds = 0, compactedKeys = false;
    function* prepare() {
      let nextKey = 1;
      if (incrementalDelta) {
        for (const key of state.keyToId?.keys() || []) { nextKey = Math.max(nextKey, key + 1); yield; }
        for (const [id, bounds] of projectedBoundsCache || []) { candidate.projectedBoundsById.set(id, bounds); yield; }
      }
      const sameLayout = state.spatialGridMeta?.width === Math.max(1, canvasWidth || 1)
        && state.spatialGridMeta?.height === Math.max(1, canvasHeight || 1);
      const cacheBounds = (feature, id, unchanged) => {
        if (unchanged && projectedBoundsCache?.has(id)) return;
        candidate.projectedBoundsById.delete(id);
        const bounds = computeProjectedFeatureBounds(feature);
        computedBounds += 1;
        if (bounds) candidate.projectedBoundsById.set(id, bounds);
      };
      const rememberSource = (collection, index, feature) => sources.push({ collection, index, feature,
        geometry: feature.geometry, properties: feature.properties, id: getFeatureId(feature) });
      for (let index = 0; index < featureCount; index += 1) {
        const feature = featureSources[index];
        const id = getFeatureId(feature) || `feature-${index}`;
        rememberSource(features, index, feature);
        candidate.landIndex.set(id, feature);
        const unchanged = !!incrementalDelta && !changedIds.has(id) && state.landIndex?.get(id) === feature;
        cacheBounds(feature, id, unchanged);
        if (!shouldExcludePoliticalInteractionFeature(feature, id)) {
          const country = helpers.getFeatureCountryCodeNormalized(feature);
          if (country) {
            if (!candidate.countryToFeatureIds.has(country)) candidate.countryToFeatureIds.set(country, []);
            candidate.countryToFeatureIds.get(country).push(id);
          }
          const key = incrementalDelta ? (state.idToKey?.get(id) || nextKey++) : index + 1;
          compactedKeys ||= key > MAX_PICKING_KEY;
          candidate.idToKey.set(id, key);
          candidate.keyToId.set(key, id);
        }
        const previousItem = unchanged && sameLayout ? state.spatialItemsById?.get(id) : null;
        if (previousItem?.feature === feature) {
          candidate.spatialItems.push(previousItem.drawOrder === index ? previousItem : { ...previousItem, drawOrder: index });
          reusedItems += 1;
        } else if (path) {
          appendLandSpatialItemsRange({ ...helpers, targetItems: candidate.spatialItems,
            features: featureSources, start: index, end: index + 1, canvasWidth, canvasHeight,
            allowComputeMissingBounds: false,
            getProjectedFeatureBounds: (_feature, { featureId }) => candidate.projectedBoundsById.get(featureId) || null });
        }
        yield;
      }
      if (incrementalDelta) for (const id of state.landIndex?.keys() || []) {
        if (!candidate.landIndex.has(id)) candidate.projectedBoundsById.delete(id);
        yield;
      }
      if (compactedKeys) {
        candidate.idToKey.clear(); candidate.keyToId.clear();
        for (let index = 0; index < featureCount; index += 1) {
          const feature = featureSources[index], id = getFeatureId(feature) || `feature-${index}`;
          if (!shouldExcludePoliticalInteractionFeature(feature, id)) {
            if (index + 1 > MAX_PICKING_KEY) return false;
            candidate.idToKey.set(id, index + 1); candidate.keyToId.set(index + 1, id);
          }
          yield;
        }
      }
      for (let index = 0; index < riverCount; index += 1) {
        const feature = riverSources[index], id = getFeatureId(feature);
        rememberSource(riverFeatures, index, feature);
        if (id) cacheBounds(feature, id, false);
        yield;
      }
      const grid = yield* iterateSpatialGridSnapshot({ ...gridConstants,
        items: candidate.spatialItems, canvasWidth, canvasHeight });
      candidate.spatialGrid = grid.grid;
      candidate.spatialGridMeta = grid.gridMeta;
      candidate.spatialItemsById = grid.itemsById;
      // This validation also runs in bounded slices, rather than an O(N)
      // scan inside the eventual synchronous publication boundary.
      for (const source of sources) {
        if (source.collection[source.index] !== source.feature
          || source.feature.geometry !== source.geometry || source.feature.properties !== source.properties
          || getFeatureId(source.feature) !== source.id) return false;
        yield;
      }
      return features.length === featureCount && riverFeatures.length === riverCount;
    }
    let yieldCount = 0, maxSliceMs = 0, sliceStartedAt = nowMs();
    const result = (status) => ({ status, yieldCount, maxSliceMs: Math.max(maxSliceMs, nowMs() - sliceStartedAt),
      computedBounds, reusedItems, compactedKeys, ...(status === "prepared" ? { candidate } : {}) });
    const checkpoint = async () => {
      maxSliceMs = Math.max(maxSliceMs, nowMs() - sliceStartedAt);
      yieldCount += 1; await yieldControl(); sliceStartedAt = nowMs();
      return current();
    };
    if (!current() || !await checkpoint()) return result("cancelled");
    const iterator = prepare();
    let steps = 0;
    while (true) {
      const step = iterator.next();
      if (step.done) {
        if (!step.value || !current()) return result("cancelled");
        prepared.set(candidate, () => current() && features.length === featureCount && riverFeatures.length === riverCount);
        return result("prepared");
      }
      if (++steps >= 400 || nowMs() - sliceStartedAt >= 6) {
        if (!await checkpoint()) return result("cancelled");
        steps = 0;
      }
    }
  }

  function isPrimarySpatialCandidateCurrent(candidate) {
    const valid = candidate && prepared.get(candidate);
    return !!valid?.();
  }

  function adoptPrimarySpatialCandidate(candidate) {
    if (!isPrimarySpatialCandidateCurrent(candidate)) return { status: "cancelled" };
    prepared.delete(candidate);
    invalidate();
    publish(candidate);
    return { status: "published", landFeatures: candidate.landIndex.size,
      spatialItems: candidate.spatialItems.length, gridCells: candidate.spatialGrid.size };
  }
  return { preparePrimarySpatialCandidateChunked, isPrimarySpatialCandidateCurrent, adoptPrimarySpatialCandidate, invalidate };
}

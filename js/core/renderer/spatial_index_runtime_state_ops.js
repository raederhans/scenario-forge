import {
  createDefaultSecondarySpatialIndexState,
  createDefaultSpatialIndexState,
} from "../state/spatial_index_state.js";
import { commitProjectedBoundsCacheState } from "../state/actions/renderer_cache_actions.js";

function ensureMapHolder(currentValue) {
  return currentValue instanceof Map ? currentValue : new Map();
}

export function clearPrimaryIndexMaps(state) {
  state.landIndex = ensureMapHolder(state.landIndex);
  state.countryToFeatureIds = ensureMapHolder(state.countryToFeatureIds);
  state.idToKey = ensureMapHolder(state.idToKey);
  state.keyToId = ensureMapHolder(state.keyToId);
  state.landIndex.clear();
  state.countryToFeatureIds.clear();
  state.idToKey.clear();
  state.keyToId.clear();
}

export function resetPrimarySpatialState(state) {
  const defaults = createDefaultSpatialIndexState();
  state.spatialItems = defaults.spatialItems;
  state.spatialIndex = defaults.spatialIndex;
  state.spatialGrid = defaults.spatialGrid;
  state.spatialGridMeta = defaults.spatialGridMeta;
  state.spatialItemsById = defaults.spatialItemsById;
}

export function resetSecondarySpatialState(state) {
  const defaults = createDefaultSecondarySpatialIndexState();
  state.secondarySpatialGeneration = Number(state.secondarySpatialGeneration || 0) + 1;
  state.secondarySpatialBuildPending = false;
  state.secondarySpatialLastReason = "";
  state.secondarySpatialPreservedDuringBuild = false;
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

export function markSecondarySpatialBuildPending(state, {
  reason = "secondary-spatial-build",
  preserveCurrent = false,
} = {}) {
  const normalizedReason = String(reason || "secondary-spatial-build");
  if (!preserveCurrent) {
    resetSecondarySpatialState(state);
  }
  state.secondarySpatialBuildPending = true;
  state.secondarySpatialLastReason = normalizedReason;
  state.secondarySpatialPreservedDuringBuild = !!preserveCurrent;
}

export function applyPrimarySpatialSnapshot(state, {
  items = [],
  grid = new Map(),
  gridMeta = null,
  itemsById = new Map(),
} = {}) {
  state.spatialItems = items;
  state.spatialIndex = null;
  state.spatialGrid = grid;
  state.spatialGridMeta = gridMeta;
  state.spatialItemsById = itemsById;
}

export function applyPrimarySpatialCandidate(state, candidate) {
  commitProjectedBoundsCacheState(state, {
    projectedBoundsById: candidate.projectedBoundsById,
    sphericalFeatureDiagnosticsById: state.sphericalFeatureDiagnosticsById || new Map(),
  });
  state.landIndex = candidate.landIndex;
  state.countryToFeatureIds = candidate.countryToFeatureIds;
  state.idToKey = candidate.idToKey;
  state.keyToId = candidate.keyToId;
  applyPrimarySpatialSnapshot(state, { items: candidate.spatialItems, grid: candidate.spatialGrid,
    gridMeta: candidate.spatialGridMeta, itemsById: candidate.spatialItemsById });
  state.hitCanvasDirty = true;
}

export function applySecondarySpatialSnapshot(state, {
  water = {},
  special = {},
  reason = "secondary-spatial-apply",
} = {}) {
  state.secondarySpatialGeneration = Number(state.secondarySpatialGeneration || 0) + 1;
  state.secondarySpatialBuildPending = false;
  state.secondarySpatialLastReason = String(reason || "secondary-spatial-apply");
  state.secondarySpatialPreservedDuringBuild = false;
  state.waterSpatialItems = Array.isArray(water.items) ? water.items : [];
  state.waterSpatialIndex = null;
  state.waterSpatialGrid = water.grid instanceof Map ? water.grid : new Map();
  state.waterSpatialGridMeta = water.gridMeta ?? null;
  state.waterSpatialItemsById = water.itemsById instanceof Map ? water.itemsById : new Map();
  state.specialSpatialItems = Array.isArray(special.items) ? special.items : [];
  state.specialSpatialIndex = null;
  state.specialSpatialGrid = special.grid instanceof Map ? special.grid : new Map();
  state.specialSpatialGridMeta = special.gridMeta ?? null;
  state.specialSpatialItemsById = special.itemsById instanceof Map ? special.itemsById : new Map();
}

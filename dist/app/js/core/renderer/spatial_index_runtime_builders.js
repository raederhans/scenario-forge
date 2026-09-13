const DEFAULT_HIT_GRID_TARGET_COLS = 24;
const DEFAULT_HIT_GRID_MIN_CELL_PX = 32;
const DEFAULT_HIT_GRID_MAX_CELL_PX = 96;
const DEFAULT_HIT_MAX_CELLS_PER_ITEM = 400;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getSpatialBucketKey(col, row) {
  return `${col},${row}`;
}

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
    let featureBounds;
    let featureBoundsComputed = false;
    hitGeometries.forEach((hitGeometry, partIndex) => {
      if (shouldExcludeWaterHitGeometry(hitGeometry, feature, id)) return;
      let bounds = computeProjectedGeoBounds(hitGeometry);
      if (!bounds) {
        // Several parts can require the same whole-feature fallback. Keep this
        // result (including null) local so the next rebuild sees new geometry.
        if (!featureBoundsComputed) {
          featureBounds = computeProjectedGeoBounds(feature);
          featureBoundsComputed = true;
        }
        bounds = featureBounds;
      }
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

export function buildSpatialGridSnapshot({
  items = [],
  canvasWidth = 1,
  canvasHeight = 1,
  hitGridTargetCols = DEFAULT_HIT_GRID_TARGET_COLS,
  hitGridMinCellPx = DEFAULT_HIT_GRID_MIN_CELL_PX,
  hitGridMaxCellPx = DEFAULT_HIT_GRID_MAX_CELL_PX,
  hitMaxCellsPerItem = DEFAULT_HIT_MAX_CELLS_PER_ITEM,
} = {}) {
  const width = Math.max(1, canvasWidth || 1);
  const height = Math.max(1, canvasHeight || 1);
  const cellSize = clampNumber(
    Math.round(width / hitGridTargetCols),
    hitGridMinCellPx,
    hitGridMaxCellPx
  );
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const grid = new Map();
  const globals = [];
  const itemsById = new Map();

  const pushToCell = (col, row, item) => {
    const key = getSpatialBucketKey(col, row);
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push(item);
  };

  items.forEach((item) => {
    if (!item?.id) return;
    itemsById.set(item.id, item);
    const c0 = clampNumber(Math.floor(item.minX / cellSize), 0, cols - 1);
    const c1 = clampNumber(Math.floor(item.maxX / cellSize), 0, cols - 1);
    const r0 = clampNumber(Math.floor(item.minY / cellSize), 0, rows - 1);
    const r1 = clampNumber(Math.floor(item.maxY / cellSize), 0, rows - 1);
    const covered = (c1 - c0 + 1) * (r1 - r0 + 1);

    if (covered > hitMaxCellsPerItem) {
      globals.push(item);
      return;
    }

    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        pushToCell(col, row, item);
      }
    }
  });

  return {
    grid,
    gridMeta: {
      cellSize,
      cols,
      rows,
      width,
      height,
      globals,
    },
    itemsById,
  };
}

export function captureSpatialGridBuild({
  items,
  canvasWidth = 1,
  canvasHeight = 1,
  hitGridTargetCols = DEFAULT_HIT_GRID_TARGET_COLS,
  hitGridMinCellPx = DEFAULT_HIT_GRID_MIN_CELL_PX,
  hitGridMaxCellPx = DEFAULT_HIT_GRID_MAX_CELL_PX,
  hitMaxCellsPerItem = DEFAULT_HIT_MAX_CELLS_PER_ITEM,
} = {}) {
  return buildSpatialGridSnapshot({
    items,
    canvasWidth,
    canvasHeight,
    hitGridTargetCols,
    hitGridMinCellPx,
    hitGridMaxCellPx,
    hitMaxCellsPerItem,
  });
}

// Reconcile only cells touched by replacement/removal. Item order remains the
// full-build draw order, including world-spanning items in the globals list.
export function reconcileSpatialGridSnapshot(previous, options) {
  const layout = captureSpatialGridBuild({ ...options, items: [] });
  const meta = previous?.gridMeta;
  if (!(previous?.grid instanceof Map) || !(previous?.itemsById instanceof Map)
    || !meta || ["cellSize", "cols", "rows", "width", "height"].some((key) => meta[key] !== layout.gridMeta[key])) {
    return captureSpatialGridBuild(options);
  }
  const items = options.items || [];
  const nextById = new Map(items.map((item) => [item.id, item]));
  const removed = [];
  const added = [];
  for (const [id, item] of previous.itemsById) if (nextById.get(id) !== item) removed.push(item);
  for (const item of items) if (previous.itemsById.get(item.id) !== item) added.push(item);
  if (!removed.length && !added.length) return previous;
  const oldCells = captureSpatialGridBuild({ ...options, items: removed });
  const newCells = captureSpatialGridBuild({ ...options, items: added });
  const removedIds = new Set(removed.map((item) => item.id));
  const grid = new Map(previous.grid);
  const sort = (values) => values.sort((a, b) => a.drawOrder - b.drawOrder);
  for (const key of new Set([...oldCells.grid.keys(), ...newCells.grid.keys()])) {
    const bucket = sort([
      ...(grid.get(key) || []).filter((item) => !removedIds.has(item.id)),
      ...(newCells.grid.get(key) || []),
    ]);
    if (bucket.length) grid.set(key, bucket);
    else grid.delete(key);
  }
  return {
    grid,
    gridMeta: { ...meta, globals: sort([
      ...(meta.globals || []).filter((item) => !removedIds.has(item.id)),
      ...newCells.gridMeta.globals,
    ]) },
    itemsById: nextById,
  };
}

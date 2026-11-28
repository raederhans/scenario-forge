import { clamp as clampNumber } from "../value_normalization.js";
import { getSpatialBucketKey } from "./spatial_index_runtime_builders.js";

function normalizeGlobals(globals) {
  if (Array.isArray(globals)) return globals;
  if (globals && typeof globals.forEach === "function") {
    const items = [];
    globals.forEach((item) => items.push(item));
    return items;
  }
  return [];
}

function hasUsableGridSnapshot({ grid = null, gridMeta = null, items = null } = {}) {
  return !!(
    grid instanceof Map
    && gridMeta
    && Array.isArray(items)
    && Number(gridMeta.cellSize) > 0
    && Number(gridMeta.cols) > 0
    && Number(gridMeta.rows) > 0
  );
}

export function doesSpatialItemIntersectProjectedRect(item, rect) {
  return !!(
    item
    && rect
    && !(item.maxX < rect.minX
      || item.maxY < rect.minY
      || item.minX > rect.maxX
      || item.minY > rect.maxY)
  );
}

export function getProjectedRectCellSpan(rect, gridMeta) {
  if (!rect || !gridMeta) return null;
  const cellSize = Number(gridMeta.cellSize || 0);
  const cols = Number(gridMeta.cols || 0);
  const rows = Number(gridMeta.rows || 0);
  if (!cellSize || cols <= 0 || rows <= 0) return null;
  const c0 = clampNumber(Math.floor(Number(rect.minX || 0) / cellSize), 0, cols - 1);
  const c1 = clampNumber(Math.floor(Number(rect.maxX || 0) / cellSize), 0, cols - 1);
  const r0 = clampNumber(Math.floor(Number(rect.minY || 0) / cellSize), 0, rows - 1);
  const r1 = clampNumber(Math.floor(Number(rect.maxY || 0) / cellSize), 0, rows - 1);
  return {
    colStart: c0,
    colEnd: c1,
    rowStart: r0,
    rowEnd: r1,
    cols: Math.max(0, c1 - c0 + 1),
    rows: Math.max(0, r1 - r0 + 1),
  };
}

export function collectSpatialItemsForProjectedRects({
  grid = null,
  gridMeta = null,
  items = null,
  projectedRects = [],
  maxCandidates = Infinity,
  shouldIncludeItem = () => true,
} = {}) {
  if (!hasUsableGridSnapshot({ grid, gridMeta, items })) return null;
  const normalizedRects = (Array.isArray(projectedRects) ? projectedRects : []).filter(Boolean);
  if (!normalizedRects.length) return { items: [], overflow: false };

  const candidateItems = [];
  const seen = new Set();
  let overflow = false;
  const maybePush = (item) => {
    if (overflow || !item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    if (!normalizedRects.some((rect) => doesSpatialItemIntersectProjectedRect(item, rect))) return;
    if (!shouldIncludeItem(item)) return;
    candidateItems.push(item);
    if (candidateItems.length > maxCandidates) {
      overflow = true;
    }
  };

  normalizedRects.forEach((rect) => {
    const span = getProjectedRectCellSpan(rect, gridMeta);
    if (!span) return;
    for (let row = span.rowStart; row <= span.rowEnd; row += 1) {
      for (let col = span.colStart; col <= span.colEnd; col += 1) {
        const bucket = grid.get(getSpatialBucketKey(col, row));
        bucket?.forEach(maybePush);
      }
    }
  });
  normalizeGlobals(gridMeta.globals).forEach(maybePush);
  candidateItems.sort((left, right) => (left?.drawOrder ?? 0) - (right?.drawOrder ?? 0));
  return {
    items: candidateItems,
    overflow,
  };
}

export function collectVisibleSpatialItemsWithStats({
  grid = null,
  gridMeta = null,
  items = null,
  viewportBounds = null,
  shouldIncludeItem = () => true,
  overscanPx = 0,
} = {}) {
  if (!hasUsableGridSnapshot({ grid, gridMeta, items }) || !viewportBounds) return null;
  const span = getProjectedRectCellSpan(viewportBounds, gridMeta);
  if (!span) return null;

  const visibleItems = [];
  const seen = new Set();
  let cellCandidateCount = 0;
  let visitedCellCount = 0;
  const globals = normalizeGlobals(gridMeta.globals);
  const maybePush = (item) => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    if (!shouldIncludeItem(item)) return;
    if (!doesSpatialItemIntersectProjectedRect(item, viewportBounds)) return;
    visibleItems.push(item);
  };

  for (let row = span.rowStart; row <= span.rowEnd; row += 1) {
    for (let col = span.colStart; col <= span.colEnd; col += 1) {
      const bucket = grid.get(getSpatialBucketKey(col, row));
      visitedCellCount += 1;
      cellCandidateCount += Array.isArray(bucket) ? bucket.length : 0;
      bucket?.forEach(maybePush);
    }
  }
  globals.forEach(maybePush);
  visibleItems.sort((left, right) => (left?.drawOrder ?? 0) - (right?.drawOrder ?? 0));
  return {
    items: visibleItems,
    stats: {
      cellCandidateCount,
      globalCandidateCount: globals.length,
      visitedCellCount,
      overscanPx: Math.max(0, Number(overscanPx || 0)),
      cellSpan: span,
    },
  };
}

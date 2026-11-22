import { collectSpatialItemsForProjectedRects } from "./spatial_query_index.js";

// Clip the segment to the open box. An edge along the perimeter does not cut the box.
function edgeEntersBox(a, b, box) {
  if (Math.max(a[0], b[0]) <= box.minX || Math.min(a[0], b[0]) >= box.maxX
    || Math.max(a[1], b[1]) <= box.minY || Math.min(a[1], b[1]) >= box.maxY) return false;
  let enter = 0;
  let leave = 1;
  for (const [axis, min, max] of [[0, box.minX, box.maxX], [1, box.minY, box.maxY]]) {
    const delta = b[axis] - a[axis];
    if (!delta) {
      if (a[axis] <= min || a[axis] >= max) return false;
      continue;
    }
    const t0 = (min - a[axis]) / delta;
    const t1 = (max - a[axis]) / delta;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
    if (enter >= leave) return false;
  }
  return true;
}

export function querySelectionShape({ shape, grid, gridMeta, items, isEligible, getCentroid }) {
  const { points } = shape;
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const lasso = shape.type === "lasso";
  const candidates = collectSpatialItemsForProjectedRects({
    grid, gridMeta, items, projectedRects: [bounds],
    shouldIncludeItem: item => item.interactive && isEligible(item.feature, item.id),
  });
  if (!candidates) return null;
  if (lasso && points.length < 3) return [];
  const contains = ([x, y]) => x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  return candidates.items.filter(item => {
    if (lasso) {
      // If no edge enters the box, one interior point classifies the whole box.
      if (!points.some((p, i) => edgeEntersBox(p, points[(i + 1) % points.length], item))) {
        return d3.polygonContains(points, [(item.minX + item.maxX) / 2, (item.minY + item.maxY) / 2]);
      }
    } else if (contains([item.minX, item.minY]) && contains([item.maxX, item.maxY])) {
      return true;
    }
    const centroid = getCentroid(item.feature);
    return centroid && (lasso ? d3.polygonContains(points, centroid) : contains(centroid));
  }).map(item => item.id);
}

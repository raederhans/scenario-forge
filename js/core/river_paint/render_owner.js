import { getMapDataBoundary } from '../map_data_boundary.js';
import { getRiverPaintRuntime } from './runtime.js';

// Sparse integration into the existing political pass, including its patch
// surface. The authoritative geometry/colour model is shared with hit testing,
// contours, history and export; this is not a second colour store.
export function createRiverPaintRenderOwner({ state, getContext, getPath,
  getProjectionKey, isVisible = () => true, isEnabled = () => true,
  fallbackColor = '#d7d3c7', createPath = () => typeof Path2D === 'function' ? new Path2D() : null,
} = {}) {
  const runtime = getRiverPaintRuntime(state);
  let projectionKey = null, paths = new WeakMap(), builds = 0, draws = 0;
  function pathFor(feature, path) {
    const previous = paths.get(feature.geometry);
    if (previous) return previous;
    const next = createPath();
    if (!next || typeof path.context !== 'function') return null;
    const original = path.context();
    try { path.context(next); path(feature); }
    finally { path.context(original); }
    paths.set(feature.geometry, next); builds += 1;
    return next;
  }
  function draw(k = 1, parentId = null) {
    if (!isEnabled()) return 0;
    const pack = runtime.getActivePack(), context = getContext(), path = getPath();
    if (!pack || !context || !path) return 0;
    const key = getProjectionKey();
    if (projectionKey !== key) { projectionKey = key; paths = new WeakMap(); }
    const boundary = getMapDataBoundary(state);
    let rendered = 0;
    for (const parent of pack.parents) {
      if (parentId && parentId !== parent.parentId) continue;
      const feature = state.landIndex?.get(parent.parentId);
      if (!feature || !isVisible(feature)) continue;
      const children = parent.cells.map(cell => runtime.getCellFeature(cell.id));
      if (children.some(child => !child)) continue;
      context.save();
      try {
        const parentPath = pathFor(feature, path);
        if (parentPath) context.clip(parentPath);
        else { context.beginPath(); path(feature); context.clip(); }
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.lineWidth = .75 / Math.max(.0001, Number(k) || 1);
        context.lineJoin = 'round'; context.lineCap = 'round';
        for (const child of children) {
          const color = boundary.paint.resolveRiverCellColor(child.id).color || fallbackColor;
          const childPath = pathFor(child, path);
          context.fillStyle = color; context.strokeStyle = color;
          if (childPath) { context.fill(childPath); context.stroke(childPath); }
          else { context.beginPath(); path(child); context.fill(); context.stroke(); }
          rendered += 1;
        }
      } finally { context.restore(); }
    }
    draws += 1;
    return rendered;
  }
  return Object.freeze({ draw, diagnostics: () => ({ builds, draws }) });
}

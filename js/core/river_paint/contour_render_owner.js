// River seams share the border layer's style and parent visibility. Replay on
// transparent scratch so later land erases lower seams without touching borders.
export function createRiverContourRenderOwner({ getContext, getPath, getProjectionKey,
  getOrderedEntries, getParentMeshes,
  createCanvas = () => typeof document !== 'undefined' ? document.createElement('canvas') : null,
  createPath = () => typeof Path2D === 'function' ? new Path2D() : null,
} = {}) {
  let canvas = null, projectionKey, paths = new WeakMap();
  let builds = 0, draws = 0, renderedParents = 0, maskedParents = 0;

  function dispose() {
    if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; }
  }

  function pathFor(value, path) {
    const geometry = value?.geometry || value;
    if (!geometry || typeof geometry !== 'object') return null;
    const previous = paths.get(geometry);
    if (previous) return previous;
    const next = createPath();
    if (!next) return null;
    const original = path.context();
    try { path.context(next); path(value); }
    finally { path.context(original); }
    paths.set(geometry, next);
    builds += 1;
    return next;
  }

  function hasLines(mesh) {
    const geometry = mesh?.geometry || mesh;
    if (geometry?.type === 'LineString') return geometry.coordinates?.length >= 2;
    return geometry?.type === 'MultiLineString'
      && geometry.coordinates?.some(line => Array.isArray(line) && line.length >= 2);
  }

  function draw({ k = 1, color, alpha = 1, width = 1,
    lineJoin = 'round', lineCap = 'round', miterLimit = 4 } = {}) {
    const entries = (getOrderedEntries() || []).map(entry => {
      const feature = entry?.feature || entry;
      const id = String(entry?.id || feature?.properties?.id || feature?.id || '');
      return { feature, meshes: (getParentMeshes(id) || []).filter(hasLines) };
    });
    renderedParents = 0;
    maskedParents = 0;
    if (!entries.some(({ meshes }) => meshes.length)) { dispose(); return 0; }
    const target = getContext(), path = getPath();
    if (!target?.canvas || !path || typeof path.context !== 'function') return 0;
    const pixelWidth = Number(target.canvas.width || 0), pixelHeight = Number(target.canvas.height || 0);
    if (!(pixelWidth > 0 && pixelHeight > 0)) return 0;
    if (!canvas) canvas = createCanvas();
    if (!canvas) return 0;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) { dispose(); return 0; }
    const key = getProjectionKey();
    if (projectionKey !== key) { projectionKey = key; paths = new WeakMap(); }
    const original = path.context();
    const usePath = (value, callback) => {
      const cached = pathFor(value, path);
      if (cached) callback(cached);
      else {
        context.beginPath();
        path.context(context);
        try { path(value); callback(); }
        finally { path.context(original); }
      }
    };
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      context.setTransform(target.getTransform());
      for (const { feature, meshes } of entries) {
        if (!feature?.geometry) continue;
        // No lower seam exists until the first participating parent is drawn.
        if (renderedParents) {
          context.globalCompositeOperation = 'destination-out';
          context.globalAlpha = 1;
          context.fillStyle = context.strokeStyle = '#000000';
          context.lineWidth = .75 / Math.max(.0001, Number(k) || 1);
          context.lineJoin = context.lineCap = 'round';
          usePath(feature, parentPath => {
            if (parentPath) { context.fill(parentPath); context.stroke(parentPath); }
            else { context.fill(); context.stroke(); }
          });
          maskedParents += 1;
        }
        if (!meshes.length) continue;
        context.save();
        try {
          usePath(feature, parentPath => parentPath ? context.clip(parentPath) : context.clip());
          context.globalCompositeOperation = 'source-over';
          context.globalAlpha = alpha;
          context.strokeStyle = color;
          context.lineWidth = width;
          context.lineJoin = lineJoin;
          context.lineCap = lineCap;
          context.miterLimit = miterLimit;
          meshes.forEach(mesh => usePath(mesh, meshPath => meshPath ? context.stroke(meshPath) : context.stroke()));
        } finally { context.restore(); }
        renderedParents += 1;
      }
    } finally { path.context(original); context.restore(); }
    if (!renderedParents) return 0;
    target.save();
    try {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.drawImage(canvas, 0, 0);
    } finally { target.restore(); }
    draws += 1;
    return renderedParents;
  }

  return Object.freeze({ draw, dispose, diagnostics: () => ({ builds, draws, renderedParents,
    maskedParents, scratchWidth: canvas?.width || 0, scratchHeight: canvas?.height || 0,
    scratchBytes: (canvas?.width || 0) * (canvas?.height || 0) * 4 }) });
}

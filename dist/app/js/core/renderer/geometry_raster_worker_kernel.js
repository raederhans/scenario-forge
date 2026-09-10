const PROJECTION_FIELDS = new Set([
  "scale", "translate", "center", "rotate", "angle", "reflectX", "reflectY",
  "precision", "clipAngle", "clipExtent",
]);

export function createGeometryRasterProjection(d3, options = {}) {
  if (options.factory !== undefined && options.factory !== "geoEqualEarth") {
    throw new Error("Unsupported projection factory.");
  }
  const projection = d3.geoEqualEarth();
  for (const [key, value] of Object.entries(options)) {
    if (key === "factory" || key === "pointRadius") continue;
    if (!PROJECTION_FIELDS.has(key)) throw new Error(`Unsupported projection field: ${key}`);
    projection[key](value);
  }
  return projection;
}

function abortIfNeeded(isCancelled) {
  if (!isCancelled()) return;
  const error = new Error("Geometry raster task cancelled.");
  error.name = "AbortError";
  throw error;
}

export function createGeometryRasterWorkerKernel({
  d3,
  createCanvas = (width, height) => new OffscreenCanvas(width, height),
  createPath = () => new Path2D(),
  yieldTask = () => globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0)),
  batchSize = 64,
  sliceBudgetMs = 8,
  now = () => performance.now(),
} = {}) {
  let sceneKey = null;
  let projectionKey = null;
  let projectionOptionsSignature = "";
  let pathGenerator = null;
  const geometries = new Map();
  const paths = new Map();
  // The worker entry serializes render tasks; each kind owns one reusable surface.
  const surfaces = new Map();

  async function render(packet, { isCancelled = () => false } = {}) {
    const startedAt = now();
    abortIfNeeded(isCancelled);
    if (packet.kind !== "hit" && packet.kind !== "political") throw new Error("Unsupported raster kind.");
    const { width, height, dpr = 1, offsetX = 0, offsetY = 0 } = packet;
    const { x = 0, y = 0, k = 1 } = packet.transform || {};
    if (![width, height].every((value) => Number.isInteger(value) && value > 0)
      || ![dpr, x, y, k, offsetX, offsetY].every(Number.isFinite) || dpr <= 0 || k <= 0) {
      throw new Error("Invalid raster dimensions or transform.");
    }
    const options = packet.projectionOptions || {};
    const optionsSignature = JSON.stringify(options);
    if (sceneKey !== packet.sceneKey || packet.resetGeometry) {
      geometries.clear();
      paths.clear();
      sceneKey = packet.sceneKey;
    }
    if (!pathGenerator || projectionKey !== packet.projectionKey || projectionOptionsSignature !== optionsSignature) {
      const projection = createGeometryRasterProjection(d3, options);
      pathGenerator = d3.geoPath(projection).pointRadius(options.pointRadius ?? 2);
      projectionKey = packet.projectionKey;
      projectionOptionsSignature = optionsSignature;
      paths.clear();
    }
    for (const { id, feature } of packet.geometryUpdates || []) {
      paths.delete(id);
      if (feature) geometries.set(id, feature);
      else geometries.delete(id);
    }
    let surface = surfaces.get(packet.kind);
    if (!surface) {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Worker 2D context unavailable.");
      surface = { canvas, context };
      surfaces.set(packet.kind, surface);
    }
    const { canvas, context } = surface;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.filter = "none";
    context.shadowBlur = 0;
    context.shadowColor = "rgba(0,0,0,0)";
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.setLineDash?.([]);
    context.lineDashOffset = 0;
    context.miterLimit = 10;
    context.lineWidth = 1;
    context.fillStyle = "#000000";
    context.strokeStyle = "#000000";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.translate(offsetX, offsetY);
    context.translate(x, y);
    context.scale(k, k);
    context.lineJoin = "round";
    context.lineCap = "round";
    let renderedCount = 0;
    let pathBuildCount = 0;
    let yieldCount = 0;
    let sliceStartedAt = now();
    const entries = packet.entries || [];
    for (let index = 0; index < entries.length; index += 1) {
      if (index % Math.max(1, batchSize) === 0) {
        // Cached paths are cheap: yielding for every 64 features added hundreds
        // of timer delays even when the worker had hardly done any work.
        if (now() - sliceStartedAt >= sliceBudgetMs) {
          await yieldTask();
          yieldCount += 1;
          sliceStartedAt = now();
        }
        abortIfNeeded(isCancelled);
      }
      const entry = entries[index];
      const feature = geometries.get(entry.id);
      if (!feature) throw new Error(`Missing raster geometry: ${entry.id}`);
      let path = paths.get(entry.id);
      if (!path) {
        path = createPath();
        try {
          pathGenerator.context(path)(feature);
        } finally {
          pathGenerator.context(null);
        }
        paths.set(entry.id, path);
        pathBuildCount += 1;
      }
      context.fillStyle = entry.fillColor;
      context.fill(path);
      if (packet.kind === "political" && entry.strokeColor && entry.lineWidth > 0) {
        context.strokeStyle = entry.strokeColor;
        context.lineWidth = entry.lineWidth;
        context.stroke(path);
      }
      renderedCount += 1;
    }
    abortIfNeeded(isCancelled);
    const bitmap = canvas.transferToImageBitmap();
    if (isCancelled()) {
      bitmap.close();
      abortIfNeeded(isCancelled);
    }
    return { bitmap, kind: packet.kind, width, height, renderedCount, pathBuildCount, yieldCount, renderMs: now() - startedAt };
  }

  return { render };
}

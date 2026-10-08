import { decodePackedRasterUpdates, drawPackedRasterGeometry, isPackedRasterGeometry, getRasterGeometryWeights } from "./packed_geometry.js";
import "../geometry_transfer_codec_shared.js";
import { GeometryBudgetMap, getGeometryRetentionWeights, PROJECTED_PATH_CACHE_BUDGET, WORKER_GEOMETRY_CACHE_BUDGET } from "./geometry_cache_budget.js";

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
  createPath = (svg) => new Path2D(svg),
  createBitmap = (...args) => createImageBitmap(...args),
  yieldTask = () => globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0)),
  batchSize = 64,
  sliceBudgetMs = 8,
  now = () => performance.now(),
  pathCacheBudget = PROJECTED_PATH_CACHE_BUDGET,
  geometryCacheBudget = WORKER_GEOMETRY_CACHE_BUDGET,
} = {}) {
  let sceneKey = null;
  let projectionKey = null;
  let projectionOptionsSignature = "";
  let pathGenerator = null;
  let svgPathGenerator = null;
  let projection = null;
  const weights = (feature) => getRasterGeometryWeights(feature, getGeometryRetentionWeights);
  const geometries = new GeometryBudgetMap({ budget: geometryCacheBudget, weigh: (feature) => weights(feature).decoded, autoTrim: false });
  const paths = new GeometryBudgetMap({ budget: pathCacheBudget, weigh: (entry) => entry.estimatedBytes });
  // The worker entry serializes render tasks; each kind owns one reusable surface.
  const surfaces = new Map();

  async function render(packet, { isCancelled = () => false } = {}) {
    const startedAt = now();
    abortIfNeeded(isCancelled);
    if (packet.kind !== "hit" && packet.kind !== "political" && packet.kind !== "navigation") throw new Error("Unsupported raster kind.");
    let geometryRetentionBudget = geometryCacheBudget;
    let pathRetentionBudget = pathCacheBudget;
    if (packet.kind === "navigation" && packet.navigationRetentionBudgetBytes !== undefined) {
      const budget = packet.navigationRetentionBudgetBytes;
      if (!Number.isSafeInteger(budget) || budget < 0) throw new Error("Invalid navigation retention budget.");
      geometryRetentionBudget = Math.min(geometryCacheBudget, Math.floor(budget * 2 / 3));
      pathRetentionBudget = Math.min(pathCacheBudget, budget - geometryRetentionBudget);
    }
    geometries.budget = geometryRetentionBudget;
    paths.budget = pathRetentionBudget;
    paths.trim();
    const { width, height, dpr = 1, offsetX = 0, offsetY = 0 } = packet;
    const { x = 0, y = 0, k = 1, scaleY = k } = packet.transform || {};
    if (![width, height].every((value) => Number.isInteger(value) && value > 0)
      || ![dpr, x, y, k, scaleY, offsetX, offsetY].every(Number.isFinite) || dpr <= 0 || k <= 0
      || (packet.kind === "navigation" && scaleY <= 0)) {
      throw new Error("Invalid raster dimensions or transform.");
    }
    const region = packet.renderRegion || null;
    if (region) {
      const { x: rx, y: ry, width: rw, height: rh } = region;
      if (packet.kind !== "political" || ![rx, ry, rw, rh].every(Number.isInteger)
        || rx < 0 || ry < 0 || rw <= 0 || rh <= 0 || rx + rw > width || ry + rh > height
        || !packet.patchBaseIdentity || !Array.isArray(packet.drawEntryIds) || !packet.drawEntryIds.length) {
        throw new Error("Invalid political raster patch.");
      }
    }
    // Keep the same device-space raster origin and clipping as a full frame.
    // Translating paths into a smaller canvas changes native edge coverage.
    // Draw only patch contributors, then crop the bitmap without re-rasterizing.
    const surfaceWidth = width, surfaceHeight = height;
    const options = packet.projectionOptions || {};
    const optionsSignature = JSON.stringify(options);
    if (sceneKey !== packet.sceneKey || packet.resetGeometry) {
      geometries.clear();
      paths.clear();
      sceneKey = packet.sceneKey;
    }
    if (!pathGenerator || projectionKey !== packet.projectionKey || projectionOptionsSignature !== optionsSignature) {
      projection = createGeometryRasterProjection(d3, options);
      pathGenerator = d3.geoPath(projection).pointRadius(options.pointRadius ?? 2);
      svgPathGenerator = null;
      projectionKey = packet.projectionKey;
      projectionOptionsSignature = optionsSignature;
      paths.clear();
    }
    const navigationTimings = packet.kind === "navigation" ? {
      geometryUpdateMs: 0, pathBuildMs: 0, fillMs: 0, yieldWallMs: 0,
      bitmapMs: 0, trimMs: 0,
      maxPathMs: 0, maxPathId: null, maxFillMs: 0, maxFillId: null,
    } : null;
    const unpackingStartedAt = now();
    let updates;
    if (packet.geometryTransport?.encoding === "geo-f64-batches-v1") {
      if (packet.kind !== "navigation" || !Array.isArray(packet.geometryTransport.batches)) {
        throw new Error("Invalid navigation geometry transport.");
      }
      updates = [];
      let unpackSliceStartedAt = now();
      for (const batch of packet.geometryTransport.batches) {
        abortIfNeeded(isCancelled);
        const decoded = batch?.encoding === "geo-f64-v1"
          ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(batch) : batch;
        if (!Array.isArray(decoded)) throw new Error("Invalid navigation geometry batch.");
        updates.push(...decoded);
        if (now() - unpackSliceStartedAt >= sliceBudgetMs) {
          const yieldStartedAt = now();
          await yieldTask();
          navigationTimings.yieldWallMs += now() - yieldStartedAt;
          unpackSliceStartedAt = now();
        }
      }
    } else {
      updates = packet.geometryTransport
        ? packet.kind === "navigation"
          ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(packet.geometryTransport)
          : decodePackedRasterUpdates(packet.geometryTransport)
        : packet.geometryUpdates || [];
    }
    const unpackingMs = now() - unpackingStartedAt;
    const updateStartedAt = navigationTimings ? now() : 0;
    let updateSliceStartedAt = now();
    for (let index = 0; index < updates.length; index += 1) {
      if (packet.kind === "navigation" && index % Math.max(1, batchSize) === 0) {
        if (now() - updateSliceStartedAt >= sliceBudgetMs) {
          const yieldStartedAt = now();
          await yieldTask();
          navigationTimings.yieldWallMs += now() - yieldStartedAt;
          updateSliceStartedAt = now();
        }
        abortIfNeeded(isCancelled);
      }
      const { id, feature } = updates[index];
      paths.delete(id);
      if (feature) geometries.set(id, feature);
      else geometries.delete(id);
    }
    if (navigationTimings) navigationTimings.geometryUpdateMs = now() - updateStartedAt;
    let surface = surfaces.get(packet.kind);
    if (!surface) {
      const canvas = createCanvas(surfaceWidth, surfaceHeight);
      const context = canvas.getContext("2d", packet.kind === "navigation" ? { willReadFrequently: true } : undefined);
      if (!context) throw new Error("Worker 2D context unavailable.");
      surface = { canvas, context };
      surfaces.set(packet.kind, surface);
    }
    const { canvas, context } = surface;
    if (canvas.width !== surfaceWidth) canvas.width = surfaceWidth;
    if (canvas.height !== surfaceHeight) canvas.height = surfaceHeight;
    context.setTransform(1, 0, 0, 1, 0, 0);
    // A patch publishes only its crop. Clear that entire crop, including holes,
    // without changing the full-frame raster origin or the immutable result.
    if (region) context.clearRect(region.x, region.y, region.width, region.height);
    else context.clearRect(0, 0, surfaceWidth, surfaceHeight);
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
    context.scale(k, packet.kind === "navigation" ? scaleY : k);
    context.lineJoin = "round";
    context.lineCap = "round";
    let renderedCount = 0;
    let pathBuildCount = 0;
    let yieldCount = 0;
    let pathAdmissionSkips = 0;
    const allEntries = packet.entries || [];
    const drawIds = region ? new Set(packet.drawEntryIds) : null;
    const entries = drawIds ? allEntries.filter(entry => drawIds.has(entry.id)) : allEntries;
    if (drawIds && (drawIds.size !== packet.drawEntryIds.length || entries.length !== drawIds.size)) {
      throw new Error("Raster patch entry inventory mismatch.");
    }
    const frameGeometryIds = new Set(allEntries.map((entry) => entry.id));
    // Reserve the paths this frame can already reuse, once per ID. Touching
    // them first leaves inactive paths at the LRU front. Only admit misses
    // into the remaining byte budget, so an early miss cannot evict a later
    // hit and turn every over-budget, same-order frame into a full rebuild.
    // This retains references only in the existing cache, never a second
    // frame-sized Path2D store, and never changes painter order or geometry.
    let framePathWeight = 0;
    for (const id of frameGeometryIds) {
      const cached = paths.get(id);
      if (cached) framePathWeight += cached.estimatedBytes;
    }
    let sliceStartedAt = now();
    for (let index = 0; index < entries.length; index += 1) {
      if (index % Math.max(1, batchSize) === 0) {
        // Cached paths are cheap: yielding for every 64 features added hundreds
        // of timer delays even when the worker had hardly done any work.
        if (now() - sliceStartedAt >= sliceBudgetMs) {
          const yieldStartedAt = navigationTimings ? now() : 0;
          await yieldTask();
          if (navigationTimings) navigationTimings.yieldWallMs += now() - yieldStartedAt;
          yieldCount += 1;
          sliceStartedAt = now();
        }
        abortIfNeeded(isCancelled);
      }
      const entry = entries[index];
      const feature = geometries.get(entry.id);
      if (!feature) throw new Error(`Missing raster geometry: ${entry.id}`);
      let path = paths.get(entry.id)?.path;
      if (!path) {
        const pathStartedAt = navigationTimings ? now() : 0;
        if (packet.kind === "navigation") {
          svgPathGenerator ||= d3.geoPath(projection).pointRadius(options.pointRadius ?? 2).digits(6);
          path = createPath(svgPathGenerator(feature));
        } else {
          path = createPath();
          try {
            if (isPackedRasterGeometry(feature)) drawPackedRasterGeometry(feature, projection, path, options.pointRadius ?? 2);
            else pathGenerator.context(path)(feature);
          } finally {
            pathGenerator.context(null);
          }
        }
        const estimatedBytes = weights(feature).path;
        if (estimatedBytes > paths.budget) {
          // Preserve the cache's oversized-skip accounting; draw transiently.
          paths.set(entry.id, { path, estimatedBytes });
        } else if (framePathWeight + estimatedBytes <= paths.budget) {
          paths.set(entry.id, { path, estimatedBytes });
          framePathWeight += estimatedBytes;
        } else {
          pathAdmissionSkips += 1;
        }
        pathBuildCount += 1;
        if (navigationTimings) {
          const elapsed = now() - pathStartedAt;
          navigationTimings.pathBuildMs += elapsed;
          if (elapsed > navigationTimings.maxPathMs) {
            navigationTimings.maxPathMs = elapsed;
            navigationTimings.maxPathId = entry.id;
          }
        }
      }
      context.fillStyle = entry.fillColor;
      context.globalAlpha = packet.kind === "navigation" ? (entry.alpha ?? 1) : 1;
      const fillStartedAt = navigationTimings ? now() : 0;
      context.fill(path);
      if (navigationTimings) {
        const elapsed = now() - fillStartedAt;
        navigationTimings.fillMs += elapsed;
        if (elapsed > navigationTimings.maxFillMs) {
          navigationTimings.maxFillMs = elapsed;
          navigationTimings.maxFillId = entry.id;
        }
      }
      if (packet.kind === "political" && entry.strokeColor && entry.lineWidth > 0) {
        context.strokeStyle = entry.strokeColor;
        context.lineWidth = entry.lineWidth;
        context.stroke(path);
      }
      renderedCount += 1;
    }
    abortIfNeeded(isCancelled);
    const bitmapStartedAt = navigationTimings ? now() : 0;
    const bitmap = region
      ? await createBitmap(canvas, region.x, region.y, region.width, region.height)
      : canvas.transferToImageBitmap();
    if (navigationTimings) navigationTimings.bitmapMs = now() - bitmapStartedAt;
    if (isCancelled()) {
      bitmap.close();
      abortIfNeeded(isCancelled);
    }
    // Current-frame geometry is pinned; a genuinely huge visible frame may
    // exceed the target. Retire inactive geometry and acknowledge it so the
    // client can re-upload it on a later view without disabling the worker.
    const trimStartedAt = navigationTimings ? now() : 0;
    // The immutable navigation bitmap no longer needs its input geometry.
    // Release its temporary frame pins before acknowledging retained state;
    // otherwise a whole-world upload could stay above budget between jobs.
    if (packet.kind === "navigation") {
      // Keep geometry behind resident projected paths warm first. Plain painter
      // order would retain late water while retiring the early cached land paths.
      for (const id of paths.keys()) geometries.get(id);
    }
    const evictedGeometryIds = packet.kind === "navigation"
      ? geometries.trim() : geometries.trim(frameGeometryIds);
    for (const id of evictedGeometryIds) paths.delete(id);
    if (navigationTimings) navigationTimings.trimMs = now() - trimStartedAt;
    return { bitmap, kind: packet.kind, width: region?.width ?? width, height: region?.height ?? height,
      ...(region ? { renderRegion: { ...region }, patchBaseIdentity: packet.patchBaseIdentity } : {}),
      ...(navigationTimings ? { navigationTimings } : {}), renderedCount, pathBuildCount, yieldCount, unpackingMs,
      clearedPixelCount: region ? region.width * region.height : width * height,
      geometryTransportMode: packet.geometryTransport ? "packed-f64" : "geojson",
      evictedGeometryIds, cacheBudget: { geometry: geometries.getStats(),
        paths: { ...paths.getStats(), frameAdmissionSkips: pathAdmissionSkips } }, renderMs: now() - startedAt };
  }

  return { render };
}

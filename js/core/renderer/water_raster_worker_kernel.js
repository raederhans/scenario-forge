import { createGeometryRasterProjection } from "./geometry_raster_worker_kernel.js";
import { createWaterResidentGeometry } from "./water_resident_geometry.js";
import { drawPackedRasterGeometry } from "./packed_geometry.js";
import { GeometryBudgetMap, PROJECTED_PATH_CACHE_BUDGET, WORKER_GEOMETRY_CACHE_BUDGET } from "./geometry_cache_budget.js";
import { shouldDrawLakeOutline } from "./lake_outline_style.js";
import { createOceanSurfacePattern } from "./ocean_surface_pattern.js";
import { yieldWaterTask } from "./water_geometry_transport.js";

export function createWaterRasterWorkerKernel({
  d3, createCanvas = (w, h) => new OffscreenCanvas(w, h), createPath = () => new Path2D(),
  yieldTask = yieldWaterTask, now = () => performance.now(),
  geometryBudgetBytes = WORKER_GEOMETRY_CACHE_BUDGET,
  pathBudgetBytes = PROJECTED_PATH_CACHE_BUDGET, surfaceBudgetBytes = 32 * 1024 * 1024,
} = {}) {
  const boundsBudgetBytes = Math.min(8 * 1024 * 1024, Math.floor(geometryBudgetBytes / 4));
  const geometry = createWaterResidentGeometry(geometryBudgetBytes - boundsBudgetBytes);
  const boundsCache = new GeometryBudgetMap({ budget: boundsBudgetBytes, weigh: () => 128 });
  const paths = new GeometryBudgetMap({ budget: pathBudgetBytes, weigh: entry => entry.bytes });
  const retentionBudgetBytes = geometryBudgetBytes + pathBudgetBytes;
  let namespace = null, projectionSignature = null, projection = null;
  let patternSource = null;
  const check = cancelled => { if (cancelled()) throw Object.assign(new Error("Water candidate cancelled."), { name: "AbortError" }); };
  function stats() {
    return { geometryBytes: geometry.getBytes() + boundsCache.getStats().estimatedBytes,
      boundsBytes: boundsCache.getStats().estimatedBytes, pathBytes: paths.getStats().estimatedBytes,
      patternBytes: patternSource ? patternSource.bitmap.width * patternSource.bitmap.height * 4 : 0,
      ...geometry.getStats() };
  }
  function trimPaths(requiredTokens = new Set()) {
    // Reserve the bounds cache's existing cap up front. A later bounds insert
    // cannot shrink this frame's path allowance and evict a just-built path.
    paths.budget = Math.max(0, retentionBudgetBytes - geometry.getBytes() - boundsBudgetBytes);
    const requiredKeys = new Set();
    for (const [key, path] of paths) {
      if (requiredTokens.has(path.contentToken)) requiredKeys.add(key);
    }
    paths.trim(requiredKeys);
    // A complete working set may itself exceed the unchanged byte cap.
    paths.trim();
  }
  function sync(packet) {
    const result = geometry.sync(packet);
    // Version aliases remain strict, while equal source content keeps one token
    // and its projected paths across immutable payload replacements.
    if (namespace !== packet.geometryNamespace) { paths.clear(); boundsCache.clear(); }
    namespace = packet.geometryNamespace;
    const versions = new Map(result.resident);
    trimPaths(new Set((packet.requiredIds || []).map(id =>
      geometry.getRecord(namespace, id, versions.get(id)).token)));
    return { ...result, ...stats() };
  }
  function setPattern(source) {
    if (patternSource?.bitmap !== source?.bitmap) patternSource?.bitmap.close();
    patternSource = source;
  }
  function prepare(context, packet, tileX = 0, clearBounds = undefined) {
    const { dpr, offsetX = 0, offsetY = 0 } = packet.layout;
    const { x, y, k } = packet.transform;
    context.setTransform(1, 0, 0, 1, 0, 0);
    let clearedPixels = 0;
    if (clearBounds === undefined) {
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      clearedPixels = context.canvas.width * context.canvas.height;
    } else if (clearBounds) {
      context.clearRect(clearBounds.x, clearBounds.y, clearBounds.width, clearBounds.height);
      clearedPixels = clearBounds.width * clearBounds.height;
    }
    context.globalAlpha = 1; context.globalCompositeOperation = "source-over";
    context.setTransform(dpr * k, 0, 0, dpr * k, dpr * (offsetX + x) - tileX, dpr * (offsetY + y));
    return clearedPixels;
  }
  function buildPartPath(contentToken, part, pointRadius) {
    const path = createPath();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, points = 0;
    const extend = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); points++; };
    const sink = {
      moveTo(x, y) { extend(x, y); path.moveTo(x, y); },
      lineTo(x, y) { extend(x, y); path.lineTo(x, y); },
      closePath() { path.closePath(); },
      arc(x, y, r, start, end) { extend(x - r, y - r); extend(x + r, y + r); path.arc(x, y, r, start, end); },
    };
    drawPackedRasterGeometry(part, projection, sink, pointRadius);
    return { contentToken, pointRadius, path,
      bounds: { minX, minY, maxX, maxY }, bytes: 256 + points * 32 };
  }
  async function render(packet, { isCancelled = () => false } = {}) {
    check(isCancelled);
    const startedAt = now();
    const initialPathEvictions = paths.getStats().evictions;
    const { pixelWidth: width, pixelHeight: height, dpr, offsetX = 0, offsetY = 0 } = packet.layout || {};
    const { x, y, k } = packet.transform || {};
    if (![width, height].every(v => Number.isSafeInteger(v) && v > 0)
      || ![dpr, x, y, k, offsetX, offsetY].every(Number.isFinite) || dpr <= 0 || k <= 0) throw new RangeError("Invalid water raster layout.");
    const bitmapBytes = width * height * 4;
    const scratchWidth = Math.min(width, Math.floor((surfaceBudgetBytes - bitmapBytes) / (height * 4)));
    if (scratchWidth < 1) throw new RangeError("Water surfaces exceed budget.");
    const signature = JSON.stringify(packet.projectionOptions);
    if (signature !== projectionSignature) {
      projection = createGeometryRasterProjection(d3, packet.projectionOptions);
      projectionSignature = signature; paths.clear(); boundsCache.clear();
    }
    if (packet.geometryNamespace !== namespace) throw new Error("Water geometry namespace mismatch.");
    // Share unused geometry allowance with paths without raising the combined
    // retention cap. Full-world water otherwise churned the fixed 32 MiB LRU.
    const recordsById = new Map(), entriesByToken = new Map();
    for (const entry of packet.entries) {
      if (!(entry.opacity > 0)) continue;
      const record = geometry.getRecord(namespace, entry.id, entry.geometryVersion);
      recordsById.set(entry.id, record);
      let entries = entriesByToken.get(record.token);
      if (!entries) { entries = []; entriesByToken.set(record.token, entries); }
      entries.push(entry);
    }
    trimPaths(new Set(entriesByToken.keys()));
    const visible = (bounds, entry) => {
      const padding = entry.lake ? entry.lake.outlineWidth * dpr : 0;
      return Number.isFinite(bounds.minX)
        && dpr * (bounds.maxX * k + x + offsetX) >= -padding
        && dpr * (bounds.minX * k + x + offsetX) <= width + padding
        && dpr * (bounds.maxY * k + y + offsetY) >= -padding
        && dpr * (bounds.minY * k + y + offsetY) <= height + padding;
    };
    const evictablePaths = [];
    let evictionCursor = 0;
    let framePathBytes = 0;
    // Reserve existing hits before processing the first miss. New transient
    // paths must not evict a later hit and cause same-order full-frame churn.
    for (const [key, path] of paths) {
      if (entriesByToken.get(path.contentToken)?.some(entry => visible(path.bounds, entry))) {
        framePathBytes += path.bytes;
      } else evictablePaths.push([key, path.bytes]);
    }
    let pathBuildCount = 0, boundsMissCount = 0, pathAdmissionSkips = 0, oversizedPathSkips = 0;
    function resolvePart(entry, index, part, pointRadius) {
      const contentToken = recordsById.get(entry.id).token;
      const key = JSON.stringify([namespace, contentToken, pointRadius, index]);
      const cached = paths.get(key);
      let bounds = boundsCache.get(key);
      if (!bounds) {
        boundsMissCount++;
        if (cached) { bounds = cached.bounds; boundsCache.set(key, bounds); }
      }
      if (cached) return cached;
      if (bounds && !visible(bounds, entry)) return { bounds, path: null };
      pathBuildCount++;
      const candidate = buildPartPath(contentToken, part, pointRadius);
      if (!bounds) boundsCache.set(key, candidate.bounds);
      if (visible(candidate.bounds, entry)) {
        if (candidate.bytes > paths.budget) {
          oversizedPathSkips++;
        } else if (framePathBytes + candidate.bytes > paths.budget) {
          pathAdmissionSkips++;
        } else {
          let retainedBytes = paths.getStats().estimatedBytes;
          // The inactive LRU queue is collected once before any misses. Each
          // victim is visited at most once, without rescanning the hot prefix.
          while (retainedBytes + candidate.bytes > paths.budget && evictionCursor < evictablePaths.length) {
            const [oldKey, oldBytes] = evictablePaths[evictionCursor++];
            retainedBytes -= oldBytes;
            paths.delete(oldKey);
            paths.evictions++;
          }
          paths.set(key, candidate);
          framePathBytes += candidate.bytes;
        }
      }
      // Even an oversized/rejected candidate supplies both its bounds and path
      // for this stripe. Never project it twice merely to recover the path.
      return candidate;
    }
    if (packet.patternRevision != null && patternSource?.revision !== packet.patternRevision) throw new Error("Water pattern revision mismatch.");
    const canvas = createCanvas(width, height), context = canvas.getContext("2d");
    const scratch = createCanvas(scratchWidth, height), scratchContext = scratch.getContext("2d");
    let renderedCount = 0, maxWorkMs = 0, maxWorkPart = "", pathBuildMs = 0, rasterMs = 0, compositePixels = 0, clearedPixels = 0;
    const noteWork = (startedAt, entry, index, tileX) => {
      const elapsed = now() - startedAt;
      if (elapsed > maxWorkMs) {
        maxWorkMs = elapsed;
        maxWorkPart = `${String(entry.id).slice(0, 160)}:${index}:${tileX}`;
      }
    };
    let scratchDirty = null;
    try {
      if (!context || !scratchContext) throw new Error("Water canvas context unavailable.");
      clearedPixels += prepare(context, packet);
      const pattern = packet.patternRevision == null ? null : createOceanSurfacePattern(scratchContext,
        patternSource.bitmap, patternSource.layout, patternSource.referenceTransform);
      if (packet.patternRevision != null && !pattern) throw new Error("Water surface pattern unavailable.");
      for (const entry of packet.entries) {
        check(isCancelled);
        if (!(entry.opacity > 0)) continue;
        const source = recordsById.get(entry.id).feature;
        const parts = source.geometry.type === "GeometryCollection"
          ? source.geometry.geometries.map(part => ({ ...source, geometry: part })) : [source];
        let didDraw = false;
        // Opaque union preserves overlapping parts; opacity is applied once per feature.
        for (let tileX = 0; tileX < width; tileX += scratchWidth) {
          // Keep the accelerated rasterizer's AA, but clear only pixels painted
          // by the previous feature. Thousands of small lakes otherwise enqueue
          // full-surface clears on the GPU shared with the visible scene.
          clearedPixels += prepare(scratchContext, packet, tileX, scratchDirty);
          scratchDirty = null;
          scratchContext.fillStyle = entry.useOceanPattern && pattern ? pattern : entry.fillColor;
          const lakePath = entry.lake ? createPath() : null;
          let outline = false, hasPath = false;
          let copyLeft = Infinity, copyTop = Infinity, copyRight = -Infinity, copyBottom = -Infinity;
          for (let index = 0; index < parts.length; index++) {
            check(isCancelled);
            const workStart = now(), buildStart = now();
            const pointRadius = packet.projectionOptions.pointRadius ?? 4.5;
            const path = resolvePart(entry, index, parts[index], pointRadius);
            if (!visible(path.bounds, entry)) {
              pathBuildMs += now() - buildStart;
              noteWork(workStart, entry, index, tileX);
              if (index % 32 === 31 || now() - workStart >= 6) { await yieldTask(); check(isCancelled); }
              continue;
            }
            pathBuildMs += now() - buildStart;
            if (Number.isFinite(path.bounds.minX)) {
              hasPath = true;
              const padding = 2 + (entry.lake ? entry.lake.outlineWidth * dpr : 0);
              copyLeft = Math.min(copyLeft, Math.floor(dpr * (path.bounds.minX * k + x + offsetX) - tileX - padding));
              copyTop = Math.min(copyTop, Math.floor(dpr * (path.bounds.minY * k + y + offsetY) - padding));
              copyRight = Math.max(copyRight, Math.ceil(dpr * (path.bounds.maxX * k + x + offsetX) - tileX + padding));
              copyBottom = Math.max(copyBottom, Math.ceil(dpr * (path.bounds.maxY * k + y + offsetY) + padding));
              if (lakePath) {
                lakePath.addPath(path.path);
                outline ||= shouldDrawLakeOutline(entry.lake.featureIdentity, path.bounds, k, entry.lake);
              } else scratchContext.fill(path.path);
            }
            noteWork(workStart, entry, index, tileX);
            // A huge ring can be atomic here, but it never runs on the UI/hit worker.
            if (index % 32 === 31 || now() - workStart >= 6) { await yieldTask(); check(isCancelled); }
          }
          const rasterStart = now();
          if (lakePath && hasPath) scratchContext.fill(lakePath);
          const sx = Math.max(0, copyLeft), sy = Math.max(0, copyTop);
          const sw = Math.min(scratchWidth, copyRight) - sx, sh = Math.min(height, copyBottom) - sy;
          if (hasPath && sw > 0 && sh > 0) {
            scratchDirty = { x: sx, y: sy, width: sw, height: sh };
            // Tiny lakes previously copied the entire DPR-2 surface once each.
            // Keep the same device origin and antialias padding, but composite
            // only the feature's painted bounds into the complete candidate.
            const composite = alpha => {
              context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
              context.globalAlpha = alpha;
              context.drawImage(scratch, sx, sy, sw, sh, tileX + sx, sy, sw, sh);
              context.restore(); compositePixels += sw * sh;
            };
            composite(entry.opacity);
            if (lakePath && outline) {
              // Match the original fill-then-stroke alpha ordering, including overlap.
              clearedPixels += prepare(scratchContext, packet, tileX, scratchDirty);
              scratchContext.strokeStyle = entry.lake.outlineColor;
              scratchContext.lineWidth = entry.lake.outlineWidth / Math.max(0.0001, k);
              scratchContext.lineJoin = "round"; scratchContext.setLineDash([]);
              scratchContext.stroke(lakePath);
              composite(entry.opacity * entry.lake.outlineOpacity);
            }
            didDraw = true;
          }
          rasterMs += now() - rasterStart;
          await yieldTask(); check(isCancelled);
        }
        if (didDraw) renderedCount++;
      }
      check(isCancelled);
      const bitmap = canvas.transferToImageBitmap();
      return { identity: packet.identity, revision: packet.revision, bitmap, renderedCount,
        stats: { ...stats(), surfaceBytes: bitmapBytes + scratchWidth * height * 4,
          pathBuildMs, rasterMs, compositePixels, clearedPixels, maxWorkMs, maxWorkPart,
          pathBuildCount, boundsMissCount, pathAdmissionSkips, oversizedPathSkips,
          pathEvictions: paths.getStats().evictions - initialPathEvictions, totalMs: now() - startedAt } };
    } finally { canvas.width = canvas.height = scratch.width = scratch.height = 1; }
  }
  function dispose() { geometry.clear(); paths.clear(); boundsCache.clear(); setPattern(null); }
  return { sync, render, setPattern, dispose, stats };
}

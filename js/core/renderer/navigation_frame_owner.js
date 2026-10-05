import { pageResourceBudget } from "../runtime_resource_budget.js";

const MAX_DIMENSION = 1024;
const MAX_RETAINED_BYTES = 8 * 1024 * 1024;
const SLICE_MS = 6;
const DEFAULT_QUALITY_LIMITS = Object.freeze({
  worldMaxDevicePixelMagnification: 2,
  detailMinCssScaleRatio: 0.8,
  detailMaxCssScaleRatio: 1.25,
  detailMaxDevicePixelMagnification: 1.5,
});

function isValidTransform(transform) {
  return Number.isFinite(transform?.x) && Number.isFinite(transform?.y)
    && Number.isFinite(transform?.k) && transform.k > 0;
}

function isValidCanvasSize(canvas) {
  return Number.isSafeInteger(canvas?.width) && canvas.width > 0
    && Number.isSafeInteger(canvas?.height) && canvas.height > 0;
}

export function createNavigationFrameOwner({
  getIdentity,
  shouldPause = () => false,
  createCanvas = () => document.createElement("canvas"),
  schedule = (callback, delay = 0) => setTimeout(callback, delay),
  cancel = clearTimeout,
  now = () => performance.now(),
  resourceBudget = pageResourceBudget,
  recordMetric = () => {},
  qualityLimits = {},
} = {}) {
  const quality = { ...DEFAULT_QUALITY_LIMITS, ...qualityLimits };
  if (Object.values(quality).some((value) => !Number.isFinite(value) || value <= 0)
    || quality.detailMinCssScaleRatio > quality.detailMaxCssScaleRatio) {
    throw new TypeError("Navigation raster quality limits must be positive finite bounds.");
  }
  const frameOwner = Symbol("navigation-frame");
  const jobOwner = Symbol("navigation-frame-job");
  let frame = null;
  let job = null;

  function releaseFrame() {
    if (frame) {
      frame.canvas.width = 0;
      frame.canvas.height = 0;
      frame = null;
    }
    resourceBudget.release(frameOwner);
  }

  function cancelJob(reason) {
    if (!job) return;
    const stale = job;
    job = null;
    if (stale.timer !== null) cancel(stale.timer);
    stale.controller?.abort();
    stale.canvas.width = 0;
    stale.canvas.height = 0;
    resourceBudget.release(jobOwner);
    recordMetric("navigationFrameCancel", now() - stale.startedAt, {
      reason, drawnItems: stale.drawnItems, totalItems: stale.totalItems,
    });
  }

  function clear() {
    cancelJob("clear");
    releaseFrame();
  }

  function validIdentity(identity) {
    return identity !== null && identity !== undefined && getIdentity() === identity;
  }

  function isReady() {
    if (job && !validIdentity(job.identity)) cancelJob("identity");
    if (!frame) return false;
    const identity = getIdentity();
    if (identity !== frame.identity) {
      let changedFields = [];
      try {
        const before = JSON.parse(frame.identity), after = JSON.parse(identity);
        if (Array.isArray(before) && Array.isArray(after)) {
          changedFields = before.flatMap((value, index) => JSON.stringify(value) === JSON.stringify(after[index]) ? [] : [index]);
        }
      } catch { /* Scalar identities are supported by standalone callers. */ }
      recordMetric("navigationFrameInvalid", 0, { reason: "identity", changedFields });
      releaseFrame();
      return false;
    }
    return true;
  }

  function runSlice(active) {
    active.timer = null;
    if (job !== active) return;
    if (!validIdentity(active.identity)) {
      cancelJob("identity");
      return;
    }
    if (shouldPause()) {
      active.timer = schedule(() => runSlice(active), 32);
      return;
    }
    const sliceStartedAt = now();
    let drawn = 0;
    try {
      while (active.layerIndex < active.layers.length) {
        const layer = active.layers[active.layerIndex];
        if (active.itemIndex >= layer.items.length) {
          active.layerIndex++;
          active.itemIndex = 0;
          continue;
        }
        if (drawn > 0 && now() - sliceStartedAt >= SLICE_MS) break;
        const item = layer.items[active.itemIndex++];
        const itemStartedAt = now();
        layer.drawItem(active.context, item);
        const itemMs = now() - itemStartedAt;
        if (itemMs > active.maxItemMs) {
          active.maxItemMs = itemMs;
          active.slowestItem = String(item?.properties?.id || item?.id || item?.type || "");
          active.slowestLayer = active.layerIndex;
        }
        active.drawnItems++;
        drawn++;
        if (job !== active) return;
      }
    } catch {
      if (job === active) cancelJob("draw-error");
      return;
    }
    active.maxSliceMs = Math.max(active.maxSliceMs, now() - sliceStartedAt);
    if (job !== active) return;
    if (!validIdentity(active.identity)) {
      cancelJob("identity");
      return;
    }
    if (active.layerIndex < active.layers.length) {
      active.timer = schedule(() => runSlice(active));
      return;
    }
    publish(active);
  }

  function publish(active) {
    const previous = frame;
    frame = {
      canvas: active.canvas, identity: active.identity, bounds: active.bounds,
      backgroundColor: active.backgroundColor, bytes: active.bytes,
    };
    job = null;
    resourceBudget.release(jobOwner);
    resourceBudget.update(frameOwner, { bitmaps: active.bytes });
    if (previous) {
      previous.canvas.width = 0;
      previous.canvas.height = 0;
    }
    recordMetric("navigationFramePrepare", now() - active.startedAt, {
      width: active.canvas.width, height: active.canvas.height,
      estimatedBytes: active.bytes, itemCount: active.totalItems,
      mode: active.mode || "main",
      maxSliceMs: active.maxSliceMs,
      maxItemMs: active.maxItemMs, slowestItem: active.slowestItem, slowestLayer: active.slowestLayer,
    });
  }

  function prepare({ bounds, layers, renderRaster = null, backgroundColor = "#fff", maxDimension = MAX_DIMENSION } = {}, immediate = false) {
    const identity = getIdentity();
    if (identity === null || identity === undefined) return false;
    if (job && !validIdentity(job.identity)) cancelJob("identity");
    if (job?.identity === identity) return false;
    if (isReady()) return false;
    if (job) cancelJob("superseded");
    if (frame) releaseFrame();

    const minX = Number(bounds?.[0]?.[0]);
    const minY = Number(bounds?.[0]?.[1]);
    const maxX = Number(bounds?.[1]?.[0]);
    const maxY = Number(bounds?.[1]?.[1]);
    const worldWidth = maxX - minX;
    const worldHeight = maxY - minY;
    if (![minX, minY, maxX, maxY, worldWidth, worldHeight].every(Number.isFinite)
      || !(worldWidth > 0 && worldHeight > 0) || !Array.isArray(layers)
      || layers.some((layer) => !Array.isArray(layer?.items) || typeof layer.drawItem !== "function")
      || typeof backgroundColor !== "string" || !backgroundColor
      || !Number.isFinite(maxDimension) || maxDimension < 1) return false;

    const limit = Math.min(MAX_DIMENSION, Math.floor(maxDimension));
    const scale = limit / Math.max(worldWidth, worldHeight);
    const width = Math.max(1, Math.round(worldWidth * scale));
    const height = Math.max(1, Math.round(worldHeight * scale));
    const bytes = width * height * 4;
    // Navigation is a bounded required fallback. Other owners' retained
    // canvases must not evict it or permanently prevent its preparation.
    const retainedBytes = (frame?.bytes || 0) + (job?.bytes || 0);
    if (retainedBytes + bytes > MAX_RETAINED_BYTES) return false;

    const canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      return false;
    }
    resourceBudget.update(jobOwner, { bitmaps: bytes });
    try {
      context.setTransform(width / worldWidth, 0, 0, height / worldHeight,
        -minX * width / worldWidth, -minY * height / worldHeight);
      context.fillStyle = backgroundColor;
      context.fillRect(minX, minY, worldWidth, worldHeight);
    } catch {
      canvas.width = 0;
      canvas.height = 0;
      resourceBudget.release(jobOwner);
      return false;
    }
    const totalItems = layers.reduce((total, layer) => total + layer.items.length, 0);
    job = {
      canvas, context, identity, bounds: [[minX, minY], [maxX, maxY]],
      backgroundColor, bytes, layers, totalItems, drawnItems: 0,
      layerIndex: 0, itemIndex: 0, startedAt: now(), timer: null, maxSliceMs: 0, maxItemMs: 0,
    };
    const active = job;
    if (typeof renderRaster === "function" && !immediate) {
      active.controller = new AbortController();
      active.mode = "worker";
      void runRaster(active, renderRaster);
    } else if (immediate) runSlice(active);
    else job.timer = schedule(() => runSlice(active));
    return true;
  }

  async function runRaster(active, renderRaster) {
    let result = null;
    try {
      result = await renderRaster({ width: active.canvas.width, height: active.canvas.height,
        bounds: active.bounds, signal: active.controller.signal });
      if (job !== active) return;
      if (!validIdentity(active.identity)) {
        cancelJob("identity");
        return;
      }
      if (!result?.bitmap) throw new Error("Navigation worker unavailable");
      active.context.setTransform(1, 0, 0, 1, 0, 0);
      active.context.drawImage(result.bitmap, 0, 0);
      active.drawnItems = active.totalItems;
      publish(active);
    } catch {
      if (job !== active) return;
      if (!validIdentity(active.identity)) {
        cancelJob("identity");
        return;
      }
      // Unsupported/failed workers retain the existing cooperative renderer.
      active.mode = "main-fallback";
      const [[minX, minY], [maxX, maxY]] = active.bounds;
      active.context.setTransform(active.canvas.width / (maxX - minX), 0, 0,
        active.canvas.height / (maxY - minY),
        -minX * active.canvas.width / (maxX - minX), -minY * active.canvas.height / (maxY - minY));
      active.timer = schedule(() => runSlice(active));
    } finally {
      result?.bitmap?.close?.();
    }
  }

  function captureWholeScene(source, transform, dpr, bounds) {
    if (shouldPause()) return false;
    if (!isValidCanvasSize(source) || !isValidTransform(transform)
      || !Number.isFinite(dpr) || dpr <= 0 || !Array.isArray(bounds)
      || !Array.isArray(bounds[0]) || !Array.isArray(bounds[1])) return false;
    const [[minX, minY], [maxX, maxY]] = bounds;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)
      || maxX <= minX || maxY <= minY) return false;
    // Only a complete exact frame whose visible canvas contains the entire
    // projected world proves global coverage. Regional snapshots cannot seed it.
    if ((minX * transform.k + transform.x) * dpr < 0
      || (minY * transform.k + transform.y) * dpr < 0
      || (maxX * transform.k + transform.x) * dpr > source.width
      || (maxY * transform.k + transform.y) * dpr > source.height) return false;
    if (isReady()) return true;
    cancelJob("complete-visible-frame");
    return prepare({ bounds, backgroundColor: "transparent", layers: [{ items: [source], drawItem(context) {
      context.save();
      context.transform(1 / (dpr * transform.k), 0, 0, 1 / (dpr * transform.k),
        -transform.x / transform.k, -transform.y / transform.k);
      context.drawImage(source, 0, 0);
      context.restore();
    } }] }, true);
  }

  function draw(context, transform, dpr, {
    detailSource = null, detailTransform = null, detailDpr = dpr,
  } = {}) {
    if (!isValidCanvasSize(context?.canvas) || !isReady()
      || !isValidTransform(transform) || !(Number.isFinite(dpr) && dpr > 0)) return false;
    const { canvas, bounds, backgroundColor } = frame;
    if (!isValidCanvasSize(canvas)) return false;
    const worldWidth = bounds[1][0] - bounds[0][0];
    const worldHeight = bounds[1][1] - bounds[0][1];
    const worldScaleX = dpr * transform.k * worldWidth / canvas.width;
    const worldScaleY = dpr * transform.k * worldHeight / canvas.height;
    const worldOffsetX = dpr * (transform.x + transform.k * bounds[0][0]);
    const worldOffsetY = dpr * (transform.y + transform.k * bounds[0][1]);
    if (![worldScaleX, worldScaleY, worldOffsetX, worldOffsetY].every(Number.isFinite)
      || worldScaleX <= 0 || worldScaleY <= 0) return false;
    const worldMagnification = Math.max(worldScaleX, worldScaleY);
    const worldQualityOK = worldMagnification <= quality.worldMaxDevicePixelMagnification;

    let detail = null;
    if (detailSource !== context.canvas && isValidCanvasSize(detailSource) && isValidTransform(detailTransform)
      && Number.isFinite(detailDpr) && detailDpr > 0) {
      const ratio = transform.k / detailTransform.k;
      const magnification = ratio * dpr / detailDpr;
      const x = (transform.x - detailTransform.x * ratio) * dpr;
      const y = (transform.y - detailTransform.y * ratio) * dpr;
      const width = detailSource.width * magnification;
      const height = detailSource.height * magnification;
      if ([ratio, magnification, x, y, width, height].every(Number.isFinite)
        && magnification > 0 && ratio >= quality.detailMinCssScaleRatio
        && ratio <= quality.detailMaxCssScaleRatio
        && magnification <= quality.detailMaxDevicePixelMagnification) {
        detail = {
          ratio, magnification, x, y,
          coversViewport: x <= 0 && y <= 0
            && x + width >= context.canvas.width && y + height >= context.canvas.height,
        };
      }
    }
    // Decide before any destination mutation. A sharp regional crop can stand
    // alone only when it covers every target pixel; world blur cannot fill gaps.
    if (!worldQualityOK && !detail?.coversViewport) {
      recordMetric("navigationFrameReject", 0, {
        reason: "raster-quality", worldMagnification,
        detailQualityOK: Boolean(detail), detailCoversViewport: Boolean(detail?.coversViewport),
      });
      return false;
    }
    const detailOnly = !worldQualityOK;
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, context.canvas.width, context.canvas.height);
      if (worldQualityOK) {
        context.setTransform(worldScaleX, 0, 0, worldScaleY, worldOffsetX, worldOffsetY);
        context.drawImage(canvas, 0, 0);
      }
      if (detail) {
        context.setTransform(detail.magnification, 0, 0, detail.magnification, detail.x, detail.y);
        context.drawImage(detailSource, 0, 0);
      }
    } finally {
      context.restore();
    }
    recordMetric("navigationFrameReuse", 0, {
      targetK: transform.k, detail: Boolean(detail), detailOnly,
      worldMagnification, worldQualityOK,
      detailCssScaleRatio: detail?.ratio ?? null,
      detailDevicePixelMagnification: detail?.magnification ?? null,
    });
    return true;
  }

  return Object.freeze({ prepare, draw, clear, isReady, captureWholeScene });
}

import { pageResourceBudget } from "../runtime_resource_budget.js";

const MAX_DIMENSION = 1024;
const MAX_RETAINED_BYTES = 8 * 1024 * 1024;
const SLICE_MS = 6;

export function createNavigationFrameOwner({
  getIdentity,
  shouldPause = () => false,
  createCanvas = () => document.createElement("canvas"),
  schedule = (callback, delay = 0) => setTimeout(callback, delay),
  cancel = clearTimeout,
  now = () => performance.now(),
  resourceBudget = pageResourceBudget,
  recordMetric = () => {},
} = {}) {
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
    const pressure = resourceBudget.snapshot().pressure;
    if (identity !== frame.identity || pressure) {
      let changedFields = [];
      try {
        const before = JSON.parse(frame.identity), after = JSON.parse(identity);
        if (Array.isArray(before) && Array.isArray(after)) {
          changedFields = before.flatMap((value, index) => JSON.stringify(value) === JSON.stringify(after[index]) ? [] : [index]);
        }
      } catch { /* Scalar identities are supported by standalone callers. */ }
      recordMetric("navigationFrameInvalid", 0, { reason: identity !== frame.identity ? "identity" : "pressure", changedFields });
      releaseFrame();
      return false;
    }
    return true;
  }

  function runSlice(active) {
    active.timer = null;
    if (job !== active) return;
    if (!validIdentity(active.identity) || resourceBudget.snapshot().pressure) {
      cancelJob("identity-or-pressure");
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
    if (bytes > MAX_RETAINED_BYTES || !resourceBudget.admitSpeculative(bytes).admitted) return false;

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
      if (!validIdentity(active.identity) || resourceBudget.snapshot().pressure) {
        cancelJob("identity-or-pressure");
        return;
      }
      if (!result?.bitmap) throw new Error("Navigation worker unavailable");
      active.context.setTransform(1, 0, 0, 1, 0, 0);
      active.context.drawImage(result.bitmap, 0, 0);
      active.drawnItems = active.totalItems;
      publish(active);
    } catch {
      if (job !== active) return;
      if (!validIdentity(active.identity) || resourceBudget.snapshot().pressure) {
        cancelJob("identity-or-pressure");
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
    if (!source?.width || !source.height || !Number.isFinite(transform?.k) || transform.k <= 0
      || !Number.isFinite(dpr) || dpr <= 0 || !Array.isArray(bounds)) return false;
    const [[minX, minY], [maxX, maxY]] = bounds;
    if (![minX, minY, maxX, maxY, transform.x, transform.y].every(Number.isFinite)) return false;
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
    if (!context?.canvas || !isReady()
      || !Number.isFinite(transform?.x) || !Number.isFinite(transform?.y)
      || !(Number.isFinite(transform?.k) && transform.k > 0)
      || !(Number.isFinite(dpr) && dpr > 0)) return false;
    const { canvas, bounds, backgroundColor } = frame;
    const worldWidth = bounds[1][0] - bounds[0][0];
    const worldHeight = bounds[1][1] - bounds[0][1];
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, context.canvas.width, context.canvas.height);
      context.setTransform(dpr * transform.k * worldWidth / canvas.width, 0,
        0, dpr * transform.k * worldHeight / canvas.height,
        dpr * (transform.x + transform.k * bounds[0][0]),
        dpr * (transform.y + transform.k * bounds[0][1]));
      context.drawImage(canvas, 0, 0);
      if (detailSource && detailTransform && detailDpr > 0 && detailTransform.k > 0) {
        const ratio = transform.k / detailTransform.k;
        context.setTransform(ratio * dpr / detailDpr, 0, 0, ratio * dpr / detailDpr,
          (transform.x - detailTransform.x * ratio) * dpr,
          (transform.y - detailTransform.y * ratio) * dpr);
        context.drawImage(detailSource, 0, 0);
      }
    } finally {
      context.restore();
    }
    recordMetric("navigationFrameReuse", 0, {
      targetK: transform.k, detail: Boolean(detailSource && detailTransform),
    });
    return true;
  }

  return Object.freeze({ prepare, draw, clear, isReady, captureWholeScene });
}

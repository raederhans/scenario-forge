import "../../vendor/d3.v7.min.js";
import { buildPoliticalIdRasterTile } from "../core/renderer/political_id_raster_tile.js";

const d3 = globalThis.d3;

function stableKey(value) {
  if (Array.isArray(value)) return value.map(stableKey);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableKey(value[key])]));
  }
  return value;
}

// Path2D does not expose retained storage. This input-coordinate estimate is a
// budget hint, not a heap measurement; the entry cap also bounds retention.
function estimatePathBytes(feature) {
  let points = 0;
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") points++;
    else for (const child of value) visit(child);
  }
  function geometry(value) {
    if (!value) return;
    if (value.type === "Feature") geometry(value.geometry);
    else if (value.type === "FeatureCollection") for (const child of value.features || []) geometry(child);
    else if (value.type === "GeometryCollection") for (const child of value.geometries || []) geometry(child);
    else visit(value.coordinates);
  }
  geometry(feature);
  return 256 + points * 64;
}

export function recreatePoliticalIdRasterProjection(options, density, projectionApi = d3) {
  if (!options || typeof options.factory !== "string" || typeof projectionApi?.[options.factory] !== "function") {
    throw new TypeError("Political ID raster packet has an unsupported projection factory.");
  }
  const projection = projectionApi[options.factory]();
  const methods = options.methods || Object.fromEntries(
    Object.entries(options).filter(([key]) => key !== "factory"),
  );
  for (const [name, value] of Object.entries(methods)) {
    if (!["scale", "translate", "precision", "clipExtent"].includes(name)
      && typeof projection[name] === "function") projection[name](value);
  }
  if (Number.isFinite(Number(methods.scale))) projection.scale(Number(methods.scale) * density);
  if (Array.isArray(methods.translate)) projection.translate(methods.translate.map((value) => Number(value) * density));
  if (Number.isFinite(Number(methods.precision))) projection.precision(Number(methods.precision) * density);
  if (Array.isArray(methods.clipExtent)) {
    projection.clipExtent(methods.clipExtent.map((point) => point.map((value) => Number(value) * density)));
  }
  return projection;
}

export function createPoliticalIdRasterWorkerRuntime({
  postMessage,
  buildTile = buildPoliticalIdRasterTile,
  projectionApi = d3,
  pathCacheMaxEntries = 1024,
  pathCacheMaxEstimatedBytes = 16 * 1024 * 1024,
} = {}) {
  if (!Number.isSafeInteger(pathCacheMaxEntries) || pathCacheMaxEntries < 0
    || !Number.isSafeInteger(pathCacheMaxEstimatedBytes) || pathCacheMaxEstimatedBytes < 0) {
    throw new RangeError("Political path cache budgets must be nonnegative integers.");
  }
  const tasks = new Map();
  let queue = Promise.resolve();
  let disposed = false;
  let cacheNamespace = null;
  let pathCache = new Map();
  let pathCacheEstimatedBytes = 0;

  function dispose() {
    disposed = true;
    for (const task of tasks.values()) task.cancelled = true;
    pathCache.clear();
    pathCacheEstimatedBytes = 0;
    cacheNamespace = null;
  }

  async function run(task) {
    const { taskId, packet } = task;
    const isCancelled = () => task.cancelled;
    try {
      if (task.cancelled) return;
      const density = Number(packet?.density);
      if (!Number.isFinite(density) || density <= 0) throw new RangeError("Invalid political ID raster density.");
      const projection = recreatePoliticalIdRasterProjection(packet.projectionOptions, density, projectionApi);
      const namespace = typeof packet.geometryNamespace === "string" && packet.geometryNamespace.length
        ? packet.geometryNamespace : null;
      const geometryKey = JSON.stringify(stableKey([density, packet.projectionOptions]));
      // Each build owns a bounded transaction. Cancellation/failure never changes
      // the last accepted cache, including its namespace and LRU order.
      const localCache = namespace && namespace === cacheNamespace ? new Map(pathCache) : new Map();
      let localEstimatedBytes = namespace === cacheNamespace ? pathCacheEstimatedBytes : 0;
      let pathBuilds = 0, pathCacheHits = 0;
      function getCachedPath(entry, buildPath) {
        const validToken = (value) => (typeof value === "string" && value.length > 0)
          || (typeof value === "number" && Number.isFinite(value));
        const key = namespace && validToken(entry.id) && validToken(entry.geometryVersion)
          ? JSON.stringify([namespace, entry.id, entry.geometryVersion, geometryKey]) : null;
        if (key && localCache.has(key)) {
          const cached = localCache.get(key);
          localCache.delete(key);
          localCache.set(key, cached);
          pathCacheHits++;
          return cached.path;
        }
        const path = buildPath();
        pathBuilds++;
        const estimatedBytes = estimatePathBytes(entry.feature);
        if (key && !task.cancelled && pathCacheMaxEntries > 0 && estimatedBytes <= pathCacheMaxEstimatedBytes) {
          localCache.set(key, { path, estimatedBytes });
          localEstimatedBytes += estimatedBytes;
          while (localCache.size > pathCacheMaxEntries || localEstimatedBytes > pathCacheMaxEstimatedBytes) {
            const oldestKey = localCache.keys().next().value;
            localEstimatedBytes -= localCache.get(oldestKey).estimatedBytes;
            localCache.delete(oldestKey);
          }
        }
        return path;
      }
      const entries = (packet.entries || []).map((entry) => ({
        ...entry,
        bounds: entry.bounds && {
          minX: Number(entry.bounds.minX) * density,
          minY: Number(entry.bounds.minY) * density,
          maxX: Number(entry.bounds.maxX) * density,
          maxY: Number(entry.bounds.maxY) * density,
        },
      }));
      // Packet dimensions and origins already describe the physical raster grid.
      const tile = await buildTile({
        entries, projection,
        width: Number(packet.width),
        height: Number(packet.height),
        originX: Number(packet.originX || 0),
        originY: Number(packet.originY || 0),
        strokeWidth: Number(packet.strokeWidth ?? 0.75),
        gutter: Number(packet.gutter ?? 0),
        getCachedPath,
        d3: projectionApi,
        isCancelled,
      });
      if (!task.cancelled) {
        Object.assign(tile.stats ||= {}, {
          pathBuilds, pathCacheHits, pathCacheEntries: localCache.size,
          pathCacheEstimatedBytes: localEstimatedBytes,
        });
        postMessage({ taskId, type: "RESULT", tile }, [tile.codes.buffer, tile.edgeIds.buffer, tile.edgeWeights.buffer]);
        pathCache = localCache;
        pathCacheEstimatedBytes = localEstimatedBytes;
        cacheNamespace = namespace;
      }
    } catch (error) {
      if (!task.cancelled) postMessage({ taskId, type: "ERROR", message: String(error?.message || error), name: String(error?.name || "Error") });
    } finally {
      if (tasks.get(taskId) === task) tasks.delete(taskId);
    }
  }

  function handleMessage(data = {}) {
    const taskId = String(data.taskId || "");
    if (data.type === "DISPOSE_POLITICAL_ID_RASTER") {
      dispose();
      return;
    }
    if (disposed) return;
    if (data.type === "CANCEL_TASK") {
      const task = tasks.get(taskId);
      if (task) task.cancelled = true;
      return;
    }
    if (data.type !== "BUILD_POLITICAL_ID_TILE") {
      postMessage({ taskId, type: "ERROR", message: "Unsupported political ID raster task." });
      return;
    }
    const previous = tasks.get(taskId);
    if (previous) previous.cancelled = true;
    const task = { taskId, packet: data.packet || {}, cancelled: false };
    tasks.set(taskId, task);
    queue = queue.then(() => run(task), () => run(task));
  }

  return {
    handleMessage, dispose, getPendingTaskCount: () => tasks.size,
    getPathCacheStats: () => ({
      geometryNamespace: cacheNamespace, pathCacheEntries: pathCache.size,
      pathCacheEstimatedBytes,
    }),
  };
}

if (typeof self !== "undefined") {
  const runtime = createPoliticalIdRasterWorkerRuntime({ postMessage: (message, transfer) => self.postMessage(message, transfer) });
  self.onmessage = ({ data }) => runtime.handleMessage(data);
}

import { createWorkerTaskClient } from "./worker_task_client.js";
import { createPoliticalIdRasterAssetStore } from "./renderer/political_id_raster_assets.js";

const WORKER_URL = new URL("../workers/political_id_raster.worker.js", import.meta.url);

export function createPoliticalIdRasterWorkerClient({
  createWorker = () => new Worker(WORKER_URL, { type: "module" }),
  isSupported = () => typeof Worker === "function"
    && typeof OffscreenCanvas === "function" && typeof Path2D === "function",
  taskClient = null,
} = {}) {
  let disposed = false;
  const lifetime = new AbortController();
  const manifestValidator = createPoliticalIdRasterAssetStore({ indexedDB: null, fetchImpl: null });
  let manifest = null, manifestRevision = 0, assetStats = manifestValidator.stats();
  let assetReads = 0, assetWrites = 0, copiedTileBytes = 0;
  let maxAssetServiceMs = 0, maxAssetDeliveryMs = 0;
  const client = taskClient || createWorkerTaskClient({
    createWorker: () => {
      // The shared task client creates its worker in a later microtask.
      if (disposed) throw new Error("Political ID raster worker client is disposed.");
      return createWorker();
    },
    getTaskId: message => {
      if (!disposed && message.assets) assetStats = { ...assetStats, ...message.assets };
      if (message.assetTiming) {
        maxAssetServiceMs = Math.max(maxAssetServiceMs, message.assetTiming.finishedAt - message.assetTiming.startedAt);
        maxAssetDeliveryMs = Math.max(maxAssetDeliveryMs, performance.timeOrigin + performance.now() - message.assetTiming.finishedAt);
      }
      return String(message.taskId || "");
    },
    resolveMessage: (message) => Object.hasOwn(message, "value") ? message.value : message.tile,
    isErrorMessage: (message) => message.type === "ERROR" || message.error === true,
    createMessageError: (message) => Object.assign(new Error(message.message || message.errorCode || "Political ID raster worker failed."), { name: message.name || "Error" }),
  });

  function available() {
    return !disposed && !!isSupported();
  }

  function request(packet, { signal } = {}) {
    if (disposed) return Promise.reject(new Error("Political ID raster worker client is disposed."));
    if (!available()) return Promise.reject(new Error("Political ID raster worker is unavailable."));
    if (!packet || typeof packet !== "object") return Promise.reject(new TypeError("Political ID raster packet is required."));
    const requestSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    return client.dispatchTask("BUILD_POLITICAL_ID_TILE", { packet }, { signal: requestSignal });
  }

  function prepare() {
    if (!available()) return Promise.reject(new Error("Political ID raster worker is unavailable."));
    return client.ensureWorker();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    client.terminate(new Error("Political ID raster worker client disposed."));
    lifetime.abort();
    manifestValidator.dispose(); manifest = null;
  }

  async function assetRequest(type, payload, signal) {
    if (disposed) throw new Error("Political ID raster worker client is disposed.");
    const requestSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    return client.dispatchTask(type, { ...payload, manifest, manifestRevision,
      assetStartedAt: performance.timeOrigin + performance.now() }, { signal: requestSignal });
  }
  const assetStore = {
    registerManifest(value) {
      const count = manifestValidator.registerManifest(value);
      manifest = value; manifestRevision++;
      return count;
    },
    async load(identity, { idToCode, signal, cacheMode = "normal" } = {}) {
      assetReads++;
      try { return await assetRequest("LOAD_POLITICAL_ID_ASSET", { identity, idToCode, cacheMode }, signal); }
      finally { assetReads--; }
    },
    async save(identity, tile, { codeToId, signal } = {}) {
      // Keep caller-owned coverage intact. Only one serial producer can have a
      // tile copy in flight; include that transient storage in the diagnostics.
      const bytes = tile.codes.byteLength + tile.edgeIds.byteLength + tile.edgeWeights.byteLength;
      assetWrites++; copiedTileBytes += bytes;
      try { return await assetRequest("SAVE_POLITICAL_ID_ASSET", { identity, tile, codeToId }, signal); }
      finally { assetWrites--; copiedTileBytes -= bytes; }
    },
    stats: () => ({ ...assetStats, pendingReads: disposed ? 0 : assetReads,
      pendingWrites: disposed ? 0 : Math.max(assetWrites, assetStats.pendingWrites),
      pendingBytes: disposed ? 0 : assetStats.pendingBytes + copiedTileBytes,
      memoryBytes: disposed ? 0 : assetStats.memoryBytes, maxAssetServiceMs, maxAssetDeliveryMs, disposed }),
    dispose,
  };
  return Object.freeze({ available, prepare, request, dispose, assetStore });
}

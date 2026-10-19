import { createWorkerTaskClient } from "./worker_task_client.js";
import { createPoliticalIdRasterAssetStore } from "./renderer/political_id_raster_assets.js";
import "./geometry_transfer_codec_shared.js";

const WORKER_URL = new URL("../workers/political_id_raster.worker.js", import.meta.url);
export const POLITICAL_ID_ASSET_SAVE_MAX_BYTES = 8 * 1024 * 1024;

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
  let geometryWorker = null, geometryNamespace = null, resident = new Map();
  let geometryQueue = Promise.resolve();
  const geometryStats = { geometryUploads: 0, geometryUploadBytes: 0, geometryReuses: 0,
    residentGeometryBytes: 0, pathBytes: 0 };
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
    const token = value => (typeof value === "string" && value.length > 0)
      || (typeof value === "number" && Number.isFinite(value));
    if (!token(packet.geometryNamespace) || !(packet.entries || []).every(entry => token(entry.id) && token(entry.geometryVersion))) {
      return client.dispatchTask("BUILD_POLITICAL_ID_TILE", { packet }, { signal: requestSignal });
    }
    return enqueueGeometry(async () => {
      await ensureGeometryWorker();
      requestSignal.throwIfAborted();
      const sameScene = geometryNamespace === packet.geometryNamespace;
      const updates = [];
      for (const entry of packet.entries || []) {
        if (sameScene && resident.get(entry.id) === entry.geometryVersion) geometryStats.geometryReuses++;
        else updates.push({ id: entry.id, feature: entry.feature });
      }
      if (!sameScene || updates.length || packet.deletedGeometryIds?.length) {
        await syncGeometry(packet.geometryNamespace, updates,
          (packet.entries || []).map(entry => [entry.id, entry.geometryVersion]),
          (packet.entries || []).map(entry => entry.id), packet.deletedGeometryIds || [], requestSignal);
      }
      const tile = await client.dispatchTask("BUILD_POLITICAL_ID_TILE", { packet: {
        ...packet, residentGeometry: true,
        entries: (packet.entries || []).map(({ feature: _feature, ...entry }) => entry),
      } }, { signal: requestSignal });
      geometryStats.pathBytes = tile?.stats?.pathBytes ?? geometryStats.pathBytes;
      return tile;
    });
  }

  function enqueueGeometry(work) {
    const result = geometryQueue.then(work);
    geometryQueue = result.catch(() => {});
    return result;
  }

  async function ensureGeometryWorker() {
    if (disposed) throw new Error("Political ID raster worker client is disposed.");
    const worker = await client.ensureWorker();
    if (geometryWorker !== worker) {
      geometryWorker = worker; geometryNamespace = null; resident.clear();
      geometryStats.residentGeometryBytes = 0; geometryStats.pathBytes = 0;
    }
  }

  async function syncGeometry(namespace, updates, versions, requiredIds, deletedIds, signal) {
    const codec = globalThis.__scenarioForgeGeometryTransferCodecShared;
    let packed = codec.pack(updates, { minCoordinateCount: 0 });
    if (!packed.payload?.encoding && updates.length) {
      packed = codec.pack([...updates, { id: null, feature: { type: "Point", coordinates: [0, 0] } }], { minCoordinateCount: 0 });
      if (!packed.payload?.encoding) throw new TypeError("Invalid political resident geometry.");
      packed.payload.value.pop();
    }
    // Empty/null geometries have no coordinate scalars but use the same protocol.
    const payload = packed.payload?.encoding ? packed.payload : {
      encoding: "geo-f64-v1", value: packed.payload, coordinates: new Float64Array(), lengths: new Uint32Array(),
    };
    geometryStats.geometryUploads += updates.length;
    geometryStats.geometryUploadBytes += payload.coordinates.byteLength + payload.lengths.byteLength;
    let value;
    try {
      value = await client.dispatchTask("SYNC_POLITICAL_ID_GEOMETRY", {
        geometryNamespace: namespace, updates: payload, versions, requiredIds, deletedIds,
      }, { signal, transfer: packed.transferables });
      signal?.throwIfAborted();
    } catch (error) {
      // An aborted acknowledgement may follow a committed worker transaction.
      // Forget the index so the next request cannot assume stale residency.
      geometryNamespace = null; resident.clear();
      throw error;
    }
    geometryNamespace = namespace; resident = new Map(value.resident);
    geometryStats.residentGeometryBytes = value.residentGeometryBytes;
    geometryStats.pathBytes = value.pathBytes;
    geometryStats.geometryBudgetBytes = value.geometryBudgetBytes;
    geometryStats.pathBudgetBytes = value.pathBudgetBytes;
  }

  function releaseGeometry(ids = []) {
    return enqueueGeometry(async () => {
      await ensureGeometryWorker();
      await syncGeometry(geometryNamespace, [], [], [], ids, lifetime.signal);
    });
  }

  function clearGeometry() {
    return enqueueGeometry(async () => {
      await ensureGeometryWorker();
      await syncGeometry(null, [], [], [], [...resident.keys()], lifetime.signal);
    });
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
    resident.clear(); geometryWorker = null; geometryNamespace = null;
    geometryStats.residentGeometryBytes = 0; geometryStats.pathBytes = 0;
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
      // Persistence is optional. Admit at most one bounded caller-preserving
      // structured clone, even when callers produce tiles faster than disk I/O.
      const bytes = tile.codes.byteLength + tile.edgeIds.byteLength + tile.edgeWeights.byteLength;
      if (assetWrites || bytes > POLITICAL_ID_ASSET_SAVE_MAX_BYTES) return false;
      signal?.throwIfAborted();
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
  return Object.freeze({ available, prepare, request, dispose, assetStore,
    releaseGeometry, clearGeometry, getStats: () => ({ ...geometryStats }) });
}

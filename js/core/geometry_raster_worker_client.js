import { createWorkerTaskClient } from "./worker_task_client.js";
import "./geometry_transfer_codec_shared.js";

const WORKER_URL = new URL("../workers/geometry_raster.worker.js", import.meta.url);
const closeResult = (result) => result?.bitmap?.close?.();

// One active request plus the latest request for each surface. Geometry is
// acknowledged separately from frame currentness, so a stale frame cannot
// corrupt the next incremental upload.
export function createGeometryRasterWorkerClient({
  createWorker = () => new Worker(WORKER_URL, { type: "module" }),
  isSupported = () => typeof Worker === "function" && typeof OffscreenCanvas === "function"
    && typeof Path2D === "function",
  onMetric = () => {},
} = {}) {
  let disabled = false;
  let active = null;
  // geometryStoreKey: tracks which scene the worker's geometry store belongs to.
  // This is the sceneKey supplied by the runtime owner (activeScenarioId +
  // sceneGeneration only), NOT the full frame identity, so that topology/data
  // generation changes and same-scene chunk arrivals do NOT reset uploads.
  let geometryStoreKey = null;
  // geometryRefs: tracks the geometry object last uploaded per id. Used to
  // compute incremental diffs and to release departed entry ids.
  let geometryRefs = new Map();
  let geometryIdsByKind = new Map();
  const queued = new Map();
  const liveTaskIds = new Set();
  const metric = (...args) => {
    try { onMetric(...args); } catch { /* Diagnostics must not strand a render request. */ }
  };
  const client = createWorkerTaskClient({
    createWorker: () => {
      if (disabled) throw new Error("Geometry worker disposed.");
      return createWorker();
    },
    createTaskId: (_type, sequence) => {
      const id = `geometry-raster-${sequence}`;
      liveTaskIds.add(id);
      return id;
    },
    getTaskId: (message) => {
      if (!liveTaskIds.has(message?.taskId) || message?.type === "ERROR") closeResult(message?.result);
      liveTaskIds.delete(message?.taskId);
      return message?.taskId;
    },
    resolveMessage: (message) => message.result,
  });
  const available = () => !disabled && isSupported();
  const reportQueue = () => metric("geometryWorkerQueue", 0, { pending: queued.size + Number(!!active) });

  async function dispatch(task) {
    active = task;
    reportQueue();
    const startedAt = performance.now();
    let result = null;
    try {
      const resetGeometry = geometryStoreKey !== task.input.sceneKey;
      const savedRefs = resetGeometry ? new Map() : geometryRefs;
      const updates = [];
      const nextRefs = new Map(savedRefs);
      const nextIdsByKind = resetGeometry ? new Map() : new Map(geometryIdsByKind);
      nextIdsByKind.set(task.input.kind, new Set(task.input.entries.map((entry) => entry.id)));
      const retainedIds = new Set([...nextIdsByKind.values()].flatMap((ids) => [...ids]));

      // Build geometry updates for entries that changed or are new.
      const entries = task.input.entries.map(({ feature, ...entry }) => {
        if (!feature?.geometry) throw new TypeError(`Missing raster geometry: ${entry.id}`);
        if (savedRefs.get(entry.id) !== feature.geometry) {
          updates.push({ id: entry.id, feature });
        }
        nextRefs.set(entry.id, feature.geometry);
        return entry;
      });

      // Political overscan and hit candidates differ. Retain their active union
      // so alternating surfaces does not evict and re-upload each other's paths.
      if (!resetGeometry) {
        for (const [id] of savedRefs) {
          if (!retainedIds.has(id)) {
            updates.push({ id, feature: null });
            nextRefs.delete(id);
          }
        }
      }

      const { identity: _identity, ...input } = task.input;
      const packingStartedAt = performance.now();
      const transport = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(updates);
      const packingMs = performance.now() - packingStartedAt;
      result = await client.dispatchTask("RENDER_GEOMETRY", {
        packet: { ...input, entries, geometryUpdates: transport.transferables.length ? null : updates,
          geometryTransport: transport.transferables.length ? transport.payload : null, resetGeometry },
      }, { signal: task.controller.signal, transfer: transport.transferables });
      if (disabled) {
        closeResult(result);
        task.resolve(null);
        return;
      }
      if (!result?.bitmap) throw new Error("Missing geometry raster bitmap.");
      for (const id of result.evictedGeometryIds || []) nextRefs.delete(id);
      geometryStoreKey = task.input.sceneKey;
      geometryRefs = nextRefs;
      geometryIdsByKind = nextIdsByKind;
      metric("geometryWorkerRoundTrip", performance.now() - startedAt, {
        kind: task.input.kind, geometryUploads: updates.filter((update) => update.feature).length,
        geometryRemovals: updates.filter((update) => !update.feature).length, retainedGeometryCount: nextRefs.size, entries: entries.length,
        workerMs: result?.renderMs || 0, pathBuildCount: result?.pathBuildCount || 0,
        yieldCount: result?.yieldCount || 0,
        packingMs, unpackingMs: result?.unpackingMs || 0,
        cacheBudget: result?.cacheBudget || null, geometryEvictions: result?.evictedGeometryIds?.length || 0,
      });
      task.resolve(result);
    } catch (error) {
      closeResult(result);
      // A failed worker may have only applied part of an upload. Do not reuse
      // that acknowledgement, or retry endlessly on an unsupported browser.
      geometryStoreKey = null;
      geometryRefs.clear();
      geometryIdsByKind.clear();
      disabled = true;
      metric("geometryWorkerFallback", 0, { reason: String(error?.message || error), kind: task.input?.kind });
      task.resolve(null);
      for (const pending of queued.values()) pending.resolve(null);
      queued.clear();
      client.terminate();
    } finally {
      liveTaskIds.clear();
      if (active === task) active = null;
      const next = queued.values().next().value;
      if (next) {
        queued.delete(next.input.kind);
        void dispatch(next);
      }
      reportQueue();
    }
  }

  function request(input) {
    if (!available()) return Promise.resolve(null);
    if (!input || typeof input !== "object") return Promise.resolve(null);
    if (active?.input.kind === input.kind && active.input.identity === input.identity) return active.promise;
    const previous = queued.get(input.kind);
    if (previous?.input.identity === input.identity) return previous.promise;
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const task = { input, promise, resolve, controller: new AbortController() };
    if (active) {
      previous?.resolve(null);
      queued.set(input.kind, task);
      reportQueue();
    } else {
      void dispatch(task);
    }
    return promise;
  }

  function dispose() {
    disabled = true;
    active?.controller.abort();
    for (const pending of queued.values()) pending.resolve(null);
    queued.clear();
    client.terminate();
    geometryRefs.clear();
    geometryIdsByKind.clear();
    geometryStoreKey = null;
  }

  return { available, request, dispose, getQueueSize: () => queued.size + Number(!!active) };
}

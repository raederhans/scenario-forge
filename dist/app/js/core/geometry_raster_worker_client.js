import { createWorkerTaskClient } from "./worker_task_client.js";

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
  let sceneKey = null;
  let geometryRefs = new Map();
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
      const resetGeometry = sceneKey !== task.input.sceneKey;
      const savedRefs = resetGeometry ? new Map() : geometryRefs;
      const updates = [];
      const nextRefs = new Map(savedRefs);
      const entries = task.input.entries.map(({ feature, ...entry }) => {
        if (!feature?.geometry) throw new TypeError(`Missing raster geometry: ${entry.id}`);
        if (savedRefs.get(entry.id) !== feature.geometry) {
          updates.push({ id: entry.id, feature });
          nextRefs.set(entry.id, feature.geometry);
        }
        return entry;
      });
      const { identity: _identity, ...input } = task.input;
      result = await client.dispatchTask("RENDER_GEOMETRY", {
        packet: { ...input, entries, geometryUpdates: updates, resetGeometry },
      }, { signal: task.controller.signal });
      if (disabled) {
        closeResult(result);
        task.resolve(null);
        return;
      }
      if (!result?.bitmap) throw new Error("Missing geometry raster bitmap.");
      sceneKey = task.input.sceneKey;
      geometryRefs = nextRefs;
      metric("geometryWorkerRoundTrip", performance.now() - startedAt, {
        kind: task.input.kind, geometryUploads: updates.length, entries: entries.length,
        workerMs: result?.renderMs || 0, pathBuildCount: result?.pathBuildCount || 0,
        yieldCount: result?.yieldCount || 0,
      });
      task.resolve(result);
    } catch (error) {
      closeResult(result);
      // A failed worker may have only applied part of an upload. Do not reuse
      // that acknowledgement, or retry endlessly on an unsupported browser.
      sceneKey = null;
      geometryRefs.clear();
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
    sceneKey = null;
  }

  return { available, request, dispose, getQueueSize: () => queued.size + Number(!!active) };
}

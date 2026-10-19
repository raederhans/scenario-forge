import { packWaterGeometry } from "./renderer/water_geometry_transport.js";

const WORKER_URL = new URL("../workers/water_raster.worker.js", import.meta.url);
const aborted = () => Object.assign(new Error("Water request cancelled."), { name: "AbortError" });
const UNKNOWN_PATTERN_REVISION = Symbol("unknown-water-pattern-revision");

export function createWaterRasterWorkerClient({
  createWorker = () => new Worker(WORKER_URL, { type: "module" }),
  isSupported = () => typeof Worker === "function" && typeof OffscreenCanvas === "function" && typeof Path2D === "function",
  createBitmap = source => createImageBitmap(source), packGeometry = packWaterGeometry,
  timeoutMs = 30_000, nowMs = () => performance.now(),
} = {}) {
  let worker = null, disposed = false, sequence = 0, namespace = null, patternRevision = UNKNOWN_PATTERN_REVISION;
  let resident = new Map(), queue = Promise.resolve();
  const pending = new Map(), lifetime = new AbortController();
  let phase = "idle", startedAt = 0;
  function forget() { namespace = null; resident.clear(); patternRevision = UNKNOWN_PATTERN_REVISION; }
  function cleanup(id) {
    const item = pending.get(id);
    if (!item) return null;
    pending.delete(id); clearTimeout(item.timer); item.signal?.removeEventListener("abort", item.onAbort);
    return item;
  }
  function stop(error) {
    worker?.terminate(); worker = null; forget();
    for (const id of [...pending.keys()]) cleanup(id).reject(error);
  }
  function ensureWorker() {
    if (!worker) {
      worker = createWorker();
      worker.onmessage = event => {
        const message = event.data, item = cleanup(message.taskId);
        if (!item) { message.value?.bitmap?.close(); return; }
        if (message.type === "ERROR") item.reject(Object.assign(new Error(message.message), { name: message.name || "Error" }));
        else item.resolve(message.value);
      };
      worker.onerror = event => stop(new Error(event.message || "Water worker failed."));
    }
    return worker;
  }
  function dispatch(type, payload, signal, transfer = []) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const taskId = `water:${++sequence}`;
      const target = ensureWorker();
      const item = { resolve, reject, signal, timer: null, onAbort: null };
      item.onAbort = () => {
        if (!cleanup(taskId)) return;
        target.postMessage({ type: "CANCEL_TASK", taskId }); reject(aborted());
      };
      item.timer = setTimeout(() => stop(new Error("Water worker timed out.")), timeoutMs);
      pending.set(taskId, item); signal.addEventListener("abort", item.onAbort, { once: true });
      try { target.postMessage({ type, taskId, ...payload }, transfer); }
      catch (error) { cleanup(taskId); reject(error); }
    });
  }
  function available() { return !disposed && !!isSupported(); }
  function request(input, { signal } = {}) {
    if (!available()) return Promise.reject(Object.assign(new Error("Water worker unsupported."), { name: "NotSupportedError" }));
    const requestSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const queuedAt = nowMs();
    const work = queue.then(async () => {
      phase = "geometry"; startedAt = nowMs();
      const timings = { queueWaitMs: startedAt - queuedAt, prepareMs: 0, packingMs: 0,
        syncRoundTripMs: 0, patternMs: 0, buildRoundTripMs: 0, geometryUploadCount: 0, geometryUploadBytes: 0 };
      requestSignal.throwIfAborted(); ensureWorker();
      const updates = [], versions = [], requiredIds = [], sourceIds = [];
      for (const entry of input.features) {
        const id = JSON.stringify([entry.id, entry.geometryVersion]);
        requiredIds.push(id); versions.push([id, entry.geometryVersion]);
        sourceIds.push([id, entry.id]);
        if (namespace !== input.sceneKey || resident.get(id) !== entry.geometryVersion) {
          updates.push({ id, feature: { type: "GeometryCollection", geometries: entry.parts } });
        }
      }
      timings.prepareMs = nowMs() - startedAt;
      if (namespace !== input.sceneKey || updates.length) {
        phase = "packing";
        const packingStartedAt = nowMs();
        const packed = await packGeometry(updates, { signal: requestSignal });
        timings.packingMs = nowMs() - packingStartedAt;
        timings.geometryUploadCount = updates.length;
        timings.geometryUploadBytes = [...new Set(packed.transfer)].reduce((bytes, buffer) => bytes + buffer.byteLength, 0);
        try {
          phase = "sync";
          const syncStartedAt = nowMs();
          const result = await dispatch("SYNC_WATER_GEOMETRY", {
            geometryNamespace: input.sceneKey, updates: packed.payload, versions, requiredIds, sourceIds,
          }, requestSignal, packed.transfer);
          timings.syncRoundTripMs = nowMs() - syncStartedAt;
          requestSignal.throwIfAborted(); namespace = input.sceneKey; resident = new Map(result.resident);
        } catch (error) { forget(); throw error; }
      }
      const patternStartedAt = nowMs();
      let patternSource;
      const nextPatternRevision = input.patternSource?.revision ?? null;
      if (nextPatternRevision !== patternRevision) {
        if (input.patternSource) {
          const bitmap = await createBitmap(input.patternSource.canvas);
          if (requestSignal.aborted) { bitmap.close(); requestSignal.throwIfAborted(); }
          patternSource = { ...input.patternSource, canvas: undefined, bitmap };
        } else patternSource = null;
      }
      timings.patternMs = nowMs() - patternStartedAt;
      const entries = input.features.map(({ parts: _parts, ...entry }) => ({ ...entry, id: JSON.stringify([entry.id, entry.geometryVersion]) }));
      const packet = { identity: input.identity, revision: input.revision, geometryNamespace: input.sceneKey,
        projectionKey: input.projectionKey, projectionOptions: input.projectionOptions,
        layout: input.layout, transform: input.transform, entries, patternRevision: nextPatternRevision };
      try {
        phase = "raster";
        const buildStartedAt = nowMs();
        const result = await dispatch("BUILD_WATER_BITMAP", { packet, patternSource }, requestSignal,
          patternSource?.bitmap ? [patternSource.bitmap] : []);
        timings.buildRoundTripMs = nowMs() - buildStartedAt;
        if (requestSignal.aborted) { result.bitmap.close(); requestSignal.throwIfAborted(); }
        patternRevision = nextPatternRevision;
        return { ...result, stats: { ...result.stats, ...timings } };
      } catch (error) {
        patternSource?.bitmap?.close();
        // BUILD may already have installed its transferred pattern before a
        // cancellation/error. The next build must explicitly replace or clear it.
        patternRevision = UNKNOWN_PATTERN_REVISION;
        throw error;
      }
    });
    queue = work.then(() => { phase = "idle"; }, () => { phase = "idle"; });
    return work;
  }
  function dispose() { disposed = true; lifetime.abort(); stop(aborted()); }
  return { available, request, dispose, getDiagnostics: () => ({ phase, pending: pending.size,
    residentFeatures: resident.size, elapsedMs: phase === "idle" ? 0 : nowMs() - startedAt }) };
}

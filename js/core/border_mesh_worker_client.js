import { createWorkerTaskClient } from "./worker_task_client.js";
import { packTopologyForTransferAsync } from "./topology_transfer_codec.js";
import { unpackBorderMeshResult } from "./border_mesh_transfer_codec.js";

function createAbortError() {
  const error = new Error("Border worker request aborted.");
  error.name = "AbortError";
  return error;
}

function awaitRegistration(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

// The kernel resolves all semantic fields through geometryPolicy. TopoJSON
// mesh only needs this political geometry tree, its arcs and the transform.
export async function prepareBorderTopologyForTransfer(topology, options = {}) {
  const {
    signal,
    nowMs = () => performance.now(),
    yieldControl = () => globalThis.scheduler?.yield
      ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)),
    timeBudgetMs = 4,
    coordinateBatchSize = 16_384,
  } = options;
  const checkCancelled = () => { if (signal?.aborted) throw createAbortError(); };
  checkCancelled();
  const root = [];
  const geometries = new WeakMap();
  const frames = [{ source: [topology.objects?.political], target: root, index: 0 }];
  const batchSize = Math.max(1, Math.floor(Number(coordinateBatchSize) || 16_384));
  const checkInterval = Math.min(256, batchSize);
  let work = 0;
  let startedAt = nowMs();
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.source.length) { frames.pop(); continue; }
    const index = frame.index++;
    if (index in frame.source) {
      const geometry = frame.source[index];
      if (!geometry) frame.target[index] = geometry;
      else if (geometries.has(geometry)) frame.target[index] = geometries.get(geometry);
      else {
        const stripped = { type: geometry.type };
        geometries.set(geometry, stripped);
        frame.target[index] = stripped;
        if ("arcs" in geometry) stripped.arcs = geometry.arcs;
        if ("coordinates" in geometry) stripped.coordinates = geometry.coordinates;
        if (geometry.type === "GeometryCollection" && "geometries" in geometry) {
          const children = geometry.geometries;
          stripped.geometries = Array.isArray(children) ? new Array(children.length) : children;
          if (Array.isArray(children)) frames.push({ source: children, target: stripped.geometries, index: 0 });
        }
      }
    }
    if (++work % checkInterval === 0) {
      checkCancelled();
      if (work >= batchSize || nowMs() - startedAt >= timeBudgetMs) {
        await yieldControl();
        checkCancelled();
        work = 0;
        startedAt = nowMs();
      }
    }
  }
  checkCancelled();
  const shell = { type: topology.type, objects: { political: root[0] }, arcs: topology.arcs };
  if (topology.transform != null) shell.transform = {
    scale: topology.transform.scale, translate: topology.transform.translate,
  };
  return packTopologyForTransferAsync(shell, options);
}

export function createBorderMeshWorkerClient({
  createWorker = () => new Worker(new URL("../workers/border_mesh.worker.js", import.meta.url), { type: "module" }),
  isSupported = () => typeof Worker === "function",
  onDiagnostic = () => {},
  prepareTopology = prepareBorderTopologyForTransfer,
} = {}) {
  let scene = null;
  let generation = 0;
  let registrations = new Map();
  const client = createWorkerTaskClient({ createWorker, resolveMessage: (message, task) => {
    onDiagnostic({ status: "ready", type: task.type, cpuMs: message.cpuMs });
    return task.type === "BUILD" ? unpackBorderMeshResult(message.result) : message.result;
  } });
  function reset(reason = "reset") {
    generation += 1;
    for (const registration of registrations.values()) registration.controller.abort();
    registrations = new Map();
    client.terminate(new Error(`Border worker ${reason}.`));
  }
  async function build({ sceneKey, source, ...request }, { signal, timeoutMs } = {}) {
    if (!isSupported()) return null;
    if (signal?.aborted) throw createAbortError();
    if (scene !== sceneKey) { reset("scene changed"); scene = sceneKey; }
    const ownedGeneration = generation;
    const { sourceKey, sourceSignature } = source;
    let registration = registrations.get(sourceKey);
    if (!registration || registration.signature !== sourceSignature || registration.topology !== source.topology) {
      const sameTopology = registration?.topology === source.topology;
      const previous = registration;
      const sourcePayload = { topology: source.topology, geometryPolicy: source.geometryPolicy };
      if (!sameTopology) previous?.controller.abort();
      const controller = sameTopology ? previous.controller : new AbortController();
      registration = { topology: source.topology, signature: sourceSignature, controller, promise: null };
      registrations.set(sourceKey, registration);
      // Store the shared registration before starting preparation so concurrent
      // builds join it. A BUILD signal must never cancel another build's source.
      registration.promise = Promise.resolve().then(async () => {
        if (sameTopology) {
          await previous.promise;
          if (controller.signal.aborted || generation !== ownedGeneration) throw createAbortError();
          const promise = client.dispatchTask("UPDATE_POLICY", { sourceKey, sourceSignature,
            geometryPolicy: sourcePayload.geometryPolicy }, { timeoutMs, signal: controller.signal });
          onDiagnostic({ status: "dispatch", type: "UPDATE_POLICY", sourceKey });
          return promise;
        }
        const startedAt = performance.now();
        const packed = await prepareTopology(sourcePayload.topology, { signal: controller.signal });
        if (controller.signal.aborted || generation !== ownedGeneration) throw createAbortError();
        const packingMs = performance.now() - startedAt;
        const transferBytes = packed.transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
        const promise = client.dispatchTask("REGISTER_SOURCE", { sourceKey, sourceSignature,
          geometryPolicy: sourcePayload.geometryPolicy,
          topology: packed.topology, topologyArcs: packed.topologyArcs },
        { timeoutMs, transfer: packed.transfer, signal: controller.signal });
        onDiagnostic({ status: "dispatch", type: "REGISTER_SOURCE", sourceKey, packingMs, transferBytes });
        return promise;
      });
    }
    try {
      await awaitRegistration(registration.promise, signal);
      if (generation !== ownedGeneration || registrations.get(sourceKey) !== registration) throw new Error("Stale border worker request.");
      const result = await client.dispatchTask("BUILD", { ...request, sourceKey, sourceSignature }, { signal, timeoutMs });
      if (generation !== ownedGeneration || registrations.get(sourceKey) !== registration) throw new Error("Stale border worker result.");
      return result;
    } catch (error) {
      if (generation === ownedGeneration && registrations.get(sourceKey) === registration && error?.name !== "AbortError") reset("task failed");
      onDiagnostic({ status: error?.name === "AbortError" ? "cancelled" : "error", message: error.message });
      throw error;
    }
  }
  return { build, reset, dispose: () => reset("disposed") };
}

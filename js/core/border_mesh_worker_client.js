import { createWorkerTaskClient } from "./worker_task_client.js";
import { packTopologyForTransfer } from "./topology_transfer_codec.js";

export function createBorderMeshWorkerClient({
  createWorker = () => new Worker(new URL("../workers/border_mesh.worker.js", import.meta.url), { type: "module" }),
  isSupported = () => typeof Worker === "function",
  onDiagnostic = () => {},
} = {}) {
  let scene = null;
  let generation = 0;
  let registrations = new Map();
  const client = createWorkerTaskClient({ createWorker, resolveMessage: (message, task) => {
    onDiagnostic({ status: "ready", type: task.type, cpuMs: message.cpuMs });
    return message.result;
  } });
  function reset(reason = "reset") {
    generation += 1;
    registrations = new Map();
    client.terminate(new Error(`Border worker ${reason}.`));
  }
  async function build({ sceneKey, source, ...request }, { signal, timeoutMs } = {}) {
    if (!isSupported()) return null;
    if (scene !== sceneKey) { reset("scene changed"); scene = sceneKey; }
    const ownedGeneration = generation;
    const { sourceKey, sourceSignature } = source;
    let registration = registrations.get(sourceKey);
    if (!registration || registration.signature !== sourceSignature || registration.topology !== source.topology) {
      const sameTopology = registration?.topology === source.topology;
      let promise;
      if (sameTopology) {
        promise = client.dispatchTask("UPDATE_POLICY", { sourceKey, sourceSignature,
          geometryPolicy: source.geometryPolicy }, { timeoutMs });
        onDiagnostic({ status: "dispatch", type: "UPDATE_POLICY", sourceKey });
      } else {
        const startedAt = performance.now();
        const packed = packTopologyForTransfer(source.topology);
        const packingMs = performance.now() - startedAt;
        const transferBytes = packed.transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
        promise = client.dispatchTask("REGISTER_SOURCE", { ...source,
          topology: packed.topology, topologyArcs: packed.topologyArcs }, { timeoutMs, transfer: packed.transfer });
        onDiagnostic({ status: "dispatch", type: "REGISTER_SOURCE", sourceKey, packingMs, transferBytes });
      }
      registration = { topology: source.topology, signature: sourceSignature, promise };
      registrations.set(sourceKey, registration);
    }
    try {
      await registration.promise;
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

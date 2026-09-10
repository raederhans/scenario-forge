import { createWorkerTaskClient } from "./worker_task_client.js";

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
    if (!registration || registration.signature !== sourceSignature) {
      registration = { signature: sourceSignature, promise: client.dispatchTask("REGISTER_SOURCE", source, { timeoutMs }) };
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

import "../../vendor/topojson-client.min.js";
import { createBorderMeshWorkerKernel } from "../core/renderer/border_mesh_worker_kernel.js";

const kernel = createBorderMeshWorkerKernel();
self.onmessage = ({ data }) => {
  const { type, taskId } = data;
  if (type === "CANCEL_TASK") return;
  try {
    const startedAt = performance.now();
    const result = type === "REGISTER_SOURCE" ? kernel.registerSource(data)
      : type === "BUILD" ? kernel.build(data) : (() => { throw new Error("Unknown border worker task."); })();
    self.postMessage({ type: "RESULT", taskId, result, cpuMs: performance.now() - startedAt });
  } catch (error) {
    self.postMessage({ type: "ERROR", taskId, message: error?.message || String(error) });
  }
};

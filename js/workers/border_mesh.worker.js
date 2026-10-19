import "../../vendor/topojson-client.min.js";
import { createBorderMeshWorkerKernel } from "../core/renderer/border_mesh_worker_kernel.js";
import { packBorderMeshResult } from "../core/border_mesh_transfer_codec.js";

const kernel = createBorderMeshWorkerKernel();
self.onmessage = ({ data }) => {
  const { type, taskId } = data;
  if (type === "CANCEL_TASK") return;
  try {
    const startedAt = performance.now();
    const result = type === "REGISTER_SOURCE" ? kernel.registerSource(data)
      : type === "UPDATE_POLICY" ? kernel.updatePolicy(data)
      : type === "BUILD" ? kernel.build(data) : (() => { throw new Error("Unknown border worker task."); })();
    const packed = type === "BUILD" ? packBorderMeshResult(result) : { result, transfer: [] };
    self.postMessage({ type: "RESULT", taskId, result: packed.result, cpuMs: performance.now() - startedAt }, packed.transfer);
  } catch (error) {
    self.postMessage({ type: "ERROR", taskId, message: error?.message || String(error) });
  }
};

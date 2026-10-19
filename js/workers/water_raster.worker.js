import "../../vendor/d3.v7.min.js";
import { createWaterRasterWorkerKernel } from "../core/renderer/water_raster_worker_kernel.js";

export function createWaterRasterWorkerRuntime({ postMessage, kernel = createWaterRasterWorkerKernel({ d3: globalThis.d3 }) } = {}) {
  const tasks = new Map();
  let queue = Promise.resolve(), disposed = false;
  function receive(message) {
    if (message.type === "CANCEL_TASK") { const task = tasks.get(message.taskId); if (task) task.cancelled = true; return; }
    if (message.type === "DISPOSE") { disposed = true; for (const task of tasks.values()) task.cancelled = true; queue.finally(() => kernel.dispose()); return; }
    if (disposed) { message.patternSource?.bitmap.close(); return; }
    const task = { cancelled: false };
    tasks.set(message.taskId, task);
    queue = queue.then(async () => {
      let pattern = message.patternSource;
      try {
        if (task.cancelled) return;
        let value;
        if (message.type === "SYNC_WATER_GEOMETRY") value = kernel.sync(message);
        else if (message.type === "BUILD_WATER_BITMAP") {
          if (pattern !== undefined) { kernel.setPattern(pattern); pattern = null; }
          value = await kernel.render(message.packet, { isCancelled: () => task.cancelled });
        } else throw new Error("Unsupported water worker task.");
        if (task.cancelled || disposed) { value?.bitmap?.close(); return; }
        postMessage({ type: "RESULT", taskId: message.taskId, value }, value?.bitmap ? [value.bitmap] : []);
      } catch (error) {
        if (!task.cancelled && !disposed) postMessage({ type: "ERROR", taskId: message.taskId, message: error.message, name: error.name });
      } finally { pattern?.bitmap.close(); tasks.delete(message.taskId); }
    });
  }
  return { receive };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const runtime = createWaterRasterWorkerRuntime({ postMessage: (...args) => globalThis.postMessage(...args) });
  globalThis.onmessage = event => runtime.receive(event.data);
}

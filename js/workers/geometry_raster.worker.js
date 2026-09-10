import "../../vendor/d3.v7.min.js";
import { createGeometryRasterWorkerKernel } from "../core/renderer/geometry_raster_worker_kernel.js";

const kernel = createGeometryRasterWorkerKernel({ d3: globalThis.d3 });
const tasks = new Map();
let queue = Promise.resolve();

self.onmessage = ({ data: message = {} }) => {
  const { taskId, type } = message;
  if (type === "CANCEL_TASK") {
    const task = tasks.get(taskId);
    if (task) task.cancelled = true;
    return;
  }
  if (type !== "RENDER_GEOMETRY") {
    self.postMessage({ type: "ERROR", taskId, message: "Unsupported geometry raster task." });
    return;
  }
  const task = { cancelled: false };
  tasks.set(taskId, task);
  queue = queue.then(async () => {
    let result = null;
    try {
      result = await kernel.render(message.packet, { isCancelled: () => task.cancelled });
      if (task.cancelled) result.bitmap.close();
      else self.postMessage({ type: "GEOMETRY_RASTER_RESULT", taskId, result }, [result.bitmap]);
    } catch (error) {
      result?.bitmap?.close();
      if (!task.cancelled) self.postMessage({ type: "ERROR", taskId, message: String(error.message || error) });
    } finally {
      if (tasks.get(taskId) === task) tasks.delete(taskId);
    }
  });
};

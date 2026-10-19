import { createCanvasGpuSubmissionKernel } from "../core/renderer/canvas_gpu_submission_kernel.js";

export function createCanvasGpuSubmissionWorkerRuntime({
  postMessage, kernel = createCanvasGpuSubmissionKernel(),
} = {}) {
  let active = null, disposed = false;
  function receive(message = {}) {
    if (message.type === "CANCEL_TASK") {
      if (active?.taskId === message.taskId) active.cancelled = true;
      return;
    }
    if (message.type === "DISPOSE_CANVAS_GPU_SESSION" && !active) {
      disposed = true;
      active = { taskId: message.taskId };
      return (async () => {
        let reply;
        try {
          await kernel.dispose();
          reply = { type: "CANVAS_GPU_DISPOSED", taskId: message.taskId };
        } catch (error) {
          reply = { type: "ERROR", taskId: message.taskId, message: String(error?.message || error), name: error?.name || "Error" };
        } finally { active = null; }
        postMessage(reply);
      })();
    }
    if (message.type !== "CONSUME_CANVAS_BITMAP" || active || disposed) {
      message.bitmap?.close?.();
      postMessage({ type: "ERROR", taskId: message.taskId,
        message: active ? "Canvas GPU submission worker is busy." : disposed
          ? "Canvas GPU submission worker is disposed." : "Unsupported canvas GPU submission task." });
      return;
    }
    const task = { taskId: message.taskId, cancelled: false };
    active = task;
    return (async () => {
      let reply;
      try {
        const stats = await kernel.consume(message.bitmap, { width: message.width, height: message.height,
          isCancelled: () => task.cancelled });
        reply = { type: task.cancelled ? "CANVAS_GPU_CANCELLED" : "CANVAS_GPU_RESULT", taskId: task.taskId, stats };
      } catch (error) {
        reply = task.cancelled || error?.name === "AbortError"
          ? { type: "CANVAS_GPU_CANCELLED", taskId: task.taskId }
          : { type: "ERROR", taskId: task.taskId, message: String(error?.message || error), name: error?.name || "Error" };
      } finally {
        // Each candidate's bitmap, texture and fence have been released. The
        // idle 1x1 context remains owned by this session until explicit disposal.
        active = null;
      }
      postMessage(reply);
    })();
  }
  return { receive, getPendingTaskCount: () => Number(!!active) };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const runtime = createCanvasGpuSubmissionWorkerRuntime({ postMessage: value => globalThis.postMessage(value) });
  globalThis.onmessage = event => { void runtime.receive(event.data); };
}

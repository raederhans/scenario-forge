import { createWorkerTaskClient } from "./worker_task_client.js";

const WORKER_URL = new URL("../workers/canvas_gpu_submission.worker.js", import.meta.url);
const abortError = () => new DOMException("Canvas GPU submission cancelled.", "AbortError");

// A renderer may retain one lazy worker session across runners. There is no queue: the next bitmap
// cannot enter until the previous task has acknowledged resource cleanup.
export function createCanvasGpuSubmissionClient({
  createWorker = () => new Worker(WORKER_URL, { type: "module" }),
  isSupported = () => typeof Worker === "function",
  timeoutMs = 20_000,
} = {}) {
  let active = null, disposed = false, worker = null, disposal = null, lastFailure = null;
  function cancel(task) {
    task.cancelled = true;
    if (task.taskId && worker) {
      try { worker.postMessage({ type: "CANCEL_TASK", taskId: task.taskId }); }
      catch (error) { client.terminate(error); worker = null; }
    }
  }
  const client = createWorkerTaskClient({
    createWorker: () => {
      if (disposed || !isSupported()) throw new Error("Canvas GPU submission worker is unavailable.");
      worker = createWorker();
      return worker;
    },
    createTaskId: (type, sequence) => {
      if (type === "DISPOSE_CANVAS_GPU_SESSION") return `canvas-gpu-dispose:${sequence}`;
      const taskId = `canvas-gpu:${sequence}`;
      active.taskId = taskId;
      const task = active;
      // Cancellation may arrive while the generic client's worker-start
      // microtask is pending. Send it after the request has been posted.
      if (task.cancelled) queueMicrotask(() => { if (active === task) cancel(task); });
      return taskId;
    },
    defaultTimeoutMs: timeoutMs,
    createTimeoutError: type => {
      worker = null;
      return new Error(`Worker task timed out for ${type}.`);
    },
    createWorkerError: event => {
      worker = null;
      return event?.error instanceof Error ? event.error : new Error(event?.message || "Canvas GPU submission worker crashed.");
    },
    createMessageError: message => Object.assign(new Error(message.message || "Canvas GPU submission failed."), {
      name: message.name || "Error",
    }),
    resolveMessage: message => {
      if (!["CANVAS_GPU_RESULT", "CANVAS_GPU_CANCELLED", "CANVAS_GPU_DISPOSED"].includes(message.type)) {
        throw new Error("Invalid canvas GPU completion acknowledgement.");
      }
      return message;
    },
  });

  function consume(bitmap, { signal, width = bitmap?.width, height = bitmap?.height } = {}) {
    if (active) {
      bitmap?.close?.();
      return Promise.reject(new Error("Canvas GPU submission session already has an active task."));
    }
    const bytes = width * height * 4;
    if (disposed || !isSupported() || !bitmap || ![width, height].every(value => Number.isSafeInteger(value) && value > 0)
      || bitmap.width !== width || bitmap.height !== height || !Number.isSafeInteger(bytes)
      || bytes * 3 > 80 * 1024 * 1024) {
      bitmap?.close?.();
      return Promise.reject(new Error("Invalid or unavailable canvas GPU submission."));
    }
    lastFailure = null;
    const task = { taskId: null, cancelled: !!signal?.aborted, promise: null };
    active = task;
    const onAbort = () => cancel(task);
    signal?.addEventListener("abort", onAbort, { once: true });
    task.promise = (async () => {
      try {
        if (task.cancelled) throw abortError();
        await client.ensureWorker();
        if (task.cancelled || disposed) throw abortError();
        // Deliberately omit the generic client's signal option. Its immediate
        // abort rejection would release the runner's ledger before GPU cleanup.
        const result = await client.dispatchTask("CONSUME_CANVAS_BITMAP", { bitmap, width, height }, { transfer: [bitmap] });
        if (task.cancelled || disposed || result.type === "CANVAS_GPU_CANCELLED") throw abortError();
        if (result.stats?.width !== width || result.stats?.height !== height) {
          throw new Error("Canvas GPU completion dimensions do not match the submitted bitmap.");
        }
        return result.stats;
      } catch (error) {
        if (task.cancelled || disposed) throw abortError();
        lastFailure = error;
        throw error;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        // This closes an untransferred bitmap on every early failure. After a
        // successful transfer the sender is detached and owns no pixel storage.
        bitmap.close();
        if (active === task) active = null;
      }
    })();
    return task.promise;
  }

  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    const task = active;
    if (task) cancel(task);
    disposal = (async () => {
      try { await task?.promise; } catch { /* The owner receives the original task failure. */ }
      try {
        if (worker) {
          const result = await client.dispatchTask("DISPOSE_CANVAS_GPU_SESSION");
          if (result.type !== "CANVAS_GPU_DISPOSED") throw new Error("Invalid canvas GPU disposal acknowledgement.");
        }
      } catch (error) {
        if (!lastFailure) throw error;
      } finally { client.terminate(); worker = null; }
    })();
    return disposal;
  }

  return { consume, dispose, getPendingTaskCount: () => Number(!!active) };
}

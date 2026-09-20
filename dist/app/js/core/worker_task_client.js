function normalizeTaskId(value = "") {
  return String(value || "").trim();
}

function defaultCreateTaskId(type, sequence) {
  return `${String(type || "task")}:${Date.now()}:${sequence}`;
}

function defaultCreateTimeoutError(type) {
  return new Error(`Worker task timed out for ${String(type || "task")}.`);
}

function defaultCreateWorkerError(event) {
  if (event?.error instanceof Error) {
    return event.error;
  }
  return new Error(event?.message || "Worker task client crashed.");
}

function createAbortError(reason = null) {
  if (reason instanceof Error && reason.name === "AbortError") {
    return reason;
  }
  if (typeof globalThis.DOMException === "function") {
    return new globalThis.DOMException("Worker task aborted.", "AbortError");
  }
  const error = new Error("Worker task aborted.");
  error.name = "AbortError";
  return error;
}

export function createWorkerTaskClient({
  createWorker,
  defaultTimeoutMs = 20_000,
  resolveTimeoutMs = (_type, timeoutMs = null) => (
    Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : defaultTimeoutMs
  ),
  createTaskId = defaultCreateTaskId,
  getTaskId = (message) => normalizeTaskId(message?.taskId),
  isErrorMessage = (message) => String(message?.type || "") === "ERROR",
  createMessageError = (message) => new Error(message?.message || "Worker task failed."),
  createTimeoutError = defaultCreateTimeoutError,
  createRecycleError = (_type, _taskId, timeoutError) => timeoutError,
  createWorkerError = defaultCreateWorkerError,
  resolveMessage = (message) => message,
} = {}) {
  if (typeof createWorker !== "function") {
    throw new TypeError("createWorkerTaskClient requires a createWorker function.");
  }

  let workerInstance = null;
  let workerLoadPromise = null;
  let taskSequence = 0;
  const pendingTasks = new Map();

  function cleanupPendingTask(taskId) {
    const normalizedTaskId = normalizeTaskId(taskId);
    const pending = pendingTasks.get(normalizedTaskId);
    if (!pending) return null;
    if (pending.timeoutId !== null && pending.timeoutId !== undefined) {
      globalThis.clearTimeout?.(pending.timeoutId);
    }
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener?.("abort", pending.abortListener);
    }
    pendingTasks.delete(normalizedTaskId);
    return pending;
  }

  function rejectAllPending(error) {
    for (const [taskId, pending] of pendingTasks.entries()) {
      cleanupPendingTask(taskId);
      pending.reject(error);
    }
  }

  function recycleWorker(error = null) {
    if (workerInstance && typeof workerInstance.terminate === "function") {
      workerInstance.terminate();
    }
    workerInstance = null;
    workerLoadPromise = null;
    if (error) {
      rejectAllPending(error);
    }
  }

  function handleWorkerMessage(event) {
    const message = event?.data || {};
    const taskId = getTaskId(message);
    if (!taskId) return;
    const pending = cleanupPendingTask(taskId);
    if (!pending) return;
    if (isErrorMessage(message, pending)) {
      pending.reject(createMessageError(message, pending));
      return;
    }
    try {
      pending.resolve(resolveMessage(message, pending));
    } catch (error) {
      pending.reject(error);
    }
  }

  function handleWorkerError(event) {
    recycleWorker(createWorkerError(event));
  }

  function ensureWorker() {
    if (workerInstance) {
      return Promise.resolve(workerInstance);
    }
    if (!workerLoadPromise) {
      workerLoadPromise = Promise.resolve().then(() => {
        const worker = createWorker();
        worker.onmessage = handleWorkerMessage;
        worker.onerror = handleWorkerError;
        workerInstance = worker;
        return worker;
      }).catch((error) => {
        workerLoadPromise = null;
        throw error;
      });
    }
    return workerLoadPromise;
  }

  function dispatchTask(type, payload = {}, { timeoutMs = null, signal = null, transfer = [] } = {}) {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal.reason));
    }
    return ensureWorker().then((worker) => new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError(signal.reason));
        return;
      }
      const taskId = normalizeTaskId(createTaskId(type, ++taskSequence));
      const effectiveTimeoutMs = resolveTimeoutMs(type, timeoutMs);
      const timeoutId = globalThis.setTimeout?.(() => {
        const pending = cleanupPendingTask(taskId);
        if (!pending) return;
        const timeoutError = createTimeoutError(type, taskId);
        recycleWorker(createRecycleError(type, taskId, timeoutError));
        pending.reject(timeoutError);
      }, effectiveTimeoutMs);
      const pending = {
        resolve,
        reject,
        timeoutId,
        type,
        payload,
        signal,
        abortListener: null,
      };
      const abortTask = () => {
        const activePending = cleanupPendingTask(taskId);
        if (!activePending) return;
        try {
          worker.postMessage({ type: "CANCEL_TASK", taskId });
        } catch (_error) {
          // The caller still receives the requested cancellation if the worker is already gone.
        }
        activePending.reject(createAbortError(signal?.reason));
      };
      pending.abortListener = abortTask;
      pendingTasks.set(taskId, pending);
      if (signal) {
        signal.addEventListener?.("abort", abortTask, { once: true });
        if (signal.aborted) {
          abortTask();
          return;
        }
      }
      try {
        worker.postMessage({
          type,
          taskId,
          ...payload,
        }, transfer);
      } catch (error) {
        const activePending = cleanupPendingTask(taskId);
        if (activePending) {
          activePending.reject(error);
        }
      }
    }));
  }

  return {
    cleanupPendingTask,
    dispatchTask,
    ensureWorker,
    getPendingTaskCount: () => pendingTasks.size,
    recycleWorker,
    terminate: (error = new Error("Worker task client terminated.")) => recycleWorker(error),
  };
}

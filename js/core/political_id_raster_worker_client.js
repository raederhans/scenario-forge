import { createWorkerTaskClient } from "./worker_task_client.js";

const WORKER_URL = new URL("../workers/political_id_raster.worker.js", import.meta.url);

export function createPoliticalIdRasterWorkerClient({
  createWorker = () => new Worker(WORKER_URL, { type: "module" }),
  isSupported = () => typeof Worker === "function"
    && typeof OffscreenCanvas === "function" && typeof Path2D === "function",
  taskClient = null,
} = {}) {
  let disposed = false;
  const lifetime = new AbortController();
  const client = taskClient || createWorkerTaskClient({
    createWorker: () => {
      // The shared task client creates its worker in a later microtask.
      if (disposed) throw new Error("Political ID raster worker client is disposed.");
      return createWorker();
    },
    resolveMessage: (message) => message.tile,
    isErrorMessage: (message) => message.type === "ERROR" || message.error === true,
    createMessageError: (message) => new Error(message.message || message.errorCode || "Political ID raster worker failed."),
  });

  function available() {
    return !disposed && !!isSupported();
  }

  function request(packet, { signal } = {}) {
    if (disposed) return Promise.reject(new Error("Political ID raster worker client is disposed."));
    if (!available()) return Promise.reject(new Error("Political ID raster worker is unavailable."));
    if (!packet || typeof packet !== "object") return Promise.reject(new TypeError("Political ID raster packet is required."));
    const requestSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    return client.dispatchTask("BUILD_POLITICAL_ID_TILE", { packet }, { signal: requestSignal });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    client.terminate(new Error("Political ID raster worker client disposed."));
    lifetime.abort();
  }

  return Object.freeze({ available, request, dispose });
}

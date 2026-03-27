const STARTUP_WORKER_URL = new URL("../workers/startup_boot.worker.js", import.meta.url);
const STARTUP_WORKER_TIMEOUT_MS = 20_000;

const MESSAGE_TYPES = Object.freeze({
  LOAD_BASE_STARTUP: "LOAD_BASE_STARTUP",
  LOAD_SCENARIO_RUNTIME_BOOTSTRAP: "LOAD_SCENARIO_RUNTIME_BOOTSTRAP",
  DECODE_RUNTIME_CHUNK: "DECODE_RUNTIME_CHUNK",
  BASE_STARTUP_READY: "BASE_STARTUP_READY",
  SCENARIO_RUNTIME_BOOTSTRAP_READY: "SCENARIO_RUNTIME_BOOTSTRAP_READY",
  RUNTIME_CHUNK_READY: "RUNTIME_CHUNK_READY",
  ERROR: "ERROR",
});

let startupWorker = null;
let startupWorkerLoadPromise = null;
let taskCounter = 0;
const pendingTasks = new Map();

function getSearchParams(search = null) {
  try {
    const source = typeof search === "string" ? search : (globalThis.location?.search || "");
    return new URLSearchParams(source);
  } catch (_error) {
    return new URLSearchParams();
  }
}

function parseToggleParam(value, fallback = null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function shouldUseStartupWorker(search = null) {
  if (typeof globalThis.Worker !== "function") return false;
  const params = getSearchParams(search);
  if (parseToggleParam(params.get("dev_nocache"), false) === true) {
    return false;
  }
  return parseToggleParam(params.get("startup_worker"), true) !== false;
}

function cleanupPendingTask(taskId) {
  const pending = pendingTasks.get(taskId);
  if (!pending) return null;
  if (pending.timeoutId) {
    globalThis.clearTimeout?.(pending.timeoutId);
  }
  pendingTasks.delete(taskId);
  return pending;
}

function rejectAllPending(error) {
  for (const [taskId, pending] of pendingTasks.entries()) {
    cleanupPendingTask(taskId);
    pending.reject(error);
  }
}

function ensureStartupWorker() {
  if (startupWorker) {
    return Promise.resolve(startupWorker);
  }
  if (!startupWorkerLoadPromise) {
    startupWorkerLoadPromise = Promise.resolve().then(() => {
      const worker = new Worker(STARTUP_WORKER_URL);
      worker.onmessage = (event) => {
        const message = event?.data || {};
        const taskId = String(message?.taskId || "").trim();
        if (!taskId) return;
        const pending = cleanupPendingTask(taskId);
        if (!pending) return;
        if (message.type === MESSAGE_TYPES.ERROR) {
          pending.reject(new Error(message.message || `Startup worker failed during ${message.stage || "unknown"}.`));
          return;
        }
        pending.resolve(message);
      };
      worker.onerror = (event) => {
        const error = event?.error instanceof Error
          ? event.error
          : new Error(event?.message || "Startup worker crashed.");
        rejectAllPending(error);
        startupWorker?.terminate?.();
        startupWorker = null;
        startupWorkerLoadPromise = null;
      };
      startupWorker = worker;
      return worker;
    }).catch((error) => {
      startupWorkerLoadPromise = null;
      throw error;
    });
  }
  return startupWorkerLoadPromise;
}

function dispatchTask(type, payload, { timeoutMs = STARTUP_WORKER_TIMEOUT_MS } = {}) {
  return ensureStartupWorker().then((worker) => new Promise((resolve, reject) => {
    const taskId = `${type}:${Date.now()}:${++taskCounter}`;
    const timeoutId = globalThis.setTimeout?.(() => {
      cleanupPendingTask(taskId);
      reject(new Error(`Startup worker timed out for ${type}.`));
    }, timeoutMs);
    pendingTasks.set(taskId, {
      resolve,
      reject,
      timeoutId,
    });
    worker.postMessage({
      type,
      taskId,
      ...payload,
    });
  }));
}

export async function loadBaseStartupViaWorker({
  topologyUrl,
  localesUrl,
  geoAliasesUrl,
  timeoutMs = STARTUP_WORKER_TIMEOUT_MS,
} = {}) {
  const message = await dispatchTask(MESSAGE_TYPES.LOAD_BASE_STARTUP, {
    topologyUrl,
    localesUrl,
    geoAliasesUrl,
  }, { timeoutMs });
  return {
    topologyPrimary: message.topologyPrimary || null,
    locales: message.locales || { ui: {}, geo: {} },
    geoAliases: message.geoAliases || { alias_to_stable_key: {} },
    decodedCollections: message.decodedCollections || null,
    metrics: message.metrics || null,
  };
}

export async function loadScenarioRuntimeBootstrapViaWorker({
  runtimeTopologyUrl,
  timeoutMs = STARTUP_WORKER_TIMEOUT_MS,
} = {}) {
  const message = await dispatchTask(MESSAGE_TYPES.LOAD_SCENARIO_RUNTIME_BOOTSTRAP, {
    runtimeTopologyUrl,
  }, { timeoutMs });
  return {
    runtimePoliticalTopology: message.runtimePoliticalTopology || null,
    runtimePoliticalMeta: message.runtimePoliticalMeta || null,
    decodedCollections: message.decodedCollections || null,
    metrics: message.metrics || null,
  };
}

export async function decodeRuntimeChunkViaWorker({
  runtimeTopologyUrl,
  chunkUrl,
  chunkType = "runtime-topology",
  timeoutMs = STARTUP_WORKER_TIMEOUT_MS,
} = {}) {
  const message = await dispatchTask(MESSAGE_TYPES.DECODE_RUNTIME_CHUNK, {
    runtimeTopologyUrl,
    chunkUrl,
    chunkType,
  }, { timeoutMs });
  return {
    runtimePoliticalTopology: message.runtimePoliticalTopology || null,
    runtimePoliticalMeta: message.runtimePoliticalMeta || null,
    decodedCollections: message.decodedCollections || null,
    chunkPayload: message.chunkPayload || null,
    metrics: message.metrics || null,
  };
}

export function terminateStartupWorker() {
  if (startupWorker) {
    startupWorker.terminate();
  }
  rejectAllPending(new Error("Startup worker terminated."));
  startupWorker = null;
  startupWorkerLoadPromise = null;
}

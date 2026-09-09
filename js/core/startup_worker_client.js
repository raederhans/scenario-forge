import { createWorkerTaskClient } from "./worker_task_client.js";

const STARTUP_WORKER_URL = new URL("../workers/startup_boot.worker.js", import.meta.url);
const STARTUP_WORKER_TIMEOUT_MS = 20_000;
const STARTUP_WORKER_TIMEOUTS_MS = Object.freeze({
  LOAD_BASE_STARTUP: 20_000,
  LOAD_STARTUP_BUNDLE: 45_000,
  LOAD_SCENARIO_RUNTIME_BOOTSTRAP: 30_000,
  DECODE_RUNTIME_CHUNK: 30_000,
});

const MESSAGE_TYPES = Object.freeze({
  LOAD_BASE_STARTUP: "LOAD_BASE_STARTUP",
  LOAD_STARTUP_BUNDLE: "LOAD_STARTUP_BUNDLE",
  LOAD_SCENARIO_RUNTIME_BOOTSTRAP: "LOAD_SCENARIO_RUNTIME_BOOTSTRAP",
  DECODE_RUNTIME_CHUNK: "DECODE_RUNTIME_CHUNK",
  BASE_STARTUP_READY: "BASE_STARTUP_READY",
  STARTUP_BUNDLE_READY: "STARTUP_BUNDLE_READY",
  SCENARIO_RUNTIME_BOOTSTRAP_READY: "SCENARIO_RUNTIME_BOOTSTRAP_READY",
  RUNTIME_CHUNK_READY: "RUNTIME_CHUNK_READY",
  ERROR: "ERROR",
});

let taskCounter = 0;
const startupWorkerTaskClient = createWorkerTaskClient({
  createWorker: () => new Worker(STARTUP_WORKER_URL),
  createTaskId: (type) => `${type}:${Date.now()}:${++taskCounter}`,
  resolveTimeoutMs: resolveTaskTimeoutMs,
  createMessageError: (message) => {
    const error = new Error(message.message || `Startup worker failed during ${message.stage || "unknown"}.`);
    if (message?.name) {
      error.name = String(message.name);
    }
    return error;
  },
  createTimeoutError: (type) => new Error(`Startup worker timed out for ${type}.`),
  createRecycleError: (type) => new Error(`Startup worker recycled after timeout for ${type}.`),
  createWorkerError: (event) => (
    event?.error instanceof Error
      ? event.error
      : new Error(event?.message || "Startup worker crashed.")
  ),
});

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

function resolveTaskTimeoutMs(type, timeoutMs = null) {
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  return STARTUP_WORKER_TIMEOUTS_MS[type] || STARTUP_WORKER_TIMEOUT_MS;
}

function resolveWorkerResourceUrl(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return "";
  }
  try {
    return new URL(normalizedUrl, globalThis.location?.href || import.meta.url).toString();
  } catch (_error) {
    return normalizedUrl;
  }
}

function dispatchTask(type, payload, { timeoutMs = null, signal = null } = {}) {
  return startupWorkerTaskClient.dispatchTask(type, payload, { timeoutMs, signal });
}

export async function loadBaseStartupViaWorker({
  topologyUrl,
  localesUrl,
  geoAliasesUrl,
  needTopologyPrimary = true,
  needLocales = true,
  needGeoAliases = true,
  cachedTopologyPrimary = null,
  timeoutMs = null,
} = {}) {
  const message = await dispatchTask(MESSAGE_TYPES.LOAD_BASE_STARTUP, {
    topologyUrl: resolveWorkerResourceUrl(topologyUrl),
    localesUrl: resolveWorkerResourceUrl(localesUrl),
    geoAliasesUrl: resolveWorkerResourceUrl(geoAliasesUrl),
    needTopologyPrimary,
    needLocales,
    needGeoAliases,
    cachedTopologyPrimary,
  }, { timeoutMs });
  return {
    topologyPrimary: message.topologyPrimary || null,
    locales: message.locales === null ? null : (message.locales || { ui: {}, geo: {} }),
    geoAliases: message.geoAliases === null ? null : (message.geoAliases || { alias_to_stable_key: {} }),
    decodedCollections: message.decodedCollections || null,
    metrics: message.metrics || null,
  };
}

export async function loadStartupBundleViaWorker({
  startupBundleUrl,
  scenarioId = "",
  language = "en",
  timeoutMs = null,
} = {}) {
  const message = await dispatchTask(MESSAGE_TYPES.LOAD_STARTUP_BUNDLE, {
    startupBundleUrl: resolveWorkerResourceUrl(startupBundleUrl),
    scenarioId,
    language,
  }, { timeoutMs });
  return {
    payload: message.payload || null,
    baseDecodedCollections: message.baseDecodedCollections || null,
    runtimeDecodedCollections: message.runtimeDecodedCollections || null,
    runtimePoliticalMeta: message.runtimePoliticalMeta || null,
    metrics: message.metrics || null,
  };
}

export async function loadScenarioRuntimeBootstrapViaWorker({
  runtimeTopologyUrl,
  timeoutMs = null,
} = {}) {
  const message = await dispatchTask(MESSAGE_TYPES.LOAD_SCENARIO_RUNTIME_BOOTSTRAP, {
    runtimeTopologyUrl: resolveWorkerResourceUrl(runtimeTopologyUrl),
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
  timeoutMs = null,
  signal = null,
} = {}) {
  const message = await dispatchTask(MESSAGE_TYPES.DECODE_RUNTIME_CHUNK, {
    runtimeTopologyUrl: resolveWorkerResourceUrl(runtimeTopologyUrl),
    chunkUrl: resolveWorkerResourceUrl(chunkUrl),
    chunkType,
  }, { timeoutMs, signal });
  return {
    runtimePoliticalTopology: message.runtimePoliticalTopology || null,
    runtimePoliticalMeta: message.runtimePoliticalMeta || null,
    decodedCollections: message.decodedCollections || null,
    chunkPayload: message.chunkPayload || null,
    metrics: message.metrics || null,
  };
}

export function terminateStartupWorker() {
  startupWorkerTaskClient.terminate(new Error("Startup worker terminated."));
}

// Default-off political raster worker protocol client.
// Protocol v2 makes request identity and result metrics measurable while the
// renderer keeps the existing main-thread political pass as the stable path.

export const POLITICAL_RASTER_WORKER_PROTOCOL_VERSION = 2;
export const POLITICAL_RASTER_WORKER_METRIC_NAMES = Object.freeze({
  roundTripMs: "politicalRasterWorker.roundTripMs",
  rasterMs: "politicalRasterWorker.rasterMs",
  encodeMs: "politicalRasterWorker.encodeMs",
  decodeMs: "politicalRasterWorker.decodeMs",
  blitMs: "politicalRasterWorker.blitMs",
  timeoutCount: "politicalRasterWorker.timeoutCount",
  recycleCount: "politicalRasterWorker.recycleCount",
  staleResponseCount: "politicalRasterWorker.staleResponseCount",
  acceptedCount: "politicalRasterWorker.acceptedCount",
  rejectedStaleCount: "politicalRasterWorker.rejectedStaleCount",
  fallbackCount: "politicalRasterWorker.fallbackCount",
});

const POLITICAL_RASTER_WORKER_FLAG_QUERY_KEYS = Object.freeze([
  "political_raster_worker",
  "ENABLE_POLITICAL_RASTER_WORKER",
]);
const POLITICAL_RASTER_WORKER_FLAG_TRUE_VALUES = Object.freeze(["1", "true", "yes", "on"]);
const POLITICAL_RASTER_WORKER_TIMEOUT_MS = 1800;
const POLITICAL_RASTER_WORKER_URL = new URL("../workers/political_raster.worker.js", import.meta.url);

const politicalRasterWorkerFlagCache = {
  initialized: false,
  enabled: false,
  search: "",
};

let workerInstance = null;
let taskSequence = 0;
let pendingTask = null;
let latestIdentity = null;

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function readPoliticalRasterWorkerFlagFromSearch(search = globalThis.location?.search || "") {
  const normalizedSearch = String(search || "");
  const params = new URLSearchParams(normalizedSearch);
  const values = POLITICAL_RASTER_WORKER_FLAG_QUERY_KEYS
    .map((key) => params.get(key))
    .filter((value) => value !== null);
  const raw = values.find((value) => value.trim() !== "") || values[0] || "";
  return POLITICAL_RASTER_WORKER_FLAG_TRUE_VALUES.includes(raw.trim().toLowerCase());
}

function ensurePoliticalRasterWorkerFlagCache(search = globalThis.location?.search || "") {
  const normalizedSearch = String(search || "");
  if (politicalRasterWorkerFlagCache.initialized && politicalRasterWorkerFlagCache.search === normalizedSearch) {
    return politicalRasterWorkerFlagCache.enabled;
  }
  politicalRasterWorkerFlagCache.enabled = readPoliticalRasterWorkerFlagFromSearch(normalizedSearch);
  politicalRasterWorkerFlagCache.search = normalizedSearch;
  politicalRasterWorkerFlagCache.initialized = true;
  return politicalRasterWorkerFlagCache.enabled;
}

export function refreshPoliticalRasterWorkerFlag(search = globalThis.location?.search || "") {
  const normalizedSearch = String(search || "");
  politicalRasterWorkerFlagCache.search = "";
  politicalRasterWorkerFlagCache.initialized = false;
  return ensurePoliticalRasterWorkerFlagCache(normalizedSearch);
}

export function isPoliticalRasterWorkerEnabled(search = globalThis.location?.search || "") {
  return ensurePoliticalRasterWorkerFlagCache(search);
}

export function createPoliticalRasterWorkerIdentity({
  scenarioId = "",
  selectionVersion = 0,
  topologyRevision = 0,
  colorRevision = 0,
  transformBucket = "",
  dpr = 1,
  viewport = null,
  passSignature = "",
} = {}) {
  return {
    protocolVersion: POLITICAL_RASTER_WORKER_PROTOCOL_VERSION,
    scenarioId: String(scenarioId || ""),
    selectionVersion: Number(selectionVersion || 0),
    topologyRevision: Number(topologyRevision || 0),
    colorRevision: Number(colorRevision || 0),
    transformBucket: String(transformBucket || ""),
    dpr: Number(dpr || 1),
    viewport,
    passSignature: String(passSignature || ""),
  };
}

function normalizeViewportIdentity(viewport = null) {
  if (!viewport || typeof viewport !== "object") return "";
  return ["x", "y", "width", "height", "left", "top", "right", "bottom"]
    .map((fieldName) => {
      const value = Number(viewport[fieldName]);
      return Number.isFinite(value) ? `${fieldName}:${Number(value.toFixed(3))}` : `${fieldName}:`;
    })
    .join("|");
}

function getIdentitySignature(identity = null) {
  if (!identity || typeof identity !== "object") return "";
  return [
    String(identity.scenarioId || ""),
    Number(identity.selectionVersion || 0),
    Number(identity.topologyRevision || 0),
    Number(identity.colorRevision || 0),
    String(identity.transformBucket || ""),
    Number(identity.dpr || 1).toFixed(2),
    String(identity.passSignature || ""),
    normalizeViewportIdentity(identity.viewport),
  ].join("::");
}

export function isPoliticalRasterWorkerResultCurrent(requestIdentity, currentIdentity) {
  const request = requestIdentity || {};
  const current = currentIdentity || {};
  return String(request.scenarioId || "") === String(current.scenarioId || "")
    && Number(request.selectionVersion || 0) === Number(current.selectionVersion || 0)
    && Number(request.topologyRevision || 0) === Number(current.topologyRevision || 0)
    && Number(request.colorRevision || 0) === Number(current.colorRevision || 0)
    && String(request.transformBucket || "") === String(current.transformBucket || "")
    && String(request.passSignature || "") === String(current.passSignature || "")
    && Math.abs(Number(request.dpr || 1) - Number(current.dpr || 1)) <= 0.01
    && normalizeViewportIdentity(request.viewport) === normalizeViewportIdentity(current.viewport);
}

export function ensurePoliticalRasterWorkerMetrics(root = globalThis) {
  const target = root || globalThis;
  if (!target.__mc_politicalRasterWorkerMetrics || typeof target.__mc_politicalRasterWorkerMetrics !== "object") {
    target.__mc_politicalRasterWorkerMetrics = {
      protocolVersion: POLITICAL_RASTER_WORKER_PROTOCOL_VERSION,
      enabled: false,
      ready: false,
      roundTripMs: 0,
      rasterMs: 0,
      encodeMs: 0,
      decodeMs: 0,
      blitMs: 0,
      timeoutCount: 0,
      recycleCount: 0,
      staleResponseCount: 0,
      acceptedCount: 0,
      rejectedStaleCount: 0,
      fallbackCount: 0,
      lastReason: "",
      lastTaskId: "",
    };
  }
  target.__mc_politicalRasterWorkerMetrics.protocolVersion = POLITICAL_RASTER_WORKER_PROTOCOL_VERSION;
  return target.__mc_politicalRasterWorkerMetrics;
}

function updateWorkerTimingMetrics(payload = {}, startedAt = 0) {
  const metrics = ensurePoliticalRasterWorkerMetrics();
  metrics.roundTripMs = Math.max(0, nowMs() - Number(startedAt || nowMs()));
  metrics.rasterMs = Math.max(0, Number(payload.rasterMs || 0));
  metrics.encodeMs = Math.max(0, Number(payload.encodeMs || 0));
  metrics.decodeMs = Math.max(0, Number(payload.decodeMs || 0));
  metrics.blitMs = Math.max(0, Number(payload.blitMs || 0));
}

function clearPendingTask(taskId = "") {
  if (!pendingTask) return;
  if (taskId && pendingTask.taskId !== taskId) return;
  if (pendingTask.timeoutId) {
    globalThis.clearTimeout(pendingTask.timeoutId);
  }
  pendingTask = null;
}

function noteWorkerFallback(reason, taskId = "") {
  const metrics = ensurePoliticalRasterWorkerMetrics();
  metrics.fallbackCount += 1;
  metrics.lastReason = String(reason || "fallback");
  metrics.lastTaskId = String(taskId || metrics.lastTaskId || "");
}

function handleWorkerMessage(event) {
  const payload = event?.data || {};
  const metrics = ensurePoliticalRasterWorkerMetrics();
  if (Number(payload.protocolVersion || 0) !== POLITICAL_RASTER_WORKER_PROTOCOL_VERSION) {
    metrics.fallbackCount += 1;
    metrics.lastReason = "protocol-mismatch";
    clearPendingTask(String(payload.taskId || ""));
    return;
  }
  const taskId = String(payload.taskId || "");
  const task = pendingTask && pendingTask.taskId === taskId ? pendingTask : null;
  updateWorkerTimingMetrics(payload, task?.startedAt || nowMs());
  metrics.lastTaskId = taskId;
  if (payload.type === "RASTER_RESULT") {
    const current = latestIdentity || task?.identity || null;
    const request = payload.identity || task?.identity || null;
    if (!isPoliticalRasterWorkerResultCurrent(request, current)) {
      metrics.staleResponseCount += 1;
      metrics.rejectedStaleCount += 1;
      metrics.lastReason = "stale-response";
      clearPendingTask(taskId);
      return;
    }
    metrics.ready = true;
    metrics.acceptedCount += 1;
    metrics.lastReason = String(payload.reason || "accepted");
    clearPendingTask(taskId);
    return;
  }
  if (payload.type === "ERROR") {
    noteWorkerFallback(payload.errorCode || payload.reason || "worker-error", taskId);
    clearPendingTask(taskId);
    return;
  }
}

function ensureWorker() {
  const metrics = ensurePoliticalRasterWorkerMetrics();
  if (workerInstance) return workerInstance;
  if (typeof globalThis.Worker !== "function") {
    noteWorkerFallback("worker-unavailable");
    return null;
  }
  try {
    workerInstance = new Worker(POLITICAL_RASTER_WORKER_URL, { type: "module" });
    workerInstance.onmessage = handleWorkerMessage;
    workerInstance.onerror = () => {
      noteWorkerFallback("worker-error");
      metrics.ready = false;
    };
    return workerInstance;
  } catch (_error) {
    noteWorkerFallback("worker-create-failed");
    return null;
  }
}

export function requestPoliticalRasterWorkerPass({
  identity = createPoliticalRasterWorkerIdentity(),
  renderHint = {},
} = {}) {
  const metrics = ensurePoliticalRasterWorkerMetrics();
  metrics.enabled = ensurePoliticalRasterWorkerFlagCache();
  latestIdentity = identity;
  if (!metrics.enabled) {
    metrics.lastReason = "flag-disabled";
    return { ok: false, reason: "flag-disabled" };
  }
  const worker = ensureWorker();
  if (!worker) {
    return { ok: false, reason: metrics.lastReason || "worker-unavailable" };
  }
  const identitySignature = getIdentitySignature(identity);
  if (pendingTask && pendingTask.identitySignature === identitySignature) {
    metrics.lastReason = "request-pending";
    return { ok: true, reason: "request-pending", taskId: pendingTask.taskId };
  }
  if (pendingTask) {
    metrics.staleResponseCount += 1;
    metrics.rejectedStaleCount += 1;
    clearPendingTask(pendingTask.taskId);
  }
  const taskId = `political-raster-${++taskSequence}`;
  const startedAt = nowMs();
  const timeoutId = globalThis.setTimeout(() => {
    if (!pendingTask || pendingTask.taskId !== taskId) return;
    metrics.timeoutCount += 1;
    noteWorkerFallback("timeout", taskId);
    clearPendingTask(taskId);
  }, POLITICAL_RASTER_WORKER_TIMEOUT_MS);
  pendingTask = {
    taskId,
    identity,
    identitySignature,
    startedAt,
    timeoutId,
  };
  metrics.lastTaskId = taskId;
  metrics.lastReason = "queued";
  worker.postMessage({
    protocolVersion: POLITICAL_RASTER_WORKER_PROTOCOL_VERSION,
    type: "RASTER_POLITICAL_PASS",
    taskId,
    createdAtMs: startedAt,
    identity,
    renderHint: {
      pass: "political",
      surface: "main",
      ...renderHint,
    },
  });
  return { ok: true, reason: "queued", taskId };
}

export function terminatePoliticalRasterWorker() {
  const metrics = ensurePoliticalRasterWorkerMetrics();
  clearPendingTask();
  if (workerInstance && typeof workerInstance.terminate === "function") {
    workerInstance.terminate();
  }
  workerInstance = null;
  metrics.ready = false;
  metrics.recycleCount += 1;
}

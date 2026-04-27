// Minimal political raster worker protocol client.
// The feature flag defaults off, so the renderer keeps the main-thread raster path.

export const POLITICAL_RASTER_WORKER_PROTOCOL_VERSION = 1;
export const POLITICAL_RASTER_WORKER_METRIC_NAMES = Object.freeze({
  roundTripMs: "politicalRasterWorker.roundTripMs",
  timeoutCount: "politicalRasterWorker.timeoutCount",
  recycleCount: "politicalRasterWorker.recycleCount",
  staleResponseCount: "politicalRasterWorker.staleResponseCount",
});

export function isPoliticalRasterWorkerEnabled(search = globalThis.location?.search || "") {
  const params = new URLSearchParams(String(search || ""));
  const raw = params.get("political_raster_worker") || params.get("ENABLE_POLITICAL_RASTER_WORKER") || "";
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function createPoliticalRasterWorkerIdentity({
  scenarioId = "",
  selectionVersion = 0,
  topologyRevision = 0,
  colorRevision = 0,
  transformBucket = "",
  dpr = 1,
  viewport = null,
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

export function isPoliticalRasterWorkerResultCurrent(requestIdentity, currentIdentity) {
  const request = requestIdentity || {};
  const current = currentIdentity || {};
  return String(request.scenarioId || "") === String(current.scenarioId || "")
    && Number(request.selectionVersion || 0) === Number(current.selectionVersion || 0)
    && Number(request.topologyRevision || 0) === Number(current.topologyRevision || 0)
    && Number(request.colorRevision || 0) === Number(current.colorRevision || 0)
    && String(request.transformBucket || "") === String(current.transformBucket || "")
    && Math.abs(Number(request.dpr || 1) - Number(current.dpr || 1)) <= 0.01
    && normalizeViewportIdentity(request.viewport) === normalizeViewportIdentity(current.viewport);
}

export function ensurePoliticalRasterWorkerMetrics(root = globalThis) {
  const target = root || globalThis;
  if (!target.__mc_politicalRasterWorkerMetrics || typeof target.__mc_politicalRasterWorkerMetrics !== "object") {
    target.__mc_politicalRasterWorkerMetrics = {
      enabled: false,
      roundTripMs: 0,
      timeoutCount: 0,
      recycleCount: 0,
      staleResponseCount: 0,
    };
  }
  return target.__mc_politicalRasterWorkerMetrics;
}

export function requestPoliticalRasterWorkerPass() {
  const metrics = ensurePoliticalRasterWorkerMetrics();
  metrics.enabled = isPoliticalRasterWorkerEnabled();
  return { ok: false, reason: metrics.enabled ? "unsupported-capability" : "flag-disabled" };
}

export function terminatePoliticalRasterWorker() {
  const metrics = ensurePoliticalRasterWorkerMetrics();
  metrics.recycleCount += 1;
}

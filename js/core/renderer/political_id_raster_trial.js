const MODE_KEY = "scenario-forge-political-render-mode";
const MODES = new Set(["auto", "raster", "vector", "hybrid"]);
const SUPPORTED_SCENARIOS = new Set(["hoi4_1936", "hoi4_1939", "tno_1962", "modern_world"]);
const KEY = "scenario-forge-political-id-raster";
export const POLITICAL_ID_RASTER_STATUS_EVENT = "political-id-raster-status";
let previousStatus = "";

export function readPoliticalIdRasterPreference({ search = globalThis.location?.search || "", storage } = {}) {
  const parameter = new URLSearchParams(search).get("political_id_raster");
  if (parameter !== null) return parameter === "1";
  try { return (storage ?? globalThis.localStorage)?.getItem(KEY) === "1"; }
  catch { return false; }
}

/** Auto uses the complete persistent producer; legacy trials keep their saved semantics. */
export function readPoliticalRenderPolicy({ search = globalThis.location?.search || "", storage,
  scenarioId = "", deviceMemory = globalThis.navigator?.deviceMemory,
  capable = typeof globalThis.Worker === "function" && typeof globalThis.OffscreenCanvas === "function"
    && typeof globalThis.WebGL2RenderingContext === "function",
} = {}) {
  const params = new URLSearchParams(search);
  let value = params.get("political_render_mode"), preferenceSource = "url";
  if (value === null && params.has("political_id_raster")) {
    value = params.get("political_id_raster") === "1" ? "hybrid" : "vector";
    preferenceSource = "legacy-url";
  }
  if (value === null) {
    try {
      const store = storage ?? globalThis.localStorage;
      value = store?.getItem(MODE_KEY) ?? null;
      preferenceSource = "storage";
      if (value === null) {
        const legacy = store?.getItem(KEY);
        if (legacy !== null && legacy !== undefined) {
          value = legacy === "1" ? "hybrid" : "vector";
          preferenceSource = "legacy-storage";
        }
      }
    } catch { value = null; }
  }
  if (value === null) { value = "auto"; preferenceSource = "default"; }
  const valid = MODES.has(value), mode = valid ? value : "vector";
  const automaticRasterReason = !SUPPORTED_SCENARIOS.has(scenarioId) ? "unsupported-scenario"
    : !capable ? "unsupported-browser"
    : Number(deviceMemory) > 0 && Number(deviceMemory) <= 2 ? "low-memory" : "eligible";
  const automaticRasterEnabled = automaticRasterReason === "eligible";
  const effectiveMode = mode === "auto" ? (automaticRasterEnabled ? "raster" : "vector") : mode;
  return Object.freeze({ mode, effectiveMode, preferenceSource, valid,
    requested: effectiveMode === "raster" || effectiveMode === "hybrid",
    persistent: effectiveMode === "raster", automaticRasterEnabled, automaticRasterReason });
}

export function writePoliticalRenderMode(mode) {
  if (!MODES.has(mode)) throw new TypeError("Unknown political render mode.");
  try { globalThis.localStorage?.setItem(MODE_KEY, mode); } catch { /* URL still works. */ }
  if (globalThis.location && globalThis.history) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("political_render_mode", mode);
    url.searchParams.delete("political_id_raster");
    globalThis.history.replaceState(globalThis.history.state, "", url);
  }
}

export function writePoliticalIdRasterPreference(enabled) {
  const value = enabled ? "1" : "0";
  try { globalThis.localStorage?.setItem(KEY, value); globalThis.localStorage?.removeItem(MODE_KEY); } catch { /* Session URL remains usable. */ }
  if (globalThis.location && globalThis.history) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("political_id_raster", value);
    url.searchParams.delete("political_render_mode");
    globalThis.history.replaceState(globalThis.history.state, "", url);
  }
}

export function getPoliticalIdRasterEligibility({ requested, exporting, debugMode, ready, firstVisible, readonly, unlocking, riverPartitions, scenarioId }) {
  if (!requested) return "off";
  if (!SUPPORTED_SCENARIOS.has(scenarioId)) return "unsupported-scenario";
  if (exporting) return "export";
  if (debugMode !== "PROD") return "debug-mode";
  if (!ready || !firstVisible || readonly || unlocking) return "startup";
  if (riverPartitions) return "river-partitions";
  return "eligible";
}

export function publishPoliticalIdRasterStatus(diagnostics) {
  const signature = JSON.stringify([diagnostics.requested, diagnostics.selected, diagnostics.displayState,
    diagnostics.reason, diagnostics.failed, diagnostics.sceneKey, diagnostics.mode, diagnostics.actualBackend]);
  if (signature === previousStatus) return;
  previousStatus = signature;
  globalThis.dispatchEvent?.(new CustomEvent(POLITICAL_ID_RASTER_STATUS_EVENT, { detail: diagnostics }));
}

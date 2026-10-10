const KEY = "scenario-forge-political-id-raster";
export const POLITICAL_ID_RASTER_STATUS_EVENT = "political-id-raster-status";
let previousStatus = "";

export function readPoliticalIdRasterPreference({ search = globalThis.location?.search || "", storage } = {}) {
  const parameter = new URLSearchParams(search).get("political_id_raster");
  if (parameter !== null) return parameter === "1";
  try { return (storage ?? globalThis.localStorage)?.getItem(KEY) === "1"; }
  catch { return false; }
}

export function writePoliticalIdRasterPreference(enabled) {
  const value = enabled ? "1" : "0";
  try { globalThis.localStorage?.setItem(KEY, value); } catch { /* Session URL remains usable. */ }
  if (globalThis.location && globalThis.history) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("political_id_raster", value);
    globalThis.history.replaceState(globalThis.history.state, "", url);
  }
}

export function getPoliticalIdRasterEligibility({ requested, exporting, debugMode, ready, firstVisible, readonly, unlocking, riverPartitions, scenarioId }) {
  if (!requested) return "off";
  if (!["hoi4_1936", "hoi4_1939", "tno_1962"].includes(scenarioId)) return "unsupported-scenario";
  if (exporting) return "export";
  if (debugMode !== "PROD") return "debug-mode";
  if (!ready || !firstVisible || readonly || unlocking) return "startup";
  if (riverPartitions) return "river-partitions";
  return "eligible";
}

export function publishPoliticalIdRasterStatus(diagnostics) {
  const signature = JSON.stringify([diagnostics.requested, diagnostics.selected, diagnostics.displayState,
    diagnostics.reason, diagnostics.failed, diagnostics.sceneKey]);
  if (signature === previousStatus) return;
  previousStatus = signature;
  globalThis.dispatchEvent?.(new CustomEvent(POLITICAL_ID_RASTER_STATUS_EVENT, { detail: diagnostics }));
}

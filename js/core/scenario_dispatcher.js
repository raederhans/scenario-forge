import {
  applyScenarioBundle,
  applyScenarioById,
  clearActiveScenario,
  resetToScenarioBaseline,
  setScenarioViewMode,
} from "./scenario_manager.js";
import { flushRenderBoundary, requestRender } from "./render_boundary.js";

const VALID_RENDER_MODES = new Set(["flush", "request", "none"]);

function normalizeRenderMode(renderMode) {
  const normalized = String(renderMode || "flush").trim().toLowerCase();
  return VALID_RENDER_MODES.has(normalized) ? normalized : "flush";
}

function splitCommandOptions(options = {}) {
  const {
    renderMode = "flush",
    renderNow: _renderNow,
    ...scenarioOptions
  } = options || {};
  return {
    renderMode: normalizeRenderMode(renderMode),
    scenarioOptions: {
      ...scenarioOptions,
      renderNow: false,
    },
  };
}

function finalizeRenderMode(renderMode, reason) {
  if (renderMode === "none") {
    return false;
  }
  if (renderMode === "request") {
    return requestRender(reason);
  }
  return flushRenderBoundary(reason);
}

export async function applyScenarioBundleCommand(bundle, options = {}) {
  const { renderMode, scenarioOptions } = splitCommandOptions(options);
  const result = await applyScenarioBundle(bundle, scenarioOptions);
  finalizeRenderMode(renderMode, `scenario-bundle:${String(bundle?.manifest?.scenario_id || "unknown")}`);
  return result;
}

export async function applyScenarioByIdCommand(scenarioId, options = {}) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  const { renderMode, scenarioOptions } = splitCommandOptions(options);
  const result = await applyScenarioById(normalizedScenarioId, scenarioOptions);
  finalizeRenderMode(renderMode, `scenario-apply:${normalizedScenarioId || "unknown"}`);
  return result;
}

export function setScenarioViewModeCommand(viewMode, options = {}) {
  const { renderMode, scenarioOptions } = splitCommandOptions(options);
  const changed = setScenarioViewMode(viewMode, scenarioOptions);
  if (changed) {
    finalizeRenderMode(renderMode, `scenario-view:${String(viewMode || "ownership")}`);
  }
  return changed;
}

export function resetScenarioToBaselineCommand(options = {}) {
  const { renderMode, scenarioOptions } = splitCommandOptions(options);
  const changed = resetToScenarioBaseline(scenarioOptions);
  if (changed) {
    finalizeRenderMode(renderMode, "scenario-reset");
  }
  return changed;
}

export function clearActiveScenarioCommand(options = {}) {
  const { renderMode, scenarioOptions } = splitCommandOptions(options);
  const result = clearActiveScenario(scenarioOptions);
  finalizeRenderMode(renderMode, "scenario-clear");
  return result;
}

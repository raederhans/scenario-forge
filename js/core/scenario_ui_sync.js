import { createDefaultScenarioAuditUiState, state } from "./state.js";
import { flushRenderBoundary } from "./render_boundary.js";

export function ensureScenarioAuditUiState() {
  if (!state.scenarioAuditUi || typeof state.scenarioAuditUi !== "object") {
    state.scenarioAuditUi = createDefaultScenarioAuditUiState();
  }
  if (typeof state.scenarioAuditUi.loading !== "boolean") {
    state.scenarioAuditUi.loading = false;
  }
  if (typeof state.scenarioAuditUi.loadedForScenarioId !== "string") {
    state.scenarioAuditUi.loadedForScenarioId = "";
  }
  if (typeof state.scenarioAuditUi.errorMessage !== "string") {
    state.scenarioAuditUi.errorMessage = "";
  }
  return state.scenarioAuditUi;
}

export function setScenarioAuditUiState(partial = {}) {
  const current = ensureScenarioAuditUiState();
  Object.assign(current, partial);
  return current;
}

export function syncScenarioUi() {
  if (typeof state.updateScenarioUIFn === "function") {
    state.updateScenarioUIFn();
  }
  if (typeof state.renderScenarioAuditPanelFn === "function") {
    state.renderScenarioAuditPanelFn();
  }
}

export function syncCountryUi({ renderNow = false } = {}) {
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
  if (typeof state.updateActiveSovereignUIFn === "function") {
    state.updateActiveSovereignUIFn();
  }
  if (typeof state.updateDynamicBorderStatusUIFn === "function") {
    state.updateDynamicBorderStatusUIFn();
  }
  if (typeof state.updateScenarioContextBarFn === "function") {
    state.updateScenarioContextBarFn();
  }
  syncScenarioUi();
  if (renderNow) {
    flushRenderBoundary("scenario-country-ui");
  }
}

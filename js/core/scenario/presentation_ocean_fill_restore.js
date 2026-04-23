import {
  normalizeScenarioOceanFillColor,
} from "./pure_helpers.js";
import {
  STATE_BUS_EVENTS,
  emitStateBusEvent,
} from "../state/index.js";

function emitScenarioToolbarInputUpdate() {
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
}

function createScenarioOceanFillRestoreRuntime({
  state,
  invalidateOceanBackgroundVisualState = null,
} = {}) {
  function getScenarioOceanFillOverride(manifest) {
    const rawValue = String(manifest?.style_defaults?.ocean?.fillColor || "").trim();
    return rawValue ? normalizeScenarioOceanFillColor(rawValue, "") : "";
  }

  function updateScenarioOceanFill(fillColor, reason) {
    if (!state.styleConfig || typeof state.styleConfig !== "object") {
      state.styleConfig = {};
    }
    if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
      state.styleConfig.ocean = {};
    }
    const previousFill = normalizeScenarioOceanFillColor(state.styleConfig.ocean.fillColor);
    const nextFill = normalizeScenarioOceanFillColor(fillColor);
    state.styleConfig.ocean.fillColor = nextFill;
    if (previousFill !== nextFill && typeof invalidateOceanBackgroundVisualState === "function") {
      invalidateOceanBackgroundVisualState(reason);
      return true;
    }
    return previousFill !== nextFill;
  }

  function syncScenarioOceanFillForActivation(manifest) {
    const nextOverride = getScenarioOceanFillOverride(manifest);
    const previousOverride = getScenarioOceanFillOverride(state.activeScenarioManifest);
    if (state.scenarioOceanFillBeforeActivate === null) {
      state.scenarioOceanFillBeforeActivate = normalizeScenarioOceanFillColor(state.styleConfig?.ocean?.fillColor);
    }
    if (nextOverride) {
      updateScenarioOceanFill(nextOverride, "scenario-ocean-fill-activate");
    } else if (previousOverride && state.scenarioOceanFillBeforeActivate !== null) {
      updateScenarioOceanFill(
        state.scenarioOceanFillBeforeActivate,
        "scenario-ocean-fill-restore-baseline"
      );
    }
    emitScenarioToolbarInputUpdate();
  }

  function restoreScenarioOceanFillAfterExit() {
    if (state.scenarioOceanFillBeforeActivate === null) {
      return;
    }
    updateScenarioOceanFill(state.scenarioOceanFillBeforeActivate, "scenario-ocean-fill-clear");
    state.scenarioOceanFillBeforeActivate = null;
    emitScenarioToolbarInputUpdate();
  }

  return {
    getScenarioOceanFillOverride,
    restoreScenarioOceanFillAfterExit,
    syncScenarioOceanFillForActivation,
    updateScenarioOceanFill,
  };
}

export {
  createScenarioOceanFillRestoreRuntime,
};

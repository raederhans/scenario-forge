import {
  normalizeScenarioRenderProfile,
} from "./pure_helpers.js";
import {
  normalizeScenarioPerformanceHints,
} from "./presentation_hint_helpers.js";
import {
  STATE_BUS_EVENTS,
  emitStateBusEvent,
} from "../state/index.js";

function emitScenarioPresentationUiUpdates() {
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_WATER_INTERACTION);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_SPECIAL_REGION);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_RELIEF_OVERLAY);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DYNAMIC_BORDER_STATUS);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
}

function createScenarioDisplayRestoreRuntime({
  state,
} = {}) {
  function syncScenarioPresentationUi() {
    emitScenarioPresentationUiUpdates();
  }

  function captureScenarioDisplaySettingsBeforeActivate() {
    if (state.activeScenarioId || state.scenarioDisplaySettingsBeforeActivate) {
      return state.scenarioDisplaySettingsBeforeActivate;
    }
    state.scenarioDisplaySettingsBeforeActivate = {
      renderProfile: normalizeScenarioRenderProfile(state.renderProfile, "auto"),
      dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
      parentBordersVisible: state.parentBordersVisible !== false,
      showWaterRegions: state.showWaterRegions !== false,
      showScenarioSpecialRegions: state.showScenarioSpecialRegions !== false,
      showScenarioReliefOverlays: state.showScenarioReliefOverlays !== false,
    };
    return state.scenarioDisplaySettingsBeforeActivate;
  }

  function applyScenarioPerformanceHints(manifest) {
    captureScenarioDisplaySettingsBeforeActivate();
    const hints = normalizeScenarioPerformanceHints(manifest);
    state.activeScenarioPerformanceHints = hints;
    if (hints.renderProfileDefault) {
      state.renderProfile = normalizeScenarioRenderProfile(hints.renderProfileDefault, state.renderProfile || "auto");
    }
    if (typeof hints.dynamicBordersDefault === "boolean") {
      state.dynamicBordersEnabled = hints.dynamicBordersDefault;
    }
    state.parentBordersVisible = typeof hints.parentBordersDefault === "boolean"
      ? hints.parentBordersDefault
      : false;
    if (typeof hints.waterRegionsDefault === "boolean") {
      state.showWaterRegions = hints.waterRegionsDefault;
    }
    if (typeof hints.specialRegionsDefault === "boolean") {
      state.showScenarioSpecialRegions = hints.specialRegionsDefault;
    }
    if (typeof hints.scenarioReliefOverlaysDefault === "boolean") {
      state.showScenarioReliefOverlays = hints.scenarioReliefOverlaysDefault;
    }
    syncScenarioPresentationUi();
  }

  function restoreScenarioDisplaySettingsAfterExit() {
    const snapshot = state.scenarioDisplaySettingsBeforeActivate;
    if (snapshot && typeof snapshot === "object") {
      state.renderProfile = normalizeScenarioRenderProfile(snapshot.renderProfile, state.renderProfile || "auto");
      state.dynamicBordersEnabled = snapshot.dynamicBordersEnabled !== false;
      state.parentBordersVisible = snapshot.parentBordersVisible !== false;
      state.showWaterRegions = snapshot.showWaterRegions !== false;
      state.showScenarioSpecialRegions = snapshot.showScenarioSpecialRegions !== false;
      state.showScenarioReliefOverlays = snapshot.showScenarioReliefOverlays !== false;
    }
    state.scenarioDisplaySettingsBeforeActivate = null;
    state.activeScenarioPerformanceHints = null;
    syncScenarioPresentationUi();
  }

  return {
    applyScenarioPerformanceHints,
    captureScenarioDisplaySettingsBeforeActivate,
    restoreScenarioDisplaySettingsAfterExit,
    syncScenarioPresentationUi,
  };
}

export {
  createScenarioDisplayRestoreRuntime,
};

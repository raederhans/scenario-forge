import {
  SCENARIO_RENDER_PROFILES,
  normalizeScenarioRenderProfile,
} from "./pure_helpers.js";
import {
  normalizeScenarioPerformanceHints,
} from "./presentation_hint_helpers.js";
import {
  STATE_BUS_EVENTS,
  emitStateBusEvent,
} from "../state/index.js";
import {
  setActiveScenarioPerformanceHintsState,
} from "../state/actions/scenario_presentation_actions.js";

function emitScenarioPresentationUiUpdates() {
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_WATER_INTERACTION);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_SPECIAL_REGION);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_RELIEF_OVERLAY);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DYNAMIC_BORDER_STATUS);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
}

function createScenarioDisplayRestoreRuntime({
  state,
  getSearchParams = () => new URLSearchParams(globalThis.location?.search || ""),
} = {}) {
  let lastHintRenderProfile = null;
  let renderProfileChangedDuringScenario = false;

  function getExplicitRenderProfile() {
    const value = String(getSearchParams()?.get?.("render_profile") ?? "").trim().toLowerCase();
    return SCENARIO_RENDER_PROFILES.has(value) ? value : null;
  }

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
      showScenarioAtlantropa: state.showScenarioAtlantropa !== false,
      showScenarioReliefOverlays: state.showScenarioReliefOverlays !== false,
      showStrategicResourceMarkers: !!state.showStrategicResourceMarkers,
      strategicChoroplethMetric: String(state.strategicChoroplethMetric || ""),
    };
    return state.scenarioDisplaySettingsBeforeActivate;
  }

  function applyScenarioPerformanceHints(manifest) {
    captureScenarioDisplaySettingsBeforeActivate();
    const hints = normalizeScenarioPerformanceHints(manifest);
    setActiveScenarioPerformanceHintsState(state, hints);
    const explicitRenderProfile = getExplicitRenderProfile();
    if (explicitRenderProfile) {
      state.renderProfile = explicitRenderProfile;
      lastHintRenderProfile = null;
    } else if (lastHintRenderProfile && state.renderProfile !== lastHintRenderProfile) {
      renderProfileChangedDuringScenario = true;
    }
    if (!explicitRenderProfile && !renderProfileChangedDuringScenario && hints.renderProfileDefault) {
      state.renderProfile = normalizeScenarioRenderProfile(hints.renderProfileDefault, state.renderProfile || "auto");
      lastHintRenderProfile = state.renderProfile;
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
    if (typeof hints.scenarioAtlantropaDefault === "boolean") {
      state.showScenarioAtlantropa = hints.scenarioAtlantropaDefault;
    }
    if (typeof hints.scenarioReliefOverlaysDefault === "boolean") {
      state.showScenarioReliefOverlays = hints.scenarioReliefOverlaysDefault;
    }
    syncScenarioPresentationUi();
  }

  function restoreScenarioDisplaySettingsAfterExit() {
    const snapshot = state.scenarioDisplaySettingsBeforeActivate;
    if (snapshot && typeof snapshot === "object") {
      if (!getExplicitRenderProfile() && !renderProfileChangedDuringScenario
        && lastHintRenderProfile && state.renderProfile === lastHintRenderProfile) {
        state.renderProfile = normalizeScenarioRenderProfile(snapshot.renderProfile, state.renderProfile || "auto");
      }
      state.dynamicBordersEnabled = snapshot.dynamicBordersEnabled !== false;
      state.parentBordersVisible = snapshot.parentBordersVisible !== false;
      state.showWaterRegions = snapshot.showWaterRegions !== false;
      state.showScenarioSpecialRegions = snapshot.showScenarioSpecialRegions !== false;
      state.showScenarioAtlantropa = snapshot.showScenarioAtlantropa !== false;
      state.showScenarioReliefOverlays = snapshot.showScenarioReliefOverlays !== false;
      state.showStrategicResourceMarkers = !!snapshot.showStrategicResourceMarkers;
      state.strategicChoroplethMetric = String(snapshot.strategicChoroplethMetric || "");
    }
    state.scenarioDisplaySettingsBeforeActivate = null;
    lastHintRenderProfile = null;
    renderProfileChangedDuringScenario = false;
    setActiveScenarioPerformanceHintsState(state, null);
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

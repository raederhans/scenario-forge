import {
  SCENARIO_RENDER_PROFILES,
  normalizeScenarioOceanFillColor,
  normalizeScenarioRenderProfile,
} from "./pure_helpers.js";
import {
  STATE_BUS_EVENTS,
  emitStateBusEvent,
} from "../state/index.js";

function normalizeScenarioPerformanceHints(manifest) {
  const raw = manifest?.performance_hints;
  if (!raw || typeof raw !== "object") {
    return {
      renderProfileDefault: "",
      dynamicBordersDefault: null,
      parentBordersDefault: null,
      scenarioReliefOverlaysDefault: null,
      waterRegionsDefault: null,
      specialRegionsDefault: null,
    };
  }
  const renderProfileDefault = String(raw.render_profile_default || "").trim().toLowerCase();
  return {
    renderProfileDefault: SCENARIO_RENDER_PROFILES.has(renderProfileDefault) ? renderProfileDefault : "",
    dynamicBordersDefault:
      typeof raw.dynamic_borders_default === "boolean" ? raw.dynamic_borders_default : null,
    parentBordersDefault:
      typeof raw.parent_borders_default === "boolean" ? raw.parent_borders_default : null,
    scenarioReliefOverlaysDefault:
      typeof raw.scenario_relief_overlays_default === "boolean" ? raw.scenario_relief_overlays_default : null,
    waterRegionsDefault:
      typeof raw.water_regions_default === "boolean" ? raw.water_regions_default : null,
    specialRegionsDefault:
      typeof raw.special_regions_default === "boolean" ? raw.special_regions_default : null,
  };
}

function createScenarioPresentationRuntime({
  state,
  invalidateOceanBackgroundVisualState = null,
} = {}) {
  function syncScenarioPresentationUi() {
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_WATER_INTERACTION);
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_SPECIAL_REGION);
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_RELIEF_OVERLAY);
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DYNAMIC_BORDER_STATUS);
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
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
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
  }

  function restoreScenarioOceanFillAfterExit() {
    if (state.scenarioOceanFillBeforeActivate === null) {
      return;
    }
    updateScenarioOceanFill(state.scenarioOceanFillBeforeActivate, "scenario-ocean-fill-clear");
    state.scenarioOceanFillBeforeActivate = null;
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
  }

  return {
    applyScenarioPerformanceHints,
    captureScenarioDisplaySettingsBeforeActivate,
    getScenarioOceanFillOverride,
    normalizeScenarioPerformanceHints,
    restoreScenarioDisplaySettingsAfterExit,
    restoreScenarioOceanFillAfterExit,
    syncScenarioOceanFillForActivation,
    syncScenarioPresentationUi,
    updateScenarioOceanFill,
  };
}

export {
  createScenarioPresentationRuntime,
  normalizeScenarioPerformanceHints,
};

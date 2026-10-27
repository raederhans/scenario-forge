import {
  normalizeScenarioOceanFillColor,
} from "./pure_helpers.js";
import {
  STATE_BUS_EVENTS,
  emitStateBusEvent,
} from "../state/index.js";
import {
  mergeScenarioStyleDefaultsState,
} from "../state/actions/scenario_presentation_actions.js";

function emitScenarioToolbarInputUpdate() {
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
}

function clampNumber(value, fallback, min = 0, max = 1) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(max, Math.max(min, resolved));
}

function normalizeScenarioBorderStyleOverride(rawDefaults, groupKey) {
  if (!rawDefaults || typeof rawDefaults !== "object") {
    return null;
  }
  const override = {};
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "color")) {
    const color = String(rawDefaults.color || "").trim();
    if (color) {
      override.color = color;
    }
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "colorMode") && groupKey === "internalBorders") {
    const colorMode = String(rawDefaults.colorMode || "").trim().toLowerCase();
    if (colorMode) {
      override.colorMode = colorMode;
    }
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "opacity")) {
    override.opacity = clampNumber(rawDefaults.opacity, 1, 0, 1);
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "width")) {
    override.width = clampNumber(rawDefaults.width, 1, 0, 12);
  }
  return Object.keys(override).length ? override : null;
}

function projectScenarioOceanStyleDefaultsPatch(rawDefaults) {
  if (!rawDefaults || typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
    return null;
  }
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "preset")) {
    patch.preset = rawDefaults.preset;
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "fillColor")) {
    patch.fillColor = rawDefaults.fillColor;
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "opacity")) {
    patch.opacity = rawDefaults.opacity;
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "scale")) {
    patch.scale = rawDefaults.scale;
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "contourStrength")) {
    patch.contourStrength = rawDefaults.contourStrength;
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "experimentalAdvancedStyles")) {
    patch.experimentalAdvancedStyles = rawDefaults.experimentalAdvancedStyles;
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "coastalAccentEnabled")) {
    patch.coastalAccentEnabled = rawDefaults.coastalAccentEnabled;
  }
  return Object.keys(patch).length ? patch : null;
}

function projectScenarioBorderStyleDefaultsPatch(rawDefaults, groupKey) {
  if (!rawDefaults || typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
    return null;
  }
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "color")) {
    patch.color = rawDefaults.color;
  }
  if (
    groupKey === "internalBorders"
    && Object.prototype.hasOwnProperty.call(rawDefaults, "colorMode")
  ) {
    patch.colorMode = rawDefaults.colorMode;
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "opacity")) {
    patch.opacity = rawDefaults.opacity;
  }
  if (Object.prototype.hasOwnProperty.call(rawDefaults, "width")) {
    patch.width = rawDefaults.width;
  }
  return Object.keys(patch).length ? patch : null;
}

function projectScenarioStyleDefaultsPatch(styleOverride) {
  if (!styleOverride || typeof styleOverride !== "object" || Array.isArray(styleOverride)) {
    return null;
  }
  const patch = {};
  const oceanPatch = projectScenarioOceanStyleDefaultsPatch(styleOverride.ocean);
  if (oceanPatch) {
    patch.ocean = oceanPatch;
  }
  const internalBordersPatch = projectScenarioBorderStyleDefaultsPatch(
    styleOverride.internalBorders,
    "internalBorders",
  );
  if (internalBordersPatch) {
    patch.internalBorders = internalBordersPatch;
  }
  const empireBordersPatch = projectScenarioBorderStyleDefaultsPatch(
    styleOverride.empireBorders,
    "empireBorders",
  );
  if (empireBordersPatch) {
    patch.empireBorders = empireBordersPatch;
  }
  const coastlinesPatch = projectScenarioBorderStyleDefaultsPatch(
    styleOverride.coastlines,
    "coastlines",
  );
  if (coastlinesPatch) {
    patch.coastlines = coastlinesPatch;
  }
  return Object.keys(patch).length ? patch : null;
}

function createScenarioOceanFillRestoreRuntime({
  state,
  invalidateOceanBackgroundVisualState = null,
} = {}) {
  function getScenarioOceanFillOverride(manifest) {
    const rawValue = String(manifest?.style_defaults?.ocean?.fillColor || "").trim();
    return rawValue ? normalizeScenarioOceanFillColor(rawValue, "") : "";
  }

  function getScenarioOceanStyleOverride(manifest) {
    const oceanDefaults = manifest?.style_defaults?.ocean;
    if (!oceanDefaults || typeof oceanDefaults !== "object") {
      return null;
    }
    const override = {};
    const fillColor = getScenarioOceanFillOverride(manifest);
    if (fillColor) {
      override.fillColor = fillColor;
    }
    const preset = String(oceanDefaults.preset || "").trim();
    if (preset) {
      override.preset = preset;
    }
    if (Object.prototype.hasOwnProperty.call(oceanDefaults, "experimentalAdvancedStyles")) {
      override.experimentalAdvancedStyles = oceanDefaults.experimentalAdvancedStyles === true;
    }
    return Object.keys(override).length ? override : null;
  }

  function getScenarioStyleDefaultsOverride(manifest) {
    const styleDefaults = manifest?.style_defaults;
    if (!styleDefaults || typeof styleDefaults !== "object") {
      return null;
    }
    const override = {};
    const oceanOverride = getScenarioOceanStyleOverride(manifest);
    if (oceanOverride) {
      override.ocean = oceanOverride;
    }
    ["internalBorders", "empireBorders", "coastlines"].forEach((groupKey) => {
      const groupOverride = normalizeScenarioBorderStyleOverride(styleDefaults[groupKey], groupKey);
      if (groupOverride) {
        override[groupKey] = groupOverride;
      }
    });
    return Object.keys(override).length ? override : null;
  }

  function cloneScenarioStyleDefaultsSnapshot(styleOverride) {
    const snapshot = state.scenarioPresentationStyleBeforeActivate
      ? structuredClone(state.scenarioPresentationStyleBeforeActivate)
      : {};
    Object.keys(styleOverride || {}).forEach((groupKey) => {
      if (Object.prototype.hasOwnProperty.call(snapshot, groupKey)) return;
      snapshot[groupKey] = {
        ...(state.styleConfig?.[groupKey] || {}),
      };
    });
    return Object.keys(snapshot).length ? snapshot : null;
  }

  function mergeScenarioStyleDefaultsWithBaseline(styleOverride, baselineSnapshot) {
    const scopedOverride = {};
    Object.keys(baselineSnapshot || {}).forEach((groupKey) => {
      scopedOverride[groupKey] = {
        ...(baselineSnapshot[groupKey] || {}),
        ...(styleOverride?.[groupKey] || {}),
      };
    });
    return Object.keys(scopedOverride).length ? scopedOverride : null;
  }

  function getStyleDefaultsSignature(styleOverride) {
    const payload = {};
    Object.keys(styleOverride || {}).sort().forEach((groupKey) => {
      payload[groupKey] = {
        ...(state.styleConfig?.[groupKey] || {}),
      };
    });
    return JSON.stringify(payload);
  }

  function updateScenarioStyleDefaults(styleOverride, reason) {
    const projectedOverride = projectScenarioStyleDefaultsPatch(styleOverride);
    if (!projectedOverride) {
      return false;
    }
    const previous = getStyleDefaultsSignature(projectedOverride);
    mergeScenarioStyleDefaultsState(state, projectedOverride);
    const next = getStyleDefaultsSignature(projectedOverride);
    const changed = previous !== next;
    if (changed && projectedOverride.ocean && typeof invalidateOceanBackgroundVisualState === "function") {
      invalidateOceanBackgroundVisualState(reason);
    }
    return changed;
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

  function updateScenarioOceanStyle(styleOverride, reason) {
    if (!styleOverride || typeof styleOverride !== "object") {
      return false;
    }
    if (!state.styleConfig || typeof state.styleConfig !== "object") {
      state.styleConfig = {};
    }
    if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
      state.styleConfig.ocean = {};
    }
    const previous = JSON.stringify({
      fillColor: normalizeScenarioOceanFillColor(state.styleConfig.ocean.fillColor),
      preset: String(state.styleConfig.ocean.preset || ""),
      experimentalAdvancedStyles: state.styleConfig.ocean.experimentalAdvancedStyles === true,
    });
    Object.entries(styleOverride).forEach(([key, value]) => {
      state.styleConfig.ocean[key] = value;
    });
    const next = JSON.stringify({
      fillColor: normalizeScenarioOceanFillColor(state.styleConfig.ocean.fillColor),
      preset: String(state.styleConfig.ocean.preset || ""),
      experimentalAdvancedStyles: state.styleConfig.ocean.experimentalAdvancedStyles === true,
    });
    if (previous !== next && typeof invalidateOceanBackgroundVisualState === "function") {
      invalidateOceanBackgroundVisualState(reason);
      return true;
    }
    return previous !== next;
  }

  function syncScenarioOceanFillForActivation(manifest) {
    const nextOverride = getScenarioStyleDefaultsOverride(manifest);
    const hadPresentationSnapshot = !!state.scenarioPresentationStyleBeforeActivate;
    if (nextOverride) {
      const baselineSnapshot = cloneScenarioStyleDefaultsSnapshot(nextOverride);
      state.scenarioPresentationStyleBeforeActivate = baselineSnapshot;
      if (!hadPresentationSnapshot) {
        state.scenarioOceanStyleBeforeActivate = {
          ...(state.styleConfig?.ocean || {}),
        };
      }
      if (state.scenarioOceanFillBeforeActivate === null) {
        state.scenarioOceanFillBeforeActivate = normalizeScenarioOceanFillColor(state.styleConfig?.ocean?.fillColor);
      }
      updateScenarioStyleDefaults(
        mergeScenarioStyleDefaultsWithBaseline(nextOverride, baselineSnapshot),
        "scenario-style-defaults-activate"
      );
    } else if (state.scenarioPresentationStyleBeforeActivate) {
      updateScenarioStyleDefaults(
        state.scenarioPresentationStyleBeforeActivate
          || { ocean: { fillColor: state.scenarioOceanFillBeforeActivate } },
        "scenario-style-defaults-restore-baseline"
      );
    }
    emitScenarioToolbarInputUpdate();
  }

  function restoreScenarioOceanFillAfterExit() {
    if (state.scenarioOceanFillBeforeActivate === null && !state.scenarioPresentationStyleBeforeActivate) {
      return;
    }
    updateScenarioStyleDefaults(
      state.scenarioPresentationStyleBeforeActivate || { ocean: state.scenarioOceanStyleBeforeActivate || { fillColor: state.scenarioOceanFillBeforeActivate } },
      "scenario-style-defaults-clear"
    );
    state.scenarioOceanFillBeforeActivate = null;
    state.scenarioOceanStyleBeforeActivate = null;
    state.scenarioPresentationStyleBeforeActivate = null;
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

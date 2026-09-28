import assert from "node:assert/strict";
import test from "node:test";

import { createOceanLakeControlsController } from "../js/ui/toolbar/ocean_lake_controls_controller.js";
import { createDefaultStyleConfig } from "../js/core/state/ui_state.js";
import { state as runtimeState } from "../js/core/state.js";
import { clearHistory, undoHistory, redoHistory } from "../js/core/history_manager.js";

import { setAppearanceStyleConfigState } from "../js/core/state/actions/appearance_actions.js";

class Control {
  constructor(value = "") {
    this.value = value;
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.title = "";
    this.textContent = "";
    this.listeners = new Map();
    this.classList = { toggle() {} };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    this.listeners.get(type)?.({ target: this });
  }
}

function createFixture(stateOverride = null) {
  const styleConfig = createDefaultStyleConfig();
  styleConfig.ocean.preset = "flat";
  styleConfig.ocean.experimentalAdvancedStyles = false;
  const state = stateOverride || { styleConfig };
  if (stateOverride) setAppearanceStyleConfigState(stateOverride, styleConfig);
  const select = new Control("flat");
  select.options = ["flat", "bathymetry_soft", "bathymetry_contours"].map((value) => ({ value, disabled: false }));
  const toggle = new Control();
  const opacity = new Control();
  const opacityValue = new Control();
  const scale = new Control();
  const contour = new Control();
  const contourValue = new Control();
  const lakeOutlineToggle = new Control();
  const oceanRegionNamesToggle = new Control();
  const lakeInvalidations = [];
  const renderReasons = [];
  const controller = createOceanLakeControlsController({
    state,
    t: (value) => value,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    renderDirty(reason) { renderReasons.push(reason); },
    normalizeOceanFillColor: (value) => value || "#aadaff",
    normalizeOceanPreset: (value) => value,
    advancedPresets: new Set(["bathymetry_soft", "bathymetry_contours"]),
    getBathymetryPresetStyleDefaults: () => ({ opacity: 0.7, scale: 1.2, contourStrength: 0.3 }),
    invalidateOceanVisualState() {},
    invalidateOceanWaterInteractionVisualState(reason) { lakeInvalidations.push(reason); },
    lakeOutlineToggle,
    oceanRegionNamesToggle,
    oceanAdvancedStylesToggle: toggle,
    oceanStyleSelect: select,
    oceanTextureOpacity: opacity,
    oceanTextureScale: scale,
    oceanContourStrength: contour,
    oceanTextureOpacityValue: opacityValue,
    oceanContourStrengthValue: contourValue,
    documentRef: { getElementById: () => null },
  });
  controller.bindEvents();
  return { state, controller, toggle, select, opacity, opacityValue, scale, contour, contourValue, lakeOutlineToggle, lakeInvalidations, oceanRegionNamesToggle, renderReasons };
}

test("lake outline control starts enabled and invalidates water on toggle", () => {
  const priorStyle = runtimeState.styleConfig;
  try {
    clearHistory();
    const fixture = createFixture(runtimeState);
    fixture.controller.renderOceanLakeControlsUi();
    assert.equal(fixture.lakeOutlineToggle.checked, true);
    fixture.lakeOutlineToggle.checked = false;
    fixture.lakeOutlineToggle.dispatch("change");
    assert.equal(fixture.state.styleConfig.lakes.outlineEnabled, false);
    assert.deepEqual(fixture.lakeInvalidations, ["lake-outline"]);
    assert.equal(runtimeState.historyPast.at(-1)?.before?.styleConfig?.["lakes.outlineEnabled"], true);
    assert.equal(runtimeState.historyPast.at(-1)?.after?.styleConfig?.["lakes.outlineEnabled"], false);
    assert.equal(undoHistory(), true);
    assert.equal(runtimeState.styleConfig.lakes.outlineEnabled, true);
    assert.equal(redoHistory(), true);
    assert.equal(runtimeState.styleConfig.lakes.outlineEnabled, false);
    fixture.controller.renderOceanLakeControlsUi();
    assert.equal(fixture.lakeOutlineToggle.checked, false);
  } finally {
    clearHistory();
    setAppearanceStyleConfigState(runtimeState, priorStyle);
  }
});

test("sea names start hidden and turning them on refreshes labels with undo history", () => {
  const priorStyle = runtimeState.styleConfig;
  try {
    clearHistory();
    const fixture = createFixture(runtimeState);
    fixture.controller.renderOceanLakeControlsUi();
    assert.equal(fixture.oceanRegionNamesToggle.checked, false);
    fixture.oceanRegionNamesToggle.checked = true;
    fixture.oceanRegionNamesToggle.dispatch("change");
    assert.equal(runtimeState.styleConfig.ocean.showRegionNames, true);
    assert.deepEqual(fixture.renderReasons, ["ocean-region-names"]);
    assert.equal(runtimeState.historyPast.at(-1)?.before?.styleConfig?.["ocean.showRegionNames"], false);
    assert.equal(runtimeState.historyPast.at(-1)?.after?.styleConfig?.["ocean.showRegionNames"], true);
    assert.equal(undoHistory(), true);
    assert.equal(runtimeState.styleConfig.ocean.showRegionNames, false);
    assert.equal(redoHistory(), true);
    assert.equal(runtimeState.styleConfig.ocean.showRegionNames, true);
  } finally {
    clearHistory();
    setAppearanceStyleConfigState(runtimeState, priorStyle);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { createOceanLakeControlsController } from "../js/ui/toolbar/ocean_lake_controls_controller.js";
import { normalizeAppearanceStyleSnapshot } from "../js/core/state/appearance_preset_state.js";
import { mergeScenarioStyleDefaultsState } from "../js/core/state/actions/scenario_presentation_actions.js";
import { createScenarioOceanFillRestoreRuntime } from "../js/core/scenario/presentation_ocean_fill_restore.js";
import { createDefaultStyleConfig, restoreImportedStyleConfigState } from "../js/core/state/ui_state.js";
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

test("enabling bathymetry from flat chooses soft and applies defaults; disabling restores flat", () => {
  const fixture = createFixture();
  fixture.controller.renderOceanLakeControlsUi();
  assert.equal(fixture.opacity.disabled, true);
  fixture.toggle.checked = true;
  fixture.toggle.dispatch("change");
  assert.equal(fixture.state.styleConfig.ocean.preset, "bathymetry_soft");
  assert.deepEqual([
    fixture.state.styleConfig.ocean.opacity,
    fixture.state.styleConfig.ocean.scale,
    fixture.state.styleConfig.ocean.contourStrength,
  ], [0.7, 1.2, 0.3]);
  assert.equal(fixture.opacity.disabled, false);
  fixture.toggle.checked = false;
  fixture.toggle.dispatch("change");
  assert.equal(fixture.state.styleConfig.ocean.preset, "flat");
  assert.equal(fixture.opacity.disabled, true);
});

test("flat style disables sliders and zero settings remain visible", () => {
  const fixture = createFixture();
  fixture.toggle.checked = true;
  fixture.toggle.dispatch("change");
  fixture.select.value = "flat";
  fixture.select.dispatch("change");
  assert.equal(fixture.opacity.disabled, true);
  assert.equal(fixture.scale.disabled, true);
  assert.equal(fixture.contour.disabled, true);
  fixture.state.styleConfig.ocean.opacity = 0;
  fixture.state.styleConfig.ocean.contourStrength = 0;
  fixture.controller.renderOceanLakeControlsUi();
  assert.equal(fixture.opacity.value, "0");
  assert.equal(fixture.opacityValue.textContent, "0%");
  assert.equal(fixture.contour.value, "0");
  assert.equal(fixture.contourValue.textContent, "0%");
});


test("new ocean styles and partial project and appearance snapshots use Soft defaults", () => {
  const expected = { preset: "bathymetry_soft", experimentalAdvancedStyles: true,
    opacity: 0.9, scale: 1.25, contourStrength: 0 };
  const project = { styleConfig: { ocean: { fillColor: "#123456", preset: "flat", experimentalAdvancedStyles: false } } };
  restoreImportedStyleConfigState(project, { ocean: { fillColor: "#abcdef" } });
  for (const config of [createDefaultStyleConfig(), project.styleConfig,
    normalizeAppearanceStyleSnapshot({ ocean: { fillColor: "#abcdef" } })]) {
    for (const [key, value] of Object.entries(expected)) assert.equal(config.ocean[key], value, key);
  }
  for (const ocean of [{ experimentalAdvancedStyles: false }, { preset: "flat" },
    { experimentalAdvancedStyles: false, preset: "flat", opacity: 0, scale: 1, contourStrength: 0 }]) {
    const target = { styleConfig: createDefaultStyleConfig() };
    restoreImportedStyleConfigState(target, { ocean });
    const appearance = normalizeAppearanceStyleSnapshot({ ocean });
    for (const [key, value] of Object.entries(ocean)) {
      assert.equal(target.styleConfig.ocean[key], value);
      assert.equal(appearance.ocean[key], value);
    }
  }
});

test("scenario ocean defaults fill missing fields and restore explicit user choices", () => {
  const target = { styleConfig: { ocean: { fillColor: "#123456" } } };
  mergeScenarioStyleDefaultsState(target, { ocean: { fillColor: "#abcdef" } });
  assert.deepEqual(target.styleConfig.ocean, { ...createDefaultStyleConfig().ocean, fillColor: "#abcdef" });
  target.styleConfig.ocean.experimentalAdvancedStyles = false;
  target.styleConfig.ocean.preset = "flat";
  target.scenarioOceanFillBeforeActivate = null;
  const before = structuredClone(target.styleConfig.ocean);
  const runtime = createScenarioOceanFillRestoreRuntime({ state: target });
  runtime.syncScenarioOceanFillForActivation({ style_defaults: { ocean: { fillColor: "#112233" } } });
  assert.equal(target.styleConfig.ocean.experimentalAdvancedStyles, false);
  assert.equal(target.styleConfig.ocean.preset, "flat");
  runtime.restoreScenarioOceanFillAfterExit();
  assert.deepEqual(target.styleConfig.ocean, before);
});

test("Soft defaults render enabled bathymetry controls without changing saved values", () => {
  const fixture = createFixture();
  fixture.state.styleConfig = createDefaultStyleConfig();
  fixture.controller.renderOceanLakeControlsUi();
  assert.equal(fixture.toggle.checked, true);
  assert.equal(fixture.select.value, "bathymetry_soft");
  assert.equal(fixture.opacity.disabled, false);
  assert.equal(fixture.opacity.value, "90");
  assert.equal(fixture.scale.value, "125");
  assert.equal(fixture.contour.value, "0");
});

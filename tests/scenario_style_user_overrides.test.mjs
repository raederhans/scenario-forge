import test from "node:test";
import assert from "node:assert/strict";
import {
  createScenarioOceanFillRestoreRuntime,
  recordScenarioStyleUserOverride,
} from "../js/core/scenario/presentation_ocean_fill_restore.js";

function setup() {
  const state = {
    activeScenarioId: "",
    scenarioStyleUserOverrides: {},
    scenarioOceanFillBeforeActivate: null,
    styleConfig: {
      ocean: { fillColor: "#112233", preset: "flat", experimentalAdvancedStyles: false },
      internalBorders: { color: "#333333", colorMode: "auto", width: 1, opacity: 1 },
      empireBorders: { color: "#444444", width: 1, opacity: 1 },
      coastlines: { color: "#555555", width: 1, opacity: 1 },
    },
  };
  const runtime = createScenarioOceanFillRestoreRuntime({ state });
  const activate = (id, style_defaults) => {
    state.activeScenarioId = id;
    runtime.syncScenarioOceanFillForActivation({ scenario_id: id, style_defaults });
  };
  return { state, runtime, activate };
}

test("scenario overrides survive switching without leaking and exit restores baseline", () => {
  const { state, runtime, activate } = setup();
  const baseline = structuredClone(state.styleConfig);
  const a = { ocean: { fillColor: "#aabbcc" }, internalBorders: { width: 2 } };
  const b = { ocean: { fillColor: "#ddeeff" }, internalBorders: { width: 3 } };
  activate("A", a);
  runtime.updateScenarioOceanFill("#123456", "user");
  recordScenarioStyleUserOverride(state, "ocean", "fillColor", "#123456");
  recordScenarioStyleUserOverride(state, "internalBorders", "width", 4);
  recordScenarioStyleUserOverride(state, "internalBorders", "colorMode", "manual");
  recordScenarioStyleUserOverride(state, "empireBorders", "opacity", 0.4);
  recordScenarioStyleUserOverride(state, "coastlines", "color", "#abcdef");
  activate("B", b);
  assert.equal(state.styleConfig.ocean.fillColor, "#ddeeff");
  assert.equal(state.styleConfig.internalBorders.width, 3);
  activate("A", a);
  assert.equal(state.styleConfig.ocean.fillColor, "#123456");
  assert.equal(state.styleConfig.internalBorders.width, 4);
  assert.equal(state.styleConfig.internalBorders.colorMode, "manual");
  assert.equal(state.styleConfig.empireBorders.opacity, 0.4);
  assert.equal(state.styleConfig.coastlines.color, "#abcdef");
  activate("B", b);
  assert.equal(state.styleConfig.ocean.fillColor, "#ddeeff");
  assert.equal(state.styleConfig.empireBorders.opacity, 1);
  assert.equal(state.styleConfig.coastlines.color, "#555555");
  runtime.restoreScenarioOceanFillAfterExit();
  state.activeScenarioId = "";
  assert.deepEqual(state.styleConfig, baseline);
  activate("A", a);
  assert.equal(state.styleConfig.ocean.fillColor, "#123456");
});

test("only active scenario whitelist edits are recorded", () => {
  const { state, activate } = setup();
  recordScenarioStyleUserOverride(state, "ocean", "fillColor", "#123456");
  assert.deepEqual(state.scenarioStyleUserOverrides, {});
  activate("A", {});
  recordScenarioStyleUserOverride(state, "lakes", "fillColor", "#123456");
  recordScenarioStyleUserOverride(state, "empireBorders", "political", "off");
  recordScenarioStyleUserOverride(state, "ocean", "showRegionNames", true);
  assert.deepEqual(state.scenarioStyleUserOverrides, {});
  recordScenarioStyleUserOverride(state, "ocean", "preset", "bathymetry_soft");
  recordScenarioStyleUserOverride(state, "ocean", "experimentalAdvancedStyles", true);
  activate("B", {});
  activate("A", {});
  assert.equal(state.styleConfig.ocean.preset, "bathymetry_soft");
  assert.equal(state.styleConfig.ocean.experimentalAdvancedStyles, true);
});

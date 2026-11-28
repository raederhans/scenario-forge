import test from "node:test";
import assert from "node:assert/strict";
import {
  captureScenarioStyleBaselineBeforeUserEdit,
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

test("switching scenarios preserves each ocean override", () => {
  const { state, runtime, activate } = setup();
  const a = { ocean: { fillColor: "#aabbcc" }, internalBorders: { width: 2 } };
  const b = { ocean: { fillColor: "#ddeeff" }, internalBorders: { width: 3 } };
  activate("A", a);
  runtime.updateScenarioOceanFill("#123456", "user");
  recordScenarioStyleUserOverride(state, "ocean", "fillColor", "#123456");
  activate("B", b);
  assert.equal(state.styleConfig.ocean.fillColor, "#ddeeff");
  activate("A", a);
  assert.equal(state.styleConfig.ocean.fillColor, "#123456");
});

test("editing a group the scenario does not override keeps the pristine baseline (A -> B -> A -> exit)", () => {
  const { state, runtime, activate } = setup();
  const pristineCoast = { ...state.styleConfig.coastlines };
  const oceanOnlyA = { ocean: { fillColor: "#aabbcc" } };
  const oceanOnlyB = { ocean: { fillColor: "#ddeeff" } };
  activate("A", oceanOnlyA);
  // 与界面入口相同的顺序：先记基线，再改样式，再记录用户改动。
  captureScenarioStyleBaselineBeforeUserEdit(state, "coastlines");
  state.styleConfig.coastlines = { ...state.styleConfig.coastlines, color: "#abcdef" };
  recordScenarioStyleUserOverride(state, "coastlines", "color", "#abcdef");
  activate("B", oceanOnlyB);
  assert.equal(state.styleConfig.coastlines.color, pristineCoast.color, "edit must not leak into B");
  activate("A", oceanOnlyA);
  assert.equal(state.styleConfig.coastlines.color, "#abcdef", "A keeps the user edit");
  state.activeScenarioId = "";
  runtime.restoreScenarioOceanFillAfterExit();
  assert.deepEqual(state.styleConfig.coastlines, pristineCoast, "exit restores the pristine value");
});

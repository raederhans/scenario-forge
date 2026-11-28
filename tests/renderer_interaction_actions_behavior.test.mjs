import assert from "node:assert/strict";
import test from "node:test";
import { removeClickWaterRegionOverrideState, setClickSelectedColorState } from "../js/core/state/actions/renderer_interaction_actions.js";
import { removeClickCountryColorsState, setClickCountryColorsState } from "../js/core/state/actions/scenario_activation_actions.js";

test("click selection actions preserve canonical color writes and remove overrides", () => {
  const selectedColor = { css: "#123456" };
  const target = {
    sovereignBaseColors: { AA: "#aaaaaa", BB: "#bbbbbb" },
    waterRegionOverrides: { "water-1": "#111111", "water-2": "#222222" },
  };

  assert.equal(setClickSelectedColorState(target, selectedColor), selectedColor);
  assert.equal(target.selectedColor, selectedColor);
  assert.equal(removeClickWaterRegionOverrideState(target, " water-1 "), true);
  assert.deepEqual(target.waterRegionOverrides, { "water-2": "#222222" });
  assert.equal(removeClickCountryColorsState(target, " AA "), true);
  assert.deepEqual(target.sovereignBaseColors, { BB: "#bbbbbb" });

  assert.equal(setClickCountryColorsState(target, " DD ", "#dddddd"), true);
  assert.equal(target.sovereignBaseColors.DD, "#dddddd");
});

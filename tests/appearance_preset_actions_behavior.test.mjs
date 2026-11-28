import test from "node:test";
import assert from "node:assert/strict";
import { applyAppearancePresetState } from "../js/core/state/actions/appearance_preset_actions.js";

test("preset apply action owns detached style, visibility, and intensity commits", () => {
  const styleConfig = { ocean: { fillColor: "#123456" } };
  const layerVisibility = { showUrban: false, showPhysical: true };
  const intensityFields = {};
  const target = { styleConfig: {}, intensityFields: {} };

  applyAppearancePresetState(target, { styleConfig, layerVisibility, intensityFields });

  assert.notEqual(target.styleConfig, styleConfig);
  assert.equal(target.showUrban, false);
  assert.equal(target.showPhysical, true);
  assert.notEqual(target.intensityFields, intensityFields);
});

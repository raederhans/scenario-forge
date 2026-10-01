import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultStyleConfig, restoreImportedStyleConfigState } from "../js/core/state/ui_state.js";
import { patchAppearanceStyleGroupState } from "../js/core/state/actions/appearance_actions.js";
import { normalizeAppearanceStyleSnapshot } from "../js/core/state/appearance_preset_state.js";

test("country names default on and their disabled setting survives style/preset roundtrip", () => {
  const state = { styleConfig: createDefaultStyleConfig() };
  assert.equal(state.styleConfig.countryLabels.enabled, true);
  patchAppearanceStyleGroupState(state, "countryLabels", { enabled: false });
  const saved = normalizeAppearanceStyleSnapshot(state.styleConfig);
  const restored = { styleConfig: createDefaultStyleConfig() };
  restoreImportedStyleConfigState(restored, saved);
  assert.equal(restored.styleConfig.countryLabels.enabled, false);
});

test("legacy and malformed country label styles retain a safe boolean setting", () => {
  const state = { styleConfig: createDefaultStyleConfig() };
  restoreImportedStyleConfigState(state, {});
  assert.equal(state.styleConfig.countryLabels.enabled, true);
  restoreImportedStyleConfigState(state, { countryLabels: { enabled: "false" } });
  assert.equal(state.styleConfig.countryLabels.enabled, true);
});

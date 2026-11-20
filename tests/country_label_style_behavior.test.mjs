import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultStyleConfig, restoreImportedStyleConfigState } from "../js/core/state/ui_state.js";
import { FileManager } from "../js/core/file_manager.js";
import { patchAppearanceStyleGroupState } from "../js/core/state/actions/appearance_actions.js";
import { normalizeAppearanceStyleSnapshot } from "../js/core/state/appearance_preset_state.js";

const defaults = { enabled: true, sizeScale: 1, uppercase: true, opacity: 1 };

test("country name styles survive project and preset roundtrips", () => {
  const state = { styleConfig: createDefaultStyleConfig() };
  assert.deepEqual(state.styleConfig.countryLabels, defaults);
  const selected = { enabled: false, sizeScale: 0.75, uppercase: false, opacity: 0.45 };
  patchAppearanceStyleGroupState(state, "countryLabels", selected);
  const project = FileManager.buildProjectPayload(state);
  const imported = FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(project)));
  for (const snapshot of [imported.styleConfig, normalizeAppearanceStyleSnapshot(state.styleConfig)]) {
    const restored = { styleConfig: createDefaultStyleConfig() };
    restoreImportedStyleConfigState(restored, snapshot);
    assert.deepEqual(restored.styleConfig.countryLabels, selected);
  }
});

test("legacy and malformed styles restore default settings", () => {
  for (const countryLabels of [undefined, { enabled: false },
    { enabled: "false", sizeScale: null, uppercase: "false", opacity: "invalid" }]) {
    const state = { styleConfig: { countryLabels: { sizeScale: 0.65, uppercase: false, opacity: 0.35 } } };
    restoreImportedStyleConfigState(state, { countryLabels });
    assert.deepEqual(state.styleConfig.countryLabels, { ...defaults, enabled: countryLabels?.enabled !== false });
  }
});

test("imported country name size and opacity clamp at both ends", () => {
  for (const [sizeScale, opacity, expectedScale, expectedOpacity] of [[0, 2, 0.6, 1], [2, 0, 1.6, 0.3]]) {
    const result = normalizeAppearanceStyleSnapshot({ countryLabels: { sizeScale, opacity } });
    assert.deepEqual(result.countryLabels, { ...defaults, sizeScale: expectedScale, opacity: expectedOpacity });
  }
});

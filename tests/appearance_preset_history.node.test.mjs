import assert from "node:assert/strict";
import test from "node:test";
import { createAppearancePresetFromRuntimeState, createIntensityFieldsState, sampleIntensityField, state, updateIntensityFieldChannel } from "../js/core/state.js";
import { applyAppearancePresetState } from "../js/core/state/actions/appearance_preset_actions.js";
import {
  createDefaultStyleConfig,
} from "../js/core/state/ui_state.js";
import {
  captureHistoryState,
  clearHistory,
  pushHistoryEntry,
  redoHistory,
  undoHistory,
} from "../js/core/history_manager.js";

function resetRuntimeAppearance() {
  globalThis.document = {
    getElementById: () => null,
  };
  clearHistory();
  state.styleConfig = createDefaultStyleConfig();
  state.showUrban = true;
  state.intensityFields = createIntensityFieldsState();
}

function createPresetRuntime() {
  return {
    styleConfig: {
      ocean: {
        fillColor: "#112233",
      },
    },
    showUrban: false,
    intensityFields: updateIntensityFieldChannel(
      createIntensityFieldsState(),
      "urbanGlow",
      (channel) => {
        channel.enabled = true;
        channel.points = [{ id: "glow", lon: 139.7, lat: 35.7, strength: 1.8, radiusDeg: 5 }];
      },
    ),
  };
}

test("history undo and redo restore applied appearance style, visibility, and intensity fields", () => {
  resetRuntimeAppearance();
  const preset = createAppearancePresetFromRuntimeState(createPresetRuntime(), {
    id: "history-preset",
    name: "History Preset",
    now: Date.UTC(2026, 5, 12),
  });
  const before = captureHistoryState({ appearanceState: true });
  applyAppearancePresetState(state, preset);
  const after = captureHistoryState({ appearanceState: true });

  assert.equal(pushHistoryEntry({ before, after, meta: { kind: "appearance-preset-apply" } }), true);
  assert.equal(state.styleConfig.ocean.fillColor, "#112233");
  assert.equal(state.showUrban, false);
  assert.ok(sampleIntensityField(state.intensityFields, "urbanGlow", 139.7, 35.7) > 1.4);

  assert.equal(undoHistory(), true);
  assert.equal(state.styleConfig.ocean.fillColor, "#aadaff");
  assert.equal(state.showUrban, true);
  assert.equal(sampleIntensityField(state.intensityFields, "urbanGlow", 139.7, 35.7), 1);

  assert.equal(redoHistory(), true);
  assert.equal(state.styleConfig.ocean.fillColor, "#112233");
  assert.equal(state.showUrban, false);
  assert.ok(sampleIntensityField(state.intensityFields, "urbanGlow", 139.7, 35.7) > 1.4);
});

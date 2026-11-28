import assert from "node:assert/strict";
import test from "node:test";

import {
  createPaletteLibraryOperation,
} from "../js/core/palette_library_operation.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import {
  captureHistoryState,
  clearHistory,
  pushHistoryEntry,
  redoHistory,
  undoHistory,
} from "../js/core/history_manager.js";
import { state as runtimeState } from "../js/core/state.js";
import { applyPaletteFeatureColorState, selectPalettePaintColorState } from "../js/core/state/actions/palette_library_actions.js";

function createOperationHarness(state) {
  const history = [];
  const operation = createPaletteLibraryOperation({
    state,
    ...createPaletteLibraryStateAccess(state),
    captureHistoryState({ featureIds }) {
      return { visualOverrides: Object.fromEntries(featureIds.map(id => [id, state.visualOverrides[id] ?? null])) };
    },
    pushHistoryEntry(entry) {
      history.push(entry);
      return true;
    },
    refreshResolvedColorsForFeatures() {},
    refreshColorState() {},
    markDirty() {},
    selectPaintColor(color) {
      selectPalettePaintColorState(state, color);
    },
  });
  return { apply: operation.applyColor, history };
}

test("invalid colors leave the current paint unchanged", () => {
  const state = {
    selectedColor: "#123456",
    paintMode: "sovereignty",
    ui: { politicalEditingExpanded: true },
    landIndex: new Map(),
    devSelectedHit: null,
    hoveredId: "",
    selectedInspectorCountryCode: "",
  };
  const { apply } = createOperationHarness(state);

  assert.deepEqual(apply("not-a-color"), { status: "invalid-color" });
  assert.equal(state.selectedColor, "#123456");
  assert.equal(state.paintMode, "sovereignty");
  assert.equal(state.ui.politicalEditingExpanded, true);
});

test("feature apply writes the selected color and the feature override", () => {
  const sovereignty = { target: "ITA" };
  const state = {
    selectedColor: "#111111",
    paintMode: "sovereignty",
    ui: { politicalEditingExpanded: true },
    devSelectedHit: { id: "target" },
    hoveredId: "other",
    selectedInspectorCountryCode: "GER",
    landIndex: new Map([["target", {}], ["other", {}]]),
    sovereigntyByFeatureId: sovereignty,
    visualOverrides: { target: "#222222" },
  };
  const { apply } = createOperationHarness(state);

  const result = apply("#AABBCC");

  assert.deepEqual(result, {
    status: "applied",
    color: "#aabbcc",
    target: { type: "feature", featureIds: ["target"] },
  });
  assert.equal(state.selectedColor, "#aabbcc");
  assert.equal(state.paintMode, "visual");
  assert.equal(state.ui.politicalEditingExpanded, true);
  assert.equal(state.visualOverrides.target, "#aabbcc");
  assert.equal(state.sovereigntyByFeatureId, sovereignty);
  assert.deepEqual(sovereignty, { target: "ITA" });
});

test("operation-produced feature entries round-trip through the real history harness", (t) => {
  const featureId = "palette-history-feature-test";
  const featureScope = { featureIds: [featureId] };
  const originalFeature = captureHistoryState(featureScope);
  const restoreScope = (before, scope) => {
    const after = captureHistoryState(scope);
    clearHistory();
    if (pushHistoryEntry({ before, after, meta: { affectsSovereignty: false } })) {
      undoHistory();
    }
    clearHistory();
  };
  t.after(() => {
    restoreScope(originalFeature, featureScope);
  });

  const featureState = {
    selectedColor: "#111111",
    paintMode: "visual",
    ui: {},
    devSelectedHit: { id: featureId },
    landIndex: new Map([[featureId, {}]]),
    visualOverrides: { [featureId]: "#101010" },
  };
  const featureHarness = createOperationHarness(featureState);
  assert.equal(featureHarness.apply("#f0a020").status, "applied");
  const featureEntry = featureHarness.history[0];
  applyPaletteFeatureColorState(runtimeState, [featureId], "#f0a020");
  clearHistory();
  assert.equal(pushHistoryEntry(featureEntry), true);
  assert.equal(undoHistory(), true);
  assert.equal(runtimeState.visualOverrides[featureId], "#101010");
  assert.equal(redoHistory(), true);
  assert.equal(runtimeState.visualOverrides[featureId], "#f0a020");
});

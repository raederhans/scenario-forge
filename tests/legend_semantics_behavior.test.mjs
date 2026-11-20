import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { getMapDataBoundary } from "../js/core/map_data_boundary.js";
import { getPaletteCountryTargets } from "../js/core/palette_country_targets.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import { createPaletteLibraryOperation } from "../js/core/palette_library_operation.js";
import { captureHistoryState, pushHistoryEntry, undoHistory, redoHistory } from "../js/core/history_manager.js";

const oldColor = "#123456";
const newColor = "#abcdef";
const other = "#778899";

function countryEdit(t, { occupied = false, shared = false } = {}) {
  const patch = {
    activeScenarioId: "legend",
    scenarioBaselineOwnersByFeatureId: Object.freeze({ a: "AAA", b: "BBB" }),
    landIndex: new Map(["a", "b"].map(id => [id, { id }])),
    selectedInspectorCountryCode: "AAA",
    sovereignBaseColors: { AAA: oldColor, BBB: shared ? oldColor : other },
    visualOverrides: {},
    colors: { a: oldColor, b: shared ? oldColor : other },
    legendLabels: { [oldColor]: "Old", ...(occupied ? { [newColor]: "Existing" } : {}) },
    legendColorOrder: occupied ? [oldColor, other, newColor] : [oldColor, other],
    historyPast: [], historyFuture: [],
  };
  const previous = Object.fromEntries(Object.keys(patch).map(key => [key, state[key]]));
  Object.assign(state, patch);
  t.after(() => Object.assign(state, previous));
  return createPaletteLibraryOperation({
    state, ...createPaletteLibraryStateAccess(state),
    getCountryFeatureIds: tag => [...getPaletteCountryTargets(state).get(tag)],
    captureHistoryState, pushHistoryEntry,
    markDirty() {}, selectPaintColor() {}, refreshColorState() {},
    refreshResolvedColorsForFeatures(ids) {
      for (const id of ids) state.colors[id] = getMapDataBoundary(state).paint.resolveFeatureColor(id).color;
    },
  });
}

test("country recolor moves the label and its slot in the same undoable edit", t => {
  const edit = countryEdit(t);
  edit.applyColor(newColor, { countryCode: "AAA" });
  assert.deepEqual(state.legendLabels, { [newColor]: "Old" });
  assert.deepEqual(state.legendColorOrder, [newColor, other]);
  assert.equal(undoHistory(), true);
  assert.equal(state.sovereignBaseColors.AAA, oldColor);
  assert.deepEqual(state.legendLabels, { [oldColor]: "Old" });
  assert.deepEqual(state.legendColorOrder, [oldColor, other]);
  assert.equal(redoHistory(), true);
  assert.deepEqual(state.legendLabels, { [newColor]: "Old" });
  assert.deepEqual(state.legendColorOrder, [newColor, other]);
});

test("palette owner recolor keeps the destination label and removes the duplicate slot", t => {
  countryEdit(t, { occupied: true }).applyColor(newColor);
  assert.deepEqual(state.legendLabels, { [newColor]: "Existing" });
  assert.deepEqual(state.legendColorOrder, [newColor, other]);
});

test("another feature still using the old color keeps its label and slot", t => {
  countryEdit(t, { shared: true }).applyColor(newColor);
  assert.deepEqual(state.legendLabels, { [oldColor]: "Old" });
  assert.deepEqual(state.legendColorOrder, [oldColor, other]);
});

test("an unloaded scenario member still using the old color keeps its label", t => {
  const edit = countryEdit(t, { shared: true });
  state.landIndex.delete("b");
  delete state.colors.b;
  edit.applyColor(newColor, { countryCode: "AAA" });
  assert.deepEqual(state.legendLabels, { [oldColor]: "Old" });
  assert.deepEqual(state.legendColorOrder, [oldColor, other]);
});

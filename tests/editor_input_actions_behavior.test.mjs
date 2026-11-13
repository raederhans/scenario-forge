import assert from "node:assert/strict";
import test from "node:test";
import { clearInspectorSelectionState, pushRecentColorState, selectInspectorCountryState, selectInspectorGroupState, selectInspectorFeatureState } from "../js/core/state/actions/editor_input_actions.js";

test("clear inspector resets all selection fields and reports the previous selection", () => {
  const state = {
    selectedInspectorCountryCode: "AA",
    inspectorSelectionLevel: "feature", inspectorSelectionGroupId: "g", inspectorSelectionFeatureId: "land-1",
    inspectorHighlightCountryCode: "BB",
    inspectorHighlightFeatureIds: ["land-1"],
    inspectorHighlightGroupMode: true,
    inspectorHighlightLabel: "Group",
    inspectorOverlayDirty: false,
  };
  assert.equal(clearInspectorSelectionState(state), true);
  assert.deepEqual(state, {
    inspectorSelectionLevel: "", inspectorSelectionGroupId: "", inspectorSelectionFeatureId: "",
    selectedInspectorCountryCode: "",
    inspectorHighlightCountryCode: "",
    inspectorHighlightFeatureIds: [],
    inspectorHighlightGroupMode: false,
    inspectorHighlightLabel: "",
    inspectorOverlayDirty: true,
  });
  assert.equal(clearInspectorSelectionState(state), false);
});

test("clear inspector resets remaining highlights even without a selected country", () => {
  const state = { selectedInspectorCountryCode: "", inspectorHighlightCountryCode: "AA",
    inspectorHighlightFeatureIds: ["land-1"], inspectorHighlightGroupMode: true,
    inspectorHighlightLabel: "Group", inspectorOverlayDirty: false };
  assert.equal(clearInspectorSelectionState(state), false);
  assert.deepEqual(state, { inspectorSelectionLevel: "", inspectorSelectionGroupId: "", inspectorSelectionFeatureId: "", selectedInspectorCountryCode: "", inspectorHighlightCountryCode: "",
    inspectorHighlightFeatureIds: [], inspectorHighlightGroupMode: false,
    inspectorHighlightLabel: "", inspectorOverlayDirty: true });
});

test("selection writers replace drill level without changing edits or history", () => {
  const state = { dirty: false, history: [] };
  const group = { id: "g", children: ["a", "b"] };
  selectInspectorGroupState(state, "AA", group);
  assert.equal(state.inspectorSelectionLevel, "group");
  assert.equal(state.inspectorSelectionGroupId, "g");
  assert.equal(state.inspectorSelectionFeatureId, "");
  selectInspectorFeatureState(state, "AA", "b", group);
  assert.equal(state.inspectorSelectionLevel, "feature");
  assert.equal(state.inspectorSelectionFeatureId, "b");
  assert.equal(state.inspectorSelectionGroupId, "g");
  selectInspectorFeatureState(state, "AA", "c");
  assert.equal(state.inspectorSelectionGroupId, "");
  selectInspectorCountryState(state, "BB");
  assert.equal(state.selectedInspectorCountryCode, "BB");
  assert.equal(state.inspectorSelectionLevel, "country");
  assert.equal(state.inspectorSelectionGroupId, "");
  assert.equal(state.inspectorSelectionFeatureId, "");
  assert.equal(state.dirty, false);
  assert.deepEqual(state.history, []);
});

test("recent colors keep the ten most recent distinct colors across entry points", () => {
  const state = { recentColors: [] };
  for (let index = 0; index < 12; index += 1) {
    assert.equal(pushRecentColorState(state, `#0000${String(index).padStart(2, "0")}`), true);
  }
  assert.equal(state.recentColors.length, 10);
  assert.equal(state.recentColors[0], "#000011");
  assert.equal(state.recentColors[9], "#000002");
  assert.equal(pushRecentColorState(state, "#000011"), false, "the most recent color is not re-added");
  assert.equal(pushRecentColorState(state, "#000005"), true);
  assert.equal(state.recentColors.length, 10, "re-picking an older color keeps the list at ten");
  assert.equal(state.recentColors[0], "#000005");
  assert.equal(state.recentColors.filter((value) => value === "#000005").length, 1);
  assert.equal(pushRecentColorState(state, ""), false);
});

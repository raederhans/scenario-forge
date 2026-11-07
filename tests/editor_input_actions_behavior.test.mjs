import assert from "node:assert/strict";
import test from "node:test";
import { clearInspectorSelectionState } from "../js/core/state/actions/editor_input_actions.js";

test("clear inspector resets all selection fields and reports the previous selection", () => {
  const state = {
    selectedInspectorCountryCode: "AA",
    inspectorHighlightCountryCode: "BB",
    inspectorHighlightFeatureIds: ["land-1"],
    inspectorHighlightGroupMode: true,
    inspectorHighlightLabel: "Group",
    inspectorOverlayDirty: false,
  };
  assert.equal(clearInspectorSelectionState(state), true);
  assert.deepEqual(state, {
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
  assert.deepEqual(state, { selectedInspectorCountryCode: "", inspectorHighlightCountryCode: "",
    inspectorHighlightFeatureIds: [], inspectorHighlightGroupMode: false,
    inspectorHighlightLabel: "", inspectorOverlayDirty: true });
});

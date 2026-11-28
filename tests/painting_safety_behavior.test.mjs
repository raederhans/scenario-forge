import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { FileManager } from "../js/core/file_manager.js";
import { restoreImportedWorkbenchUiState } from "../js/core/state/ui_state.js";
import { applyProjectImportPatch, captureProjectImportState } from "../js/core/state/actions/project_import_actions.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";

test("protected batch fill skips painted members", () => {
  const ids = ["a", "b", "c"];
  const editing = {
    landIndex: new Map(ids.map(id => [id, { id }])), hierarchyData: { groups: { PL_north: ["a", "b"] } },
    countryToFeatureIds: new Map([["PL", ids]]), currentTool: "fill", interactionGranularity: "subdivision",
    batchFillScope: "country", onlyUnpainted: true, visualOverrides: { b: "#123456" },
  };
  const policy = createFillTargetPolicy(editing, {
    getFeatureCountryCodeNormalized: () => "PL", getAdmin1Group: () => "", shouldExcludePoliticalInteractionFeature: () => false,
  });
  const plan = event => policy.buildDoubleClickBatchPlan(editing.landIndex.get("a"), "a", policy.getGestureScope(event));
  editing.batchFillScope = "parent";
  assert.deepEqual(plan({ shiftKey: true }).targetIds, ["a", "c"]);
  assert.equal(plan({ shiftKey: true }).skippedCount, 1);
});

test("project import restores protection and resets it for legacy projects", () => {
  const payload = FileManager.buildProjectPayload({ ...state, onlyUnpainted: true });
  const restored = {};
  for (const expected of [true, false]) {
    if (!expected) delete payload.onlyUnpainted;
    const data = FileManager.normalizeImportedProjectData(payload);
    const draft = {};
    restoreImportedWorkbenchUiState(draft, data);
    applyProjectImportPatch(restored, captureProjectImportState(draft));
    assert.equal(restored.onlyUnpainted, expected);
  }
});

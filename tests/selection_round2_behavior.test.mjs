import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { FileManager } from "../js/core/file_manager.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";

test("color quick fill crosses borders, stops at different colors and falls back only to visible parcels", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const landIndex = new Map(ids.map(id => [id, { id }]));
  const fixture = { currentTool: "fill", batchFillScope: "color", interactionGranularity: "subdivision", landIndex };
  let adjacency = { ids, graph: [[1, 2], [0], [0, 3], [2], []] };
  const policy = createFillTargetPolicy(fixture, {
    getColorAdjacency: () => adjacency,
    getVisibleFeatureIds: () => ["a", "b", "c", "e"],
    getFeaturePaintColor: id => ["a", "c"].includes(id) ? "#abcdef" : "#123456",
    shouldExcludePoliticalInteractionFeature: () => false,
  });
  // The leading click has already repainted a. Its original color determines the component.
  const plan = () => policy.buildDoubleClickBatchPlan(landIndex.get("a"), "a", "color", "#123456");
  assert.deepEqual(plan().targetIds, ["a", "b"]);
  adjacency = null;
  assert.deepEqual(plan().targetIds, ["a", "b", "e"]);
  assert.equal(plan().visibleColorFallback, true);
});

test("project import restores the color quick-fill scope", () => {
  const payload = FileManager.buildProjectPayload({ ...state, batchFillScope: "color" });
  assert.equal(FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(payload))).batchFillScope, "color");
});

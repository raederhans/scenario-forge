import assert from "node:assert/strict";
import test from "node:test";

import { commitExportWorkbenchUiState } from "../js/core/state/actions/export_workbench_actions.js";

test("export workbench commit normalizes and detaches caller drafts", () => {
  const draft = {
    target: "per-layer-png",
    layerOrder: ["paint", "background"],
    visibility: { political: false },
    adjustments: { brightness: 240 },
    bakeArtifacts: [{ layerId: "color", dependencies: ["a"], canvasSize: { width: 8, height: 9 } }],
  };
  const target = {};
  const committed = commitExportWorkbenchUiState(target, draft);

  assert.equal(committed.target, "per-layer");
  assert.deepEqual(committed.layerOrder.slice(0, 2), ["political", "background"]);
  assert.equal(committed.adjustments.brightness, 200);
  draft.layerOrder[0] = "labels";
  draft.visibility.political = true;
  draft.adjustments.brightness = 0;
  draft.bakeArtifacts[0].dependencies.push("b");
  assert.deepEqual(committed.layerOrder.slice(0, 2), ["political", "background"]);
  assert.equal(committed.visibility.political, false);
  assert.equal(committed.adjustments.brightness, 200);
  assert.deepEqual(committed.bakeArtifacts[0].dependencies, ["a"]);
});

test("export workbench commit strips uncloneable legacy bake cache entries", () => {
  const target = {};
  const draft = {
    target: "bake-pack",
    bakeCache: new Map([["color", { canvas: () => {} }]]),
    bakeArtifacts: [{ layerId: "color" }],
  };

  const committed = commitExportWorkbenchUiState(target, draft);

  assert.equal(committed.target, "bake-pack");
  assert.equal(Object.hasOwn(committed, "bakeCache"), false);
  assert.equal(Object.hasOwn(target.exportWorkbenchUi, "bakeCache"), false);
  assert.deepEqual(committed.bakeArtifacts.map(({ layerId }) => layerId), ["color"]);
});

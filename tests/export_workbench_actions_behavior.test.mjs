import assert from "node:assert/strict";
import test from "node:test";

import {
  commitExportWorkbenchUiState,
  ensureExportWorkbenchUiState,
  setExportAdjustmentsState,
  setExportBakeState,
  setExportLayerOrderState,
  setExportOutputState,
  setExportPreviewState,
  setExportTextVisibilityState,
  setExportVisibilityState,
} from "../js/core/state/actions/export_workbench_actions.js";

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

test("export workbench field actions retain normalized domain semantics", () => {
  const cache = new Map([["color", { canvas: true }]]);
  const target = { exportWorkbenchUi: { bakeCache: cache } };

  assert.equal(ensureExportWorkbenchUiState(target).bakeCache, cache);
  setExportLayerOrderState(target, ["labels", "paint"]);
  setExportVisibilityState(target, "paint", false);
  setExportTextVisibilityState(target, "annotations", false);
  setExportPreviewState(target, { mode: "layer", layerId: "annotations" });
  setExportOutputState(target, { target: "bake-pack", format: "jpg", scale: "4" });
  setExportAdjustmentsState(target, { contrast: -10, clarity: 123.7 });
  setExportBakeState(target, {
    bakeCache: cache,
    bakeArtifacts: [{ layerId: "text", dirtyFlag: false }],
  });

  const ui = target.exportWorkbenchUi;
  assert.equal(ui.layerOrder[0], "labels");
  assert.equal(ui.visibility.political, false);
  assert.equal(ui.textVisibility["svg-annotations"], false);
  assert.equal(ui.includeTextLayer, true);
  assert.equal(ui.previewMode, "layer");
  assert.equal(ui.previewLayerId, "svg-annotations");
  assert.deepEqual({ target: ui.target, format: ui.format, scale: ui.scale }, {
    target: "bake-pack",
    format: "jpg",
    scale: "4",
  });
  assert.equal(ui.adjustments.contrast, 0);
  assert.equal(ui.adjustments.clarity, 124);
  assert.equal(ui.bakeCache, cache);
  assert.deepEqual(ui.bakeArtifacts, [{
    layerId: "text",
    updatedAt: 0,
    dependencies: [],
    canvasSize: { width: 0, height: 0 },
    dirtyFlag: false,
  }]);
});

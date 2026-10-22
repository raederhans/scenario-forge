import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("export workbench detaches custom normalizer input and skips drafts for invalid targets", () => {
  const draft = {
    adjustments: { brightness: 140 },
    metadata: new Map([["nested", { value: 1 }]]),
  };
  const committed = commitExportWorkbenchUiState({}, draft, {
    normalizeState(value) {
      value.adjustments.brightness = 25;
      value.metadata.get("nested").value = 2;
      return value;
    },
  });

  assert.equal(committed.adjustments.brightness, 25);
  assert.equal(committed.metadata.get("nested").value, 2);
  assert.equal(draft.adjustments.brightness, 140);
  assert.equal(draft.metadata.get("nested").value, 1);

  let getterCalls = 0;
  const guardedDraft = {};
  Object.defineProperty(guardedDraft, "adjustments", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("draft must not be read");
    },
  });
  const fallback = commitExportWorkbenchUiState(null, guardedDraft, {
    normalizeState(value) {
      assert.equal(value, null);
      return { fallback: true };
    },
  });
  assert.deepEqual(fallback, { fallback: true });
  assert.equal(getterCalls, 0);
});

test("export workbench field actions retain normalized domain semantics", () => {
  const cache = new Map([["color", { canvas: true }]]);
  const target = { exportWorkbenchUi: { bakeCache: cache } };

  assert.equal(Object.hasOwn(ensureExportWorkbenchUiState(target), "bakeCache"), false);
  assert.equal(Object.hasOwn(target.exportWorkbenchUi, "bakeCache"), false);
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
  assert.equal(Object.hasOwn(ui, "bakeCache"), false);
  assert.deepEqual(ui.bakeArtifacts, [{
    layerId: "text",
    updatedAt: 0,
    dependencies: [],
    canvasSize: { width: 0, height: 0 },
    dirtyFlag: false,
  }]);
});


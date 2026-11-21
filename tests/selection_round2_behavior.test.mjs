import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { FileManager } from "../js/core/file_manager.js";
import { undoHistory } from "../js/core/history_manager.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { resolveClickSelectionDecision } from "../js/core/map_renderer/click_selection_transaction_owner.js";
import { toggleFeatureInDevSelection } from "../js/core/map_renderer/public.js";
import { initSelectionPanel } from "../js/ui/selection_panel.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { getQuickFillLevelModel } from "../js/ui/toolbar/quick_fill_level_controls.js";

test("only Select gives Ctrl, Cmd and Shift land clicks to the shared selection", () => {
  const land = { targetType: "land", id: "a", countryCode: null, runtimeCountryCode: null };
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey"]) {
    const keys = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, [modifier]: true };
    for (const tool of ["select", "fill", "eraser", "eyedropper"]) {
      assert.equal(resolveClickSelectionDecision(land, keys, tool).decision.devSelectionRequested, tool === "select");
    }
  }
});

test("the panel paints the shared selection in one undo and Escape clears it", () => {
  const nodes = new Map();
  const keys = {};
  globalThis.Element = class {};
  globalThis.window = { addEventListener: (event, fn) => { keys[event] = fn; } };
  globalThis.document = {
    body: { dataset: {} },
    querySelectorAll: () => [],
    getElementById(id) { return nodes.get(id) || null; },
  };
  for (const id of ["parcelSelectionPanel", "parcelSelectionCount", "fillSelectedParcels", "clearSelectedParcels"]) {
    nodes.set(id, {
      classList: { toggle(name, value) { this[name] = value; } },
      addEventListener(event, handler) { this[event] = handler; },
    });
  }
  registerRuntimeHook(state, "updateDevWorkspaceUIFn", () => {});
  initSelectionPanel();
  state.bootBlocking = false;
  initShortcuts();
  state.landIndex = new Map(["a", "b"].map(id => [id, { properties: { id, cntr_code: "FR" } }]));
  state.selectedColor = "#123456";
  state.currentTool = "eraser";
  for (const id of ["a", "b"]) toggleFeatureInDevSelection(id);
  assert.equal(nodes.get("parcelSelectionCount").textContent, "2 parcels selected");
  assert.equal(nodes.get("parcelSelectionPanel").classList.hidden, false);
  nodes.get("fillSelectedParcels").click();
  assert.deepEqual(state.visualOverrides, { a: "#123456", b: "#123456" });
  assert.equal(state.historyPast.length, 1);
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.visualOverrides, {});
  keys.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(state.devSelectionFeatureIds.size, 0);
  assert.deepEqual(state.devSelectionOrder, []);
  assert.equal(nodes.get("parcelSelectionPanel").classList.hidden, true);
  toggleFeatureInDevSelection("a");
  nodes.get("clearSelectedParcels").click();
  assert.equal(state.devSelectionFeatureIds.size, 0);
});

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
  const plan = () => policy.buildDoubleClickBatchPlan(landIndex.get("a"), "a", "#123456");
  assert.deepEqual(plan().targetIds, ["a", "b"]);
  adjacency = null;
  assert.deepEqual(plan().targetIds, ["a", "b", "e"]);
  assert.equal(plan().visibleColorFallback, true);
  assert.ok(getQuickFillLevelModel(fixture).options.some(option => option.value === "color" && !option.disabled));
  const payload = FileManager.buildProjectPayload({ ...state, batchFillScope: "color" });
  assert.equal(FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(payload))).batchFillScope, "color");
});

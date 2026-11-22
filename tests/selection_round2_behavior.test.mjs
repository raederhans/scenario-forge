import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { FileManager } from "../js/core/file_manager.js";
import { undoHistory } from "../js/core/history_manager.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { createSelectionMarqueeOwner } from "../js/core/renderer/selection_marquee_owner.js";
import { resolveClickSelectionDecision } from "../js/core/map_renderer/click_selection_transaction_owner.js";
import { toggleFeatureInDevSelection } from "../js/core/map_renderer/public.js";
import { initSelectionPanel } from "../js/ui/selection_panel.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { getQuickFillLevelModel } from "../js/ui/toolbar/quick_fill_level_controls.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

test("only Select gives Ctrl, Cmd and Shift land clicks to the shared selection", () => {
  const land = { targetType: "land", id: "a", countryCode: null, runtimeCountryCode: null };
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey"]) {
    const keys = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, [modifier]: true };
    for (const tool of ["select", "fill", "eraser", "eyedropper"]) {
      assert.equal(resolveClickSelectionDecision(land, keys, tool).decision.devSelectionRequested, tool === "select");
    }
  }
});

test("the panel paints with current or country color in one undo and reports collisions and skips", (context) => {
  const { doc, win, add } = harness(context);
  delete globalThis.requestAnimationFrame;
  const panel = add("div", doc.body, "parcelSelectionPanel");
  const count = add("span", panel, "parcelSelectionCount");
  const countries = add("select", panel, "parcelSelectionCountry");
  const countryButton = add("button", panel, "fillSelectedCountry");
  const currentButton = add("button", panel, "fillSelectedParcels");
  const clearButton = add("button", panel, "clearSelectedParcels");
  const toasts = add("div", doc.body, "toastViewport");
  state.scenarioCountriesByTag = { FR: {}, P01: { project_country: true }, GB: {} };
  state.sovereignBaseColors = { FR: "#abcdef", P01: "#ABCDEF" };
  registerRuntimeHook(state, "updateDevWorkspaceUIFn", () => {});
  initSelectionPanel();
  state.bootBlocking = false;
  initShortcuts();
  state.landIndex = new Map(["a", "b"].map(id => [id, { properties: { id, cntr_code: "FR" } }]));
  state.selectedColor = "#123456";
  state.currentTool = "eraser";
  for (const id of ["a", "b"]) toggleFeatureInDevSelection(id);
  assert.equal(count.textContent, "2 parcels selected");
  assert.equal(panel.classList.contains("hidden"), false);
  currentButton.click();
  assert.deepEqual(state.visualOverrides, { a: "#123456", b: "#123456" });
  assert.equal(state.historyPast.length, 1);
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.visualOverrides, {});
  assert.deepEqual(countries.children.map(option => option.value), ["", "FR", "P01"]);
  countries.value = "P01";
  countries.fire("change");
  assert.equal(countryButton.disabled, false);
  state.onlyUnpainted = true;
  state.visualOverrides.a = "#123456";
  countryButton.click();
  assert.deepEqual(state.visualOverrides, { a: "#123456", b: "#abcdef" });
  assert.equal(state.historyPast.length, 1);
  const notices = toasts.querySelectorAll(".toast-message").map(node => node.textContent);
  const [, france, project] = countries.children;
  assert.ok(notices.includes(`${project.text} shares this color with ${france.text}; ownership may not change.`), notices.join("\n"));
  assert.ok(notices.includes("Skipped 1 already painted parcels."));
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.visualOverrides, { a: "#123456" });
  win.fire("keydown", { key: "Escape" });
  assert.equal(state.devSelectionFeatureIds.size, 0);
  assert.deepEqual(state.devSelectionOrder, []);
  assert.equal(panel.classList.contains("hidden"), true);
  toggleFeatureInDevSelection("a");
  clearButton.click();
  assert.equal(state.devSelectionFeatureIds.size, 0);
});

test("Escape with modifiers and window blur cancel an active drag and preserve selected parcels", context => {
  const { win } = harness(context);
  context.mock.method(globalThis, "requestAnimationFrame", () => 1);
  let captured;
  const surface = {
    setPointerCapture(id) { captured = id; },
    hasPointerCapture(id) { return captured === id; },
    releasePointerCapture() { captured = null; },
  };
  const marquee = createSelectionMarqueeOwner({
    state, isPointPickActive: () => false, getScreenPoint: event => [event.clientX, 0],
    surfaceHost: { getInteractionRect: () => ({ node: () => surface }), getMapContainer: () => document.body },
    suppressNextClick() {},
  });
  state.currentTool = "select";
  state.devSelectionOrder = ["a"];
  state.devSelectionFeatureIds = new Set(["a"]);
  initShortcuts({ cancelMarquee: marquee.cancel });
  for (const [event, ctrlKey, shiftKey] of [["keydown", false, false], ["keydown", true, true], ["blur", false, false]]) {
    const down = { pointerType: "mouse", pointerId: 1, button: 0, ctrlKey: true, shiftKey, clientX: 0, preventDefault() {} };
    assert.ok(marquee.down(down));
    assert.ok(marquee.move({ ...down, clientX: 20 }));
    win.fire(event, { key: "Escape", ctrlKey, shiftKey });
    assert.equal(captured, null);
    assert.deepEqual(state.devSelectionOrder, ["a"]);
  }
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
  const plan = () => policy.buildDoubleClickBatchPlan(landIndex.get("a"), "a", "color", "#123456");
  assert.deepEqual(plan().targetIds, ["a", "b"]);
  adjacency = null;
  assert.deepEqual(plan().targetIds, ["a", "b", "e"]);
  assert.equal(plan().visibleColorFallback, true);
  assert.ok(getQuickFillLevelModel(fixture).options.some(option => option.value === "color" && !option.disabled));
  const payload = FileManager.buildProjectPayload({ ...state, batchFillScope: "color" });
  assert.equal(FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(payload))).batchFillScope, "color");
});

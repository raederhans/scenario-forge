import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { commitFeaturePaint } from "../js/core/feature_paint_commands.js";
import { undoHistory } from "../js/core/history_manager.js";
import { FileManager } from "../js/core/file_manager.js";
import { restoreImportedWorkbenchUiState } from "../js/core/state/ui_state.js";
import { applyProjectImportPatch, captureProjectImportState } from "../js/core/state/actions/project_import_actions.js";
import { getHistoryActionLabel } from "../js/core/history_action_labels.js";
import { createBrushInteractionSessionOwner, isBrushPanGesture } from "../js/core/renderer/brush_interaction_session_owner.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { confirmAutoFill } from "../js/ui/toolbar.js";
import { getNextQuickFillLevel } from "../js/ui/toolbar/quick_fill_level_controls.js";
import { createToolGuidance } from "../js/ui/toolbar/tool_guidance.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

test("auto-fill asks before clearing land, river cells or country colors", async context => {
  const language = state.currentLanguage;
  state.currentLanguage = "zh";
  context.after(() => { state.currentLanguage = language; });
  const dialogs = [];
  const cancel = options => { dialogs.push(options); return Promise.resolve(false); };
  assert.equal(await confirmAutoFill({}, cancel), true);
  assert.equal(dialogs.length, 0);
  for (const [paint, count] of [
    [{ visualOverrides: { a: "#ffffff" }, riverPaint: { overrides: { b: "#000000" } } }, 2],
    [{ riverPaint: { overrides: { b: "#000000" } } }, 1],
    [{ sovereignBaseColors: { PL: "#ffffff" } }, 0],
  ]) {
    assert.equal(await confirmAutoFill(paint, cancel), false);
    assert.ok(dialogs.at(-1).message.includes(count + " 块手涂颜色"));
  }
  for (const kind of ["auto-fill-region", "auto-fill-political"]) {
    assert.equal(getHistoryActionLabel("Undo", { kind }), "撤销：自动填色");
  }
});

function brushHarness() {
  const state = { brushModeEnabled: true, currentTool: "fill", visualOverrides: {} };
  let session;
  const noop = () => {};
  const reads = [];
  const owner = createBrushInteractionSessionOwner(state, {
    getBrushSession: () => session, setBrushSession: value => { session = value; },
    suppressNextClick: noop, cancelBrushPatchPreview: noop, refreshColorState: noop,
    requestRendererRender: noop, handlePhysicalIntensityPointerDown: noop, handlePhysicalIntensityPointerMove: noop,
    isBrushNavigationModifier: event => isBrushPanGesture(state, event),
    getStrategicOverlayRuntimeOwner: () => ({ hasSpecialZoneMembershipDragSession: () => false }),
    getHitFromEvent: ({ clientX, clientY }) => {
      reads.push([clientX, clientY]);
      return { id: [Math.floor(clientX / 4), Math.floor(clientY / 4)].join(",") };
    },
    applyBrushHit: ({ id }) => {
      if (session.visitedFeatureIds.has(id)) return false;
      session.visitedFeatureIds.add(id);
      (session.before.visualOverrides ||= {})[id] = state.visualOverrides[id] ?? null;
      state.visualOverrides[id] = "#abcdef";
      session.changed = true;
      return true;
    },
    getContext: () => true, requestInteractionRender: noop, nowMs: () => 0,
  });
  const point = (clientX, clientY = 0) => ({ clientX, clientY, buttons: 1 });
  return { state, owner, point, reads };
}

test("brush follows the coalesced path, samples its interior, caps long moves and rolls back", () => {
  const { state, owner, point, reads } = brushHarness();
  state.visualOverrides["0,1"] = "#ffffff";
  owner.handleBrushPointerDown(point(0));
  owner.handleBrushPointerMove({ ...point(12, 8), getCoalescedEvents: () => [point(0, 8)] });
  assert.deepEqual(Object.keys(state.visualOverrides).sort(), ["0,0", "0,1", "0,2", "1,2", "2,2", "3,2"]);
  reads.length = 0;
  owner.handleBrushPointerMove(point(4000));
  assert.ok(reads.length <= 64);
  assert.deepEqual(reads.at(-1), [4000, 0]);
  owner.cancelBrushSession();
  owner.flushBrushSession();
  assert.deepEqual(state.visualOverrides, { "0,1": "#ffffff" });
});

test("space-drag leaves the map available for navigation without painting", () => {
  const { state, owner, point, reads } = brushHarness();
  state.brushPanModifierActive = true;
  assert.equal(isBrushPanGesture(state, point(0)), true);
  owner.handleBrushPointerDown(point(0));
  owner.handleBrushPointerMove(point(20));
  assert.deepEqual(reads, []);
});

test("persistent brush hint follows pointer type", context => {
  const { doc, add, win } = harness(context);
  doc.defaultView = win;
  const dock = add("div", doc.body, "bottomDock");
  add("div", dock).className = "bottom-dock-primary";
  const editing = { brushModeEnabled: true };
  let coarse = true;
  context.mock.method(globalThis, "matchMedia", () => ({ matches: coarse }));
  const guidance = createToolGuidance({ documentRef: doc, state: editing, t: key => key });
  const hint = doc.getElementById("editorBrushPanHint");
  assert.equal(hint.textContent, "Drag with two fingers to pan");
  coarse = false;
  guidance.sync();
  assert.equal(hint.textContent, "Shift / Space + drag to pan");
});

test("temporary scopes keep the selected level, protect paint and require complete membership", () => {
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
  editing.brushPanModifierActive = true;
  assert.deepEqual(plan({}).targetIds, ["a"]);
  editing.brushPanModifierActive = false;
  editing.batchFillScope = "parent";
  assert.deepEqual(plan({ shiftKey: true }).targetIds, ["a", "c"]);
  assert.equal(plan({ shiftKey: true }).skippedCount, 1);
  assert.equal(editing.batchFillScope, "parent");
  assert.equal(getNextQuickFillLevel(editing).value, "country");
  editing.onlyUnpainted = false;
  assert.deepEqual(plan({}).targetIds, ["a", "b"]);
  editing.countryToFeatureIds.set("PL", [...ids, "missing"]);
  assert.equal(plan({ shiftKey: true }), null);
});

test("one undo restores a protected batch including its leading click", context => {
  harness(context);
  const initial = { onlyUnpainted: true, visualOverrides: { b: "#123456" }, historyPast: [], historyFuture: [] };
  const saved = Object.fromEntries(Object.keys(initial).map(key => [key, state[key]]));
  Object.assign(state, initial);
  context.after(() => Object.assign(state, saved));
  const policy = createFillTargetPolicy(state, {});
  const gesture = { featureId: "a", color: "#abcdef", scenarioId: "" };
  function paint(ids, kind, input) {
    commitFeaturePaint([{ ids: policy.unprotectedIds(ids), color: gesture.color }], {
      kind, refresh() {}, gesture: { ...gesture, ...input },
    });
  }
  paint(["a"], "fill-feature-color", { type: "leaf-click", timeStamp: 10 });
  paint(["a", "b", "c"], "fill-country-batch", { type: "double-click", timeStamp: 20, leadingClickTimeStamp: 10 });
  assert.deepEqual(state.visualOverrides, { a: "#abcdef", b: "#123456", c: "#abcdef" });
  assert.equal(state.historyPast.length, 1);
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.visualOverrides, { b: "#123456" });
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

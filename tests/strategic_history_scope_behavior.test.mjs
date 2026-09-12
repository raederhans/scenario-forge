import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { captureHistoryState, clearHistory, pushHistoryEntry, undoHistory, redoHistory } from "../js/core/history_manager.js";
import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";
import {
  commitStrategicOverlayCollectionsState,
  patchStrategicOverlayEditorState,
} from "../js/core/state/actions/strategic_overlay_actions.js";

function harness(t) {
  const original = captureHistoryState({ strategicOverlay: true });
  const editorSelections = {
    operationGraphicsEditor: state.operationGraphicsEditor?.selectedId,
    operationalLineEditor: state.operationalLineEditor?.selectedId,
    unitCounterEditor: state.unitCounterEditor?.selectedId,
  };
  const document = globalThis.document;
  globalThis.document = { getElementById: () => null };
  clearHistory();
  t.after(() => {
    commitStrategicOverlayCollectionsState(state, {
      operationalLines: original.operationalLines, operationGraphics: original.operationGraphics,
      unitCounters: original.unitCounters,
    });
    for (const [editorKey, selectedId] of Object.entries(editorSelections)) {
      patchStrategicOverlayEditorState(state, editorKey, { selectedId });
    }
    clearHistory();
    if (document === undefined) delete globalThis.document; else globalThis.document = document;
  });
  return createStrategicOverlayRuntimeOwner({ state, helpers: {
    captureHistoryState, commitHistoryEntry: pushHistoryEntry,
    getOperationGraphicById: id => state.operationGraphics.find(item => item.id === id),
    getOperationalLineById: id => state.operationalLines.find(item => item.id === id),
  } });
}

test("graphic vertex history clones one collection and undo/redo preserves unrelated data", t => {
  const owner = harness(t);
  commitStrategicOverlayCollectionsState(state, {
    operationGraphics: [{ id: "g", kind: "offensive", points: [[0, 0], [1, 1]] }],
    operationalLines: [{ id: "line", points: [[0, 0], [1, 1]] }],
    unitCounters: [{ id: "counter" }],
  });
  patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { selectedId: "g" });
  const lineReference = state.operationalLines;
  const counterReference = state.unitCounters;
  const legacy = captureHistoryState({ strategicOverlay: true });
  assert.equal(Object.keys(legacy).length, 6);
  assert.equal(owner.insertOperationGraphicVertex(1, [0.5, 0.5]), true);
  const entry = state.historyPast.at(-1);
  assert.deepEqual(Object.keys(entry.before), ["operationGraphics"]);
  assert.deepEqual(Object.keys(entry.after), ["operationGraphics"]);
  undoHistory();
  assert.equal(state.operationGraphics[0].points.length, 2);
  redoHistory();
  assert.equal(state.operationGraphics[0].points.length, 3);
  assert.equal(state.operationalLines, lineReference);
  assert.equal(state.unitCounters, counterReference);
  assert.equal(legacy.operationGraphics[0].points.length, 2);
});

test("deleting a line captures counters too and restores both attachment directions", t => {
  const owner = harness(t);
  commitStrategicOverlayCollectionsState(state, {
    operationalLines: [{ id: "line", points: [[0, 0], [1, 1]], attachedCounterIds: ["counter"] }],
    unitCounters: [{ id: "counter", attachment: { lineId: "line" }, anchor: { featureId: "A" } }],
  });
  patchStrategicOverlayEditorState(state, "operationalLineEditor", { selectedId: "line" });
  assert.equal(owner.deleteSelectedOperationalLine(), true);
  assert.deepEqual(Object.keys(state.historyPast.at(-1).before), ["operationalLines", "unitCounters"]);
  assert.equal(state.unitCounters[0].attachment, null);
  undoHistory();
  assert.deepEqual(state.operationalLines[0].attachedCounterIds, ["counter"]);
  assert.equal(state.unitCounters[0].attachment.lineId, "line");
  redoHistory();
  assert.equal(state.operationalLines.length, 0);
  assert.equal(state.unitCounters[0].attachment, null);
});


test("deleting a counter preserves unrelated graphics and restores its line membership", t => {
  const owner = harness(t);
  commitStrategicOverlayCollectionsState(state, {
    operationalLines: [{ id: "line", attachedCounterIds: ["counter"] }],
    unitCounters: [{ id: "counter", attachment: { lineId: "line" } }],
  });
  patchStrategicOverlayEditorState(state, "unitCounterEditor", { selectedId: "counter" });
  const graphics = state.operationGraphics;
  assert.equal(owner.deleteSelectedUnitCounter(), true);
  assert.deepEqual(Object.keys(state.historyPast.at(-1).before), ["unitCounters", "operationalLines"]);
  assert.deepEqual(state.operationalLines[0].attachedCounterIds, []);
  undoHistory();
  assert.equal(state.unitCounters[0].attachment.lineId, "line");
  assert.deepEqual(state.operationalLines[0].attachedCounterIds, ["counter"]);
  redoHistory();
  assert.equal(state.unitCounters.length, 0);
  assert.deepEqual(state.operationalLines[0].attachedCounterIds, []);
  assert.equal(state.operationGraphics, graphics);
});

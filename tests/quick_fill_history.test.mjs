import test from "node:test";
import assert from "node:assert/strict";
import { coalesceQuickFillGesture } from "../js/core/history_quick_fill_gesture.js";
function entries() {
  const first = { type: "leaf-click", featureId: "a", timeStamp: 100, color: "red", scenarioId: "" };
  return [
    { kind: "fill-feature-color", before: { visualOverrides: { a: null }, featureOverrides: { a: "old" } }, after: { visualOverrides: { a: "red" }, featureOverrides: { a: "red" } }, meta: { quickFillGesture: first } },
    { kind: "fill-parent-group", before: { visualOverrides: { a: "red", b: "blue" }, featureOverrides: { a: "red", b: "blue" } }, after: { visualOverrides: { a: "red", b: "red" }, featureOverrides: { a: "red", b: "red" } }, meta: { quickFillGesture: { ...first, type: "double-click", timeStamp: 300, leadingClickTimeStamp: 100 } } },
  ];
}
test("one batch undo restores the first click as well as all siblings", () => {
  const [previous, next] = entries();
  const merged = coalesceQuickFillGesture(previous, next);
  assert.deepEqual(merged.before.visualOverrides, { a: null, b: "blue" });
  assert.deepEqual(merged.before.featureOverrides, { a: "old", b: "blue" });
  assert.deepEqual(merged.after, next.after);
  assert.equal(next.before.visualOverrides.a, "red", "inputs remain unchanged");
});
test("unrelated history, no-op first clicks, reversed events and scenario changes cannot coalesce", () => {
  for (const patch of [
    { leadingClickTimeStamp: 150 }, { timeStamp: 50 }, { featureId: "b" },
    { color: "blue" }, { scenarioId: "new" }, { timeStamp: NaN },
  ]) {
    const [previous, next] = entries(); Object.assign(next.meta.quickFillGesture, patch);
    assert.equal(coalesceQuickFillGesture(previous, next), null);
  }
  const [previous, next] = entries(); previous.before.styleConfig = {};
  assert.equal(coalesceQuickFillGesture(previous, next), null);
});

test("a recognized double-click delayed by rendering still undoes its exact leading click", () => {
  const [previous, next] = entries();
  next.meta.quickFillGesture.timeStamp = 14000;
  const merged = coalesceQuickFillGesture(previous, next);
  assert.deepEqual(merged.before.visualOverrides, { a: null, b: "blue" });
  assert.deepEqual(merged.before.featureOverrides, { a: "old", b: "blue" });
  next.meta.quickFillGesture.leadingClickTimeStamp = 200;
  assert.equal(coalesceQuickFillGesture(previous, next), null);
});

test("actual history manager performs one undo and one redo for the complete batch", async (t) => {
  const { state } = await import("../js/core/state.js");
  const { clearHistory, pushHistoryEntry, undoHistory, redoHistory, captureHistoryState } = await import("../js/core/history_manager.js");
  const oldDocument = globalThis.document;
  const beforeTest = captureHistoryState({ featureIds: ["a", "b"] });
  globalThis.document = { getElementById: () => null };
  t.after(() => {
    clearHistory();
    pushHistoryEntry({ before: beforeTest, after: captureHistoryState({ featureIds: ["a", "b"] }) });
    undoHistory(); clearHistory();
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  });
  clearHistory();
  const [first, batch] = entries();
  pushHistoryEntry(first);
  pushHistoryEntry(batch);
  assert.equal(state.historyPast.length, 1);
  assert.equal(undoHistory(), true);
  assert.deepEqual(captureHistoryState({ featureIds: ["a", "b"] }), {
    visualOverrides: { a: null, b: "blue" }, featureOverrides: { a: "old", b: "blue" },
  });
  assert.equal(state.historyPast.length, 0);
  assert.equal(redoHistory(), true);
  assert.deepEqual(captureHistoryState({ featureIds: ["a", "b"] }), batch.after);
});

import test from "node:test";
import assert from "node:assert/strict";
import { restoreHistoryStacksState } from "../js/core/state/actions/history_actions.js";
import { restoreDirtyMetadataState } from "../js/core/state/actions/ui_dirty_actions.js";

test("stack rollback retains entries and publishes exactly the captured stacks", () => {
  const entry = { before: { legendLabels: { "#112233": "Old" } } };
  const past = [entry], future = [];
  past.slice = () => { throw new Error("custom copy method must not run"); };
  const untouched = Object.freeze({ sovereignty: true });
  const target = { historyPast: [], historyFuture: [], untouched };
  restoreHistoryStacksState(target, past, future);
  assert.equal(target.historyPast, past);
  assert.equal(target.historyFuture, future);
  assert.equal(target.historyPast[0], entry);
  assert.equal(target.untouched, untouched);
  entry.before.legendLabels["#112233"] = "Still borrowed";
  assert.equal(target.historyPast[0].before.legendLabels["#112233"], "Still borrowed");
});

test("malformed stacks reject before either existing stack changes", () => {
  for (const [past, future] of [[null, []], [[], {}], ["bad", []]]) {
    const originalPast = [], originalFuture = [];
    const target = { historyPast: originalPast, historyFuture: originalFuture };
    assert.throws(() => restoreHistoryStacksState(target, past, future), TypeError);
    assert.equal(target.historyPast, originalPast);
    assert.equal(target.historyFuture, originalFuture);
  }
  for (const target of [null, [], "bad"]) {
    assert.throws(() => restoreHistoryStacksState(target, [], []), TypeError);
  }
});

test("dirty metadata restoration keeps the captured revision without a new edit", () => {
  const target = { isDirty: true, dirtyRevision: 7, lastDirtyReason: "new", historyPast: [] };
  const past = target.historyPast;
  restoreDirtyMetadataState(target, { isDirty: false, dirtyRevision: 3, lastDirtyReason: "captured" });
  assert.deepEqual(target, { isDirty: false, dirtyRevision: 3, lastDirtyReason: "captured", historyPast: past });
  assert.equal(target.historyPast, past);
  assert.throws(() => restoreDirtyMetadataState(null, {}), TypeError);
  assert.throws(() => restoreDirtyMetadataState(target, null), TypeError);
});

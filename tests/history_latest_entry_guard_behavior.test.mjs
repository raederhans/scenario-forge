import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import {
  captureHistoryState, clearHistory, getLatestHistoryEntry, pushHistoryEntry, undoHistory,
} from "../js/core/history_manager.js";

// 清空地图 / 重置颜色的提示按钮只能撤销它自己那一次操作：入栈后记下栈顶，点击时比对。
function paint(featureId, color) {
  const capture = { featureIds: [featureId] };
  const before = captureHistoryState(capture);
  state.visualOverrides[featureId] = color;
  assert.equal(pushHistoryEntry({ before, after: captureHistoryState(capture) }), true);
  return getLatestHistoryEntry();
}

function mount(t) {
  const keys = ["visualOverrides", "historyPast", "historyFuture", "isDirty", "dirtyRevision"];
  const saved = Object.fromEntries(keys.map((key) => [key, state[key]]));
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { getElementById: () => null };
  state.visualOverrides = {};
  clearHistory();
  t.after(() => {
    Object.assign(state, saved);
    if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
    else delete globalThis.document;
  });
}

test("latest history entry identifies the operation a toast offers to undo", (t) => {
  mount(t);
  assert.equal(getLatestHistoryEntry(), null);
  const cleared = paint("A", "#111111");
  assert.equal(getLatestHistoryEntry(), cleared);

  // 之后又有新编辑：旧提示记录的条目不再是栈顶，守卫拒绝撤销，新编辑保持不变。
  const newer = paint("B", "#222222");
  assert.notEqual(getLatestHistoryEntry(), cleared);
  assert.equal(getLatestHistoryEntry(), newer);
  assert.equal(state.visualOverrides.B, "#222222");

  // 新编辑被撤销后，原条目重新回到栈顶，此时才可以撤销它。
  assert.equal(undoHistory(), true);
  assert.equal(getLatestHistoryEntry(), cleared);
  assert.equal(state.visualOverrides.B, undefined);
});

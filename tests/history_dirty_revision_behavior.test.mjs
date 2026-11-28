import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { bindBeforeUnload, clearDirty, markDirty } from "../js/core/dirty_state.js";
import {
  captureHistoryState, clearHistory, pushHistoryEntry, redoHistory, undoHistory,
} from "../js/core/history_manager.js";

function mount(t) {
  const keys = [
    "visualOverrides", "historyPast", "historyFuture", "isDirty", "dirtyRevision", "lastDirtyReason",
  ];
  const saved = Object.fromEntries(keys.map(key => [key, state[key]]));
  const globals = new Map(["addEventListener", "removeEventListener"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map();
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.removeEventListener = type => listeners.delete(type);
  Object.assign(state, {
    visualOverrides: {}, isDirty: false, dirtyRevision: 12,
  });
  clearHistory();
  bindBeforeUnload();
  t.after(() => {
    Object.assign(state, saved);
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    protectedFromLeaving() {
      let prevented = false;
      const event = { preventDefault() { prevented = true; } };
      listeners.get("beforeunload")?.(event);
      return prevented;
    },
  };
}

test("saved land paint becomes dirty and protected after undo or redo", t => {
  const environment = mount(t);
  const read = () => state.visualOverrides["land-1"];
  const original = read();
  const capture = { featureIds: ["land-1"] };
  const before = captureHistoryState(capture);
  state.visualOverrides["land-1"] = "#abcdef";
  markDirty("edit");
  const after = captureHistoryState(capture);
  assert.equal(pushHistoryEntry({ before, after }), true);
  clearDirty("project-export");
  assert.equal(environment.protectedFromLeaving(), false);
  const savedRevision = state.dirtyRevision;

  assert.equal(undoHistory(), true);
  assert.equal(read(), original);
  assert.equal(state.isDirty, true);
  assert.equal(state.dirtyRevision, savedRevision + 1);
  assert.equal(environment.protectedFromLeaving(), true);

  clearDirty("project-export");
  assert.equal(state.isDirty, false);
  assert.equal(environment.protectedFromLeaving(), false);
  assert.equal(redoHistory(), true);
  assert.equal(read(), "#abcdef");
  assert.equal(state.isDirty, true);
  assert.equal(state.dirtyRevision, savedRevision + 2);
  assert.equal(environment.protectedFromLeaving(), true);
});

test("empty history and an unchanged entry leave a saved project clean", t => {
  mount(t);
  const revision = state.dirtyRevision;
  assert.equal(undoHistory(), false);
  assert.equal(redoHistory(), false);
  assert.equal(pushHistoryEntry({ before: { visualOverrides: {} }, after: { visualOverrides: {} } }), false);
  assert.equal(state.isDirty, false);
  assert.equal(state.dirtyRevision, revision);
});

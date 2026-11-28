import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import { FileManager } from "../js/core/file_manager.js";
import { markDirty } from "../js/core/dirty_state.js";

function mount(t, write = async () => {}) {
  const keys = ["visualOverrides", "isDirty", "dirtyRevision", "lastDirtyReason"];
  const saved = Object.fromEntries(keys.map(key => [key, state[key]]));
  const globals = new Map(["document", "showSaveFilePicker"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let savedPayload;
  globalThis.document = { getElementById: () => null };
  globalThis.showSaveFilePicker = async () => ({
    createWritable: async () => ({
      async write(blob) {
        savedPayload = JSON.parse(await blob.text());
        await write();
      },
      async close() {},
    }),
  });
  Object.assign(state, { visualOverrides: { land: "#123456" }, isDirty: true, dirtyRevision: 7 });
  t.after(() => {
    Object.assign(state, saved);
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { savedPayload: () => savedPayload };
}

test("edits made while the captured project is being written remain unsaved", async t => {
  let beginWrite;
  const writing = new Promise(resolve => { beginWrite = resolve; });
  let finishWrite;
  const released = new Promise(resolve => { finishWrite = resolve; });
  const fixture = mount(t, async () => { beginWrite(); await released; });
  const saving = FileManager.exportProject(state);
  await writing;
  state.visualOverrides.land = "#abcdef";
  markDirty("paint-during-save");
  finishWrite();

  assert.equal(await saving, true);
  assert.equal(fixture.savedPayload().visualOverrides.land, "#123456");
  assert.equal(state.visualOverrides.land, "#abcdef");
  assert.equal(state.isDirty, true);
  assert.equal(state.dirtyRevision, 8);
  assert.equal(state.lastDirtyReason, "paint-during-save");
});

test("a failed file write retains the runtime dirty state and revision", async t => {
  mount(t, async () => { throw new Error("disk full"); });
  await assert.rejects(FileManager.exportProject(state), error => error.cause?.message === "disk full");
  assert.equal(state.isDirty, true);
  assert.equal(state.dirtyRevision, 7);
});

test("exporting a detached project snapshot cannot clear the active project's dirty state", async t => {
  const fixture = mount(t);
  const snapshot = { styleConfig: {}, visualOverrides: { detached: "#fedcba" } };
  assert.equal(await FileManager.exportProject(snapshot), true);
  assert.equal(fixture.savedPayload().visualOverrides.detached, "#fedcba");
  assert.equal(state.isDirty, true);
  assert.equal(state.dirtyRevision, 7);
});

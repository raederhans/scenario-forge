import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { startAutosave } from "../js/core/autosave_manager.js";
import { clearDirty, markDirty } from "../js/core/dirty_state.js";
import { buildDefaultFileStem } from "../js/core/file_name_policy.js";
import { state } from "../js/core/state.js";

function workspace(t, activeScenarioId) {
  const records = new Map();
  const storage = {
    list: () => [...records.values()],
    put: record => records.set(record.scenarioId, record),
    remove: id => records.delete(id),
    edit: visit => visit([...records.values()], { put: storage.put, delete: storage.remove }),
  };
  Object.assign(state, { activeScenarioId, projectFileStem: "", projectName: "", isDirty: false });
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2026, 10, 21) });
  let manager;
  function start(options) {
    manager?.dispose();
    manager = startAutosave({ storage, page: new EventTarget(), ...options });
    return manager;
  }
  t.after(() => manager?.dispose());
  async function edit(color) {
    state.customPresets = { color };
    markDirty("palette");
    t.mock.timers.tick(30_000);
    await nextTurn();
  }
  return { records, start, edit };
}

test("later edits and export preserve the three newest deferred versions for recovery", async t => {
  const { records, start, edit } = workspace(t, "tno_1962");
  start();
  for (const color of ["red", "blue", "green", "black"]) {
    await edit(color);
    await start({ dialog: () => false }).recover();
  }
  await edit("white");
  const colors = await Promise.all([...records.values()].map(async record =>
    JSON.parse(await record.payload.text()).customPresets.color));
  assert.deepEqual(colors.sort(), ["black", "blue", "green", "white"]);
  clearDirty("project-export");
  await nextTurn();
  const importProject = t.mock.fn(() => ({ status: "committed" }));
  await start({ dialog: () => true, importProject }).recover();
  assert.equal(importProject.mock.calls[0].arguments[1].projectPayload.customPresets.color, "black");
});

test("restoring an autosave preserves the original default export name", async t => {
  const { start, edit } = workspace(t, "");
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  t.after(() => { globalThis.document = oldDocument; });
  start();
  state.projectFileStem = "germany.v2";
  await edit("red");
  state.projectFileStem = "";
  clearDirty("project-import");
  await start({ dialog: () => true }).recover();
  assert.equal(state.isDirty, true);
  assert.equal(buildDefaultFileStem(state, new Date(2026, 10, 21, 10, 30)), "germany.v2_20261121-1030");
});

import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { startAutosave } from "../js/core/autosave_manager.js";
import { clearDirty, markDirty } from "../js/core/dirty_state.js";
import { state } from "../js/core/state.js";

const NOW = Date.UTC(2026, 10, 20);

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  Object.assign(state, {
    activeScenarioId: "1936", activeScenarioManifest: { display_name: "Europe" },
    currentLanguage: "zh", customPresets: {}, isDirty: false,
  });
  const page = new EventTarget();
  const records = new Map();
  const storage = {
    put: t.mock.fn(record => records.set(record.scenarioId, record)),
    remove: id => records.delete(id),
    edit: visit => visit([...records.values()], { put: storage.put, delete: storage.remove }),
  };
  const manager = startAutosave({ storage, page, ...options });
  t.after(manager.dispose);
  return { records, storage, manager, page };
}

test("edits restart the 30-second delay and persist the last project payload once", async t => {
  const { records, storage } = setup(t);
  markDirty("paint");
  t.mock.timers.tick(29_999);
  state.customPresets = { final: "#224466" };
  markDirty("palette");
  t.mock.timers.tick(29_999);
  await nextTurn();
  assert.equal(records.size, 0);
  t.mock.timers.tick(1);
  await nextTurn();
  const record = records.get("1936");
  assert.equal(record.scenarioName, "Europe");
  assert.equal(record.savedAt, NOW + 59_999);
  const payload = JSON.parse(await record.payload.text());
  assert.equal(payload.scenario.id, "1936");
  assert.deepEqual(payload.customPresets, state.customPresets);
  assert.equal(storage.put.mock.callCount(), 1);
});

test("project export removes its snapshot after an outstanding write completes", async t => {
  const { records, storage } = setup(t);
  records.set("other", {});
  let completeWrite;
  storage.put.mock.mockImplementation(record => new Promise(resolve => {
    completeWrite = () => { records.set(record.scenarioId, record); resolve(); };
  }));
  markDirty("paint");
  t.mock.timers.tick(30_000);
  await nextTurn();
  clearDirty("project-export");
  completeWrite();
  await nextTurn();
  assert.deepEqual([...records.keys()], ["other"]);
});

function snapshot(scenarioId, age) {
  return {
    scenarioId, scenarioName: "欧洲", savedAt: NOW - age,
    payload: new Blob([JSON.stringify({ scenario: { id: scenarioId } })]),
  };
}

test("recovery defers the previous TNO autosave before the first edit to a shared project is saved", async t => {
  const { records, manager } = setup(t, { dialog: () => false });
  state.activeScenarioId = "tno_1962";
  const previous = snapshot("tno_1962", 60_000);
  records.set("tno_1962", previous);
  clearDirty("project-import");
  await manager.recover();
  const deferred = records.get(`tno_1962@${previous.savedAt}`);
  assert.equal(records.has("tno_1962"), false);
  assert.equal(deferred.type, "deferred");
  markDirty("shared-project-edit");
  t.mock.timers.tick(30_000);
  await nextTurn();
  assert.equal(records.get("tno_1962").type, "auto");
  assert.equal(records.get(deferred.scenarioId).payload, previous.payload);
});

test("oversized UTF-8 payload leaves the previous snapshot intact", async t => {
  const { records, storage } = setup(t);
  const previous = snapshot("1936", 10_000);
  records.set("1936", previous);
  state.customPresets = { large: "图".repeat(Math.ceil(64 * 1024 * 1024 / 3)) };
  markDirty("palette");
  t.mock.timers.tick(30_000);
  await nextTurn();
  assert.equal(storage.put.mock.callCount(), 0);
  assert.equal(records.get("1936"), previous);
});

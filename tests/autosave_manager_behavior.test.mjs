import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { startAutosave } from "../js/core/autosave_manager.js";
import { clearDirty, markDirty } from "../js/core/dirty_state.js";
import { state } from "../js/core/state.js";

const NOW = Date.UTC(2026, 10, 20);
const WEEK = 7 * 24 * 60 * 60 * 1000;

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  Object.assign(state, {
    activeScenarioId: "1936", activeScenarioManifest: { display_name: "Europe" },
    currentLanguage: "zh", customPresets: {}, isDirty: false,
  });
  const page = new EventTarget();
  const records = new Map();
  const storage = {
    list: () => [...records.values()],
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

test("hidden writes immediately and cancels queued idle work", async t => {
  const timers = {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: id => clearTimeout(id),
    requestIdleCallback: t.mock.fn(fn => setTimeout(fn, 100)),
    cancelIdleCallback: id => clearTimeout(id),
  };
  const { page, storage } = setup(t, { timers });
  markDirty("paint");
  t.mock.timers.tick(30_000);
  await nextTurn();
  assert.equal(timers.requestIdleCallback.mock.callCount(), 1);
  assert.equal(storage.put.mock.callCount(), 0);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  await nextTurn();
  assert.equal(storage.put.mock.callCount(), 1);
  t.mock.timers.tick(100);
  await nextTurn();
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

test("new edits replace the scenario snapshot and a non-export clear retains it", async t => {
  const { records, storage } = setup(t);
  markDirty("paint");
  t.mock.timers.tick(30_000);
  await nextTurn();
  state.customPresets = { revised: "#665544" };
  markDirty("palette");
  t.mock.timers.tick(30_000);
  await nextTurn();
  clearDirty("project-import");
  await nextTurn();
  assert.equal(storage.put.mock.callCount(), 2);
  assert.equal(records.size, 1);
  assert.deepEqual(JSON.parse(await records.get("1936").payload.text()).customPresets, state.customPresets);
});

function snapshot(scenarioId, age) {
  return {
    scenarioId, scenarioName: "欧洲", savedAt: NOW - age,
    payload: new Blob([JSON.stringify({ scenario: { id: scenarioId } })]),
  };
}

test("startup offers the newest snapshot, imports the chosen payload and keeps it dirty", async t => {
  const dialog = t.mock.fn(() => true);
  const importProject = t.mock.fn(() => ({ status: "committed" }));
  const { records, manager } = setup(t, { dialog, importProject });
  records.set("older", snapshot("older", WEEK));
  records.set("1936", snapshot("1936", 120_000));
  await manager.recover();
  const [{ message, confirmLabel, cancelLabel }] = dialog.mock.calls[0].arguments;
  assert.equal(message, "发现 2 分钟前未保存的工作（欧洲）。");
  assert.deepEqual([confirmLabel, cancelLabel], ["恢复", "暂不恢复"]);
  assert.equal(dialog.mock.callCount(), 1);
  assert.deepEqual(importProject.mock.calls[0].arguments[1].projectPayload, { scenario: { id: "1936" } });
  assert.equal(state.isDirty, true);
  assert.equal(records.size, 2);
});

test("dismissing recovery preserves fresh snapshots and defers the prompt until the next startup", async t => {
  const dialog = t.mock.fn(() => false);
  const importProject = t.mock.fn();
  const { records, manager, storage, page } = setup(t, { dialog, importProject });
  records.set("expired", snapshot("expired", WEEK + 1));
  records.set("valid", snapshot("valid", WEEK));
  records.set("latest", snapshot("latest", 60_000));
  await manager.recover();
  await manager.recover();
  assert.equal(dialog.mock.callCount(), 1);
  assert.equal(importProject.mock.callCount(), 0);
  assert.deepEqual([...records.keys()], ["valid", `latest@${NOW - 60_000}`]);

  manager.dispose();
  const nextSession = startAutosave({ storage, page, dialog, importProject });
  t.after(nextSession.dispose);
  await nextSession.recover();
  assert.equal(dialog.mock.callCount(), 2);
});

test("storage failures during startup, autosave and export cleanup stay local", async t => {
  const fail = t.mock.fn(() => { throw Error("storage unavailable"); });
  const { manager } = setup(t, { storage: { list: fail, put: fail, remove: fail } });
  await manager.recover();
  markDirty("paint");
  t.mock.timers.tick(30_000);
  await nextTurn();
  assert.equal(state.isDirty, true);
  clearDirty("project-export");
  await nextTurn();
  assert.equal(fail.mock.callCount(), 3);
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

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

test("startup opens history and restores only the selected version after discard confirmation", async t => {
  const dialog = t.mock.fn(() => true);
  const importProject = t.mock.fn(() => ({ status: "committed" }));
  const { records, manager } = setup(t, { dialog, importProject });
  records.set("older", snapshot("older", WEEK));
  records.set("1936", snapshot("1936", 120_000));
  const openHistory = t.mock.fn();
  await manager.recover(openHistory);
  const [{ message, confirmLabel, cancelLabel }] = dialog.mock.calls[0].arguments;
  assert.equal(message, "发现 2 份未保存的工作。");
  assert.deepEqual([confirmLabel, cancelLabel], ["本地历史", "暂不恢复"]);
  assert.equal(dialog.mock.callCount(), 1);
  assert.equal(openHistory.mock.callCount(), 1);
  const history = await manager.listHistory();
  assert.deepEqual(history.map(record => record.scenarioId), [`1936@${NOW - 120_000}`, `older@${NOW - WEEK}`]);
  markDirty("paint");
  dialog.mock.mockImplementationOnce(() => false);
  await manager.restoreSnapshot(history[1]);
  assert.equal(importProject.mock.callCount(), 0);
  await manager.restoreSnapshot(history[1]);
  assert.deepEqual(importProject.mock.calls[0].arguments[1].projectPayload, { scenario: { id: "older" } });
  assert.equal(state.isDirty, true);
  assert.equal(records.size, 2);
});

test("dismissing recovery keeps every offered project in history without prompting next startup", async t => {
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
  assert.deepEqual([...records.keys()], [`latest@${NOW - 60_000}`, `valid@${NOW - WEEK}`]);

  manager.dispose();
  const nextSession = startAutosave({ storage, page, dialog, importProject });
  t.after(nextSession.dispose);
  await nextSession.recover();
  assert.equal(dialog.mock.callCount(), 1);
});

test("storage failures during startup, autosave and export cleanup stay local", async t => {
  const fail = t.mock.fn(() => { throw Error("storage unavailable"); });
  const { manager } = setup(t, { storage: { edit: fail, put: fail, remove: fail } });
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

test("manual snapshots keep the latest twenty versions across projects, never expire and can be deleted", async t => {
  const dialog = t.mock.fn();
  const { records, manager } = setup(t, { dialog });
  records.set("legacy@1", { ...snapshot("legacy@1", 10), deferred: true,
    payload: new Blob([JSON.stringify({ projectName: "Legacy project" })]) });
  const [legacy] = await manager.listHistory();
  assert.equal(legacy.type, "deferred");
  assert.equal(legacy.projectName, "Legacy project");
  for (let i = 0; i < 21; i++) {
    state.activeScenarioId = i % 2 ? "older" : "1936";
    state.projectName = `Project ${i}`;
    await manager.saveSnapshot(`Version ${i}`);
    t.mock.timers.tick(1);
  }
  assert.equal(records.size, 21);
  t.mock.timers.tick(WEEK + 1);
  await manager.recover();
  assert.equal(dialog.mock.callCount(), 0);
  const versions = await manager.listHistory();
  assert.equal(versions.length, 20);
  assert.deepEqual(versions.map(record => record.note),
    Array.from({ length: 20 }, (_, i) => `Version ${20 - i}`));
  const chosen = versions[4];
  assert.equal(chosen.projectName, "Project 16");
  assert.equal(JSON.parse(await chosen.payload.text()).projectName, "Project 16");
  await manager.deleteSnapshot(chosen);
  assert.equal(records.size, 19);
  assert.equal(records.has(chosen.scenarioId), false);
});

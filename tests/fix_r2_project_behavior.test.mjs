import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { startAutosave } from "../js/core/autosave_manager.js";
import { FileManager } from "../js/core/file_manager.js";
import { state } from "../js/core/state.js";
import { initScenarioControls } from "../js/ui/scenario_controls.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

function fileHandle(name) {
  const writes = [];
  return { name, writes, createWritable: async () => ({
    write: async blob => writes.push(JSON.parse(await blob.text())), close: async () => {},
  }) };
}

test("saving after applying another scenario picks a new file and preserves the opened project", async t => {
  const { doc, add } = harness(t);
  const select = add("select", doc.body, "scenarioSelect");
  const apply = add("button", doc.body, "applyScenarioBtn");
  const original = fileHandle("original.json");
  Object.assign(state, {
    activeScenarioId: "old", scenarioRegistry: { scenarios: [{ scenario_id: "new" }] },
    bootBlocking: false, isDirty: false, projectFileBinding: { handle: original }, projectFileStem: "original",
  });
  t.after(initScenarioControls({ applyScenario(id) { state.activeScenarioId = id; } }));
  await nextTurn();
  select.value = "new";
  select.fire("change");
  apply.click();
  await nextTurn();
  const replacement = fileHandle("replacement.json");
  let suggestedName;
  globalThis.showSaveFilePicker = async options => { suggestedName = options.suggestedName; return replacement; };
  t.after(() => { delete globalThis.showSaveFilePicker; });
  await FileManager.exportProject(state);
  assert.equal(original.writes.length, 0);
  assert.match(suggestedName, /^new_/);
  assert.equal(replacement.writes[0].scenario.id, "new");
});

test("an unavailable bound handle falls back to Save As once and binds the replacement", async t => {
  const old = { name: "old.json", createWritable: async () => { throw new DOMException("Denied", "NotAllowedError"); } };
  const project = { styleConfig: {}, projectFileBinding: { handle: old } };
  const replacement = fileHandle("replacement.json");
  const picker = t.mock.fn(async () => replacement);
  globalThis.showSaveFilePicker = picker;
  t.after(() => { delete globalThis.showSaveFilePicker; });
  assert.equal(await FileManager.exportProject(project), true);
  assert.equal(await FileManager.exportProject(project), true);
  assert.equal(picker.mock.callCount(), 1);
  assert.equal(replacement.writes.length, 2);
  assert.equal(project.projectFileBinding.handle, replacement);

  project.projectFileBinding = { handle: old };
  picker.mock.mockImplementationOnce(() => { throw new DOMException("Cancelled", "AbortError"); });
  assert.equal(await FileManager.exportProject(project), false);
  assert.equal(project.projectFileBinding.handle, null);
});

test("opening local history preserves the offered payload across another autosave", async t => {
  const page = new EventTarget();
  const savedAt = Date.now() - 1000;
  const record = { scenarioId: "X", type: "auto", savedAt, payload: new Blob(['{"projectName":"Original"}']) };
  const records = new Map([["X", record]]);
  const storage = {
    put: item => records.set(item.scenarioId, item),
    edit: visit => visit([...records.values()], { put: storage.put, delete: id => records.delete(id) }),
  };
  Object.assign(state, { activeScenarioId: "X", isDirty: false, projectName: "Edited" });
  const manager = startAutosave({ page, storage, dialog: () => true });
  t.after(manager.dispose);
  const openHistory = t.mock.fn(async () => {
    state.isDirty = true;
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
  });
  await manager.recover(openHistory);
  assert.equal(openHistory.mock.callCount(), 1);
  const history = await manager.listHistory();
  assert.deepEqual(history.map(item => [item.type, item.projectName]), [
    ["auto", "Edited"], ["deferred", "Original"],
  ]);
});

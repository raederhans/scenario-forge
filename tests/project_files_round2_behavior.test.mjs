import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";

import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { importProjectTextThroughFunnel } from "../js/core/interaction_funnel.js";

test("save writes back to the chosen file until a copy replaces it", async t => {
  const writes = [];
  const handle = name => ({ name, createWritable: async () => ({
    write: async blob => writes.push([name, blob.type]),
    close: async () => {},
  }) });
  const handles = [handle("current.json"), handle("copy.zip")];
  globalThis.showSaveFilePicker = async () => handles.shift();
  t.after(() => { delete globalThis.showSaveFilePicker; });
  const project = { styleConfig: {} };
  await FileManager.exportProject(project);
  await FileManager.exportProject(project, { format: "zip" });
  await FileManager.exportProject(project, { format: "zip", saveAs: true });
  await FileManager.exportProject(project);
  assert.deepEqual(writes, [
    ["current.json", "application/json"], ["current.json", "application/json"],
    ["copy.zip", "application/zip"], ["copy.zip", "application/zip"],
  ]);
});

test("import restores the saved geographic view and leaves a legacy opening view alone", async t => {
  const previousDocument = globalThis.document;
  const { lastDirtyReason, isDirty, projectFileBinding, projectFileStem } = state;
  globalThis.document = { getElementById: () => null };
  const view = { center: [121.2, 23.7], k: 4.5 };
  const restored = [];
  registerRuntimeHook(state, "captureProjectViewFn", () => view);
  registerRuntimeHook(state, "restoreProjectViewFn", snapshot => { restored.push(snapshot); });
  t.after(() => {
    registerRuntimeHook(state, "captureProjectViewFn", null);
    registerRuntimeHook(state, "restoreProjectViewFn", null);
    Object.assign(state, { lastDirtyReason, isDirty, projectFileBinding, projectFileStem });
    if (previousDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  });
  const payload = FileManager.buildProjectPayload(state);
  assert.deepEqual(payload.viewState, view);
  const handle = { name: "opened.json" };
  for (const [saved, fileHandle] of [[payload, handle], [{ schemaVersion: payload.schemaVersion }, null]]) {
    const result = await importProjectTextThroughFunnel(JSON.stringify(saved), { fileHandle, fileName: fileHandle?.name });
    assert.equal(result.status, "committed");
    await result.completion;
    assert.equal(state.projectFileBinding.handle, fileHandle);
  }
  assert.deepEqual(restored, [view]);
});

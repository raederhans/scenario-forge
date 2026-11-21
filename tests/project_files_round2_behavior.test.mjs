import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";
import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { importProjectTextThroughFunnel } from "../js/core/interaction_funnel.js";
import { buildDefaultFileStem } from "../js/core/file_name_policy.js";
import { updateRecentProjects } from "../js/core/recent_projects.js";
import { importResourceLabel, notifyUnmatchedRegions } from "../js/core/interaction_funnel/import_recovery_ui.js";
import { prepareProjectImportFile } from "../js/core/project_package_io.js";
import { UI_COPY_CATALOG } from "../js/core/i18n_catalog.js";

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
  assert.equal(project.projectFileStem, "copy");
  assert.equal(buildDefaultFileStem({ projectFileStem: "Atlas_20261010-1200_20261120-1400" },
    new Date(2026, 10, 21, 16, 0)), "Atlas_20261121-1600");
});

test("recent projects keep eight distinct file handles even with identical names", async () => {
  let projects = [];
  const entry = id => ({ handle: { id, name: "map.json", isSameEntry: async other => other.id === id }, name: "Map" });
  for (let id = 0; id < 10; id++) projects = await updateRecentProjects(projects, entry(id));
  projects = await updateRecentProjects(projects, entry(4));
  assert.deepEqual(projects.map(project => project.handle.id), [4, 9, 8, 7, 6, 5, 3, 2]);
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

test("damaged ZIPs and recovery resource labels have Chinese user-facing messages", async () => {
  const zip = Object.assign(new Blob(["broken"]), { name: "bad.zip" });
  await assert.rejects(prepareProjectImportFile(zip), error =>
    UI_COPY_CATALOG[error.userMessage]?.zh.includes("重新导出"));
  assert.equal(importResourceLabel("transport-overview", key => UI_COPY_CATALOG[key].zh), "交通概览");
});

test("migration warning opens the discarded IDs and original colors for review", () => {
  const unmatchedRegions = [{ featureId: "old-509", color: "#abcdef" }];
  const toasts = [];
  let details;
  const ui = { t: key => UI_COPY_CATALOG[key].zh, showToast: (...args) => toasts.push(args) };
  const showDetails = regions => { details = regions; };
  notifyUnmatchedRegions({ migratedEntries: 3 }, ui, showDetails);
  notifyUnmatchedRegions({ migratedEntries: 3, unmatchedRegions }, ui, showDetails);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][0], "已迁移 3 处记录，1 个地块无法对应。");
  toasts[0][1].onAction();
  assert.deepEqual(details, unmatchedRegions);
});

test("opening from the panel passes the picked handle and Save As forces the picker", async t => {
  const button = () => ({ dataset: {}, addEventListener(type, listener) { this[type] = listener; } });
  const nodes = { uploadProjectBtn: button(), projectFileInput: button(), projectSaveAsBtn: button(),
    projectDownloadDestination: { value: "browser" } };
  const documentRef = { getElementById: id => nodes[id], querySelectorAll: () => [] };
  const local = {};
  const handle = { getFile: async () => ({ name: "Atlas.json" }) };
  globalThis.showOpenFilePicker = async () => [handle];
  t.after(() => { delete globalThis.showOpenFilePicker; });
  let imported, saved;
  createProjectSupportDiagnosticsController({ state: local, documentRef, helpers: {
    t: key => key, mapRenderer: {},
    importProjectThroughFunnel: async (file, options) => { imported = { file, options }; },
    fileManager: { exportProject: async (_, options) => { saved = options; return true; } },
  } }).bindEvents();
  await nodes.uploadProjectBtn.click();
  assert.equal(imported.file.name, "Atlas.json");
  assert.equal(imported.options.fileHandle, handle);
  assert.equal(await local.runProjectSaveAsFn(), true);
  assert.equal(saved.destination, "picker");
  assert.equal(saved.saveAs, true);
});

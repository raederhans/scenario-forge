import assert from "node:assert/strict";
import test from "node:test";
import { callRuntimeHook, registerRuntimeHook } from "../js/core/state/index.js";
import { bindProjectFileDrop } from "../js/ui/project_file_drop.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";

test("map shows a project drop hint and imports the dropped file once", () => {
  const map = Object.assign(new EventTarget(), { dataset: {}, contains: node => node === map });
  const state = {};
  const imports = [];
  registerRuntimeHook(state, "runProjectImportFileFn", file => imports.push(file));
  const bind = () => bindProjectFileDrop(map, state, key => key);
  bind();
  bind();
  function drag(type, dataTransfer, relatedTarget = null) {
    const event = Object.assign(new Event(type, { cancelable: true }), { dataTransfer, relatedTarget });
    map.dispatchEvent(event);
    return event.defaultPrevented;
  }

  for (const [name, type] of [["map.JSON", "application/json"], ["project.zip", "application/x-zip-compressed"]]) {
    const file = { name, type };
    const transfer = { files: [], items: [{ kind: "file", type }], types: ["Files"] };
    assert.equal(drag("dragenter", transfer), true);
    assert.equal(map.dataset.projectDropLabel, "Drop to open project");
    drag("dragleave", transfer, map);
    assert.equal(map.dataset.projectDropLabel, "Drop to open project");
    drag("dragleave", transfer);
    assert.equal(map.dataset.projectDropLabel, undefined);
    drag("dragover", transfer);
    assert.equal(map.dataset.projectDropLabel, "Drop to open project");
    transfer.files = [file];
    assert.equal(drag("drop", transfer), true);
    assert.equal(map.dataset.projectDropLabel, undefined);
    assert.equal(imports.pop(), file);
    assert.equal(imports.length, 0);
  }

  const image = { files: [], items: [{ kind: "file", type: "image/png" }], types: ["Files"] };
  drag("dragover", image);
  assert.equal(map.dataset.projectDropLabel, "Drop to use as a reference image");
  image.files.push({ name: "map.png", type: "image/png" });
  drag("drop", image);
  const row = { files: [], items: [{ kind: "string", type: "text/plain" }], types: ["text/plain"] };
  assert.equal(drag("dragover", row), false);
  assert.equal(map.dataset.projectDropLabel, undefined);
  assert.equal(drag("drop", row), false);
  assert.deepEqual(imports, []);
});

test("import hook confirms unsaved changes before reading a project ZIP", async () => {
  const calls = [];
  const state = { isDirty: true };
  createProjectSupportDiagnosticsController({
    state,
    documentRef: { getElementById: () => null },
    helpers: {
      t: key => key,
      showAppDialog: async dialog => { calls.push(dialog.title); return false; },
      importProjectThroughFunnel: () => calls.push("import"),
    },
  }).bindEvents();
  await callRuntimeHook(state, "runProjectImportFileFn", {
    name: "map.zip", arrayBuffer: () => calls.push("read ZIP"),
  });
  assert.deepEqual(calls, ["Load Project"]);
});

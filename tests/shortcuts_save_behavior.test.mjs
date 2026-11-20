import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { FileManager } from "../js/core/file_manager.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";

function bindShortcut(context, elements = {}) {
  const listeners = {};
  globalThis.Element = class {};
  globalThis.window = { addEventListener: (key, fn) => { listeners[key] = fn; } };
  globalThis.document = {
    body: { dataset: {} }, querySelectorAll: () => [],
    getElementById: id => elements[id],
  };
  state.bootBlocking = false;
  state.startupReadonly = false;
  initShortcuts();
  context.after(() => {
    registerRuntimeHook(state, "runProjectSaveFn", null);
    delete globalThis.Element;
    delete globalThis.window;
    delete globalThis.document;
  });
  return modifier => {
    const event = { key: "s", [modifier]: true, preventDefault() { this.defaultPrevented = true; } };
    const result = listeners.keydown(event);
    assert.ok(event.defaultPrevented);
    return result;
  };
}

test("Ctrl+S and Cmd+S share the pending panel save and its options", async context => {
  const press = bindShortcut(context, {
    projectDownloadFormat: { value: "zip" },
    projectDownloadDestination: { value: "browser" },
    projectPackageContents: { value: "diagnostic" },
  });
  const pending = Promise.withResolvers();
  const calls = [];
  createProjectSupportDiagnosticsController({
    state, helpers: {
      t: key => key,
      fileManager: { exportProject(_state, options) { calls.push(options); return pending.promise; } },
    },
  }).bindEvents();
  const first = press("ctrlKey");
  await press("metaKey");
  assert.deepEqual(calls, [{ format: "zip", destination: "browser", packageContents: "diagnostic" }]);
  pending.resolve(true);
  await first;
  await press("metaKey");
  assert.equal(calls.length, 2);
});

for (const path of ["hook", "fallback"]) {
  test(`save shortcut handles a rejected ${path}`, async context => {
    const press = bindShortcut(context);
    const fail = context.mock.fn(async () => { throw new Error("write failed"); });
    if (path === "hook") registerRuntimeHook(state, "runProjectSaveFn", fail);
    else context.mock.method(FileManager, "exportProject", fail);
    await assert.doesNotReject(async () => press("ctrlKey"));
    assert.equal(fail.mock.callCount(), 1);
  });
}

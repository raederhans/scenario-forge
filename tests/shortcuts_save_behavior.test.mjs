import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";

test("Ctrl+O and Cmd+O open the project panel file picker", t => {
  let selections = 0;
  const button = Object.assign(new EventTarget(), { dataset: {}, click() { this.dispatchEvent(new Event("click")); } });
  const input = Object.assign(new EventTarget(), { dataset: {}, click() { selections++; } });
  const nodes = { uploadProjectBtn: button, projectFileInput: input };
  const documentRef = {
    body: { dataset: {} }, querySelectorAll: () => [], getElementById: id => nodes[id] || null,
  };
  const windowRef = new EventTarget();
  for (const [key, value] of Object.entries({ window: windowRef, document: documentRef, Element: class {} })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const { bootBlocking, startupReadonly } = state;
  Object.assign(state, { bootBlocking: false, startupReadonly: false });
  t.after(() => Object.assign(state, { bootBlocking, startupReadonly }));
  createProjectSupportDiagnosticsController({ state, documentRef, helpers: { t: key => key } }).bindEvents();
  initShortcuts();
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "o", [modifier]: true });
    windowRef.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(selections, 2);
});

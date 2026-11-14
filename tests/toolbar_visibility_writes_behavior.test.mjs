import { Node, harness } from "./helpers/toolbar_document_fixture.mjs";
import { registerRuntimeHook, readRegisteredRuntimeHookSource } from "../js/core/state/index.js";
import { STATE_NOTIFICATION_HOOK_NAMES, STATE_HANDLER_HOOK_NAMES, STATE_INTERNAL_HANDLER_HOOK_NAMES } from "../js/core/state/config.js";
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { initToolbar } from "../js/ui/toolbar.js";
for (const initialParentVisibility of [false, undefined, null, true]) {
  test(`toolbar initialization preserves parent border visibility (${initialParentVisibility})`, async context => {
    const h = harness(context);
    const hookNames = new Set([...STATE_NOTIFICATION_HOOK_NAMES, ...STATE_HANDLER_HOOK_NAMES, ...STATE_INTERNAL_HANDLER_HOOK_NAMES]);
    const savedHooks = [...hookNames].map(name => [name, readRegisteredRuntimeHookSource(state, name)]);
    const saved = { ...Object.fromEntries(Object.entries(state).filter(([key]) => !hookNames.has(key))), ui: { ...state.ui } };
    context.after(() => {
      Object.assign(state, saved);
      for (const [name, hook] of savedHooks) registerRuntimeHook(state, name, hook);
    });
    context.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ samples: [] }) }));
    context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    context.after(async () => { await new Promise(resolve => setImmediate(resolve)); });
    h.add("div", h.doc.body, "riverCellPicker");
    h.add("select", h.doc.body, "riverCellSelect");
    h.add("button", h.doc.body, "riverCellApplyBtn");
    state.parentBordersVisible = initialParentVisibility;
    initToolbar({ render: () => {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.parentBordersVisible, initialParentVisibility !== false);
  });
}
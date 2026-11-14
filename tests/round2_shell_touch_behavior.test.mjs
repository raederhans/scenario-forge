import { Node, harness } from "./helpers/toolbar_document_fixture.mjs";
import { registerRuntimeHook, readRegisteredRuntimeHookSource } from "../js/core/state/index.js";
import { STATE_NOTIFICATION_HOOK_NAMES, STATE_HANDLER_HOOK_NAMES, STATE_INTERNAL_HANDLER_HOOK_NAMES } from "../js/core/state/config.js";
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { initToolbar } from "../js/ui/toolbar.js";
async function toolbar(context, width) {
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
  const queries = new Map();
  const matches = query => query === "(pointer: coarse)" ? false : width <= Number(query.match(/max-width: (\d+)px/)?.[1] ?? -1);
  context.mock.method(globalThis, "matchMedia", query => {
    if (!queries.has(query)) {
      const media = new Node("media", h.doc); media.matches = matches(query); queries.set(query, media);
    }
    return queries.get(query);
  });
  for (const side of ["left", "right"]) {
    h.add("button", h.doc.body, `${side}PanelToggle`);
    h.add("button", h.add("div", h.doc.body, `${side}Sidebar`));
  }
  h.add("div", h.doc.body, "sidebarDrawerBackdrop");
  h.add("div", h.doc.body, "riverCellPicker");
  h.add("select", h.doc.body, "riverCellSelect");
  h.add("button", h.doc.body, "riverCellApplyBtn");
  initToolbar();
  await new Promise(resolve => setImmediate(resolve));
  return { ...h, resize(next) {
    width = next;
    for (const [query, media] of queries) {
      const nextMatch = matches(query);
      if (media.matches !== nextMatch) { media.matches = nextMatch; media.fire("change"); }
    }
  } };
}

for (const [narrow, wide] of [[800, 1280], [1023, 1024]]) {
  for (const side of ["left", "right"]) {
    test(`${side} drawer closes across ${narrow} → ${wide} → ${narrow}`, async context => {
      const h = await toolbar(context, narrow);
      h.doc.getElementById(`${side}PanelToggle`).click();
      assert.equal(h.doc.body.classList.contains(`${side}-drawer-open`), true);
      assert.equal(h.doc.getElementById("sidebarDrawerBackdrop").classList.contains("hidden"), false);
      h.resize(wide);
      h.resize(narrow);
      for (const name of ["left", "right"]) {
        assert.equal(h.doc.body.classList.contains(`${name}-drawer-open`), false);
        assert.equal(h.doc.getElementById(`${name}PanelToggle`).getAttribute("aria-expanded"), "false");
      }
      assert.equal(h.doc.getElementById("sidebarDrawerBackdrop").classList.contains("hidden"), true);
    });
  }
}

for (const side of ["left", "right"]) {
  test(`${side} drawer stays open across 767 → 768 → 767`, async context => {
    const h = await toolbar(context, 767);
    h.doc.getElementById(`${side}PanelToggle`).click();
    for (const width of [768, 767]) {
      h.resize(width);
      assert.equal(h.doc.body.classList.contains(`${side}-drawer-open`), true);
      assert.equal(h.doc.getElementById(`${side}PanelToggle`).getAttribute("aria-expanded"), "true");
      assert.equal(h.doc.getElementById("sidebarDrawerBackdrop").classList.contains("hidden"), false);
    }
  });
}

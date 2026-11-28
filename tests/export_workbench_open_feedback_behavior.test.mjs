import assert from "node:assert/strict";
import test from "node:test";
import { createExportWorkbenchController } from "../js/ui/toolbar/export_workbench_controller.js";
import { normalizeExportWorkbenchUiState } from "../js/core/state_defaults.js";

function mount(context, overrides = {}) {
  const previous = globalThis.document;
  globalThis.document = { getElementById: () => null };
  context.after(() => { globalThis.document = previous; });
  const frames = [];
  let builds = 0;
  const status = { textContent: "" };
  const stage = { children: [], replaceChildren(...children) { this.children = children; } };
  const overlay = {
    hidden: true, attributes: new Map(),
    classList: { toggle(name, hidden) { if (name === "hidden") overlay.hidden = hidden; } },
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  const canvas = { classList: { add() {} } };
  const build = async () => { builds++; return canvas; };
  const controller = createExportWorkbenchController({
    state: {}, t: key => key, showToast() {}, showExportFailureToast() {},
    normalizeExportWorkbenchUiState, renderPassNames: [],
    exportWorkbenchOverlay: overlay, exportWorkbenchPreviewStage: stage,
    exportWorkbenchPreviewState: status,
    buildCompositeSourceCanvas: build, buildSingleExportSourceCanvas: build,
    applyExportAdjustmentsToCanvas: source => source, bakeLayer() {}, clearBakeCache() {},
    requestPreviewFrame: callback => frames.push(callback),
    ...overrides,
  });
  return { controller, overlay, status, stage, get builds() { return builds; },
    async frame() { frames.shift()(); await new Promise(setImmediate); },
  };
}

test("opening shows the shell and preparing state before preview work", async context => {
  const h = mount(context);
  h.controller.renderExportWorkbenchUi(true);
  assert.equal(h.overlay.hidden, false);
  assert.equal(h.overlay.attributes.get("aria-hidden"), "false");
  assert.equal(h.status.textContent, "Preparing preview…");
  assert.equal(h.builds, 0);
  await h.frame();
  assert.equal(h.status.textContent, "Preparing preview…");
  assert.equal(h.builds, 0);
  await h.frame();
  await h.frame();
  assert.equal(h.builds, 1);
  assert.equal(h.status.textContent, "");
  assert.equal(h.status.hidden, true);
  assert.equal(h.stage.children.length, 1);
});

test("the bake cache is available only for bake packs", context => {
  const shell = { hidden: true };
  const list = {
    children: [], closest: () => shell,
    replaceChildren() { this.children = []; },
    appendChild(item) { this.children.push(item); },
  };
  const state = {};
  const { controller } = mount(context, { state, exportWorkbenchBakeArtifactList: list });
  globalThis.document.createElement = () => ({ append() {}, appendChild() {} });
  for (const target of ["composite", "bake-pack", "per-layer"]) {
    state.exportWorkbenchUi = { target };
    controller.renderExportWorkbenchBakeArtifactList();
    assert.equal(shell.hidden, target !== "bake-pack");
    if (!shell.hidden) assert.ok(list.children.length > 0);
  }
});

test("closing before preparation prevents deferred opening and preview work", async context => {
  const h = mount(context);
  h.controller.renderExportWorkbenchUi(true);
  h.controller.renderExportWorkbenchUi(false);
  await h.frame();
  await h.frame();
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.builds, 0);
  assert.equal(h.stage.children.length, 0);
});

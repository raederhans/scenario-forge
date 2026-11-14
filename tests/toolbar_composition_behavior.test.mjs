import assert from "node:assert/strict";
import test from "node:test";
import { createExportWorkflowController } from "../js/ui/toolbar/export_workflow_controller.js";
import { registerRuntimeHook } from "../js/core/state/index.js";

class Element {
  constructor() {
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      contains: name => classes.has(name),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, callback) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
  }
  click() { for (const callback of this.listeners.get("click") || []) callback(); }
}

function mount(elements = {}, callbacks = {}) {
  const state = {};
  const document = {
    getElementById: id => elements[id] || null,
    querySelectorAll: () => [],
  };
  const controller = createExportWorkflowController({
    state, document, t: key => key, renderPassNames: [],
    closeDockPopover() {}, closeScenarioGuide() {},
    syncSupportSurfaceUrlState() {}, rememberOverlayTrigger() {},
    restoreOverlayTriggerFocus() {}, focusOverlaySurface() {},
    ...callbacks,
  });
  return { controller, state };
}

test("export workflow is usable immediately after construction", () => {
  const target = new Element();
  const { controller } = mount({ exportWorkbenchTarget: target });
  const ui = controller.ensureExportWorkbenchUiState();
  assert.equal(ui.target, "composite");
  assert.equal(controller.syncExportWorkbenchControlsFromState().target, "composite");
  assert.equal(target.value, "composite");
  controller.renderExportWorkbenchLayerList();
});

test("export entry and workbench events bind once", context => {
  const previous = globalThis.HTMLInputElement;
  globalThis.HTMLInputElement = Element;
  context.after(() => {
    if (previous === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = previous;
  });
  const workspace = new Element();
  const advanced = new Element();
  const close = new Element();
  const { controller, state } = mount({
    workspaceExportBtn: workspace,
    exportWorkbenchAdvancedBtn: advanced,
    exportWorkbenchCloseBtn: close,
  });
  let opened = 0;
  let closed = 0;
  registerRuntimeHook(state, "openExportWorkbenchFn", trigger => {
    assert.equal(trigger, workspace);
    opened++;
  });
  registerRuntimeHook(state, "closeExportWorkbenchFn", options => {
    assert.equal(options.restoreFocus, true);
    closed++;
  });
  controller.bindEntryEvents();
  controller.bindWorkbenchEvents();
  controller.bindEntryEvents();
  controller.bindWorkbenchEvents();
  workspace.click();
  close.click();
  advanced.click();
  assert.equal(opened, 1);
  assert.equal(closed, 1);
  assert.equal(advanced.getAttribute("aria-expanded"), "true");
});

test("closing export preserves focus return and its explicit opt-out", () => {
  const overlay = new Element();
  const panel = new Element();
  const workspace = new Element();
  const restored = [];
  const views = [];
  const { controller } = mount({
    exportWorkbenchOverlay: overlay,
    exportWorkbenchPanel: panel,
    workspaceExportBtn: workspace,
  }, {
    restoreOverlayTriggerFocus: (...args) => restored.push(args),
    syncSupportSurfaceUrlState: view => views.push(view),
  });
  controller.setExportWorkbenchState(false);
  assert.equal(overlay.getAttribute("aria-hidden"), "true");
  assert.deepEqual(restored, [[overlay, null, workspace]]);
  overlay.classList.toggle("hidden", false);
  controller.setExportWorkbenchState(false, { restoreFocus: false });
  assert.equal(restored.length, 1);
  assert.deepEqual(views, ["", ""]);
});

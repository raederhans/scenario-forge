import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import * as walk from "acorn-walk";
import { createWorkspaceChromeSupportSurfaceController } from "../js/ui/toolbar/workspace_chrome_support_surface_controller.js";

const toolbarSource = readFileSync(new URL("../js/ui/toolbar.js", import.meta.url), "utf8");
let refreshCallbackSource;
walk.simple(parse(toolbarSource, { ecmaVersion: "latest", sourceType: "module" }), {
  CallExpression(node) {
    if (node.callee.name !== "createWorkspaceChromeSupportSurfaceController") return;
    const callback = node.arguments[0].properties.find(property => property.key.name === "refreshPaintModeUi").value;
    refreshCallbackSource = toolbarSource.slice(callback.start, callback.end);
  },
});
const createRefreshCallback = new Function("runtimeState", `return (${refreshCallbackSource});`);

class Button {
  constructor(id = "") {
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const active = force ?? !this.classes.has(name);
        if (active) this.classes.add(name); else this.classes.delete(name);
        return active;
      },
    };
  }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  replaceChildren(...children) { this.children = children; for (const child of children) child.parent = this; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }
  dispatch(name, event = {}) { for (const handler of this.listeners.get(name) || []) handler(event); }
  click() {
    if (this.disabled) return;
    this.focus();
    this.dispatch("click", { target: this });
  }
  closest(selector) {
    return selector.split(",").some(value => value.trim() === "#" + this.id) ? this : this.parent?.closest(selector) || null;
  }
  focus() { document.activeElement = this; }
}

function createHarness(context, initial = {}) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  const doc = new Button("document");
  doc.createElement = tagName => { const element = new Button(); element.tagName = String(tagName).toUpperCase(); element.ownerDocument = doc; return element; };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  Object.defineProperty(globalThis, "Element", { value: Button, configurable: true });
  context.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else delete globalThis.document;
    if (oldElement) Object.defineProperty(globalThis, "Element", oldElement); else delete globalThis.Element;
  });
  const nodes = Object.fromEntries([
    "dockQuickFillBtn", "dockQuickFillRow", "quickFillParentBtn", "quickFillCountryBtn", "dockQuickFillHint",
    "dockReferenceBtn", "dockReferencePopover", "dockEditPopoverBtn", "dockEditPopover",
  ].map(id => [id, new Button(id)]));
  for (const node of Object.values(nodes)) node.ownerDocument = doc;
  nodes.quickFillParentBtn.parent = nodes.dockQuickFillRow;
  nodes.quickFillCountryBtn.parent = nodes.dockQuickFillRow;
  const state = { activeDockPopover: "", batchFillScope: "parent", paintMode: "visual", interactionGranularity: "subdivision", ...initial };
  const calls = [];
  const controller = createWorkspaceChromeSupportSurfaceController({
    state, ...nodes, t: (text, group) => { assert.equal(group, "ui"); return text; },
    refreshPaintModeUi: createRefreshCallback(state),
    rememberOverlayTrigger: (surface, trigger) => calls.push(["remember", surface, trigger]),
    focusOverlaySurface: surface => surface.focus(),
    restoreOverlayTriggerFocus: (surface, trigger) => { calls.push(["restore", surface, trigger]); trigger?.focus(); },
    closeExportWorkbench: () => calls.push(["closeExport"]),
    syncSupportSurfaceUrlState: view => calls.push(["url", view]),
  });
  let refreshCount = 0;
  state.updatePaintModeUIFn = function () {
    assert.equal(this, state);
    refreshCount++;
    controller.refreshQuickFillControls();
  };
  controller.bindQuickFillControls();
  controller.bindDockPopoverDismiss();
  controller.refreshQuickFillControls();
  return { controller, state, nodes, calls, doc, get refreshCount() { return refreshCount; } };
}

test("ownership and country granularity hide Quick Fill and close its active popover", context => {
  const h = createHarness(context);
  for (const patch of [{ paintMode: "sovereignty" }, { interactionGranularity: "country" }]) {
    Object.assign(h.state, { activeScenarioId: "", paintMode: "visual", interactionGranularity: "subdivision" });
    h.controller.refreshQuickFillControls();
    h.nodes.dockQuickFillBtn.click();
    assert.equal(h.state.activeDockPopover, "quickfill");
    Object.assign(h.state, patch);
    h.controller.refreshQuickFillControls();
    assert.equal(h.state.activeDockPopover, "");
    assert.equal(h.nodes.dockQuickFillBtn.classList.contains("hidden"), true);
    assert.equal(h.nodes.dockQuickFillBtn.getAttribute("aria-hidden"), "true");
    assert.equal(h.nodes.dockQuickFillBtn.getAttribute("aria-expanded"), "false");
    assert.equal(h.nodes.dockQuickFillRow.getAttribute("aria-hidden"), "true");
  }
  assert.equal(h.refreshCount, 0, "refreshing Quick Fill must not recurse into the toolbar refresh hook");
});

test("live policy normalizes country codes and controls Province labels hints and disabled scopes", context => {
  const h = createHarness(context, {
    selectedInspectorCountryCode: " h-k 1 ",
    countryInteractionPoliciesByCode: new Map([["HK", { parentScopeLabel: "Province", quickFillScopes: ["parent"] }]]),
  });
  assert.equal(h.nodes.quickFillParentBtn.textContent, "By Province");
  assert.equal(h.nodes.quickFillCountryBtn.textContent, "By Country");
  assert.equal(h.nodes.quickFillCountryBtn.disabled, true);
  assert.equal(h.nodes.quickFillParentBtn.classList.contains("is-active"), true);
  assert.match(h.nodes.dockQuickFillHint.textContent, /province batch/);
  h.nodes.quickFillCountryBtn.dispatch("click");
  assert.equal(h.state.batchFillScope, "parent"); assert.equal(h.refreshCount, 0);
  h.state.countryInteractionPoliciesByCode.set("HK", { quickFillScopes: ["country"] });
  h.controller.refreshQuickFillControls();
  assert.equal(h.nodes.quickFillParentBtn.disabled, true);
  assert.equal(h.nodes.quickFillCountryBtn.disabled, false);
  h.nodes.quickFillCountryBtn.click();
  assert.equal(h.state.batchFillScope, "country"); assert.equal(h.refreshCount, 1);
  assert.match(h.nodes.dockQuickFillHint.textContent, /country batch/);
  h.state.selectedInspectorCountryCode = ""; h.state.inspectorHighlightCountryCode = "ZZ";
  h.controller.refreshQuickFillControls();
  assert.equal(h.nodes.quickFillParentBtn.textContent, "By Parent");
  assert.equal(h.nodes.quickFillParentBtn.disabled, false);
});

test("each scope click changes shared state closes the row and refreshes exactly once", context => {
  const h = createHarness(context);
  for (const [button, scope] of [["quickFillCountryBtn", "country"], ["quickFillParentBtn", "parent"]]) {
    h.nodes.dockQuickFillBtn.click();
    const before = h.refreshCount;
    h.nodes[button].click();
    assert.equal(h.state.batchFillScope, scope);
    assert.equal(h.state.activeDockPopover, "");
    assert.equal(h.nodes.dockQuickFillRow.classList.contains("hidden"), true);
    assert.equal(h.nodes[button].classList.contains("is-active"), true);
    assert.equal(h.refreshCount, before + 1);
  }
});

test("trigger toggle outside click and Escape preserve ARIA and focus behavior", context => {
  const h = createHarness(context);
  const trigger = h.nodes.dockQuickFillBtn, row = h.nodes.dockQuickFillRow;
  assert.equal(trigger.getAttribute("aria-controls"), "dockQuickFillRow");
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  trigger.click();
  assert.equal(h.doc.activeElement, row);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(row.getAttribute("aria-hidden"), "false");
  h.doc.dispatch("click", { target: h.nodes.quickFillParentBtn });
  assert.equal(h.state.activeDockPopover, "quickfill", "inside click does not trigger outside dismissal");
  trigger.click();
  assert.equal(h.state.activeDockPopover, "");
  trigger.click();
  const outside = new Button("outside"); outside.focus(); h.doc.dispatch("click", { target: outside });
  assert.equal(h.state.activeDockPopover, ""); assert.equal(h.doc.activeElement, outside);
  trigger.click(); let prevented = 0;
  h.doc.dispatch("keydown", { key: "Escape", preventDefault() { prevented++; } });
  assert.equal(h.state.activeDockPopover, ""); assert.equal(h.doc.activeElement, trigger);
  assert.equal(prevented, 1);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(row.getAttribute("aria-hidden"), "true");
  assert.equal(h.calls.some(([name]) => name === "url"), false, "Quick Fill does not alter support-surface URL state");
});

test("repeated binding keeps one listener per control and one document dismiss pair", context => {
  const h = createHarness(context);
  h.controller.bindQuickFillControls(); h.controller.bindQuickFillControls();
  h.controller.bindDockPopoverDismiss(); h.controller.bindDockPopoverDismiss();
  for (const id of ["dockQuickFillBtn", "quickFillParentBtn", "quickFillCountryBtn"]) {
    assert.equal(h.nodes[id].listeners.get("click").length, 1);
  }
  assert.equal(h.doc.listeners.get("click").length, 1); assert.equal(h.doc.listeners.get("keydown").length, 1);
  h.nodes.dockQuickFillBtn.click(); assert.equal(h.state.activeDockPopover, "quickfill");
  h.nodes.quickFillCountryBtn.click(); assert.equal(h.refreshCount, 1);
});


test("scenario visual mode exposes explicit quick-fill scopes", context => {
  const h = createHarness(context, { activeScenarioId: "tno_1962" });
  assert.equal(h.nodes.dockQuickFillBtn.classList.contains("hidden"), false);
  assert.equal(h.nodes.quickFillCountryBtn.textContent, "Current scenario owner");
});

test("opening Quick Fill refreshes geographic levels from the current selected hit", context => {
  const h = createHarness(context);
  const hierarchyData = { quick_fill: { countries: {
    US: { levels: { state: { label: "State", groups: {} } } },
    FR: { levels: { region: { label: "Region", groups: {} } } },
  } } };
  h.state.hierarchyData = hierarchyData;
  h.state.landIndex = new Map([
    ["county-us", { properties: { cntr_code: "US" } }],
    ["region-fr", { properties: { cntr_code: "FR" } }],
  ]);
  h.state.devSelectedHit = { id: "county-us", targetType: "land" };

  h.nodes.dockQuickFillBtn.click();
  let select = h.nodes.dockQuickFillRow.children[0];
  assert.equal(select.children.some(option => option.value === "level:state"), true);
  assert.equal(select.children.find(option => option.value === "level:state").textContent, "State");

  h.nodes.dockQuickFillBtn.click();
  h.state.devSelectedHit = { id: "region-fr", targetType: "land" };
  h.nodes.dockQuickFillBtn.click();
  select = h.nodes.dockQuickFillRow.children[0];
  assert.equal(select.children.some(option => option.value === "level:state"), false);
  assert.equal(select.children.some(option => option.value === "level:region"), true);
});

test("opening Quick Fill refreshes live policy and refuses a country with no allowed scopes", context => {
  const h = createHarness(context, {
    selectedInspectorCountryCode: "US",
    countryInteractionPoliciesByCode: new Map([[
      "US", { quickFillScopes: [] },
    ]]),
  });
  h.nodes.dockQuickFillBtn.click();
  assert.equal(h.state.activeDockPopover, "");
  assert.equal(h.nodes.dockQuickFillRow.classList.contains("hidden"), true);
});

test("a newly forbidden Quick Fill closes only its own active popup", context => {
  const h = createHarness(context, {
    selectedInspectorCountryCode: "US",
    countryInteractionPoliciesByCode: new Map([[
      "US", { quickFillScopes: ["parent", "country"] },
    ]]),
  });
  h.nodes.dockQuickFillBtn.click();
  assert.equal(h.state.activeDockPopover, "quickfill");

  h.state.countryInteractionPoliciesByCode.set("US", { quickFillScopes: [] });
  h.nodes.dockQuickFillBtn.click();
  assert.equal(h.state.activeDockPopover, "");
  assert.equal(h.nodes.dockQuickFillRow.classList.contains("hidden"), true);

  h.controller.openDockPopover("edit");
  h.controller.openDockPopover("quickfill");
  assert.equal(h.state.activeDockPopover, "edit");
  assert.equal(h.nodes.dockEditPopover.classList.contains("hidden"), false);
});

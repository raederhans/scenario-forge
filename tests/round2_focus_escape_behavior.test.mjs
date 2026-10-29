import test from "node:test";
import assert from "node:assert/strict";
import { restoreFocusOrigin, restoreSurfaceTriggerFocus, rememberSurfaceTrigger, trapSurfaceTab } from "../js/ui/ui_contract.js";
import { bindSelectKeyboard } from "../js/ui/styled_selects.js";
import { createTransportWorkbenchEventOwner } from "../js/ui/toolbar/transport_workbench_event_owner.js";
import { createPaletteLibraryPanelController } from "../js/ui/toolbar/palette_library_panel.js";
import { createLegendControlOwner } from "../js/core/renderer/legend_control_owner.js";
import { createFacilitySurfaceOwner } from "../js/core/renderer/facility_surface.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { state } from "../js/core/state.js";
import { initToolbar } from "../js/ui/toolbar.js";
import { showAppDialog } from "../js/ui/app_dialog.js";

class Node {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc;
    this.children = []; this.attributes = new Map(); this.listeners = new Map();
    this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false;
    this.className = "";
    this.classList = {
      contains: name => this.className.split(" ").includes(name),
      toggle: (name, on = !this.classList.contains(name)) => {
        const classes = new Set(this.className.split(" ").filter(Boolean));
        if (on) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      },
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
    };
  }
  get tabIndex() { return this.hasAttribute("tabindex") ? Number(this.getAttribute("tabindex")) : ["BUTTON", "INPUT", "SELECT"].includes(this.tagName) ? 0 : -1; }
  set tabIndex(value) { this.setAttribute("tabindex", value); }
  get isConnected() { return this.ownerDocument.contains(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentElement = null; }); this.children = []; this.append(...nodes); }
  remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    return selector.split(",").some(part => {
      part = part.trim();
      if (part === "*") return true;
      if (part.startsWith(".")) return this.classList.contains(part.slice(1));
      if (part.startsWith("#")) return this.id === part.slice(1);
      if (part.includes(":not([disabled])")) return !this.disabled && this.tagName === part.split(":")[0].toUpperCase();
      const attribute = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]/);
      if (attribute) {
        const name = attribute[1];
        const value = name.startsWith("data-") ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this.getAttribute(name);
        return value != null && (attribute[2] === undefined || attribute[2] === value);
      }
      return this.tagName === part.toUpperCase();
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler, options = false) { this.listeners.set(type, [...(this.listeners.get(type) || []), { handler, capture: options === true || options.capture === true }]); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.handler !== handler)); }
  fire(type, options = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }, ...options };
    const path = [];
    for (let node = this; node; node = node.parentElement) path.push(node);
    for (const capture of [true, false]) {
      for (const node of capture ? [...path].reverse() : path) {
        event.currentTarget = node;
        for (const entry of [...(node.listeners.get(type) || [])]) if (entry.capture === capture) entry.handler(event);
        if (event.cancelBubble) return event;
      }
    }
    return event;
  }
  click() { this.fire("click"); }
  focus() { this.ownerDocument.activeElement = this; this.fire("focus"); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
}

function harness(context) {
  const doc = new Node("document"); doc.ownerDocument = doc;
  doc.body = doc.appendChild(new Node("body", doc));
  doc.createElement = tag => new Node(tag, doc);
  doc.getElementById = id => doc.querySelector(`#${id}`);
  const win = new Node("window", doc);
  for (const [key, value] of Object.entries({ document: doc, window: win, HTMLElement: Node, Element: Node, HTMLDetailsElement: class extends Node {}, HTMLInputElement: class extends Node {}, HTMLSelectElement: class extends Node {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win),
    requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {},
    getComputedStyle: node => ({ display: node.classList.contains("hidden") ? "none" : node.style.display || "block", visibility: node.style.visibility || "visible", zIndex: node.style.zIndex || "0" }) })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    context.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const add = (tag = "div", parent = doc.body, id = "") => { const node = doc.createElement(tag); node.id = id; parent.appendChild(node); return node; };
  return { doc, win, add };
}

for (const side of ["left", "right"]) test(`A-03/A-07 ${side} drawer yields Escape and restores focus across the breakpoint`, async context => {
  const h = harness(context);
  const saved = { ...state, ui: { ...state.ui } };
  context.after(() => Object.assign(state, saved));
  context.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ samples: [] }) }));
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  context.after(async () => { await new Promise(resolve => setImmediate(resolve)); });
  const media = new Node("media", h.doc); media.matches = false;
  context.mock.method(globalThis, "matchMedia", () => media);
  const toggle = h.add("button", h.doc.body, `${side}PanelToggle`);
  const sidebar = h.add("div", h.doc.body, `${side}Sidebar`);
  const field = h.add("button", sidebar);
  h.add("div", h.doc.body, "sidebarDrawerBackdrop");
  h.add("div", h.doc.body, "riverCellPicker");
  h.add("select", h.doc.body, "riverCellSelect");
  h.add("button", h.doc.body, "riverCellApplyBtn");
  initToolbar();
  await new Promise(resolve => setImmediate(resolve));
  field.focus(); media.matches = true; media.fire("change");
  assert.equal(sidebar.inert, true); assert.ok(h.doc.activeElement === toggle);
  toggle.click(); field.focus();
  field.fire("keydown", { key: "Escape", defaultPrevented: true });
  assert.equal(h.doc.body.classList.contains(`${side}-drawer-open`), true);
  const modal = h.add(); modal.setAttribute("aria-modal", "true");
  field.fire("keydown", { key: "Escape" });
  assert.equal(h.doc.body.classList.contains(`${side}-drawer-open`), true);
  modal.hidden = true; field.fire("keydown", { key: "Escape" });
  assert.equal(h.doc.body.classList.contains(`${side}-drawer-open`), false);
  toggle.click(); field.focus();
  const pending = showAppDialog({ title: "Confirm" });
  h.doc.activeElement.fire("keydown", { key: "Escape" });
  assert.equal(await pending, false);
  assert.ok(h.doc.activeElement === field);
  assert.equal(h.doc.body.classList.contains(`${side}-drawer-open`), true);
  field.fire("keydown", { key: "Escape" });
  assert.equal(h.doc.body.classList.contains(`${side}-drawer-open`), false);
});

function transport(h) {
  const panel = h.add("div", h.doc.body, "transportWorkbenchPanel"); panel.setAttribute("aria-modal", "true");
  const first = h.add("button", panel), last = h.add("button", panel);
  let open = true;
  createTransportWorkbenchEventOwner({ documentRef: h.doc, actions: {
    isOpen: () => open, setOpen: value => { open = value; }, handlePopoverEscape: () => false,
  } }).bind();
  return { panel, first, last, isOpen: () => open };
}

test("A-02 transport Tab wraps at both boundaries and leaves interior traversal native", context => {
  const h = harness(context), workbench = transport(h);
  workbench.first.focus(); workbench.first.fire("keydown", { key: "Tab", shiftKey: true });
  assert.ok(h.doc.activeElement === workbench.last);
  workbench.last.fire("keydown", { key: "Tab" });
  assert.ok(h.doc.activeElement === workbench.first);
  assert.equal(workbench.first.fire("keydown", { key: "Tab" }).defaultPrevented, false);
});

test("A-03 nested select consumes the first Escape and transport closes on the second", context => {
  const h = harness(context), workbench = transport(h);
  const menu = h.add("div", workbench.panel), option = h.add("button", menu);
  bindSelectKeyboard({ button: workbench.first, menu, getOptions: () => [option], open: () => { menu.hidden = false; option.focus(); },
    close: ({ restoreFocus = false } = {}) => { menu.hidden = true; if (restoreFocus) workbench.first.focus(); } });
  option.focus(); option.fire("keydown", { key: "Escape" });
  assert.equal(menu.hidden, true); assert.equal(workbench.isOpen(), true);
  assert.ok(h.doc.activeElement === workbench.first);
  workbench.first.fire("keydown", { key: "Escape" });
  assert.equal(workbench.isOpen(), false);
});

test("A-04 character shortcuts ignore options and listboxes but still work on focused buttons and body", context => {
  const h = harness(context);
  const fields = ["currentTool", "brushModeEnabled", "selectedColor", "bootBlocking", "startupReadonly"];
  const previous = Object.fromEntries(fields.map(key => [key, state[key]]));
  context.after(() => Object.assign(state, previous));
  Object.assign(state, { currentTool: "select", brushModeEnabled: false, selectedColor: "#112233", bootBlocking: false, startupReadonly: false });
  const granularity = h.add("select", h.doc.body, "paintGranularitySelect");
  granularity.options = [1, 2]; granularity.selectedIndex = 0; granularity.dispatchEvent = () => {};
  const swatch = h.add("button"); swatch.dataset.color = "#abcdef";
  const queryAll = h.doc.querySelectorAll.bind(h.doc);
  h.doc.querySelectorAll = selector => selector === "#paletteGrid .color-swatch" ? [swatch] : queryAll(selector);
  initShortcuts();
  for (const role of ["option", "listbox"]) {
    const node = h.add("div"); node.setAttribute("role", role);
    const child = h.add("span", node); child.focus();
    for (const key of ["f", "b", "g", "1"]) h.win.fire("keydown", { key, target: child });
    assert.equal(state.currentTool, "select", role); assert.equal(state.brushModeEnabled, false, role);
    assert.equal(granularity.selectedIndex, 0, role); assert.equal(state.selectedColor, "#112233", role);
  }
  // 鼠标点过的工具按钮仍持有焦点：字母快捷键照常生效。
  const toolButton = h.add("button"); toolButton.focus();
  h.win.fire("keydown", { key: "f", target: toolButton });
  assert.equal(state.currentTool, "fill");
  state.currentTool = "select";
  h.doc.body.focus(); h.win.fire("keydown", { key: "f", target: h.doc.body });
  assert.equal(state.currentTool, "fill");
  h.win.fire("keydown", { key: "g", target: h.doc.body }); assert.equal(granularity.selectedIndex, 1);
  h.win.fire("keydown", { key: "1", target: h.doc.body }); assert.equal(state.selectedColor, "#abcdef");
});

for (const shiftKey of [false, true]) test(`A-05 select Tab restores the interior anchor (reverse: ${shiftKey})`, context => {
  const h = harness(context), panel = h.add();
  h.add("button", panel); const button = h.add("button", panel); h.add("button", panel);
  const menu = h.add("div", panel), option = h.add("button", menu);
  bindSelectKeyboard({ button, menu, getOptions: () => [option], open() {}, close: ({ restoreFocus = false } = {}) => { menu.hidden = true; if (restoreFocus) button.focus(); } });
  panel.addEventListener("keydown", event => trapSurfaceTab(event, panel));
  option.focus(); const event = option.fire("keydown", { key: "Tab", shiftKey });
  assert.ok(h.doc.activeElement === button); assert.equal(event.defaultPrevented, false);
});

test("A-06 palette Escape closes and restores its toggle", context => {
  const h = harness(context), toggle = h.add("button"), panel = h.add(), list = h.add("div", panel), row = h.add("button", list);
  const previous = state.paletteLibraryOpen; context.after(() => { state.paletteLibraryOpen = previous; });
  state.paletteLibraryOpen = true;
  createPaletteLibraryPanelController({ paletteLibraryToggle: toggle, paletteLibraryPanel: panel, paletteLibraryList: list }).bindEvents();
  row.focus(); row.fire("keydown", { key: "Escape" });
  assert.equal(state.paletteLibraryOpen, false); assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(h.doc.activeElement === toggle);
});

test("A-06 palette search Escape clears the query before closing", context => {
  const h = harness(context), search = h.add("input"), panel = h.add();
  const previous = { paletteLibrarySearch: state.paletteLibrarySearch, paletteLibraryOpen: state.paletteLibraryOpen };
  context.after(() => Object.assign(state, previous));
  Object.assign(state, { paletteLibrarySearch: "red", paletteLibraryOpen: true });
  createPaletteLibraryPanelController({ paletteLibrarySearch: search, paletteLibraryPanel: panel }).bindEvents();
  search.focus(); const event = search.fire("keydown", { key: "Escape" });
  assert.equal(event.defaultPrevented, true); assert.equal(state.paletteLibrarySearch, "");
  assert.equal(state.paletteLibraryOpen, true); assert.ok(h.doc.activeElement === search);
});

for (const invalid of ["detached", "hidden", "disabled", "inert", "ancestor-hidden", "display", "visibility"]) {
  test(`A-07 focus restoration skips ${invalid} targets and uses the supplied fallback`, context => {
    const h = harness(context), parent = h.add(), origin = h.add("button", parent), fallback = h.add("button");
    if (invalid === "detached") origin.remove();
    if (invalid === "hidden") origin.hidden = true;
    if (invalid === "disabled") origin.disabled = true;
    if (invalid === "inert") parent.inert = true;
    if (invalid === "ancestor-hidden") parent.hidden = true;
    if (invalid === "display") parent.style.display = "none";
    if (invalid === "visibility") origin.style.visibility = "hidden";
    fallback.focus(); assert.ok(restoreFocusOrigin(origin) === null); assert.ok(h.doc.activeElement === fallback);
    assert.equal(restoreFocusOrigin(origin, fallback), fallback);
    const registry = new WeakMap(); rememberSurfaceTrigger(registry, parent, origin);
    restoreSurfaceTriggerFocus(registry, parent, null, fallback); assert.ok(h.doc.activeElement === fallback);
  });
}

test("A-08 legend keeps focused opacity visible and Escape returns to a visible handle", context => {
  const h = harness(context), container = h.add();
  const control = { visible: true, collapsed: false, width: 240, height: 340, opacity: 0.9, xRatio: 0, yRatio: 0 };
  const owner = createLegendControlOwner({ getMapContainer: () => container, getLanguage: () => "en", getControlState: () => control,
    getLegendModel: () => ({ colors: ["red"], labelMap: { red: "Red" }, specialZoneLegendLayers: [] }),
    updateControlState: patch => Object.assign(control, patch), toggleControlCollapsed() {}, hideControl() {}, clamp: (value, min, max) => Math.max(min, Math.min(value, max)) });
  owner.renderLegend(); const element = owner.ensureLegendControlElement();
  const handle = element.querySelector('[data-legend-resize="e"]'), panel = element.querySelector(".map-legend-opacity-panel"), input = panel.querySelector("input");
  handle.focus(); input.focus(); element.fire("pointerleave"); assert.equal(panel.hidden, false);
  const escape = input.fire("keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true); assert.equal(panel.hidden, true);
  assert.ok(h.doc.activeElement.matches(".map-legend-resize-handle"));
  assert.equal(h.doc.activeElement.hidden, false);
});

test("A-09 facility Escape uses its close action, respects modals and restores the map", context => {
  const h = harness(context), map = h.add("div", h.doc.body, "mapContainer"); map.tabIndex = -1;
  const card = h.add(), close = h.add("button", card, "facilityInfoCardCloseBtn");
  const dom = { facilityInfoCard: card, facilityInfoCardTitle: h.add("h3", card), facilityInfoCardBody: h.add("div", card), facilityInfoCardMoreBtn: h.add("button", card), facilityInfoCardZoomBtn: h.add("button", card) };
  const owner = createFacilitySurfaceOwner({ helpers: { t: text => text } });
  const entry = { familyId: "airport", properties: { name: "Airport" } };
  let closes = 0;
  close.addEventListener("click", () => { closes++; owner.applyFacilityInfoCardState(null, { dom }); });
  owner.applyFacilityInfoCardState(entry, { dom }); close.focus();
  const modal = h.add(); modal.setAttribute("aria-modal", "true");
  close.fire("keydown", { key: "Escape" }); assert.equal(closes, 0);
  modal.hidden = true;
  close.fire("keydown", { key: "Escape" }); assert.equal(closes, 1); assert.ok(h.doc.activeElement === map);
  owner.applyFacilityInfoCardState(entry, { dom }); close.focus(); close.click();
  assert.equal(closes, 2); assert.ok(h.doc.activeElement === map);
});

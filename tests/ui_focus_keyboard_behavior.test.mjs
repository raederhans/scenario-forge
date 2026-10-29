import test from "node:test";
import assert from "node:assert/strict";
import { getFocusableElements, getActiveModal } from "../js/ui/ui_contract.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { showAppDialog } from "../js/ui/app_dialog.js";
import { state } from "../js/core/state.js";
import { FileManager } from "../js/core/file_manager.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";
import { createWorkspaceChromeSupportSurfaceController } from "../js/ui/toolbar/workspace_chrome_support_surface_controller.js";

class Node {
  constructor(tag = "div", doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.classes = new Set();
    this.classList = {
      contains: name => this.classes.has(name),
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      toggle: (name, force = !this.classes.has(name)) => force ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  get tabIndex() { return this.hasAttribute("tabindex") ? Number(this.getAttribute("tabindex")) : (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(this.tagName) ? 0 : -1); }
  set tabIndex(value) { this.setAttribute("tabindex", value); }
  get ariaBusy() { return this.getAttribute("aria-busy"); }
  set ariaBusy(value) { this.setAttribute("aria-busy", value); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return descendants;
    if (selector === '[aria-modal="true"]') return descendants.filter(node => node.getAttribute("aria-modal") === "true");
    return descendants.filter(node => (!node.disabled && ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(node.tagName))
      || node.hasAttribute("href") || (selector.includes("summary") && node.tagName === "SUMMARY") || node.hasAttribute("tabindex"));
  }
  closest() { return null; }
  focus() { this.ownerDocument.activeElement = this; }
  addEventListener(name, handler, capture = false) {
    const entries = this.listeners.get(name) || [];
    entries.push({ handler, capture }); this.listeners.set(name, entries);
  }
  removeEventListener(name, handler) { this.listeners.set(name, (this.listeners.get(name) || []).filter(entry => entry.handler !== handler)); }
  dispatch(name, event = {}) {
    return (this.listeners.get(name) || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture)).map(entry => entry.handler(event));
  }
}

function harness(context) {
  const doc = new Node("document");
  doc.ownerDocument = doc;
  doc.body = doc.appendChild(new Node("body", doc));
  doc.createElement = tag => new Node(tag, doc);
  doc.getElementById = id => doc.querySelectorAll("*").find(node => node.id === id) || null;
  const win = new Node("window", doc);
  win.requestAnimationFrame = callback => callback();
  const replacements = {
    document: doc, window: win, HTMLElement: Node, Element: Node,
    requestAnimationFrame: win.requestAnimationFrame,
    getComputedStyle: node => ({ display: node.classList.contains("hidden") ? "none" : node.style.display || "block", visibility: node.style.visibility || "visible", zIndex: node.style.zIndex || "auto" }),
    fetch: async () => ({ ok: true, json: async () => ({ user: null }) }),
  };
  for (const [key, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    context.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const add = (tag, parent = doc.body, id = "") => { const node = doc.createElement(tag); node.id = id; parent.appendChild(node); return node; };
  const key = (value, options = {}) => {
    const event = { key: value, target: doc.activeElement || doc.body, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options };
    doc.dispatch("keydown", event); win.dispatch("keydown", event); return event;
  };
  return { doc, win, add, key };
}

function accountController(h, overrides = {}) {
  const trigger = h.add("button", h.doc.body, "backendAccountToggleBtn");
  const modal = h.add("div", h.doc.body, "backendAccountPopover");
  modal.setAttribute("aria-modal", "true"); modal.classList.add("hidden"); modal.style.zIndex = "85";
  const first = h.add("button", modal, "backendAccountCloseBtn");
  h.add("input", modal, "backendCloudUsername");
  const last = h.add("button", modal);
  const save = h.add("button", h.doc.body, "workspaceSaveBtn");
  const toasts = [];
  const controller = createProjectSupportDiagnosticsController({
    state: {}, documentRef: h.doc,
    helpers: { t: text => text, legendManager: {}, mapRenderer: {}, fileManager: {}, showToast: (...args) => toasts.push(args), ...overrides },
  });
  controller.bindEvents();
  return { trigger, modal, first, last, save, toasts };
}

test("focus enumeration excludes hidden ancestors and closed details content, retaining summary", context => {
  const h = harness(context);
  const surface = h.add("div");
  const first = h.add("button", surface);
  for (const kind of ["hidden", "display", "inert"]) {
    const ancestor = h.add("div", surface);
    if (kind === "display") ancestor.style.display = "none";
    else if (kind === "inert") ancestor.setAttribute("inert", "");
    else ancestor.hidden = true;
    h.add("button", h.add("div", ancestor));
  }
  const details = h.add("details", surface);
  const summary = h.add("summary", details);
  const content = h.add("button", details);
  const disabled = h.add("button", surface); disabled.disabled = true;
  assert.deepEqual(getFocusableElements(surface), [first, summary]);
  details.open = true;
  assert.deepEqual(getFocusableElements(surface), [first, summary, content]);
});

test("modal owns shortcuts until closed, and prevented events stay ignored", context => {
  const h = harness(context);
  const original = { currentTool: state.currentTool, bootBlocking: state.bootBlocking, startupReadonly: state.startupReadonly, runHistoryActionFn: state.runHistoryActionFn };
  context.after(() => Object.assign(state, original));
  Object.assign(state, { currentTool: "select", bootBlocking: false, startupReadonly: false });
  let history = 0; let saves = 0;
  state.runHistoryActionFn = () => { history++; };
  context.mock.method(FileManager, "exportProject", () => { saves++; });
  initShortcuts();
  const modal = h.add("div"); modal.setAttribute("aria-modal", "true");
  h.add("button", modal).focus();
  for (const [key, options] of [["f", {}], ["s", { ctrlKey: true }], ["z", { ctrlKey: true }], ["y", { ctrlKey: true }]]) h.key(key, options);
  assert.equal(state.currentTool, "select"); assert.equal(history, 0); assert.equal(saves, 0);
  modal.hidden = true;
  h.key("f", { defaultPrevented: true }); assert.equal(state.currentTool, "select");
  h.key("f"); h.key("s", { ctrlKey: true }); h.key("z", { ctrlKey: true });
  assert.equal(state.currentTool, "fill"); assert.equal(history, 1); assert.equal(saves, 1);
});

test("account traps first/last focus, recaptures outside focus and restores trigger", context => {
  const h = harness(context); const a = accountController(h);
  a.trigger.focus(); a.trigger.dispatch("click");
  assert.equal(h.doc.activeElement, a.first);
  h.key("Tab", { shiftKey: true }); assert.equal(h.doc.activeElement, a.last);
  h.key("Tab"); assert.equal(h.doc.activeElement, a.first);
  a.trigger.focus(); h.key("Tab"); assert.equal(h.doc.activeElement, a.first);
  assert.equal(h.key("Escape").defaultPrevented, true);
  assert.equal(a.modal.classList.contains("hidden"), true); assert.equal(h.doc.activeElement, a.trigger);
});

test("confirmation above account handles Escape without closing account", async context => {
  const h = harness(context); const a = accountController(h);
  a.trigger.dispatch("click");
  const pending = showAppDialog({ title: "Confirm" });
  const overlay = h.doc.body.children.at(-1); overlay.style.zIndex = "160";
  assert.notEqual(getActiveModal(), a.modal);
  h.key("Escape"); assert.equal(await pending, false);
  assert.equal(a.modal.classList.contains("hidden"), false); assert.equal(h.doc.activeElement, a.first);
});

test("Guide loops through visible controls and summary", context => {
  const h = harness(context);
  const guide = h.add("div"); guide.setAttribute("aria-modal", "true");
  const first = h.add("button", guide); const details = h.add("details", guide);
  const summary = h.add("summary", details); h.add("button", details);
  const controller = createWorkspaceChromeSupportSurfaceController({ state: {}, scenarioGuidePopover: guide, getFocusableElements });
  controller.bindDockPopoverDismiss();
  summary.focus(); h.key("Tab"); assert.equal(h.doc.activeElement, first);
  h.key("Tab", { shiftKey: true }); assert.equal(h.doc.activeElement, summary);
});

test("save failure is visible and restores busy/disabled; cancellation stays quiet", async context => {
  const h = harness(context);
  let rejectSave;
  const fileManager = { exportProject: () => new Promise((resolve, reject) => { rejectSave = reject; }) };
  const a = accountController(h, { fileManager });
  const [pending] = a.save.dispatch("click");
  assert.equal(a.save.disabled, true); assert.equal(a.save.getAttribute("aria-busy"), "true");
  rejectSave(new Error("Disk full")); await pending;
  assert.deepEqual(a.toasts, [["Disk full", { title: "Project save failed", tone: "error" }]]);
  assert.equal(a.save.disabled, false); assert.equal(a.save.getAttribute("aria-busy"), "false");
  fileManager.exportProject = async () => false;
  await Promise.all(a.save.dispatch("click"));
  assert.equal(a.toasts.length, 1); assert.equal(a.save.disabled, false); assert.equal(a.save.ariaBusy, "false");
});

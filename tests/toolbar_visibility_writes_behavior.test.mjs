import { registerRuntimeHook, readRegisteredRuntimeHookSource } from "../js/core/state/index.js";
import { STATE_NOTIFICATION_HOOK_NAMES, STATE_HANDLER_HOOK_NAMES, STATE_INTERNAL_HANDLER_HOOK_NAMES } from "../js/core/state/config.js";
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { initToolbar } from "../js/ui/toolbar.js";
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
      add: (...names) => names.forEach(name => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach(name => this.classList.toggle(name, false)),
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
  prepend(node) { this.children.unshift(node); node.parentElement = this; }
  after(node) {
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    node.parentElement = parent;
  }
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
  doc.createElementNS = (namespace, tag) => new Node(tag, doc);
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
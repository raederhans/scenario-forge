import test from "node:test";
import assert from "node:assert/strict";
import { initCommandPalette } from "../js/ui/command_palette.js";

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.id = "";
    this.className = "";
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.scrollTop = 0;
    this.textContent = "";
    this.value = "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (name) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      remove: (name) => { this.className = this.className.split(/\s+/).filter((item) => item !== name).join(" "); },
      toggle: (name, force) => {
        const active = force ?? !this.classList.contains(name);
        this.classList[active ? "add" : "remove"](name);
        return active;
      },
    };
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  prepend(...nodes) {
    this.append(...nodes);
    this.children = [...nodes, ...this.children.filter((node) => !nodes.includes(node))];
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  dispatchEvent(event) {
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    if (event.bubbles) this.parentNode?.dispatchEvent(event);
    return true;
  }
  click() {
    const event = { target: this, propagationStopped: false, stopPropagation() { this.propagationStopped = true; } };
    for (const callback of this.listeners.get("click") || []) callback(event);
    this.lastClickEvent = event;
  }
  scrollIntoView() {}
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) return attribute[2] === undefined ? this.attributes.has(attribute[1]) : this.getAttribute(attribute[1]) === attribute[2];
    return this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
}

function mount() {
  const doc = new Element("document");
  doc.createElement = (tag) => { const node = new Element(tag); node.ownerDocument = doc; return node; };
  doc.body = doc.createElement("body");
  doc.append(doc.body);
  const prior = doc.createElement("input");
  doc.body.append(prior);
  prior.focus();
  const clicks = [];
  const commands = [
    { key: "select", label: "Select tool", group: "Tools", shortcut: "V" },
    { key: "fill", label: "Fill tool", group: "Tools", shortcut: "F" },
    { key: "save", label: "Save project", group: "Project" },
  ].map((command) => {
    const button = doc.createElement("button");
    button.addEventListener("click", () => clicks.push(command.key));
    return { ...command, button };
  });
  const t = (key) => ({ "Select tool": "选择工具", "No matching commands": "没有匹配的命令" }[key] || key);
  const palette = initCommandPalette({ documentRef: doc, t, getCommands: () => commands });
  const get = (id) => doc.querySelector(`#${id}`);
  const press = (key, props = {}) => doc.dispatchEvent({ type: "keydown", key, preventDefault() {}, stopPropagation() {}, ...props });
  const filter = (value) => { get("editorCommandSearch").value = value; get("editorCommandSearch").dispatchEvent({ type: "input" }); };
  const options = () => get("editorCommandResults").querySelectorAll('[role="option"]');
  return { doc, prior, commands, palette, get, press, filter, options, clicks };
}

test("Ctrl/Cmd+K opens from an input, Escape closes and restores focus", () => {
  const h = mount();
  for (const modifier of ["ctrlKey", "metaKey"]) {
    h.press("k", { [modifier]: true, target: h.prior });
    assert.equal(h.get("editorCommandPalette").hidden, false);
    assert.equal(h.doc.activeElement, h.get("editorCommandSearch"));
    h.press("Escape");
    assert.equal(h.get("editorCommandPalette").hidden, true);
    assert.equal(h.doc.activeElement, h.prior);
  }
});

test("filters translated labels and English keys and reports no results", () => {
  const h = mount();
  h.palette.open();
  for (const query of ["选择", "SELECT"]) {
    h.filter(query);
    assert.equal(h.options().length, 1);
    assert.equal(h.options()[0].children[0].textContent, "选择工具");
  }
  h.filter("missing");
  assert.equal(h.options().length, 0);
  const empty = h.get("editorCommandPalette").querySelector('[role="status"]');
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, "没有匹配的命令");
});

test("arrows select options and Enter and mouse clicks proxy existing buttons", () => {
  const h = mount();
  h.palette.open();
  h.press("ArrowDown");
  assert.equal(h.options()[1].getAttribute("aria-selected"), "true");
  h.press("Enter");
  assert.deepEqual(h.clicks, ["fill"]);
  assert.equal(h.get("editorCommandPalette").hidden, true);
  h.palette.open();
  h.press("ArrowUp");
  h.press("Enter");
  assert.deepEqual(h.clicks, ["fill", "save"]);
  h.palette.open();
  const option = h.options()[0];
  option.click();
  assert.deepEqual(h.clicks, ["fill", "save", "select"]);
  // 选项点击不能冒泡到文档，否则刚打开的弹层会把它当成"点外部"立即关掉。
  assert.equal(option.lastClickEvent.propagationStopped, true);
});

test("disabled and missing buttons are omitted and ? lists shortcuts", () => {
  const h = mount();
  h.commands[0].button.disabled = true;
  h.commands.push({ key: "missing", label: "Missing", group: "Project" });
  h.palette.open();
  assert.equal(h.options().length, 2);
  h.filter("?");
  assert.equal(h.options().length, 1);
  assert.equal(h.options()[0].children[1].textContent, "F");
});

test("results are capped at fifty", () => {
  const h = mount();
  h.commands.push(...Array.from({ length: 60 }, (_, i) => ({ ...h.commands[0], key: `tool-${i}` })));
  h.palette.open();
  assert.equal(h.options().length, 50);
});

test("IME composition keys stay with the input method", () => {
  const h = mount();
  h.palette.open();
  h.press("Enter", { isComposing: true });
  h.press("Escape", { keyCode: 229 });
  assert.deepEqual(h.clicks, []);
  assert.equal(h.get("editorCommandPalette").hidden, false);
  h.press("Enter");
  assert.equal(h.clicks.length, 1);
});

test("does not open underneath another visible modal", () => {
  const h = mount();
  const workbench = h.doc.createElement("div");
  workbench.setAttribute("aria-modal", "true");
  h.doc.body.append(workbench);
  h.press("k", { ctrlKey: true });
  assert.equal(h.get("editorCommandPalette").hidden, true);
  workbench.hidden = true;
  h.press("k", { ctrlKey: true });
  assert.equal(h.get("editorCommandPalette").hidden, false);
});

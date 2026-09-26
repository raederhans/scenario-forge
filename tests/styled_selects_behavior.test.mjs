import test from "node:test";
import assert from "node:assert/strict";

function makeNode(document, tagName = "div") {
  const classes = new Set();
  const attributes = new Map();
  const listeners = new Map();
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    ownerDocument: document,
    children: [],
    dataset: {},
    style: { setProperty() {} },
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      remove: (name) => classes.delete(name),
    },
    set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
    get className() { return [...classes].join(" "); },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) || null,
    removeAttribute: (name) => attributes.delete(name),
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); return true; },
    fire(type, init = {}) {
      const event = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...init };
      let current = this;
      while (current) {
        current._listeners?.get(type)?.(event);
        current = current.parentNode;
      }
      return event;
    },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { child.parentNode = this; child.parentElement = this; this.children.push(child); },
    insertBefore(child, before) {
      child.parentNode = this;
      child.parentElement = this;
      this.children.splice(this.children.indexOf(before), 0, child);
    },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    querySelectorAll(selector) {
      const results = [];
      const visit = (parent) => parent.children.forEach((child) => {
        if (selector === ".app-select-option" && child.classList.contains("app-select-option")) results.push(child);
        visit(child);
      });
      visit(this);
      return results;
    },
    focus() { document.activeElement = this; },
    getBoundingClientRect() { return { left: 20, top: 20, bottom: 58, width: 180 }; },
    contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
  };
  node._listeners = listeners;
  return node;
}

test("long styled select searches groups and keeps native value and keyboard contract", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalObserver = globalThis.MutationObserver;
  const document = {
    documentElement: { clientWidth: 800, clientHeight: 600 },
    activeElement: null,
    createElement(tagName) { return makeNode(document, tagName); },
    getElementById: () => null,
    addEventListener() {},
  };
  document.body = makeNode(document, "body");
  globalThis.document = document;
  globalThis.window = { innerWidth: 800, innerHeight: 600, addEventListener() {} };
  globalThis.MutationObserver = class { observe() {} };
  try {
    const select = makeNode(document, "select");
    select.classList.add("select-input");
    select.id = "example";
    const firstGroup = makeNode(document, "optgroup");
    firstGroup.label = "Atlas";
    const disabledGroup = makeNode(document, "optgroup");
    disabledGroup.label = "Unavailable";
    disabledGroup.disabled = true;
    const addOption = (parent, value, label, disabled = false) => {
      const option = makeNode(document, "option");
      option.value = value;
      option.textContent = label;
      option.disabled = disabled;
      parent.appendChild(option);
      return option;
    };
    addOption(firstGroup, "alpha", "Alpha");
    addOption(firstGroup, "beta", "Beta", true);
    addOption(disabledGroup, "locked", "Locked");
    select.append(firstGroup, disabledGroup);
    for (let index = 0; index < 10; index++) addOption(select, `item-${index}`, `Item ${index}`);
    Object.defineProperty(select, "options", {
      get: () => select.children.flatMap((child) => child.tagName === "OPTGROUP" ? child.children : [child]),
    });
    let selectedValue = "item-0";
    Object.defineProperty(select, "value", {
      get: () => selectedValue,
      set(value) { selectedValue = value; },
    });
    Object.defineProperty(select, "selectedOptions", {
      get: () => select.options.filter((option) => option.value === selectedValue),
    });
    select.options.forEach((option) => Object.defineProperty(option, "selected", { get: () => option.value === selectedValue }));
    document.body.appendChild(select);
    document.querySelectorAll = () => [select];
    const events = [];
    select.addEventListener("input", () => events.push("input"));
    // The component owns change; capture both without replacing that listener.
    const dispatch = select.dispatchEvent.bind(select);
    select.dispatchEvent = (event) => { events.push(event.type); return dispatch(event); };

    const { initStyledSelects } = await import("../js/ui/styled_selects.js");
    initStyledSelects(document);
    const shell = select.parentNode;
    const button = shell.children[1];
    const menu = shell.children[2];
    const [search, list, noMatches] = menu.children;
    assert.equal(search.hidden, false);
    assert.equal(list.children[0].children[0].textContent, "Atlas");
    assert.equal(list.children[1].children[1].disabled, true);
    button.fire("click");
    assert.equal(document.activeElement, search);
    search.value = "atlas";
    search.fire("input");
    assert.equal(list.children[0].hidden, false);
    assert.equal(list.children[1].hidden, true);
    assert.equal(list.children[2].hidden, true);
    search.fire("keydown", { key: "ArrowDown" });
    assert.equal(document.activeElement.dataset.value, "alpha");
    search.value = "";
    search.fire("input");
    search.fire("keydown", { key: "End" });
    assert.equal(document.activeElement.dataset.value, "item-9");
    document.activeElement.fire("keydown", { key: "Home" });
    assert.equal(document.activeElement.dataset.value, "alpha");
    document.activeElement.fire("keydown", { key: "ArrowDown" });
    assert.equal(document.activeElement.dataset.value, "item-0");
    document.activeElement.fire("keydown", { key: "ArrowUp" });
    assert.equal(document.activeElement.dataset.value, "alpha");
    list.children[0].children[1].fire("click");
    assert.equal(select.value, "alpha");
    assert.deepEqual(events, ["input", "input", "change"]);
    assert.equal(document.activeElement, button);
    button.fire("click");
    assert.equal(search.value, "");
    search.fire("keydown", { key: "Tab" });
    assert.equal(menu.classList.contains("hidden"), true);
    button.fire("click");
    search.value = "Item 2";
    search.fire("input");
    search.fire("keydown", { key: "Enter" });
    assert.equal(select.value, "item-2");
    assert.equal(document.activeElement, button);
    button.fire("click");
    search.value = "unfindable";
    search.fire("input");
    assert.equal(noMatches.hidden, false);
    assert.ok(noMatches.textContent);
    search.fire("keydown", { key: "Escape" });
    assert.equal(document.activeElement, button);
    assert.equal(menu.classList.contains("hidden"), true);
    select.children.pop();
    select.dispatchEvent(new Event("change"));
    assert.equal(search.hidden, false, "ten available options still show search");
    select.children.pop();
    select.dispatchEvent(new Event("change"));
    assert.equal(search.hidden, true, "nine available options use the compact menu");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.MutationObserver = originalObserver;
  }
});

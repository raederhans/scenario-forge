import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { initScenarioControls } from "../js/ui/scenario_controls.js";

function makeNode(document, tagName = "div") {
  const classes = new Set();
  const attributes = new Map();
  const listeners = new Map();
  const writes = {};
  const recordWrite = (name) => { writes[name] = (writes[name] || 0) + 1; };
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    ownerDocument: document,
    children: [],
    get isConnected() {
      let current = this;
      while (current?.parentNode) current = current.parentNode;
      return current === document.body;
    },
    get childNodes() { return this.children; },
    dataset: {},
    style: { setProperty() {} },
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    classList: {
      add: (...names) => { recordWrite("class"); names.forEach((name) => classes.add(name)); },
      contains: (name) => classes.has(name),
      toggle(name, force) {
        recordWrite("class");
        if (force) classes.add(name);
        else classes.delete(name);
      },
      remove: (name) => { recordWrite("class"); classes.delete(name); },
    },
    set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
    get className() { return [...classes].join(" "); },
    setAttribute: (name, value) => { recordWrite("attribute"); attributes.set(name, String(value)); },
    getAttribute: (name) => attributes.get(name) || null,
    removeAttribute: (name) => { recordWrite("attribute"); attributes.delete(name); },
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
    appendChild(child) {
      recordWrite("append");
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      child.parentNode = this; child.parentElement = this; this.children.push(child);
    },
    insertBefore(child, before) {
      child.parentNode = this;
      child.parentElement = this;
      this.children.splice(this.children.indexOf(before), 0, child);
    },
    replaceChildren(...children) { recordWrite("replaceChildren"); this.children = []; this.append(...children); },
    querySelectorAll(selector) {
      this.querySelectorAllCalls = (this.querySelectorAllCalls || 0) + 1;
      const results = [];
      const matches = (node) => selector.includes("select")
        && node.tagName === "SELECT" && node.classList.contains("select-input");
      const visit = (parent) => parent.children.forEach((child) => {
        if (selector === ".scenario-select-option" && child.classList.contains("scenario-select-option")) results.push(child);
        if (selector === "[data-i18n]" && child.getAttribute("data-i18n")) results.push(child);
        if (matches(child)) results.push(child);
        visit(child);
      });
      visit(this);
      return results;
    },
    matches(selector) {
      return selector.includes("select.select-input")
        && this.tagName === "SELECT" && this.classList.contains("select-input");
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    closest(selector) {
      let current = this;
      const selectors = selector.split(",").map((part) => part.trim());
      while (current) {
        if (selectors.some((part) => part.startsWith(".")
          ? current.classList?.contains(part.slice(1))
          : current.tagName?.toLowerCase() === part)) return current;
        current = current.parentNode;
      }
      return null;
    },
    click() { if (!this.disabled) this.fire("click"); },
    focus() { document.activeElement = this; },
    getBoundingClientRect() { return { left: 20, top: 20, bottom: 58, width: 180 }; },
    contains(target) {
      this.containsCalls = (this.containsCalls || 0) + 1;
      return this === target || this.children.some((child) => child.contains(target));
    },
  };
  node._listeners = listeners;
  node.writes = writes;
  for (const name of ["textContent", "hidden", "disabled", "title", "placeholder", "value"]) {
    let value = node[name] ?? "";
    Object.defineProperty(node, name, {
      configurable: true,
      get: () => value,
      set(next) { recordWrite(name); value = next; },
    });
  }
  return node;
}

test("scenario picker shares navigation, selection, focus return and native change contract", async () => {
  const originalDocument = globalThis.document;
  const saved = Object.fromEntries(["scenarioRegistry", "activeScenarioId", "bootBlocking", "startupReadonly", "scenarioApplyInFlight"].map((key) => [key, state[key]]));
  const document = { activeElement: null, addEventListener() {}, createElement(tag) { return makeNode(document, tag); } };
  const nodes = Object.fromEntries(["scenarioSelect", "scenarioSelectButton", "scenarioSelectButtonText", "scenarioSelectMenu", "applyScenarioBtn"]
    .map((id) => [id, makeNode(document, id === "scenarioSelect" ? "select" : "button")]));
  document.getElementById = (id) => nodes[id] || null;
  const select = nodes.scenarioSelect;
  const button = nodes.scenarioSelectButton;
  const menu = nodes.scenarioSelectMenu;
  Object.defineProperty(select, "selectedOptions", { get: () => select.children.filter((option) => option.value === select.value) });
  menu.classList.add("hidden");
  globalThis.document = document;
  Object.assign(state, {
    scenarioRegistry: { scenarios: [{ scenario_id: "alpha" }, { scenario_id: "beta" }] },
    activeScenarioId: "alpha", bootBlocking: false, startupReadonly: false, scenarioApplyInFlight: false,
  });
  let dispose;
  try {
    dispose = initScenarioControls();
    await new Promise((resolve) => setImmediate(resolve));
    const events = [];
    const dispatch = select.dispatchEvent.bind(select);
    select.dispatchEvent = (event) => { events.push(event.type); return dispatch(event); };
    button.fire("click");
    assert.equal(document.activeElement.dataset.value, "alpha");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    document.activeElement.fire("keydown", { key: "ArrowDown" });
    assert.equal(document.activeElement.dataset.value, "beta");
    document.activeElement.fire("keydown", { key: "ArrowDown" });
    assert.equal(document.activeElement.dataset.value, "");
    document.activeElement.fire("keydown", { key: "ArrowUp" });
    assert.equal(document.activeElement.dataset.value, "beta");
    document.activeElement.fire("keydown", { key: "Home" });
    assert.equal(document.activeElement.dataset.value, "");
    document.activeElement.fire("keydown", { key: "End" });
    assert.equal(document.activeElement.dataset.value, "beta");
    document.activeElement.fire("keydown", { key: "Enter" });
    assert.equal(select.value, "beta");
    assert.deepEqual(events, ["change"]);
    assert.equal(state.activeScenarioId, "alpha", "selection does not apply a scenario");
    assert.equal(nodes.applyScenarioBtn.disabled, false);
    assert.equal(document.activeElement, button);
    assert.equal(menu.classList.contains("hidden"), true);
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      button.fire("keydown", { key });
      assert.equal(document.activeElement.dataset.value, "beta");
      const escape = document.activeElement.fire("keydown", { key: "Escape" });
      assert.equal(escape.defaultPrevented, true);
      assert.equal(document.activeElement, button);
      assert.equal(menu.classList.contains("hidden"), true);
    }
    button.fire("keydown", { key: "Home" });
    assert.equal(document.activeElement.dataset.value, "");
    document.activeElement.fire("keydown", { key: "ArrowDown" });
    document.activeElement.fire("keydown", { key: " " });
    assert.equal(select.value, "alpha");
    assert.deepEqual(events, ["change", "change"]);
    assert.equal(document.activeElement, button);
    button.fire("keydown", { key: "End" });
    assert.equal(document.activeElement.dataset.value, "beta");
    document.activeElement.fire("keydown", { key: "Tab" });
    assert.equal(menu.classList.contains("hidden"), true);
    button.disabled = true;
    button.fire("keydown", { key: "ArrowDown" });
    assert.equal(menu.classList.contains("hidden"), true);
  } finally {
    dispose?.();
    Object.assign(state, saved);
    globalThis.document = originalDocument;
  }
});

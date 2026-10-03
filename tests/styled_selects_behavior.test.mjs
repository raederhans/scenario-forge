import test from "node:test";
import assert from "node:assert/strict";
import { applyBaseLocalizationSnapshot, setCurrentLanguage } from "../js/core/state/content_state.js";

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
        if (selector === ".app-select-option" && child.classList.contains("app-select-option")) results.push(child);
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

function countWrites(root) {
  return Object.values(root.writes || {}).reduce((total, count) => total + count, 0)
    + root.children.reduce((total, child) => total + countWrites(child), 0);
}

test("long styled select searches groups and keeps native value and keyboard contract", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalObserver = globalThis.MutationObserver;
  let mutationCallback;
  let observerOptions;
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
  globalThis.MutationObserver = class {
    constructor(callback) { mutationCallback = callback; }
    observe(_target, options) { observerOptions = options; }
  };
  try {
    const select = makeNode(document, "select");
    const label = makeNode(document, "label");
    const labelText = makeNode(document, "span");
    labelText.textContent = "Field name";
    label.append(labelText, select);
    select.labels = [label];
    Object.defineProperty(label, "textContent", {
      get: () => label.children.map((child) => child.textContent).join(""),
    });
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
    let optionReads = 0;
    Object.defineProperty(select, "options", {
      get: () => {
        optionReads++;
        return select.children.flatMap((child) => child.tagName === "OPTGROUP" ? child.children : [child]);
      },
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
    document.body.appendChild(label);
    let scans = 0;
    const selects = [select];
    document.querySelectorAll = () => { scans++; return selects; };
    const events = [];
    select.addEventListener("input", () => events.push("input"));
    // The component owns change; capture both without replacing that listener.
    const dispatch = select.dispatchEvent.bind(select);
    select.dispatchEvent = (event) => { events.push(event.type); return dispatch(event); };

    const { initStyledSelects, syncStyledSelect } = await import("../js/ui/styled_selects.js");
    initStyledSelects(document);
    const shell = select.parentNode;
    const button = shell.children[1];
    const menu = shell.children[2];
    const [search, list, noMatches] = menu.children;
    assert.equal(button.getAttribute("aria-label"), "Field name", "nested labels exclude the enhanced menu's text");
    assert.equal(button.getAttribute("data-i18n-aria-label"), null, "the no-matches translation key cannot name the field");
    const initialOptions = list.querySelectorAll(".app-select-option");
    const writesBeforeRefresh = countWrites(shell);
    const buildsBeforeRefresh = list.writes.replaceChildren;
    for (let index = 0; index < 20; index++) syncStyledSelect(select);
    assert.equal(list.writes.replaceChildren, buildsBeforeRefresh, "twenty unchanged refreshes rebuild zero menus");
    assert.equal(countWrites(shell), writesBeforeRefresh, "unchanged refreshes write no identical DOM values");
    assert.deepEqual(list.querySelectorAll(".app-select-option"), initialOptions);
    select.hidden = true;
    syncStyledSelect(select);
    const hiddenWrites = countWrites(shell);
    syncStyledSelect(select);
    assert.equal(countWrites(shell), hiddenWrites, "mirrored hidden state also refreshes without redundant writes");
    select.hidden = false;
    syncStyledSelect(select);
    select.value = "item-1";
    syncStyledSelect(select);
    assert.equal(button.children[0].textContent, "Item 1", "programmatic preset changes refresh the visible label");
    assert.deepEqual(events, [], "refresh does not dispatch a change or reapply the preset");
    assert.deepEqual(list.querySelectorAll(".app-select-option"), initialOptions, "selection-only updates retain option nodes");
    assert.equal(initialOptions.find((option) => option.dataset.value === "item-1").getAttribute("aria-selected"), "true");
    select.value = "item-0";
    syncStyledSelect(select);
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
    const focusedOption = document.activeElement;
    syncStyledSelect(select);
    assert.equal(search.value, "atlas", "refresh preserves the current search");
    assert.ok(list.contains(focusedOption), "refresh retains the focused option in the live menu");
    assert.equal(document.activeElement, focusedOption);
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

    const buildsBeforeMutation = list.writes.replaceChildren;
    const alpha = firstGroup.children[0];
    alpha.textContent = "Updated alpha";
    alpha.value = "updated-alpha";
    firstGroup.label = "Updated group";
    const readsBeforeMutation = optionReads;
    mutationCallback([
      { type: "childList", target: alpha, addedNodes: [] },
      { type: "attributes", target: alpha, attributeName: "value" },
      { type: "attributes", target: firstGroup, attributeName: "label" },
    ]);
    assert.equal(list.writes.replaceChildren, buildsBeforeMutation + 1, "one mutation batch rebuilds each changed select once");
    assert.equal(optionReads - readsBeforeMutation, 2, "the mutation batch reads native options for a single sync");
    assert.equal(list.children[0].children[0].textContent, "Updated group");
    assert.equal(list.children[0].children[1].textContent, "Updated alpha");
    assert.equal(list.children[0].children[1].dataset.value, "updated-alpha");
    alpha.disabled = true;
    mutationCallback([{ type: "attributes", target: alpha, attributeName: "disabled" }]);
    assert.equal(list.children[0].children[1].disabled, true, "native disabled changes reach the menu");
    select.title = "Updated title";
    select.disabled = true;
    select.classList.add("mt-2");
    mutationCallback([{ type: "attributes", target: select, attributeName: "disabled" }]);
    assert.equal(button.disabled, true);
    assert.equal(button.title, "Updated title");
    assert.ok(shell.classList.contains("mt-2"));
    select.setAttribute("aria-label", "Explicit field name");
    mutationCallback([{ type: "attributes", target: select, attributeName: "aria-label" }]);
    assert.equal(button.getAttribute("aria-label"), "Explicit field name");
    select.removeAttribute("aria-label");
    labelText.textContent = "Renamed field";
    syncStyledSelect(select);
    assert.equal(button.getAttribute("aria-label"), "Renamed field", "a changed label is read on every refresh");
    labelText.setAttribute("data-i18n", "Actual field key");
    syncStyledSelect(select);
    assert.equal(button.getAttribute("data-i18n-aria-label"), "Actual field key", "visual label keys remain discoverable outside the shell");
    assert.equal(button.getAttribute("aria-label"), "Actual field key");
    assert.ok(["label", "value", "selected", "data-i18n-aria-label"].every((name) => observerOptions.attributeFilter.includes(name)));
    const writesBeforeOwnMutation = countWrites(shell);
    mutationCallback([{ type: "attributes", target: button, attributeName: "aria-label" }]);
    assert.equal(countWrites(shell), writesBeforeOwnMutation, "surface attribute mutations do not resync the native select");
    const scansBeforeOwnMutation = scans;
    mutationCallback([{ type: "childList", target: list, addedNodes: [list.children[0]] }]);
    await Promise.resolve();
    assert.equal(scans, scansBeforeOwnMutation, "menu rebuild mutations do not rescan the document");

    const unrelatedPanel = makeNode(document);
    document.body.appendChild(unrelatedPanel);
    mutationCallback([{ type: "childList", target: document.body, addedNodes: [unrelatedPanel] }]);
    await Promise.resolve();
    assert.equal(scans, scansBeforeOwnMutation, "unrelated DOM updates do not trigger a full document scan");

    const makeDynamicSelect = () => {
      const dynamicSelect = makeNode(document, "select");
      dynamicSelect.classList.add("select-input");
      dynamicSelect.setAttribute("data-i18n-aria-label", "Actual field key");
      const dynamicOption = makeNode(document, "option");
      dynamicOption.value = "dynamic";
      dynamicOption.textContent = "Dynamic option";
      dynamicSelect.appendChild(dynamicOption);
      Object.defineProperty(dynamicSelect, "options", { get: () => dynamicSelect.children });
      Object.defineProperty(dynamicSelect, "selectedOptions", { get: () => [dynamicOption] });
      return dynamicSelect;
    };
    const directSelect = makeDynamicSelect();
    document.body.appendChild(directSelect);
    mutationCallback([{ type: "childList", target: document.body, addedNodes: [directSelect] }]);
    await Promise.resolve();
    assert.equal(directSelect.dataset.appSelectEnhanced, "true", "a directly inserted select root is enhanced");
    assert.equal(scans, scansBeforeOwnMutation, "incremental enhancement does not query the document");

    const nestedContainer = makeNode(document);
    const nestedChild = makeNode(document);
    const nestedSelect = makeDynamicSelect();
    nestedContainer.appendChild(nestedChild);
    nestedChild.appendChild(nestedSelect);
    document.body.appendChild(nestedContainer);
    mutationCallback([{ type: "childList", target: document.body, addedNodes: [nestedContainer, nestedChild] }]);
    await Promise.resolve();
    assert.equal(nestedContainer.querySelectorAllCalls, 1, "the outermost added root is scanned once");
    assert.equal(nestedChild.querySelectorAllCalls || 0, 0, "an added child root is covered by its ancestor scan");
    assert.equal(nestedSelect.dataset.appSelectEnhanced, "true", "a select under deduplicated roots is enhanced");

    const siblingRoots = Array.from({ length: 64 }, () => makeNode(document));
    document.body.append(...siblingRoots);
    mutationCallback([{ type: "childList", target: document.body, addedNodes: siblingRoots }]);
    await Promise.resolve();
    const siblingContainsCalls = siblingRoots.reduce((total, root) => total + (root.containsCalls || 0), 0);
    assert.ok(siblingContainsCalls <= siblingRoots.length * 2,
      "batch root deduplication uses linear parent walks instead of pairwise contains comparisons");

    const removedSelect = makeDynamicSelect();
    document.body.appendChild(removedSelect);
    mutationCallback([{ type: "childList", target: document.body, addedNodes: [removedSelect] }]);
    document.body.children.splice(document.body.children.indexOf(removedSelect), 1);
    removedSelect.parentNode = null;
    removedSelect.parentElement = null;
    await Promise.resolve();
    assert.notEqual(removedSelect.dataset.appSelectEnhanced, "true", "a root removed before the microtask is skipped");

    const { state } = await import("../js/core/state.js");
    const originalLanguage = state.currentLanguage;
    const originalLocales = state.locales;
    try {
      setCurrentLanguage(state, "zh");
      applyBaseLocalizationSnapshot(state, { uiLocales: {
        ...originalLocales?.ui,
        "Actual field key": { en: "Field", zh: "字段" },
        "Search options": { en: "Search options", zh: "搜索选项" },
        "No matching options": { en: "No matching options", zh: "无匹配选项" },
      } });
      const buildsBeforeLanguage = list.writes.replaceChildren;
      syncStyledSelect(select);
      assert.equal(button.getAttribute("aria-label"), "字段");
      assert.equal(search.placeholder, "搜索选项");
      assert.equal(search.getAttribute("aria-label"), "搜索选项");
      assert.equal(noMatches.textContent, "无匹配选项");
      assert.equal(list.writes.replaceChildren, buildsBeforeLanguage, "translated shell strings alone do not rebuild options");
      alpha.textContent = "翻译后的 Alpha";
      select.value = "updated-alpha";
      syncStyledSelect(select);
      assert.equal(button.children[0].textContent, "翻译后的 Alpha");
      assert.equal(list.children[0].children[1].textContent, "翻译后的 Alpha", "translated option text reaches the menu");

      const dynamicSelect = makeDynamicSelect();
      const dynamicOption = dynamicSelect.children[0];
      dynamicOption.textContent = "新选项";
      dynamicOption.selected = true;
      const dynamicContainer = makeNode(document);
      document.body.appendChild(dynamicContainer);
      selects.push(dynamicSelect);
      mutationCallback([{ type: "childList", target: document.body, addedNodes: [dynamicContainer] }]);
      dynamicContainer.appendChild(dynamicSelect);
      mutationCallback([{ type: "childList", target: dynamicContainer, addedNodes: [dynamicSelect] }]);
      await Promise.resolve();
      assert.equal(dynamicSelect.dataset.appSelectEnhanced, "true", "new select containers are still enhanced after initialization");
      assert.equal(dynamicSelect.parentNode.children[1].getAttribute("aria-label"), "字段", "new selects read the current language even without a language change");
    } finally {
      setCurrentLanguage(state, originalLanguage);
      applyBaseLocalizationSnapshot(state, { uiLocales: originalLocales.ui, geoLocales: originalLocales.geo });
    }
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.MutationObserver = originalObserver;
  }
});

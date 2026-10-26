import test from "node:test";
import assert from "node:assert/strict";
import { initEditorWorkspace } from "../js/ui/editor_workspace.js";

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
  prepend(...nodes) {
    this.append(...nodes);
    this.children = [...nodes, ...this.children.filter((node) => !nodes.includes(node))];
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  click() { for (const callback of this.listeners.get("click") || []) callback({ target: this }); }
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

function mount(context, initialSearch = "") {
  const documentRef = new Element("document");
  documentRef.body = new Element("body");
  documentRef.append(documentRef.body);
  documentRef.createElement = (tag) => {
    const node = new Element(tag);
    node.ownerDocument = documentRef;
    return node;
  };
  documentRef.getElementById = (id) => documentRef.querySelector(`#${id}`);
  const add = (id, parent = documentRef.body, tag = "div") => {
    const node = new Element(tag);
    node.id = id;
    parent.append(node);
    return node;
  };
  const left = add("leftSidebarContent");
  const right = add("rightSidebarContent");
  add("editorProjectBar");
  for (const [sectionId, detailId] of [
    ["countryInspectorSection", "countryInspectorDetail"],
    ["waterInspectorSection", "waterInspectorDetail"],
    ["specialRegionInspectorSection", "specialRegionInspectorDetail"],
  ]) {
    const section = add(sectionId, left, "details");
    add(detailId, section);
    if (sectionId === "countryInspectorSection") add("countryList", section);
  }
  const panels = [];
  for (const key of ["borders", "cities"]) {
    const trigger = add(`layer-${key}`, left, "button");
    trigger.setAttribute("data-appearance-tab", key);
    trigger.setAttribute("role", "tab");
    trigger.textContent = key;
    const panel = add(`panel-${key}`, right);
    panel.setAttribute("data-appearance-panel", key);
    panels.push(panel);
    trigger.addEventListener("click", () => {
      for (const item of panels) item.hidden = item !== panel;
    });
  }
  add("projectSidebarPanel", right);
  add("inspectorSidebarTabProject", left, "button");
  const previous = { matchMedia: globalThis.matchMedia, MutationObserver: globalThis.MutationObserver };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.MutationObserver = class { observe() {} };
  context.after(() => Object.assign(globalThis, previous));
  const navigations = [];
  const sidebarTabs = [];
  const workspace = initEditorWorkspace({
    documentRef, initialSearch, t: (key) => key,
    setSidebarTab: (key) => sidebarTabs.push(key),
    setStrategicMode: () => {}, toggleInspector: () => {},
    onNavigate: (key) => navigations.push(key),
  });
  return { workspace, documentRef, get: documentRef.getElementById, right, navigations, sidebarTabs };
}

function expectProperty(h, key, segment) {
  assert.equal(h.right.dataset.editorContext, key);
  assert.equal(h.get(`editorProperty-${key}`).hidden, false);
  for (const name of ["Inspector", "Layers"]) {
    assert.equal(h.get(`editorSegment${name}`).getAttribute("aria-selected"), String(name === segment));
  }
  assert.equal(h.get(`editorSegment${segment}`).getAttribute("aria-controls"), `editorProperty-${key}`);
  assert.equal(h.navigations.at(-1), key);
}

test("showProperty selects the owning segment and keeps only its property visible", (context) => {
  const h = mount(context);
  assert.equal(h.get("editorPropertySegments").getAttribute("role"), "tablist");
  for (const [name, label] of [["Inspector", "Inspector"], ["Layers", "Layer settings"]]) {
    const segment = h.get(`editorSegment${name}`);
    assert.equal(segment.getAttribute("role"), "tab");
    assert.equal(segment.dataset.i18n, label);
    assert.equal(segment.textContent, label);
  }
  h.workspace.showProperty("data-appearance-panel-borders");
  expectProperty(h, "data-appearance-panel-borders", "Layers");
  assert.equal(h.get("editorProperty-countries").hidden, true);
  h.workspace.showProperty("countries");
  expectProperty(h, "countries", "Inspector");
  assert.equal(h.get("editorProperty-data-appearance-panel-borders").hidden, true);
  h.workspace.showProperty("project");
  expectProperty(h, "project", "Inspector");
  assert.equal(h.sidebarTabs.at(-1), "project");
});

test("segment clicks start at the first property and restore each segment's last property", (context) => {
  const h = mount(context);
  const countryDetail = h.get("countryInspectorDetail");
  h.get("editorSegmentLayers").click();
  expectProperty(h, "data-appearance-panel-borders", "Layers");
  h.get("layer-cities").click();
  h.get("editorSegmentInspector").click();
  expectProperty(h, "countries", "Inspector");
  assert.equal(h.get("countryInspectorDetail"), countryDetail);
  h.workspace.showProperty("water");
  h.get("editorSegmentLayers").click();
  expectProperty(h, "data-appearance-panel-cities", "Layers");
  assert.equal(h.get("panel-cities").hidden, false);
  h.get("editorSegmentInspector").click();
  expectProperty(h, "water", "Inspector");
  h.workspace.showProperty("project");
  h.get("editorSegmentLayers").click();
  h.get("editorSegmentInspector").click();
  expectProperty(h, "project", "Inspector");
});

for (const [section, key, segment] of [
  ["countries", "countries", "Inspector"],
  ["data-appearance-panel-cities", "data-appearance-panel-cities", "Layers"],
  ["panel-cities", "data-appearance-panel-cities", "Layers"],
  ["project", "project", "Inspector"],
]) {
  test(`section deep link ${section} opens the matching property and segment`, (context) => {
    const h = mount(context, `?section=${section}`);
    expectProperty(h, key, segment);
  });
}

test("Back restores the previous segment, focus and scroll, then hides when history is empty", (context) => {
  const h = mount(context);
  const back = h.get("editorPropertiesBackBtn");
  const title = h.get("editorPropertiesTitle");
  assert.equal(back.tagName, "BUTTON");
  assert.equal(back.hidden, true);
  const rememberScroll = (offset) => {
    h.right.scrollTop = offset;
    for (const callback of h.right.listeners.get("scroll")) callback();
  };
  h.workspace.showProperty("countries");
  rememberScroll(120);
  h.get("editorSegmentLayers").click();
  expectProperty(h, "data-appearance-panel-borders", "Layers");
  assert.equal(back.hidden, false);
  rememberScroll(72);
  h.get("editorSegmentInspector").click();
  expectProperty(h, "countries", "Inspector");
  back.click();
  expectProperty(h, "data-appearance-panel-borders", "Layers");
  assert.equal(h.right.scrollTop, 72);
  assert.equal(h.documentRef.activeElement, title);
  assert.deepEqual(title.focusOptions, { preventScroll: true });
  assert.equal(back.hidden, false);
  back.click();
  expectProperty(h, "countries", "Inspector");
  assert.equal(h.right.scrollTop, 120);
  assert.equal(h.documentRef.activeElement, title);
  assert.equal(back.hidden, true);
});

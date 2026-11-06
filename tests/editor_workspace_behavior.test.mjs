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

function mount(context, initialSearch = "", { countrySelected = true } = {}) {
  const documentRef = new Element("document");
  documentRef.body = new Element("body");
  documentRef.append(documentRef.body);
  documentRef.createElement = (tag) => {
    const node = new Element(tag);
    node.ownerDocument = documentRef;
    return node;
  };
  documentRef.createElementNS = (_, tag) => documentRef.createElement(tag);
  documentRef.getElementById = (id) => documentRef.querySelector(`#${id}`);
  const add = (id, parent = documentRef.body, tag = "div") => {
    const node = new Element(tag);
    node.id = id;
    node.ownerDocument = documentRef;
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
    const detail = add(detailId, section);
    if (detailId === "countryInspectorDetail" && !countrySelected) detail.classList.add("hidden");
    if (sectionId === "countryInspectorSection") add("countryList", section);
  }
  const panels = [];
  for (const key of ["borders", "physical", "urban", "citypoints", "transport", "presets", "ocean", "thematic", "daynight", "texture", "rivers"]) {
    const trigger = add(`layer-${key}`, left, "button");
    const content = ["ocean", "thematic", "daynight", "texture", "rivers"].includes(key);
    trigger.setAttribute(content ? "data-map-content-tab" : "data-appearance-tab", key);
    trigger.setAttribute("role", "tab");
    trigger.textContent = key;
    const panel = add(`panel-${key}`, right);
    panel.setAttribute(content ? "data-map-content-panel" : "data-appearance-panel", key);
    panels.push(panel);
    trigger.addEventListener("click", () => {
      for (const item of panels) item.hidden = item !== panel;
    });
  }
  const qualityRow = add("qualityRow", documentRef.getElementById("panel-borders"));
  qualityRow.className = "border-control-row";
  add("displayQuality", qualityRow, "select");
  const experiment = add("experiment", documentRef.getElementById("panel-borders"), "details");
  add("politicalRenderMode", experiment, "select");
  add("specialZonePopover", right);
  add("legendProjectSection", right, "details");
  add("transportProjectSection", left, "details");
  for (const id of ["togglePhysical", "toggleUrban", "toggleCityPoints", "toggleRivers", "dayNightEnabled", "transportAppearanceMasterToggle", "scenarioSpecialRegionVisibilityToggle"]) {
    add(id, right, "input").checked = true;
  }
  add("projectSidebarPanel", right);
  add("frontlineProjectSection", right, "details");
  const utilities = add("inspectorUtilitiesSection", right);
  add("utilitiesGuideBtn", utilities, "button");
  add("dockReferenceBtn", utilities, "button");
  const reference = add("dockReferencePopover", utilities);
  reference.classList.add("hidden");
  reference.setAttribute("role", "dialog");
  reference.setAttribute("aria-hidden", "true");
  add("referenceOpacity", reference, "input");
  add("strategicCommandBar");
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
  if (segment) {
    const tab = h.get(`editorSegment${segment}`);
    const panel = h.get(tab.getAttribute("aria-controls"));
    assert.equal(panel.id, `editorProperty-${key}`);
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
    assert.equal(tab.getAttribute("tabindex"), "0");
  }
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
  expectProperty(h, "project", null);
  assert.equal(h.sidebarTabs.at(-1), "project");
});

test("Project preserves the last object inspector and its panel association", (context) => {
  const h = mount(context);
  for (const key of ["countries", "water", "special"]) {
    h.workspace.selectObject(key);
    const detail = h.get(`editorProperty-${key}`).children[0];
    h.get("inspectorSidebarTabProject").click();
    expectProperty(h, "project", null);
    assert.equal(h.get("editorSegmentInspector").getAttribute("aria-controls"), `editorProperty-${key}`);
    assert.equal(h.get("editorSegmentInspector").getAttribute("tabindex"), "0");
    h.get("editorSegmentInspector").click();
    expectProperty(h, key, "Inspector");
    assert.equal(h.get(`editorProperty-${key}`).children[0], detail);
  }
});

test("Inspector returns to its existing empty state when no country is selected", (context) => {
  const h = mount(context, "", { countrySelected: false });
  h.get("inspectorSidebarTabProject").click();
  h.get("editorSegmentInspector").click();
  expectProperty(h, "countries", "Inspector");
  assert.equal(h.get("countryInspectorDetail").classList.contains("hidden"), true);
  const hint = h.get("editorProperty-countries").querySelector(".editor-empty-hint");
  assert.equal(hint.hidden, false);
  assert.equal(hint.textContent, "Select a country to view its properties.");
});

test("property tabs switch with arrows and Home/End, moving focus and the tab stop", (context) => {
  const h = mount(context);
  const inspector = h.get("editorSegmentInspector");
  const layers = h.get("editorSegmentLayers");
  const press = (tab, key, target, property, segment) => {
    let prevented = false;
    for (const callback of tab.listeners.get("keydown")) {
      callback({ key, preventDefault: () => { prevented = true; } });
    }
    assert.equal(prevented, true);
    assert.equal(h.documentRef.activeElement, target);
    expectProperty(h, property, segment);
    for (const button of [inspector, layers]) {
      assert.equal(button.getAttribute("tabindex"), button === target ? "0" : "-1");
    }
  };
  assert.equal(inspector.getAttribute("tabindex"), "0");
  assert.equal(layers.getAttribute("tabindex"), "-1");
  press(inspector, "ArrowRight", layers, "data-appearance-panel-borders", "Layers");
  press(layers, "ArrowRight", inspector, "countries", "Inspector");
  press(inspector, "ArrowLeft", layers, "data-appearance-panel-borders", "Layers");
  press(layers, "ArrowLeft", inspector, "countries", "Inspector");
  press(inspector, "End", layers, "data-appearance-panel-borders", "Layers");
  press(layers, "Home", inspector, "countries", "Inspector");
});

test("property segments occupy a separate header row from the title and annotation controls", (context) => {
  const h = mount(context);
  const segments = h.get("editorPropertySegments");
  const title = h.get("editorPropertiesTitle");
  const strategy = h.get("editorStrategicModeBtn");
  assert.deepEqual(segments.parentNode.children, [segments, title.parentNode]);
  assert.deepEqual(title.parentNode.children, [h.get("editorPropertiesBackBtn"), title]);
  assert.notEqual(segments.parentNode, strategy.parentNode);
  assert.equal(strategy.parentNode, h.get("editorProperty-annotations"));
  assert.equal(h.get("editorFinishAnnotationsBtn").parentNode, h.get("strategicCommandBar"));
});

test("segment clicks start at the first property and restore each segment's last property", (context) => {
  const h = mount(context);
  const countryDetail = h.get("countryInspectorDetail");
  h.get("editorSegmentLayers").click();
  expectProperty(h, "data-appearance-panel-borders", "Layers");
  h.get("layer-citypoints").click();
  h.get("editorSegmentInspector").click();
  expectProperty(h, "countries", "Inspector");
  assert.equal(h.get("countryInspectorDetail"), countryDetail);
  h.workspace.showProperty("water");
  h.get("editorSegmentLayers").click();
  expectProperty(h, "data-appearance-panel-citypoints", "Layers");
  assert.equal(h.get("panel-citypoints").hidden, false);
  h.get("editorSegmentInspector").click();
  expectProperty(h, "water", "Inspector");
  h.workspace.showProperty("project");
  h.get("editorSegmentLayers").click();
  h.get("editorSegmentInspector").click();
  expectProperty(h, "water", "Inspector");
});

for (const [section, key, segment] of [
  ["countries", "countries", "Inspector"],
  ["data-appearance-panel-citypoints", "data-appearance-panel-citypoints", "Layers"],
  ["panel-citypoints", "data-appearance-panel-citypoints", "Layers"],
  ["project", "project", null],
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


test("Layers owns persistent reference settings and removes Assets", (context) => {
  const h = mount(context);
  assert.equal(h.get("editorTaskAssetsBtn"), null);
  const entry = h.get("editorLayer-reference");
  assert.equal(h.get("editorTask-layers").contains(entry), true);
  const input = h.get("referenceOpacity");
  entry.click();
  expectProperty(h, "reference", "Layers");
  assert.equal(h.get("leftSidebarContent").dataset.editorTask, "layers");
  assert.equal(h.get("dockReferencePopover").classList.contains("hidden"), false);
  assert.equal(h.get("dockReferencePopover").getAttribute("role"), null);
  assert.equal(h.get("editorProperty-reference").contains(input), true);
  assert.equal(h.get("utilitiesGuideBtn").hidden, true);
  h.workspace.selectObject("countries");
  h.get("dockReferenceBtn").click();
  expectProperty(h, "reference", "Layers");
});

test("reference deep link selects Layers and reference settings", (context) => {
  const h = mount(context, "?view=reference");
  expectProperty(h, "reference", "Layers");
  assert.equal(h.get("leftSidebarContent").dataset.editorTask, "layers");
  assert.equal(h.get("editorLayer-reference").getAttribute("aria-pressed"), "true");
});


test("layer groups follow map order and display moves existing controls", (context) => {
  const h = mount(context);
  const groups = h.get("editorTask-layers").querySelectorAll(".editor-layer-group");
  assert.deepEqual(groups.map((g) => g.querySelector(".editor-group-heading").textContent), ["Political", "Geography", "Settlements & transport", "Data & annotations", "Map appearance"]);
  assert.deepEqual(groups.map((g) => g.querySelectorAll(".editor-layer-row").map((r) => r.dataset.layerKey)), [
    ["borders", "special-zones"], ["ocean", "physical", "rivers"], ["urban", "citypoints", "transport"],
    ["thematic", "annotations", "legend"], ["presets", "daynight", "texture", "reference", "display"],
  ]);
  assert.equal(h.get("transportProjectSection").parentNode, groups[2]);
  h.get("editorLayer-display").click();
  expectProperty(h, "display", "Layers");
  assert.equal(h.get("displayQuality").parentNode, h.get("qualityRow"));
  assert.equal(h.get("qualityRow").parentNode, h.get("editorProperty-display"));
  assert.equal(h.get("experiment").parentNode, h.get("editorProperty-display"));
});

test("visibility switches dispatch change and synchronize without navigating", (context) => {
  const h = mount(context);
  for (const [key, id] of Object.entries({ physical: "togglePhysical", urban: "toggleUrban", citypoints: "toggleCityPoints", rivers: "toggleRivers", daynight: "dayNightEnabled", transport: "transportAppearanceMasterToggle", "special-zones": "scenarioSpecialRegionVisibilityToggle" })) {
    const row = h.get("editorTask-layers").querySelectorAll(".editor-layer-row").find((r) => r.dataset.layerKey === key);
    const toggle = row.querySelector(".editor-layer-visibility");
    const checkbox = h.get(id);
    let changes = 0;
    checkbox.addEventListener("change", (event) => { changes++; assert.equal(event.bubbles, true); });
    toggle.click();
    assert.equal(checkbox.checked, false);
    assert.equal(changes, 1);
    assert.equal(toggle.getAttribute("aria-pressed"), "false");
    assert.equal(toggle.dataset.uiIcon, "eye-off");
    assert.equal(h.right.dataset.editorContext, "countries");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    assert.equal(toggle.getAttribute("aria-pressed"), "true");
    checkbox.checked = false;
    h.workspace.selectTask("layers");
    assert.equal(toggle.getAttribute("aria-pressed"), "false");
  }
});

test("layer search filters groups, shows empty state, and Escape clears it", (context) => {
  const h = mount(context);
  const search = h.get("editorLayerSearch");
  const rows = h.get("editorTask-layers").querySelectorAll(".editor-layer-row");
  search.value = "physical";
  search.dispatchEvent(new Event("input"));
  assert.deepEqual(rows.filter((r) => !r.hidden).map((r) => r.dataset.layerKey), ["physical"]);
  assert.equal(h.get("togglePhysical").checked, true);
  search.value = "no matching entry";
  search.dispatchEvent(new Event("input"));
  assert.equal(h.get("editorLayersEmpty").hidden, false);
  assert.equal(h.get("editorTask-layers").querySelectorAll(".editor-layer-group").every((g) => g.hidden), true);
  for (const callback of search.listeners.get("keydown")) callback({ key: "Escape", preventDefault() {} });
  assert.equal(search.value, "");
  assert.equal(rows.every((r) => !r.hidden), true);
  assert.equal(h.get("editorLayersEmpty").hidden, true);
});

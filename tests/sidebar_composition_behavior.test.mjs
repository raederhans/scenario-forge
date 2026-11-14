import assert from "node:assert/strict";
import test from "node:test";
import { createStrategicPanelView } from "../js/ui/sidebar/strategic_panel_view.js";
import { createSidebarLayoutController } from "../js/ui/sidebar/sidebar_layout_controller.js";

class Node extends EventTarget {
  constructor(tagName = "div") {
    super();
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.style = {};
    this.className = "";
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, force = !this.classList.contains(name)) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (force) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
        return force;
      },
      add: (...names) => names.forEach((name) => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach((name) => this.classList.toggle(name, false)),
    };
  }
  appendChild(node) {
    if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get firstElementChild() { return this.children[0]; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  hasAttribute(key) { return this.attributes.has(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  toggleAttribute(key, force) { if (force) this.setAttribute(key, ""); else this.removeAttribute(key); }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector === "details[id]") return this.tagName === "details" && !!this.id;
    if (selector.startsWith("[data-")) {
      const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return key in this.dataset;
    }
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    const space = selector.indexOf(" ");
    if (space !== -1) return this.querySelectorAll(selector.slice(0, space)).flatMap((node) => node.querySelectorAll(selector.slice(space + 1)));
    return this.children.flatMap((node) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
}

function setup(context) {
  const document = new Node("document");
  document.body = new Node("body");
  document.appendChild(document.body);
  document.createElement = (tag) => new Node(tag);
  document.createElementNS = (_, tag) => new Node(tag);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  const media = [];
  const storage = new Map();
  const writes = [];
  const location = new URL("https://localhost/editor");
  const windowEvents = new EventTarget();
  const frames = new Map();
  let frameId = 0;
  const globals = {
    document, window: globalThis, innerWidth: 1440, innerHeight: 900,
    HTMLDetailsElement: Node, location,
    history: { replaceState(_, __, url) { location.href = new URL(url, location).href; } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem(key, value) { storage.set(key, value); writes.push([key, value]); } },
    matchMedia(query) {
      const result = new EventTarget();
      Object.defineProperty(result, "matches", { get: () => globalThis.innerWidth >= 1024 && (!query.includes("1279") || globalThis.innerWidth < 1280) });
      media.push(result);
      return result;
    },
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout: () => 1, clearTimeout: () => {},
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    context.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }
  const add = (id, parent = document.body, tag = "div") => {
    const node = new Node(tag);
    node.id = id;
    parent.appendChild(node);
    return node;
  };
  const sidebar = add("rightSidebar");
  const leftSidebar = add("leftSidebar");
  const list = add("countryList", sidebar);
  const presetTree = add("presetTree", sidebar);
  for (const side of ["left", "right"]) {
    add(`${side}SidebarContent`, side === "left" ? leftSidebar : sidebar);
    add(`${side}SidebarCollapseBtn`, side === "left" ? leftSidebar : sidebar, "button");
  }
  for (const tab of ["inspector", "project"]) {
    const button = add(`${tab}Tab`, sidebar, "button");
    button.dataset.inspectorTab = tab;
    button.setAttribute("role", "tab");
    add(`${tab}Panel`, sidebar).dataset.inspectorPanel = tab;
  }
  const runtimeState = { ui: {}, currentTool: "select" };
  const refreshes = [];
  const properties = [];
  const createLayout = () => createSidebarLayoutController({
    runtimeState, sidebar, leftSidebar, list, presetTree, t: (label) => label,
    refreshStrategicOverlay: (options) => refreshes.push(options), showProperty: (kind) => properties.push(kind),
    getCountryInspectorColorPickerOpen: () => false,
    closeCountryInspectorColorPicker() {}, closeWaterInspectorColorPicker() {}, closeSpecialRegionColorPicker() {},
  });
  return { document, add, runtimeState, createLayout, refreshes, properties, storage, writes, media, location, frames };
}

test("strategic view constructs controller elements and reuses the existing panel and events", (context) => {
  const env = setup(context);
  const frontlineTabStack = env.add("frontlineTabStack");
  let deletes = 0;
  let refreshes = 0;
  const createView = () => createStrategicPanelView({
    frontlineTabStack, runtimeState: env.runtimeState, countryNames: {}, t: (label) => label,
    getDirectGeoLabel: (label) => label, getScenarioCountryMeta: () => null,
    ensureCountryPaletteColor: () => "#123456", getDynamicCountryEntries: () => [],
    deleteSelectedOperationGraphicVertex: () => deletes++, refreshStrategicOverlayUI: () => refreshes++,
  });
  const first = createView();
  for (const [name, element] of Object.entries(first.elements)) {
    assert.ok(Array.isArray(element) ? element.length > 0 : element, name);
  }
  assert.equal(first.helpers.getUnitCounterPresetMeta("INF").id, "INF");
  assert.equal(first.helpers.resolveUnitCounterCombatState({ organizationPct: 120 }).organizationPct, 100);
  const second = createView();
  assert.equal(first.elements.strategicOverlaySection, second.elements.strategicOverlaySection);
  assert.equal(frontlineTabStack.children.length, 1);
  first.elements.operationGraphicDeleteVertexBtn.dispatchEvent(new Event("pointerdown"));
  first.elements.operationGraphicDeleteVertexBtn.dispatchEvent(new Event("click"));
  assert.equal(deletes, 1);
  assert.equal(refreshes, 1);
  const accordion = env.document.getElementById("accordionLines");
  accordion.firstElementChild.dispatchEvent(new Event("click"));
  assert.equal(accordion.classList.contains("is-open"), false);
});

test("repeated layout initialization binds tab, collapse, and media events once", (context) => {
  const env = setup(context);
  const first = env.createLayout();
  first.restoreCollapsedState();
  first.bindEvents();
  const second = env.createLayout();
  second.restoreCollapsedState();
  second.bindEvents();
  env.refreshes.length = 0;
  env.document.getElementById("projectTab").dispatchEvent(new Event("click"));
  assert.equal(env.refreshes.length, 1);
  env.document.getElementById("rightSidebarCollapseBtn").dispatchEvent(new Event("click"));
  assert.equal(env.writes.length, 2);
  assert.equal(env.document.body.classList.contains("right-sidebar-collapsed"), true);
  env.frames.clear();
  globalThis.innerWidth = 1100;
  env.media.forEach((media) => media.dispatchEvent(new Event("change")));
  assert.equal(env.frames.size, 1);
});

test("URL restoration selects the matching tab, panel, and disclosure", (context) => {
  const env = setup(context);
  const details = env.add("exportProjectSection", env.document.getElementById("projectPanel"), "details");
  env.location.search = "?scope=current-project&view=export&section=exportProjectSection";
  const controller = env.createLayout();
  controller.setRightSidebarTab(controller.restoreRightSidebarUrlState());
  assert.equal(env.runtimeState.ui.rightSidebarTab, "project");
  assert.equal(env.document.getElementById("projectTab").getAttribute("aria-selected"), "true");
  assert.equal(env.document.getElementById("projectPanel").hidden, false);
  assert.equal(env.document.getElementById("inspectorPanel").hidden, true);
  assert.equal(details.open, true);
  assert.equal(env.location.searchParams.get("view"), "export");
  controller.setRightSidebarTab("inspector");
  assert.equal(env.location.searchParams.get("scope"), "current-object");
  assert.equal(env.location.searchParams.has("view"), false);
});

test("collapse restores preferences and compact changes do not overwrite desktop storage", (context) => {
  const env = setup(context);
  env.storage.set("map_left_sidebar_collapsed", "true");
  env.storage.set("map_right_sidebar_collapsed", "false");
  const controller = env.createLayout();
  controller.restoreCollapsedState();
  controller.bindEvents();
  assert.equal(env.document.body.classList.contains("left-sidebar-collapsed"), true);
  assert.equal(env.writes.length, 0);
  controller.setRightSidebarCollapsed(true);
  assert.equal(env.storage.get("map_right_sidebar_collapsed"), "true");
  const writes = env.writes.length;
  globalThis.innerWidth = 1100;
  env.media.forEach((media) => media.dispatchEvent(new Event("change")));
  controller.setRightSidebarCollapsed(false);
  assert.equal(env.document.body.classList.contains("right-sidebar-collapsed"), false);
  assert.equal(env.writes.length, writes);
  globalThis.innerWidth = 1440;
  env.media.forEach((media) => media.dispatchEvent(new Event("change")));
  assert.equal(env.document.body.classList.contains("right-sidebar-collapsed"), true);
  assert.equal(env.document.getElementById("rightSidebarContent").getAttribute("aria-hidden"), "true");
});

test("selection refresh reveals properties once and manual navigation consumes the selection", (context) => {
  const env = setup(context);
  const controller = env.createLayout();
  controller.restoreCollapsedState();
  controller.setRightSidebarCollapsed(true);
  const refresh = controller.withEditorSelection((value) => value);
  env.runtimeState.selectedWaterRegionId = "sea";
  assert.equal(refresh(7), 7);
  refresh(8);
  assert.deepEqual(env.properties, ["water"]);
  assert.equal(env.document.body.classList.contains("right-sidebar-collapsed"), false);
  env.runtimeState.selectedInspectorCountryCode = "GB";
  controller.onNavigate("reference");
  refresh();
  assert.deepEqual(env.properties, ["water"]);
  assert.equal(env.location.searchParams.get("view"), "reference");
});

import assert from "node:assert/strict";
import test from "node:test";
import { TRANSPORT_WORKBENCH_FAMILIES } from "../js/ui/toolbar/transport_workbench_descriptor.js";
import { normalizeTransportWorkbenchUiState } from "../js/core/state_defaults.js";
import { createTransportWorkbenchStateOwner } from "../js/ui/toolbar/transport_workbench_state_owner.js";

import {
  createTransportWorkbenchRightDeckOwner,
} from "../js/ui/toolbar/transport_workbench_right_deck_owner.js";

class TestClassList {
  constructor(node) {
    this.node = node;
  }

  add(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.add(token));
    this.node.className = Array.from(values).join(" ");
  }

  remove(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.delete(token));
    this.node.className = Array.from(values).join(" ");
  }

  contains(token) {
    return String(this.node.className || "").split(/\s+/).includes(token);
  }

  toggle(token, force) {
    const shouldAdd = force === undefined ? !this.contains(token) : !!force;
    if (shouldAdd) {
      this.add(token);
    } else {
      this.remove(token);
    }
    return shouldAdd;
  }
}

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.classList = new TestClassList(this);
    this.textContent = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.replaceChildrenCallCount = 0;
  }

  get childElementCount() {
    return this.children.length;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    node.parentNode = this;
    return node;
  }

  prepend(...nodes) {
    nodes.reverse().forEach((node) => {
      this.children.unshift(node);
      node.parentNode = this;
    });
  }

  replaceChildren(...nodes) {
    this.replaceChildrenCallCount += 1;
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || "";
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    const nextEvent = {
      preventDefault() {},
      ...event,
    };
    for (const handler of this.listeners.get(type) || []) {
      handler(nextEvent);
    }
  }
}

function createTestDocument() {
  return {
    createElement: (tagName) => new TestElement(tagName),
  };
}

function withTestDocument(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();
  try {
    callback();
  } finally {
    globalThis.document = previousDocument;
  }
}

function walk(node) {
  return [node, ...(node.children || []).flatMap(walk)];
}

function findByTag(node, tagName) {
  return walk(node).find((candidate) => candidate.tagName === tagName);
}

function findAllByTag(node, tagName) {
  return walk(node).filter((candidate) => candidate.tagName === tagName);
}

function findByText(node, pattern) {
  return walk(node).find((candidate) => pattern.test(candidate.textContent || ""));
}

function findAllByClass(node, className) {
  return walk(node).filter((candidate) => candidate.classList?.contains(className));
}

function textOf(node) {
  return [node.textContent, ...(node.children || []).map(textOf)].join(" ");
}

function createDisplayConfig(overrides = {}) {
  return {
    mode: "inspect",
    preset: "balanced",
    coverage: "core",
    aggregation: { algorithm: "cluster", thresholds: { cellSizePx: 44, clusterRadiusPx: 48 } },
    labels: { maxLevel: 2, budget: 8, allowAggregation: false, separationStrength: 1 },
    ...overrides,
  };
}

test("right deck owner commits toggle, select, range, and multi controls", () => withTestDocument(() => {
  const events = [];
  const owner = createTransportWorkbenchRightDeckOwner({
    translate: (value) => `t:${value}`,
    updateFamilyConfig: (familyId, key, nextValue, options = {}) => events.push([familyId, key, nextValue, options]),
    getPreviewSnapshot: () => ({ optionsReady: true }),
  });

  const toggle = owner.renderControl("road", { type: "toggle", key: "visible", label: "Visible" }, { visible: false }, false);
  const toggleInput = findByTag(toggle, "input");
  toggleInput.checked = true;
  toggleInput.dispatch("change");

  const select = owner.renderControl("road", {
    type: "select",
    key: "mode",
    label: "Mode",
    options: [{ value: "fast", label: "Fast" }, { value: "slow", label: "Slow" }],
  }, { mode: "fast" }, false);
  const selectInput = findByTag(select, "select");
  selectInput.value = "slow";
  selectInput.dispatch("change");

  const range = owner.renderControl("road", { type: "range", key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.1 }, { opacity: 0.5 }, false);
  const rangeInput = findByTag(range, "input");
  rangeInput.value = "0.7";
  rangeInput.dispatch("input");
  assert.match(textOf(range), /0\.7/);
  rangeInput.dispatch("change");

  const multi = owner.renderControl("road", {
    type: "multi",
    key: "lanes",
    label: "Lanes",
    options: [{ value: "primary", label: "Primary" }, { value: "secondary", label: "Secondary" }],
  }, { lanes: ["primary"] }, false);
  const multiInputs = findAllByTag(multi, "input");
  multiInputs[1].checked = true;
  multiInputs[1].dispatch("change");

  assert.deepEqual(events, [
    ["road", "visible", true, {}],
    ["road", "mode", "slow", {}],
    ["road", "opacity", 0.7, {}],
    ["road", "lanes", true, { appendValue: "secondary" }],
  ]);
}));

test("right deck owner keeps compare-held controls disabled and read-only", () => withTestDocument(() => {
  const events = [];
  const owner = createTransportWorkbenchRightDeckOwner({
    updateFamilyConfig: (...args) => events.push(args),
  });

  const field = owner.renderControl("road", { type: "toggle", key: "visible", label: "Visible" }, { visible: true }, true);
  const input = findByTag(field, "input");
  assert.equal(input.disabled, true);
  input.checked = false;
  input.dispatch("change");
  assert.deepEqual(events, []);
}));

test("right deck owner renders only the active control tab", () => withTestDocument(() => {
  const displayMount = new TestElement("div");
  const aggregationMount = new TestElement("div");
  aggregationMount.appendChild(new TestElement("span"));
  const displayPanel = new TestElement("section");
  const aggregationPanel = new TestElement("section");
  const displayButton = new TestElement("button");
  displayButton.dataset.transportInspectorTab = "display";
  const aggregationButton = new TestElement("button");
  aggregationButton.dataset.transportInspectorTab = "aggregation";
  const owner = createTransportWorkbenchRightDeckOwner({
    tabButtons: [displayButton, aggregationButton],
    panels: { display: displayPanel, aggregation: aggregationPanel },
    mounts: { display: displayMount, aggregation: aggregationMount },
    setInspectorTab: () => "display",
    getDisplayConfig: () => ({ mode: "inspect", preset: "balanced" }),
  });

  owner.renderTabs({
    family: { id: "road" },
    config: {},
    compareHeld: false,
    activeTab: "display",
  });

  assert.equal(displayButton.classList.contains("is-active"), true);
  assert.equal(aggregationPanel.classList.contains("hidden"), true);
  assert.match(textOf(displayMount), /Style/);
  assert.equal(aggregationButton.hidden, true);
  assert.equal(aggregationMount.childElementCount, 1);
}));

test("right deck owner preserves section open state and toggle writes", () => withTestDocument(() => {
  const events = [];
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({
    isSectionOpen: (familyId, sectionKey) => familyId === "road" && sectionKey === "style",
    toggleSection: (familyId, sectionKey, nextOpen) => events.push([familyId, sectionKey, nextOpen]),
  });

  owner.renderTabSections(
    { id: "road" },
    { visible: true },
    false,
    "display",
    mount
  );
  const details = findByTag(mount, "details");
  assert.equal(details.open, true);
  details.open = false;
  details.dispatch("toggle");
  assert.deepEqual(events, [["road", "style", false]]);
}));

test("right deck owner updates advanced range text on input and commits on change", () => withTestDocument(() => {
  const events = [];
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({
    getDisplayConfig: () => createDisplayConfig(),
    updateDisplayConfig: (familyId, updateFn) => {
      const draft = {
        aggregation: { thresholds: { clusterRadiusPx: 48 } },
        labels: { separationStrength: 1 },
      };
      updateFn(draft);
      events.push([familyId, draft.aggregation.thresholds.clusterRadiusPx]);
    },
  });

  owner.renderTabSections(
    { id: "mineral_resources" },
    { aggregationClusterRadiusPx: 48 },
    false,
    "display",
    mount
  );
  const ranges = findAllByTag(mount, "input").filter((input) => input.type === "range");
  const advancedRange = findAllByTag(findAllByClass(mount, "transport-workbench-advanced")[0], "input")[0];
  const initialReplaceCount = mount.replaceChildrenCallCount;
  advancedRange.value = "64";
  advancedRange.dispatch("input");
  assert.match(textOf(mount), /64px/);
  assert.deepEqual(events, []);
  assert.equal(mount.replaceChildrenCallCount, initialReplaceCount);
  advancedRange.dispatch("change");

  assert.deepEqual(events, [["mineral_resources", 64]]);
}));

test("right deck owner keeps density shell and advanced controls read-only while compare is held", () => withTestDocument(() => {
  const events = [];
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({
    getDisplayConfig: () => createDisplayConfig(),
    updateDisplayConfig: (...args) => events.push(args),
  });

  owner.renderTabSections(
    { id: "mineral_resources" },
    { aggregationClusterRadiusPx: 48 },
    true,
    "display",
    mount
  );
  const inputs = findAllByTag(mount, "input");
  const selects = findAllByTag(mount, "select");
  assert.equal(inputs.every((input) => input.disabled), true);
  assert.equal(selects.every((select) => select.disabled), true);

  const firstSelect = selects[0];
  firstSelect.value = "square";
  firstSelect.dispatch("change");
  const advancedRange = inputs[inputs.length - 1];
  advancedRange.value = "64";
  advancedRange.dispatch("input");

  assert.deepEqual(events, []);
}));

test("right deck owner keeps density label shell toggle read-only while compare is held", () => withTestDocument(() => {
  const events = [];
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({
    getDisplayConfig: () => createDisplayConfig(),
    updateDisplayConfig: (...args) => events.push(args),
  });

  owner.renderTabSections(
    { id: "mineral_resources" },
    { labelSeparation: 1 },
    true,
    "display",
    mount
  );
  const checkbox = findAllByTag(mount, "input").find((input) => input.type === "checkbox");
  assert.equal(checkbox.disabled, true);
  checkbox.checked = true;
  checkbox.dispatch("change");
  assert.deepEqual(events, []);
}));

test("right deck owner omits diagnostics body in the data tab", () => withTestDocument(() => {
  const events = [];
  const mount = new TestElement("div");
  const diagnosticBody = new TestElement("div");
  diagnosticBody.textContent = "diagnostic-body";
  const owner = createTransportWorkbenchRightDeckOwner({
    renderDiagnosticsBody: (familyId, config) => {
      events.push([familyId, config.visible]);
      return diagnosticBody;
    },
  });

  owner.renderTabSections(
    { id: "road" },
    { visible: true },
    false,
    "data",
    mount
  );

  assert.deepEqual(events, []);
  assert.doesNotMatch(textOf(mount), /diagnostic-body/);
  assert.doesNotMatch(textOf(mount), /Review the current data and loading status/);
}));

test("Data tab keeps source restrictions in collapsed pack details", () => withTestDocument(() => {
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({
    getPreviewSnapshot: () => ({
      status: "ready",
      manifest: { adapter_id: "japan_road_v1", source_policy: "internal review", n06_encoding: "CP932" },
      dataRows: [],
    }),
  });
  owner.renderTabSections({ id: "road" }, {}, false, "data", mount);
  const details = findAllByTag(mount, "details").find((node) => node.className === "transport-workbench-pack-details");
  assert.ok(details);
  assert.equal(details.open, false);
  assert.match(textOf(details), /Source details/);
  assert.doesNotMatch(textOf(details), /Source policy internal review/);
  assert.doesNotMatch(textOf(details), /N06 encoding CP932/);
  assert.match(textOf(details), /Source and use/);
}));

test("right deck owner renders preview data rows and selects rows without mutating config", () => withTestDocument(() => {
  const selectionEvents = [];
  const configEvents = [];
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({
    updateFamilyConfig: (...args) => configEvents.push(args),
    selectPreviewFeature: (familyId, row) => selectionEvents.push([familyId, row.id, row.kind]),
    getPreviewSnapshot: () => ({
      status: "ready",
      packMode: "preview",
      dataRowCount: 20,
      dataRows: [
        {
          id: "road-1",
          kind: "road",
          name: "Route 1",
          source: "osm",
          visible: true,
          lengthMeters: 1200,
          selected: true,
          properties: { road_class: "motorway", ref: "E1" },
        },
        {
          id: "road-2",
          kind: "road",
          name: "Route 2",
          source: "osm",
          visible: false,
          hiddenReason: "class_filtered",
          lengthMeters: 800,
          properties: { road_class: "primary" },
        },
      ],
    }),
  });

  owner.renderTabSections(
    { id: "road" },
    { visible: true },
    false,
    "data",
    mount
  );

  assert.match(textOf(mount), /Loaded Data/);
  assert.match(textOf(mount), /Loaded rows/);
  assert.match(textOf(mount), /Table Rows/);
  const metaItems = findAllByClass(mount, "transport-workbench-data-meta-item").map((item) => textOf(item).replace(/\s+/g, " ").trim());
  assert.deepEqual(metaItems.slice(0, 2), ["Loaded rows 20", "Table Rows 2"]);
  assert.match(textOf(mount), /Search and sort apply to the rows listed here/);
  assert.doesNotMatch(textOf(mount), /bounded row set/);
  assert.match(textOf(mount), /Route 1/);
  assert.match(textOf(mount), /road_class: motorway/);
  const selectedButton = findAllByTag(mount, "button").find((button) => button.dataset.transportDataRowId === "road-1");
  selectedButton.dispatch("click");
  const searchInput = findAllByTag(mount, "input").find((input) => input.type === "search");
  assert.equal(searchInput.placeholder, "Search table rows");
  searchInput.value = "Route 2";
  searchInput.dispatch("input");
  assert.doesNotMatch(textOf(mount), /Route 1/);
  assert.match(textOf(mount), /Route 2/);
  searchInput.value = "Route 99";
  searchInput.dispatch("input");
  assert.doesNotMatch(textOf(mount), /Route 1/);
  assert.doesNotMatch(textOf(mount), /Route 2/);
  const locationToggle = findAllByTag(mount, "input").find((input) => input.dataset.transportDataColumn === "location");
  locationToggle.checked = false;
  locationToggle.dispatch("change");
  const tableHeaders = findAllByTag(mount, "th").map((header) => header.textContent);
  assert.deepEqual(tableHeaders, ["Name", "Edit", "Kind", "Visible", "Source"]);

  assert.deepEqual(selectionEvents, [["road", "road-1", "road"]]);
  assert.deepEqual(configEvents, []);
}));

test("right deck owner marks point data rows with edit status", () => withTestDocument(() => {
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({
    getPreviewSnapshot: () => ({
      status: "ready",
      packMode: "preview",
      dataRowCount: 4,
      dataRows: [
        {
          id: "airport_source_1",
          kind: "airport",
          name: "Source Airport",
          source: "source-pack",
          visible: true,
          lon: 139.7,
          lat: 35.6,
          properties: {},
        },
        {
          id: "airport_source_2",
          kind: "airport",
          name: "Updated Airport",
          source: "source-pack",
          visible: true,
          lon: 139.8,
          lat: 35.7,
          properties: { edit_overlay_mode: "updated" },
        },
        {
          id: "airport_edit_1",
          kind: "airport",
          name: "Created Airport",
          source: "user_overlay",
          visible: true,
          lon: 139.9,
          lat: 35.8,
          editOverlay: true,
          properties: { source: "user_overlay", edit_overlay: true },
        },
      ],
    }),
    getEditOverlay: () => ({
      created: [{ id: "airport_edit_1" }],
      updated: [{ id: "airport_source_2" }],
      deleted: ["airport_source_3"],
    }),
  });

  owner.renderTabSections(
    { id: "airport" },
    {},
    false,
    "data",
    mount
  );

  assert.match(textOf(mount), /Source Airport/);
  assert.match(textOf(mount), /Updated Airport/);
  assert.match(textOf(mount), /Created Airport/);
  assert.match(textOf(mount), /airport_source_3/);
  assert.match(textOf(mount), /source/);
  assert.match(textOf(mount), /updated/);
  assert.match(textOf(mount), /created/);
  assert.match(textOf(mount), /deleted/);
  const sortOptions = findAllByTag(mount, "option").map((option) => option.textContent);
  assert.ok(sortOptions.includes("Edit status"));
  const searchInput = findAllByTag(mount, "input").find((input) => input.type === "search");
  searchInput.value = "deleted";
  searchInput.dispatch("input");
  assert.doesNotMatch(textOf(mount), /Source Airport/);
  assert.match(textOf(mount), /airport_source_3/);
}));

test("right deck owner adds and removes airport edit overlay points from the data tab", () => withTestDocument(() => {
  const events = [];
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({
    getPreviewSnapshot: () => ({
      status: "ready",
      selected: { id: "airport_source_1", name: "Selected Airport", lon: 139.77, lat: 35.68 },
      dataRows: [],
    }),
    getEditOverlay: () => ({
      features: [{
        id: "airport_edit_1",
        name: "Overlay Airport",
        lon: 139.77,
        lat: 35.68,
      }],
      updated: [{ id: "airport_source_1" }],
      deleted: ["airport_source_2"],
    }),
    addEditOverlayPoint: (familyId, point) => {
      events.push(["add", familyId, point.name, point.lon, point.lat]);
      return { id: "airport_edit_2", ...point };
    },
    removeEditOverlayPoint: (familyId, featureId) => {
      events.push(["remove", familyId, featureId]);
      return true;
    },
    updateEditOverlayPoint: (familyId, featureId, point) => {
      events.push(["update", familyId, featureId, point.name, point.lon, point.lat]);
      return { id: featureId, ...point };
    },
    deleteEditOverlayPoint: (familyId, featureId) => {
      events.push(["delete", familyId, featureId]);
      return true;
    },
    selectPreviewFeature: (familyId, row) => events.push(["select", familyId, row.id]),
  });

  owner.renderTabSections(
    { id: "airport" },
    {},
    false,
    "data",
    mount
  );

  assert.match(textOf(mount), /User Points/);
  assert.match(textOf(mount), /Overlay Airport/);
  assert.match(textOf(mount), /Updated: 1/);
  assert.match(textOf(mount), /Deleted: 1/);
  const inputs = findAllByTag(findAllByClass(mount, "transport-workbench-edit-overlay-form")[0], "input");
  assert.equal(inputs[0].value, "Selected Airport");
  assert.equal(inputs[1].value, "139.77");
  assert.equal(inputs[2].value, "35.68");
  const addButton = findAllByTag(mount, "button").find((button) => button.textContent === "Add point");
  addButton.dispatch("click");
  const updateButton = findAllByTag(mount, "button").find((button) => button.textContent === "Save selected");
  assert.equal(updateButton.disabled, false);
  updateButton.dispatch("click");
  const deleteButton = findAllByTag(mount, "button").find((button) => button.textContent === "Delete selected");
  assert.equal(deleteButton.disabled, false);
  deleteButton.dispatch("click");
  const removeButton = findAllByTag(mount, "button").find((button) => button.textContent === "Remove");
  removeButton.dispatch("click");

  assert.deepEqual(events, [
    ["add", "airport", "Selected Airport", "139.77", "35.68"],
    ["update", "airport", "airport_source_1", "Selected Airport", "139.77", "35.68"],
    ["delete", "airport", "airport_source_1"],
    ["remove", "airport", "airport_edit_1"],
  ]);
}));

test("right deck owner replaces the active mount when tab and family change", () => withTestDocument(() => {
  const displayMount = new TestElement("div");
  const dataMount = new TestElement("div");
  const displayButton = new TestElement("button");
  displayButton.dataset.transportInspectorTab = "display";
  const dataButton = new TestElement("button");
  dataButton.dataset.transportInspectorTab = "data";
  const owner = createTransportWorkbenchRightDeckOwner({
    tabButtons: [displayButton, dataButton],
    panels: { display: new TestElement("section"), data: new TestElement("section") },
    mounts: { display: displayMount, data: dataMount },
    getDisplayConfig: () => createDisplayConfig(),
  });
  owner.renderTabs({ family: { id: "airport" }, config: {}, compareHeld: false, activeTab: "data" });
  assert.match(textOf(dataMount), /Facility Scope/);
  owner.renderTabs({
    family: { id: "road" },
    config: { showRefs: true, refClasses: ["motorway"], labelDensityPreset: "balanced", allowPrimaryRefsAtHighZoom: false },
    compareHeld: false,
    activeTab: "labels",
  });
  assert.equal(displayButton.classList.contains("is-active"), true);
  assert.equal(dataButton.classList.contains("is-active"), false);
  assert.match(textOf(displayMount), /Labels/);
  assert.equal(!!findByText(displayMount, /Reference labels/), false);
}));


test("data tabs omit diagnostic sections and shell notes for every family", () => withTestDocument(() => {
  const owner = createTransportWorkbenchRightDeckOwner();
  for (const id of ["road", "rail", "airport", "port", "mineral_resources", "energy_facilities", "industrial_zones", "logistics_hubs"]) {
    const mount = new TestElement("div");
    owner.renderTabSections({ id }, {}, false, "data", mount);
    assert.equal(findAllByClass(mount, "transport-workbench-section-body-diagnostics").length, 0);
    assert.equal(findAllByClass(mount, "transport-workbench-shell-note").length, 0);
    assert.match(textOf(mount), /Source and use/);
    assert.doesNotMatch(textOf(mount), /Pack status|N06 matched|Name conflicts|Data Check|Diagnostics/);
  }
}));


test("every family exposes only populated tabs and layers hides the tab bar", () => withTestDocument(() => {
  for (const family of TRANSPORT_WORKBENCH_FAMILIES) {
    const tabList = new TestElement("div");
    const ids = ["inspect", "display", "aggregation", "labels", "coverage", "data"];
    const buttons = ids.map((id) => {
      const button = new TestElement("button");
      button.dataset.transportInspectorTab = id;
      tabList.appendChild(button);
      return button;
    });
    const panels = Object.fromEntries(ids.map((id) => [id, new TestElement("section")]));
    panels.inspect.appendChild(new TestElement("div"));
    const mounts = Object.fromEntries(ids.filter((id) => id !== "inspect").map((id) => [id, new TestElement("div")]));
    const owner = createTransportWorkbenchRightDeckOwner({
      tabButtons: buttons, panels, mounts, getDisplayConfig: () => createDisplayConfig(),
    });
    owner.renderTabs({ family, config: {}, activeTab: "display" });
    assert.deepEqual(buttons.filter((button) => !button.hidden).map((button) => button.dataset.transportInspectorTab),
      family.id === "layers" ? [] : ["inspect", "display", "data"]);
    assert.equal(tabList.hidden, family.id === "layers");
    if (family.id === "layers") {
      assert.equal(panels.inspect.hidden, false);
      assert.equal(panels.display.hidden, true);
      continue;
    }
    for (const id of ["display", "data"]) {
      owner.renderTabs({ family, config: {}, activeTab: id });
      assert.ok(mounts[id].childElementCount > 0, `${family.id}/${id}`);
      assert.doesNotMatch(textOf(mounts[id]), /No controls in this tab|No settings are available here/);
    }
  }
}));

test("saved inspector tabs migrate through core restoration and workbench state", () => {
  for (const [saved, expected] of Object.entries({ inspect: "inspect", display: "display", aggregation: "display", labels: "display", coverage: "data", data: "data" })) {
    const runtimeState = { transportWorkbenchUi: { activeInspectorTab: saved } };
    assert.equal(normalizeTransportWorkbenchUiState(runtimeState.transportWorkbenchUi).activeInspectorTab, expected);
    const owner = createTransportWorkbenchStateOwner(runtimeState);
    assert.equal(owner.ensureUiState().activeInspectorTab, expected);
    assert.equal(owner.setInspectorTab(saved), expected);
  }
});

test("density display merges basic controls and exposes a single advanced group", () => withTestDocument(() => {
  const mount = new TestElement("div");
  const owner = createTransportWorkbenchRightDeckOwner({ getDisplayConfig: () => createDisplayConfig() });
  owner.renderTabSections({ id: "port" }, {}, false, "display", mount);
  assert.equal(findAllByClass(mount, "transport-workbench-advanced").length, 1);
  assert.doesNotMatch(textOf(mount), /Current settings|Enabled|Disabled|Display Mode/);
  const headings = findAllByClass(mount, "transport-workbench-note-title").map((node) => node.textContent);
  assert.deepEqual(headings, ["Display settings", "Aggregation settings", "Label settings"]);
  const checkbox = findAllByTag(mount, "input").find((node) => node.type === "checkbox");
  assert.equal(checkbox.parentNode.tagName, "label");
  assert.match(textOf(checkbox.parentNode), /Allow label aggregation/);
}));

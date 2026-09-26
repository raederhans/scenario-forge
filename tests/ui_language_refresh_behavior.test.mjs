import test from "node:test";
import assert from "node:assert/strict";

import { createWaterSpecialRegionController } from "../js/ui/sidebar/water_special_region_controller.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";

function createNode() {
  const classes = new Set();
  return {
    children: [],
    dataset: {},
    style: {},
    value: "",
    textContent: "",
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener() {},
    setAttribute(name, value) { this[name] = value; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
  };
}

test("water language refresh preserves filters and selection while refreshing options and compact rows", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: createNode };
  try {
    const lake = (id, name, source) => ({
      properties: { id, name, water_type: "sea", region_group: "mediterranean", source_standard: source },
    });
    const state = {
      currentLanguage: "zh",
      selectedWaterRegionId: "west",
      waterRegionsById: new Map([
        ["west", lake("west", "Shared Sea", "atlas_west")],
        ["east", lake("east", "Shared Sea", "atlas_east")],
        ["other", lake("other", "Other Sea", "atlas_west")],
      ]),
      waterRegionOverrides: {},
      styleConfig: { lakes: { interactive: true } },
    };
    const elements = {
      waterRegionList: createNode(),
      waterInspectorTypeFilter: createNode(),
      waterInspectorGroupFilter: createNode(),
      waterInspectorSourceFilter: createNode(),
      waterInspectorSortSelect: createNode(),
      waterInspectorResultCount: createNode(),
      waterSearchInput: createNode(),
    };
    elements.waterInspectorSourceFilter.value = "atlas_west";
    elements.waterSearchInput.value = "sea";
    const translations = {
      zh: { "All Types": "全部类型", "All Groups": "全部分组", "All Sources": "全部来源", regions: "个区域", overrides: "项覆盖" },
      en: { "All Types": "All Types", "All Groups": "All Groups", "All Sources": "All Sources", regions: "regions", overrides: "overrides" },
    };
    const controller = createWaterSpecialRegionController({
      runtimeState: state,
      elements,
      helpers: {
        t: (key) => translations[state.currentLanguage][key] || key,
        getGeoFeatureDisplayLabel: (feature) => feature.properties.name,
        mapRenderer: { getWaterRegionColor: () => "#aadaff" },
        normalizeHexColor: (value) => value,
        createEmptyNote: () => createNode(),
        scheduleAdaptiveInspectorHeights() {},
        updateWorkspaceStatus() {},
      },
    });
    controller.renderWaterRegionList();
    assert.equal(elements.waterInspectorSourceFilter.children[0].textContent, "全部来源");
    assert.equal(elements.waterRegionList.children.length, 2);
    state.currentLanguage = "en";
    controller.renderWaterRegionList();
    assert.equal(elements.waterInspectorSourceFilter.children[0].textContent, "All Sources");
    assert.equal(elements.waterInspectorSourceFilter.value, "atlas_west");
    assert.equal(elements.waterSearchInput.value, "sea");
    assert.equal(state.selectedWaterRegionId, "west");
    assert.match(elements.waterInspectorResultCount.textContent, /2 regions/);
    const firstMeta = elements.waterRegionList.children[0].children[0].children[1].textContent;
    assert.equal(firstMeta, "Sea");
    elements.waterInspectorSourceFilter.value = "";
    controller.renderWaterRegionList();
    const rows = elements.waterRegionList.children.filter((row) => row.children[0].children[0].textContent === "Shared Sea");
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => /Sea · Atlas (West|East)/.test(row.children[0].children[1].textContent)));
  } finally {
    globalThis.document = originalDocument;
  }
});

test("water list uses short translated source aliases without fragment counts", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: createNode };
  try {
    const feature = (id, name, source) => ({
      properties: { id, name, water_type: "sea", region_group: "mediterranean", source_standard: source },
    });
    const state = {
      currentLanguage: "zh",
      selectedWaterRegionId: "hgo-1",
      waterRegionsById: new Map([
        ["hgo-1", feature("hgo-1", "Shared Sea 1-1-1", "hgo_donor_water_georef")],
        ["hgo-2", feature("hgo-2", "Shared Sea 1-1-2", "hgo_donor_water_georef")],
        ["med", feature("med", "Shared Sea", "mediterranean_template_sea_completion")],
      ]),
      waterRegionOverrides: {},
      styleConfig: { lakes: { interactive: true } },
    };
    const elements = {
      waterRegionList: createNode(), waterInspectorTypeFilter: createNode(),
      waterInspectorGroupFilter: createNode(), waterInspectorSourceFilter: createNode(),
      waterInspectorSortSelect: createNode(), waterInspectorResultCount: createNode(),
      waterSearchInput: createNode(),
    };
    const translations = {
      zh: { "HGO reconstruction": "HGO 重建", "Mediterranean supplement": "地中海补充数据" },
      en: { "HGO reconstruction": "HGO reconstruction", "Mediterranean supplement": "Mediterranean supplement" },
    };
    const controller = createWaterSpecialRegionController({
      runtimeState: state, elements,
      helpers: {
        t: (key) => translations[state.currentLanguage][key] || key,
        getGeoFeatureDisplayLabel: (item) => item.properties.name,
        mapRenderer: { getWaterRegionColor: () => "#aadaff" },
        normalizeHexColor: (value) => value,
        createEmptyNote: createNode,
        scheduleAdaptiveInspectorHeights() {}, updateWorkspaceStatus() {},
      },
    });
    const rowMetas = () => elements.waterRegionList.children.map((row) => row.children[0].children[1].textContent);
    controller.renderWaterRegionList();
    assert.deepEqual(rowMetas().sort(), ["Sea · HGO 重建", "Sea · 地中海补充数据"].sort());
    assert.ok(rowMetas().every((text) => !text.includes("fragments")));
    state.currentLanguage = "en";
    controller.renderWaterRegionList();
    assert.deepEqual(rowMetas().sort(), ["Sea · HGO reconstruction", "Sea · Mediterranean supplement"].sort());
    elements.waterInspectorSourceFilter.value = "hgo_donor_water_georef";
    controller.renderWaterRegionList();
    assert.equal(elements.waterInspectorSourceFilter.value, "hgo_donor_water_georef");
    assert.equal(elements.waterRegionList.children.length, 1);
    assert.equal(elements.waterRegionList.children[0].dataset.regionIds, "hgo-1|hgo-2");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("account language refresh updates mounted controls without replacing input or dialog state", () => {
  const originalDocument = globalThis.document;
  const nodes = new Map();
  const ids = [
    "backendAccountToggleBtn", "backendAccountPopover", "backendAccountCloseBtn",
    "backendAccountPopoverTitle", "backendCloudStatus", "backendCloudUsername",
    "backendCloudPassword", "backendCloudSaveTitle", "backendCloudRegisterBtn",
    "backendCloudLoginBtn", "backendCloudLogoutBtn", "backendCloudSaveBtn",
    "backendCloudPublishBtn", "backendCommunityRefreshBtn", "backendCommunityList",
  ];
  ids.forEach((id) => nodes.set(id, createNode()));
  const hint = createNode();
  nodes.get("backendAccountToggleBtn").parentElement = { querySelector: () => hint };
  nodes.get("backendCloudStatus").dataset.localizationKey = "Cloud save created.";
  nodes.get("backendCloudUsername").value = "user@example.com";
  nodes.get("backendAccountPopover").classList.add("hidden");
  const documentRef = {
    getElementById: (id) => nodes.get(id) || null,
    createElement: createNode,
  };
  globalThis.document = documentRef;
  try {
    let language = "zh";
    const controller = createProjectSupportDiagnosticsController({
      state: {},
      documentRef,
      helpers: {
        t: (key) => language === "zh" ? `中:${key}` : key,
        createEmptyNote: (value) => ({ textContent: value }),
      },
    });
    language = "en";
    controller.refreshProjectAccountLanguage();
    assert.equal(nodes.get("backendAccountPopoverTitle").textContent, "Cloud Saves");
    assert.equal(nodes.get("backendCloudStatus").textContent, "Cloud save created.");
    assert.equal(nodes.get("backendCloudUsername").placeholder, "Username");
    assert.equal(nodes.get("backendCloudUsername").value, "user@example.com");
    assert.equal(nodes.get("backendAccountPopover").classList.contains("hidden"), true);
    assert.equal(hint.textContent, "Account");
    assert.equal(nodes.get("backendCommunityList").children[0].textContent, "No community saves yet");
  } finally {
    globalThis.document = originalDocument;
  }
});

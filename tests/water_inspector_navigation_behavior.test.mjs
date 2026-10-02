import test from "node:test";
import assert from "node:assert/strict";
import { createWaterSpecialRegionController } from "../js/ui/sidebar/water_special_region_controller.js";

function node(tag = "div") {
  const classes = new Set();
  const listeners = new Map();
  return {
    tag, children: [], dataset: {}, style: {}, value: "", checked: false, textContent: "",
    ownerDocument: globalThis.document,
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
    },
    addEventListener: (name, handler) => listeners.set(name, handler),
    click() { listeners.get("click")?.(); },
    setAttribute(name, value) { this[name] = value; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    querySelector(selector) {
      for (const child of this.children) {
        if (selector === `#${child.id}`) return child;
        const descendant = child.querySelector(selector);
        if (descendant) return descendant;
      }
      return null;
    },
    focus(options) { this.focusedWith = options; this.ownerDocument.activeElement = this; },
    scrollIntoView(options) { this.scrolledWith = options; },
    closest() { return null; },
  };
}

const feature = (id, name, parentId = "", group = "macro", source = "atlas") => ({
  properties: { id, name, parent_id: parentId, water_type: "sea", region_group: group, source_standard: source },
});

test("water empty guidance tracks lake interaction in both interaction and detail refreshes", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: node };
  try {
    const hint = node();
    hint.id = "waterInspectorEmptyHint";
    const settingsButton = node("button");
    settingsButton.id = "waterInspectorLakeSettingsBtn";
    const empty = node();
    empty.appendChild(hint);
    empty.appendChild(settingsButton);
    const elements = {
      waterRegionList: node(), waterInspectorEmpty: empty, waterInspectorSelected: node(),
      waterInspectorLakeInteractionToggle: node("input"),
    };
    const state = {
      waterRegionsById: new Map(), waterRegionOverrides: {}, selectedWaterRegionId: "",
      styleConfig: { lakes: { interactive: false } },
    };
    const controller = createWaterSpecialRegionController({
      runtimeState: state, elements,
      helpers: {
        t: (key) => key, getGeoFeatureDisplayLabel: (item) => item.properties.name,
        mapRenderer: {}, normalizeHexColor: (value) => value,
        createEmptyNote: node, scheduleAdaptiveInspectorHeights() {}, updateWorkspaceStatus() {},
      },
    });
    controller.renderWaterInteractionUi();
    assert.equal(hint.textContent,
      "Choose a sea or strait from the map or list. To select lakes, first enable lake interaction in settings.");
    assert.equal(settingsButton.hidden, false);
    assert.equal(elements.waterInspectorLakeInteractionToggle.checked, false);

    state.styleConfig.lakes.interactive = true;
    controller.renderWaterInteractionUi();
    assert.equal(hint.textContent, "Click a sea, lake, or strait on the map, or choose one from the list.");
    assert.equal(settingsButton.hidden, true);
    assert.equal(elements.waterInspectorLakeInteractionToggle.checked, true);

    // List/detail refresh must also replace stale guidance after external state changes.
    state.styleConfig.lakes.interactive = false;
    controller.renderWaterRegionList();
    assert.equal(hint.textContent,
      "Choose a sea or strait from the map or list. To select lakes, first enable lake interaction in settings.");
    assert.equal(settingsButton.hidden, false);
    assert.equal(empty.classList.contains("hidden"), false);
    assert.equal(elements.waterInspectorSelected.classList.contains("hidden"), true);
    state.styleConfig.lakes.interactive = true;
    controller.renderWaterRegionList();
    assert.equal(hint.textContent, "Click a sea, lake, or strait on the map, or choose one from the list.");
    assert.equal(settingsButton.hidden, true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("lake settings entry reveals and focuses settings without enabling lake interaction", () => {
  const originalDocument = globalThis.document;
  try {
    for (const [mobile, collapsed] of [[false, true], [false, false], [true, true]]) {
      const documentRef = { createElement: node, defaultView: {
        matchMedia(query) {
          assert.equal(query, "(max-width: 1023px)");
          return { matches: mobile };
        },
      } };
      globalThis.document = documentRef;
      documentRef.body = node();
      if (collapsed) documentRef.body.classList.add("left-sidebar-collapsed");
      const calls = [];
      const filters = node("details");
      filters.open = false;
      const objectEntry = node("button");
      objectEntry.addEventListener("click", () => calls.push("water-entry"));
      const collapseButton = node("button");
      collapseButton.addEventListener("click", () => {
        calls.push("expand-left");
        documentRef.body.classList.remove("left-sidebar-collapsed");
      });
      const byId = { "editorObjects-water": objectEntry, editorWaterFilters: filters, leftSidebarCollapseBtn: collapseButton };
      documentRef.getElementById = (id) => byId[id];
      const settingsButton = node("button");
      settingsButton.id = "waterInspectorLakeSettingsBtn";
      const empty = node();
      empty.appendChild(settingsButton);
      const toggle = node("input");
      const state = {
        styleConfig: { lakes: { interactive: false } }, selectedWaterRegionId: "existing-sea",
        toggleLeftPanelFn: (open) => calls.push(["left-drawer", open]),
      };
      const controller = createWaterSpecialRegionController({
        runtimeState: state,
        elements: { waterInspectorEmpty: empty, waterInspectorLakeInteractionToggle: toggle },
        helpers: {
          t: (key) => key, markDirty: () => calls.push("dirty"), render: () => calls.push("render"),
        },
      });
      controller.bindEvents();
      controller.bindEvents();
      settingsButton.click();
      assert.equal(state.styleConfig.lakes.interactive, false);
      assert.equal(toggle.checked, false);
      assert.equal(state.selectedWaterRegionId, "existing-sea");
      assert.equal(filters.open, true);
      assert.equal(documentRef.activeElement, toggle);
      assert.deepEqual(toggle.focusedWith, { preventScroll: true });
      assert.deepEqual(toggle.scrolledWith, { block: "nearest" });
      assert.deepEqual(calls, mobile ? ["water-entry", ["left-drawer", true]]
        : collapsed ? ["water-entry", "expand-left"] : ["water-entry"]);
      if (!mobile) assert.equal(documentRef.body.classList.contains("left-sidebar-collapsed"), false);
    }
  } finally {
    globalThis.document = originalDocument;
  }
});

test("special-region empty guidance distinguishes missing scenario, hidden geometry, and available choices", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: node };
  try {
    const title = node("h3");
    title.id = "specialRegionInspectorEmptyTitle";
    const hint = node();
    hint.id = "specialRegionInspectorEmptyHint";
    const empty = node();
    empty.appendChild(title);
    empty.appendChild(hint);
    const elements = {
      specialRegionInspectorEmpty: empty, specialRegionInspectorSelected: node(),
      specialRegionInspectorSection: node("details"), specialRegionList: node(),
    };
    const region = { properties: { id: "drained-basin", name: "Drained basin", special_type: "salt_flat" } };
    const state = {
      activeScenarioId: "", selectedSpecialRegionId: "", showScenarioSpecialRegions: true,
      specialRegionsById: new Map([[region.properties.id, region]]),
    };
    const controller = createWaterSpecialRegionController({
      runtimeState: state, elements,
      helpers: {
        t: (key) => key, getGeoFeatureDisplayLabel: (item) => item.properties.name,
        scheduleAdaptiveInspectorHeights() {}, updateWorkspaceStatus() {},
      },
    });
    controller.renderSpecialRegionList();
    assert.equal(title.textContent, "No special regions available");
    assert.equal(hint.textContent, "Apply a scenario with special regions to inspect them here.");
    assert.equal(elements.specialRegionInspectorSection.classList.contains("hidden"), true);

    state.activeScenarioId = "scenario";
    state.specialRegionsById.clear();
    controller.renderSpecialRegionList();
    assert.equal(title.textContent, "No special regions available");
    assert.equal(hint.textContent, "This scenario has no visible special regions. Check the visibility settings on the left.");
    assert.equal(elements.specialRegionInspectorSection.classList.contains("hidden"), false);
    assert.equal(elements.specialRegionInspectorSection.classList.contains("is-empty-scenario-panel"), true);

    state.specialRegionsById.set(region.properties.id, region);
    state.showScenarioSpecialRegions = false;
    controller.renderSpecialRegionList();
    assert.equal(title.textContent, "No special regions available");
    assert.equal(hint.textContent, "This scenario has no visible special regions. Check the visibility settings on the left.");
    assert.equal(elements.specialRegionList.children.length, 0);

    state.showScenarioSpecialRegions = true;
    controller.renderSpecialRegionList();
    assert.equal(title.textContent, "Select a special region to inspect");
    assert.equal(hint.textContent, "Click a drained basin or exposure zone on the map, or choose one from the list.");
    assert.equal(elements.specialRegionInspectorSection.classList.contains("is-empty-scenario-panel"), false);
    assert.equal(empty.classList.contains("hidden"), false);
    assert.equal(elements.specialRegionList.children.length, 1);
    elements.specialRegionList.children[0].click();
    assert.equal(state.selectedSpecialRegionId, "drained-basin");
    assert.equal(empty.classList.contains("hidden"), true);
    assert.equal(elements.specialRegionInspectorSelected.classList.contains("hidden"), false);

    state.showScenarioSpecialRegions = false;
    controller.renderSpecialRegionList();
    assert.equal(state.selectedSpecialRegionId, "");
    assert.equal(empty.classList.contains("hidden"), false);
    assert.equal(title.textContent, "No special regions available");
    assert.equal(hint.textContent, "This scenario has no visible special regions. Check the visibility settings on the left.");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("hierarchy navigation clears only conflicting filters, exposes full ancestry, and locates selected water", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: node };
  try {
    const features = [
      feature("root", "Ocean Root"),
      feature("parent", "Parent Sea", "root"),
      feature("child", "Child Gulf", "parent", "detail", "survey"),
    ];
    const state = {
      currentLanguage: "en", selectedWaterRegionId: "child",
      waterRegionsById: new Map(features.map((item) => [item.properties.id, item])),
      waterRegionOverrides: {}, styleConfig: { lakes: { interactive: true } },
    };
    const keys = [
      "waterInspectorSection", "waterInspectorOverridesOnlyToggle", "waterInspectorTypeFilter",
      "waterInspectorGroupFilter", "waterInspectorSourceFilter", "waterInspectorSortSelect",
      "waterInspectorResultCount", "waterSearchInput", "waterRegionList", "waterInspectorEmpty",
      "waterInspectorSelected", "waterInspectorDetailHint", "waterInspectorMetaSection",
      "waterInspectorMetaList", "waterInspectorHierarchySection", "waterInspectorBreadcrumb",
      "waterInspectorJumpToParentBtn", "waterInspectorChildrenList", "waterInspectorLocateBtn",
      "waterInspectorScopeSelect", "waterInspectorScopePreview",
    ];
    const elements = Object.fromEntries(keys.map((key) => [key, node()]));
    elements.waterSearchInput.value = "Child";
    elements.waterInspectorTypeFilter.value = "sea";
    elements.waterInspectorGroupFilter.value = "detail";
    elements.waterInspectorSourceFilter.value = "survey";
    elements.waterInspectorOverridesOnlyToggle.checked = true;
    const focusCalls = [];
    const controller = createWaterSpecialRegionController({
      runtimeState: state, elements,
      helpers: {
        t: (key) => key,
        getGeoFeatureDisplayLabel: (item) => item.properties.name,
        mapRenderer: {
          getWaterRegionColor: () => "#aadaff",
          focusWaterRegionById: (id) => { focusCalls.push(id); return true; },
        },
        normalizeHexColor: (value) => value,
        createEmptyNote: node, scheduleAdaptiveInspectorHeights() {}, updateWorkspaceStatus() {},
      },
    });
    controller.bindEvents();
    controller.renderWaterRegionList();
    assert.deepEqual(elements.waterInspectorBreadcrumb.children.filter((item) => item.tag !== "span")
      .map((item) => item.textContent), ["Ocean Root", "Parent Sea"]);
    assert.equal(elements.waterInspectorBreadcrumb.children.at(-1).textContent, "Child Gulf");

    elements.waterInspectorJumpToParentBtn.click();
    assert.equal(state.selectedWaterRegionId, "parent");
    assert.equal(elements.waterSearchInput.value, "");
    assert.equal(elements.waterInspectorGroupFilter.value, "");
    assert.equal(elements.waterInspectorSourceFilter.value, "");
    assert.equal(elements.waterInspectorTypeFilter.value, "sea");
    assert.equal(elements.waterInspectorOverridesOnlyToggle.checked, false);
    assert.equal(elements.waterRegionList.children.find((row) => row.dataset.regionId === "parent")?.classList.contains("is-active"), true);
    assert.deepEqual(elements.waterRegionList.children.find((row) => row.dataset.regionId === "parent")?.scrolledWith, { block: "nearest" });

    const childRow = elements.waterInspectorChildrenList.children.find((row) =>
      row.children[0]?.children[0]?.textContent === "Child Gulf");
    childRow.click();
    assert.equal(state.selectedWaterRegionId, "child");
    assert.deepEqual(elements.waterRegionList.children.find((row) => row.dataset.regionId === "child")?.scrolledWith, { block: "nearest" });
    elements.waterInspectorLocateBtn.click();
    assert.deepEqual(focusCalls, ["child"]);
    assert.equal(elements.waterInspectorBreadcrumb["aria-label"], "Water Hierarchy");
    elements.waterInspectorBreadcrumb.children[0].click();
    assert.equal(state.selectedWaterRegionId, "root");
    assert.equal(elements.waterRegionList.children.find((row) => row.dataset.regionId === "root")?.classList.contains("is-active"), true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("ancestor breadcrumb stops at a cycle", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: node };
  try {
    const cyclic = [feature("a", "Sea A", "b"), feature("b", "Sea B", "a")];
    const state = {
      currentLanguage: "en", selectedWaterRegionId: "a",
      waterRegionsById: new Map(cyclic.map((item) => [item.properties.id, item])),
      waterRegionOverrides: {}, styleConfig: { lakes: { interactive: true } },
    };
    const elements = {
      waterRegionList: node(), waterSearchInput: node(), waterInspectorEmpty: node(),
      waterInspectorSelected: node(), waterInspectorHierarchySection: node(), waterInspectorBreadcrumb: node(),
    };
    const controller = createWaterSpecialRegionController({
      runtimeState: state, elements,
      helpers: {
        t: (key) => key, getGeoFeatureDisplayLabel: (item) => item.properties.name,
        mapRenderer: { getWaterRegionColor: () => "#aadaff" }, normalizeHexColor: (value) => value,
        createEmptyNote: node, scheduleAdaptiveInspectorHeights() {}, updateWorkspaceStatus() {},
      },
    });
    controller.renderWaterRegionList();
    assert.deepEqual(elements.waterInspectorBreadcrumb.children.map((item) => item.textContent), ["Sea B", "›", "Sea A"]);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("one list render reuses visible features and names while filters and scope update immediately", () => {
  const originalDocument = globalThis.document;
  const originalSort = Array.prototype.sort;
  const sortedFeatureSets = [];
  globalThis.document = { createElement: node };
  Array.prototype.sort = function (compare) {
    if (this.length && this.every((item) => item?.properties?.id)) {
      sortedFeatureSets.push(this.map((item) => item.properties.id).join(","));
    }
    return originalSort.call(this, compare);
  };
  try {
    const root = feature("root", "Root Sea", "", "macro", "atlas");
    const child = feature("child", "Child Sea", "root", "detail", "survey");
    const lake = feature("lake", "Lake", "", "inland", "atlas");
    lake.properties.water_type = "lake";
    const ocean = feature("ocean", "Ocean", "", "ocean_macro", "atlas");
    ocean.properties.water_type = "ocean";
    const state = {
      currentLanguage: "en", selectedWaterRegionId: "root", allowOpenOceanSelect: false,
      waterRegionsById: new Map([root, child, lake, ocean].map((item) => [item.properties.id, item])),
      waterRegionOverrides: {}, styleConfig: { lakes: { interactive: true } },
    };
    const keys = [
      "waterInspectorTypeFilter", "waterInspectorGroupFilter", "waterInspectorSourceFilter",
      "waterInspectorSortSelect", "waterInspectorResultCount", "waterSearchInput",
      "waterRegionList", "waterInspectorEmpty", "waterInspectorSelected",
      "waterInspectorChildrenList", "waterInspectorScopeSelect", "waterInspectorScopePreview",
    ];
    const elements = Object.fromEntries(keys.map((key) => [key, node()]));
    elements.waterInspectorGroupFilter.value = "macro";
    elements.waterInspectorScopeSelect.value = "same-type";
    const nameCalls = new Map();
    const controller = createWaterSpecialRegionController({
      runtimeState: state, elements,
      helpers: {
        t: (key) => key,
        getGeoFeatureDisplayLabel: (item) => {
          const id = item.properties.id;
          nameCalls.set(id, (nameCalls.get(id) || 0) + 1);
          return item.properties.name;
        },
        mapRenderer: { getWaterRegionColor: () => "#aadaff" }, normalizeHexColor: (value) => value,
        createEmptyNote: node, scheduleAdaptiveInspectorHeights() {}, updateWorkspaceStatus() {},
      },
    });
    controller.renderWaterRegionList();
    assert.deepEqual(sortedFeatureSets, ["root", "child"]);
    assert.deepEqual(Object.fromEntries(nameCalls), { root: 1, child: 1 });
    assert.equal(elements.waterInspectorResultCount.textContent, "1 regions · 0 overrides");
    assert.match(elements.waterInspectorScopePreview.textContent, /^1 regions affected/);
    assert.deepEqual(elements.waterInspectorTypeFilter.children.map((option) => option.value), ["", "lake", "sea"]);

    sortedFeatureSets.length = 0;
    nameCalls.clear();
    elements.waterInspectorGroupFilter.value = "";
    state.currentLanguage = "zh";
    controller.renderWaterRegionList();
    assert.deepEqual(sortedFeatureSets, ["root,child,lake", "child"]);
    assert.deepEqual(Object.fromEntries(nameCalls), { root: 1, child: 1, lake: 1 });
    assert.equal(elements.waterInspectorResultCount.textContent, "3 regions · 0 overrides");
    assert.match(elements.waterInspectorScopePreview.textContent, /^2 regions affected/);

    sortedFeatureSets.length = 0;
    elements.waterSearchInput.value = "child";
    controller.renderWaterRegionList();
    assert.deepEqual(sortedFeatureSets, ["child", "child"]);
    assert.equal(elements.waterInspectorResultCount.textContent, "1 regions · 0 overrides");
    assert.match(elements.waterInspectorScopePreview.textContent, /^2 regions affected/);
    assert.deepEqual(elements.waterInspectorGroupFilter.children.map((option) => option.value),
      ["", "detail", "inland", "macro"]);
  } finally {
    Array.prototype.sort = originalSort;
    globalThis.document = originalDocument;
  }
});

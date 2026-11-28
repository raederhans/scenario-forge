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
    replaceChildren(...children) { if (this.children.includes(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null; this.children = children; },
    querySelector(selector) {
      for (const child of this.children) {
        if (selector === `#${child.id}` || selector === `.${child.className}`) return child;
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


function fixture(context, translate = (key) => key) {
  const previous = globalThis.document;
  globalThis.document = { createElement: node };
  context.after(() => { globalThis.document = previous; });
  const elements = Object.fromEntries([
    "waterRegionList", "waterInspectorEmpty", "waterInspectorSelected", "waterInspectorDetailHint",
    "waterInspectorMetaSection", "waterInspectorMetaList", "waterInspectorMoreMetaList", "waterLegendList", "waterInspectorScopePreview", "waterInspectorScopeSelect",
    "specialRegionList", "specialRegionInspectorEmpty", "specialRegionInspectorSelected", "specialRegionInspectorDetailHint",
  ].map(key => [key, node()]));
  elements.waterLegendList.parentElement = node("details");
  const feature = (id) => ({ properties: { id, name: id, water_type: "sea", region_group: "marine_macro", special_type: "salt_flat" } });
  const state = {
    waterRegionsById: new Map(["a", "b"].map(id => [id, feature(id)])),
    specialRegionsById: new Map(["a", "b"].map(id => [id, feature(id)])),
    waterRegionOverrides: {}, styleConfig: { lakes: { interactive: true } },
    activeScenarioId: "scenario", showScenarioSpecialRegions: true,
    selectedWaterRegionId: "a", selectedSpecialRegionId: "a",
  };
  const controller = createWaterSpecialRegionController({ runtimeState: state, elements, helpers: {
    t: (key, domain, params) => {
      assert.equal(domain, "ui");
      return params ? translate(key).replace("{count}", params.count) : translate(key);
    },
    getGeoFeatureDisplayLabel: feature => feature.properties.name,
    mapRenderer: { getWaterRegionColor: () => "#123456" },
    normalizeHexColor: value => value,
    createEmptyNote: node, scheduleAdaptiveInspectorHeights() {}, updateWorkspaceStatus() {},
  } });
  return { elements, state, controller };
}

for (const [listKey, render, selected, refresh] of [
  ["waterRegionList", "renderWaterRegionList", "selectedWaterRegionId", "refreshWaterRegionRows"],
  ["specialRegionList", "renderSpecialRegionList", "selectedSpecialRegionId", "refreshSpecialRegionRows"],
]) {
  test(`${listKey} restores focus by ID and synchronizes pressed state`, context => {
    const { elements, state, controller } = fixture(context);
    controller[render]();
    const old = elements[listKey].children[1];
    old.focus();
    old.click();
    const current = elements[listKey].children[1];
    assert.notEqual(current, old);
    assert.equal(document.activeElement, current);
    assert.equal(state[selected], "b");
    assert.equal(current["aria-pressed"], "true");
    assert.equal(elements[listKey].children[0]["aria-pressed"], "false");
    state[selected] = "a";
    controller[refresh]({ regionIds: ["a", "b"] });
    assert.equal(elements[listKey].children[0]["aria-pressed"], "true");
    assert.equal(elements[listKey].children[1]["aria-pressed"], "false");
    const external = node();
    external.focus();
    controller[render]();
    assert.equal(document.activeElement, external);
  });
}

test("water details translate labels, values, subtitle and singular/plural scope", context => {
  const { elements, controller } = fixture(context, key => `[${key}]`);
  controller.renderWaterRegionList();
  assert.match(elements.waterInspectorScopePreview.textContent, /^\[1 region affected\]/);
  elements.waterInspectorScopeSelect.value = "same-type";
  controller.renderWaterRegionList();
  assert.match(elements.waterInspectorScopePreview.textContent, /^\[2 regions affected\]/);
  const values = elements.waterInspectorMetaList.children.map(item => item.textContent);
  for (const key of ["Type", "Group", "Fragments", "Default color", "Current color", "Sea"]) {
    assert.ok(values.includes(`[${key}]`), key);
  }
  assert.deepEqual(elements.waterInspectorMoreMetaList.children.filter((_, i) => i % 2 === 0).map(item => item.textContent), ["[ID]", "[Source]"]);
  assert.equal(elements.waterInspectorDetailHint.textContent, "[1 fragment]");
});

test("mixed water selections show recolored fragments and hide the legend after clearing", context => {
  const { elements, state, controller } = fixture(context);
  state.waterRegionsById.get("a").properties.name = "Shared Sea 1-1";
  state.waterRegionsById.get("b").properties.name = "Shared Sea 1-2";
  state.waterRegionOverrides.b = "#123456";
  controller.renderWaterRegionList();
  assert.equal(elements.waterInspectorDetailHint.textContent, "2 fragments · Recolored");
  assert.equal(elements.waterLegendList.parentElement.hidden, false);
  assert.equal(elements.waterLegendList.children.length, 1);

  delete state.waterRegionOverrides.b;
  controller.renderWaterRegionList();
  assert.equal(elements.waterInspectorDetailHint.textContent, "2 fragments");
  assert.equal(elements.waterLegendList.parentElement.hidden, true);
});

test("special region finite labels translate, unknown tokens fall back, details use the same labels", context => {
  const { elements, state, controller } = fixture(context, key => `[${key}]`);
  state.specialRegionsById.get("a").properties.region_group = "atlantropa_core";
  state.specialRegionsById.get("b").properties.special_type = "future_type";
  state.specialRegionsById.get("b").properties.region_group = "future_group";
  controller.renderSpecialRegionList();
  assert.equal(elements.specialRegionList.children[0].querySelector(".country-select-meta").textContent, "[Salt flat] · [Atlantropa core]");
  assert.equal(elements.specialRegionList.children[1].querySelector(".country-select-meta").textContent, "future type · future group");
  assert.equal(elements.specialRegionInspectorDetailHint.textContent, "[Salt flat] · [Atlantropa core]");
});

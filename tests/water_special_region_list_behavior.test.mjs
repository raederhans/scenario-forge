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
    "waterInspectorSourceFilter", "waterInspectorSourceFilterCount",
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

test("more filters indicates an active source until all sources are shown again", context => {
  const { elements, state, controller } = fixture(context);
  state.waterRegionsById.get("a").properties.source_standard = "survey";
  for (const source of ["", "survey", ""]) {
    elements.waterInspectorSourceFilter.value = source;
    controller.renderWaterRegionList();
    assert.equal(elements.waterInspectorSourceFilterCount.hidden, source === "");
    assert.equal(elements.waterRegionList.children.length, source ? 1 : 2);
  }
});

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

test("Atlantropa sea fragments are grouped by sub-sea and long lists are paged with the selection revealed", context => {
  const { elements, state, controller } = fixture(context);
  const atl = (id, regionId) => [id, { properties: {
    id, name: "Mediterranean", water_type: "sea", region_group: "atl", region_id: regionId,
    source_standard: "mediterranean_template_sea_completion",
  } }];
  const seas = Array.from({ length: 45 }, (_, i) => {
    const id = `sea-${String(i).padStart(2, "0")}`;
    return [id, { properties: { id, name: `Sea ${String(i).padStart(2, "0")}`, water_type: "sea", region_group: "marine_macro" } }];
  });
  state.waterRegionsById = new Map([
    atl("ATLSEA_FILL_tyrrhenian_2", "tyrrhenian"),
    atl("ATLSEA_FILL_adriatica_10", "adriatica"),
    atl("ATLSEA_FILL_adriatica_2", "adriatica"),
    ...Array.from({ length: 6 }, (_, i) => atl(`ATLSEA_FILL_tyrrhenian_${10 + i}`, "tyrrhenian")),
    ["med-hgo", { properties: { id: "med-hgo", name: "Mediterranean", water_type: "sea", region_group: "hgo" } }],
    ...seas,
  ]);
  state.selectedWaterRegionId = "sea-00";
  controller.renderWaterRegionList();

  const list = elements.waterRegionList.children;
  const med = list[0];
  assert.equal(med.className, "water-list-group", "the fragments collapse into one top-level entry");
  const [, medBody] = med.children;
  assert.deepEqual(medBody.children.slice(0, 2).map((sub) => sub.children[0].children[0].textContent),
    ["Tyrrhenian Sea", "Adriatic Sea"], "sub-seas follow west-to-east order");
  assert.equal(medBody.children[2].dataset.regionId, "med-hgo",
    "an ordinary water body with the same name follows the sub-seas");
  assert.equal(med.children[0].children[1].textContent, "10", "the group shows how many entries it holds");
  const adriatic = medBody.children[1].children[1].children;
  assert.deepEqual(adriatic.map((row) => row.children[0].children[0].textContent),
    ["Adriatic Sea 1", "Adriatic Sea 2"], "fragments are numbered within their sub-sea in natural id order");
  assert.deepEqual(adriatic.map((row) => row.dataset.regionId), ["ATLSEA_FILL_adriatica_2", "ATLSEA_FILL_adriatica_10"]);

  // 46 top-level entries → 40 on the first page plus a pager.
  const pager = list.at(-1);
  assert.equal(pager.className, "water-list-pager");
  assert.equal(list.length, 41);
  assert.equal(pager.children[1].textContent, "1 / 2");

  state.selectedWaterRegionId = "sea-44";
  controller.renderWaterRegionList();
  assert.equal(elements.waterRegionList.children.at(-1).children[1].textContent, "2 / 2",
    "selecting a region on another page turns to that page");
  assert.ok(elements.waterRegionList.children.some((row) => row.dataset.regionId === "sea-44"));

  state.selectedWaterRegionId = "ATLSEA_FILL_adriatica_10";
  controller.renderWaterRegionList();
  const revealed = elements.waterRegionList.children[0];
  assert.equal(revealed.open, true, "the group holding the selection opens");
  assert.equal(revealed.children[1].children[1].open, true, "and so does its sub-sea");
});

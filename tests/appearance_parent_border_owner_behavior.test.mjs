import { TestClassList } from "./helpers/appearance_class_list.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildParentBorderCountryRows,
  createAppearanceParentBorderOwner,
  getParentBorderRowsSignature,
  normalizeParentBorderEnabledMap,
} from "../js/ui/toolbar/appearance_parent_border_owner.js";

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.className = "";
    this.classList = new TestClassList(this);
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.type = "";
    this.replaceChildrenCallCount = 0;
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.replaceChildrenCallCount += 1;
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler({
        target: this,
        ...event,
      });
    }
  }
}

function createTestDocument() {
  return {
    createElement: (tagName) => new TestElement(tagName),
  };
}

function createHarness(runtimeOverrides = {}) {
  const runtimeState = {
    parentBorderSupportedCountries: ["FRA", "DEU"],
    parentBorderEnabledByCountry: { FRA: true, DEU: false, OLD: true },
    parentBordersVisible: true,
    styleConfig: {
      parentBorders: {
        color: "#123456",
        opacity: 0.5,
        width: 1.25,
      },
    },
    countryNames: {
      FRA: "France",
      DEU: "Germany",
    },
    ...runtimeOverrides,
  };
  const nodes = {
    visibleToggle: new TestElement("input"),
    colorInput: new TestElement("input"),
    opacityInput: new TestElement("input"),
    opacityValue: new TestElement("span"),
    widthInput: new TestElement("input"),
    widthValue: new TestElement("span"),
    enableAllButton: new TestElement("button"),
    disableAllButton: new TestElement("button"),
    countryList: new TestElement("div"),
    countrySearch: new TestElement("input"),
    enabledOnlyToggle: new TestElement("input"),
    countrySummary: new TestElement("summary"),
    emptyNode: new TestElement("p"),
  };
  nodes.emptyNode.className = "hidden";
  const dirtyReasons = [];
  const owner = createAppearanceParentBorderOwner({
    runtimeState,
    nodes,
    translateGeo: (label) => `geo:${label}`,
    renderDirty: (reason) => dirtyReasons.push(reason),
    documentRef: createTestDocument(),
  });
  return { dirtyReasons, nodes, owner, runtimeState };
}

test("parent border owner normalizes enabled map and sorts translated rows", () => {
  const runtimeState = {
    parentBorderSupportedCountries: ["FRA", "DEU"],
    parentBorderEnabledByCountry: { FRA: true, OLD: true },
  };

  assert.deepEqual(normalizeParentBorderEnabledMap(runtimeState), {
    FRA: true,
    DEU: false,
  });

  const rows = buildParentBorderCountryRows({
    supportedCountries: ["FRA", "DEU"],
    countryNames: { FRA: "France", DEU: "Germany" },
    translateGeo: (label) => label === "Germany" ? "A Germany" : label,
  });

  assert.deepEqual(rows.map((row) => row.code), ["DEU", "FRA"]);
  assert.equal(getParentBorderRowsSignature(rows), JSON.stringify([
    ["DEU", "A Germany"],
    ["FRA", "France"],
  ]));
});

test("parent border owner reuses the country list when the row model is unchanged", () => {
  const harness = createHarness();

  const firstRender = harness.owner.renderCountryList();
  const secondRender = harness.owner.renderCountryList();

  assert.deepEqual(firstRender, { rebuilt: true, rows: 2 });
  assert.deepEqual(secondRender, { rebuilt: false, rows: 2 });
  assert.equal(harness.nodes.countryList.replaceChildrenCallCount, 1);
  assert.equal(harness.nodes.countryList.children.length, 2);
  assert.equal(harness.nodes.countryList.children[0].children[1].textContent, "geo:France (FRA)");

  harness.runtimeState.parentBorderEnabledByCountry.DEU = true;
  const thirdRender = harness.owner.renderCountryList();
  const deuCheckbox = harness.nodes.countryList.children[1].children[0];

  assert.deepEqual(thirdRender, { rebuilt: false, rows: 2 });
  assert.equal(harness.nodes.countryList.replaceChildrenCallCount, 1);
  assert.equal(deuCheckbox.checked, true);
});

test("parent border owner syncs visibility controls without rebuilding rows", () => {
  const harness = createHarness({ parentBordersVisible: false });

  harness.owner.renderCountryList();

  assert.equal(harness.nodes.visibleToggle.checked, false);
  assert.equal(harness.nodes.colorInput.disabled, true);
  assert.equal(harness.nodes.opacityInput.disabled, true);
  assert.equal(harness.nodes.widthInput.disabled, true);
  assert.equal(harness.nodes.enableAllButton.disabled, true);
  assert.equal(harness.nodes.disableAllButton.disabled, true);
  assert.equal(harness.nodes.countryList.classList.contains("opacity-60"), true);
  assert.equal(harness.nodes.countryList.children[0].children[0].disabled, true);

  harness.runtimeState.parentBordersVisible = true;
  harness.owner.renderCountryList();

  assert.equal(harness.nodes.countryList.replaceChildrenCallCount, 1);
  assert.equal(harness.nodes.visibleToggle.checked, true);
  assert.equal(harness.nodes.colorInput.disabled, false);
  assert.equal(harness.nodes.countryList.children[0].children[0].disabled, false);
});

test("parent border owner checkbox changes update state and mark dirty", () => {
  const harness = createHarness();

  harness.owner.renderCountryList();
  const franceCheckbox = harness.nodes.countryList.children[0].children[0];
  franceCheckbox.checked = false;
  franceCheckbox.dispatch("change");

  assert.equal(harness.runtimeState.parentBorderEnabledByCountry.FRA, false);
  assert.deepEqual(harness.dirtyReasons, ["parent-border-country"]);
});

test("parent border owner binds style, visibility, and batch controls", () => {
  const harness = createHarness();

  harness.owner.bindEvents();

  assert.equal(harness.nodes.colorInput.value, "#123456");
  assert.equal(harness.nodes.opacityInput.value, "50");
  assert.equal(harness.nodes.opacityValue.textContent, "50%");
  assert.equal(harness.nodes.widthInput.value, "1.25");
  assert.equal(harness.nodes.widthValue.textContent, "1.25");

  harness.nodes.colorInput.value = "#abcdef";
  harness.nodes.colorInput.dispatch("input");
  assert.equal(harness.runtimeState.styleConfig.parentBorders.color, "#abcdef");

  harness.nodes.opacityInput.value = "75";
  harness.nodes.opacityInput.dispatch("input");
  assert.equal(harness.runtimeState.styleConfig.parentBorders.opacity, 0.75);
  assert.equal(harness.nodes.opacityValue.textContent, "75%");

  harness.nodes.widthInput.value = "2.4";
  harness.nodes.widthInput.dispatch("input");
  assert.equal(harness.runtimeState.styleConfig.parentBorders.width, 2.4);
  assert.equal(harness.nodes.widthValue.textContent, "2.40");

  harness.nodes.visibleToggle.checked = false;
  harness.nodes.visibleToggle.dispatch("change");
  assert.equal(harness.runtimeState.parentBordersVisible, false);
  assert.equal(harness.nodes.countryList.classList.contains("opacity-60"), true);

  harness.nodes.enableAllButton.dispatch("click");
  assert.deepEqual(harness.runtimeState.parentBorderEnabledByCountry, { FRA: true, DEU: true });

  harness.nodes.disableAllButton.dispatch("click");
  assert.deepEqual(harness.runtimeState.parentBorderEnabledByCountry, { FRA: false, DEU: false });

  assert.deepEqual(harness.dirtyReasons, [
    "parent-border-color",
    "parent-border-opacity",
    "parent-border-width",
    "parent-border-visibility",
    "parent-border-enable-all",
    "parent-border-disable-all",
  ]);
});

test("parent border owner shows empty state and skips repeated empty renders", () => {
  const harness = createHarness({
    parentBorderSupportedCountries: [],
    parentBorderEnabledByCountry: { FRA: true },
  });

  assert.deepEqual(harness.owner.renderCountryList(), { rebuilt: true, rows: 0 });
  assert.deepEqual(harness.owner.renderCountryList(), { rebuilt: false, rows: 0 });
  assert.equal(harness.nodes.emptyNode.classList.contains("hidden"), false);
  assert.equal(harness.nodes.countryList.replaceChildrenCallCount, 1);
  assert.deepEqual(harness.runtimeState.parentBorderEnabledByCountry, {});
});

test("country search and enabled-only filter compose and follow selection changes", () => {
  const { nodes, owner, runtimeState } = createHarness();
  owner.bindEvents();
  owner.renderCountryList();
  const visible = () => nodes.countryList.children.filter((row) => !row.hidden).map((row) => row.children[1].textContent);
  assert.equal(nodes.countrySummary.textContent, "By country (1 on)");
  nodes.countrySearch.value = "gErMaNy";
  nodes.countrySearch.dispatch("input");
  assert.deepEqual(visible(), ["geo:Germany (DEU)"]);
  nodes.countrySearch.value = " fra ";
  nodes.countrySearch.dispatch("input");
  assert.deepEqual(visible(), ["geo:France (FRA)"]);
  nodes.enabledOnlyToggle.checked = true;
  nodes.enabledOnlyToggle.dispatch("change");
  assert.deepEqual(visible(), ["geo:France (FRA)"]);
  nodes.countrySearch.value = "DEU";
  nodes.countrySearch.dispatch("input");
  assert.deepEqual(visible(), []);
  nodes.enableAllButton.dispatch("click");
  assert.deepEqual(visible(), ["geo:Germany (DEU)"]);
  assert.equal(nodes.countrySummary.textContent, "By country (2 on)");
  const checkbox = nodes.countryList.children[1].children[0];
  checkbox.checked = false;
  checkbox.dispatch("change");
  assert.deepEqual(visible(), []);
  nodes.countrySearch.value = "";
  nodes.countrySearch.dispatch("input");
  assert.deepEqual(visible(), ["geo:France (FRA)"]);
  nodes.disableAllButton.dispatch("click");
  assert.deepEqual(visible(), []);
  assert.equal(nodes.countrySummary.textContent, "By country (0 on)");
  nodes.enabledOnlyToggle.checked = false;
  nodes.enabledOnlyToggle.dispatch("change");
  assert.equal(visible().length, 2);
  runtimeState.parentBorderEnabledByCountry.DEU = true;
  owner.renderCountryList();
  assert.equal(nodes.countrySummary.textContent, "By country (1 on)");
  assert.equal(nodes.countryList.replaceChildrenCallCount, 1);
});

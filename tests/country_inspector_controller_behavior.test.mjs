import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { UI_COPY_CATALOG } from "../js/core/i18n_catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class TestClassList {
  constructor(node) {
    this.node = node;
    this.values = new Set();
  }

  syncFromNode() {
    this.values = new Set(String(this.node.className || "")
      .split(/\s+/)
      .filter(Boolean));
  }

  add(...tokens) {
    this.syncFromNode();
    tokens.forEach((token) => this.values.add(token));
    this.node.className = Array.from(this.values).join(" ");
  }

  remove(...tokens) {
    this.syncFromNode();
    tokens.forEach((token) => this.values.delete(token));
    this.node.className = Array.from(this.values).join(" ");
  }

  contains(token) {
    this.syncFromNode();
    return this.values.has(token);
  }

  toggle(token, force) {
    this.syncFromNode();
    const enabled = force === undefined ? !this.values.has(token) : !!force;
    if (enabled) this.add(token);
    else this.remove(token);
    return enabled;
  }
}

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = { removeProperty() {} };
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new TestClassList(this);
    this.className = "";
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.value = "";
    this.type = "";
    this.open = false;
  }

  get parentElement() {
    return this.parentNode;
  }

  get firstElementChild() {
    return this.children.find((child) => child.tagName !== "#text") || null;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    if (typeof node === "string") {
      const text = new TestElement("#text");
      text.textContent = node;
      node = text;
    }
    this.children.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(node, referenceNode) {
    const index = this.children.indexOf(referenceNode);
    if (index === -1) return this.appendChild(node);
    this.children.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  replaceChildren(...nodes) {
    const activeElement = globalThis.document?.activeElement;
    if (activeElement && this.contains(activeElement)) {
      globalThis.document.activeElement = globalThis.document.body;
    }
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
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type) {
    const event = {
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
    };
    for (const handler of this.listeners.get(type) || []) {
      handler(event);
    }
  }

  click() {
    this.dispatch("click");
  }

  change() {
    this.dispatch("change");
  }

  focus() {
    this.dataset.focused = "true";
    this.focusOptions = arguments[0];
    if (globalThis.document) globalThis.document.activeElement = this;
  }

  blur() {
    this.dataset.blurred = "true";
  }

  getBoundingClientRect() {
    return { left: 0, top: this.rectTop || 0, width: 0, height: 0 };
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (selector.startsWith(".") && node.className.split(/\s+/).includes(selector.slice(1))) return node;
      node = node.parentNode;
    }
    return null;
  }

  contains(target) {
    if (this === target) return true;
    return (this.children || []).some((child) => child.contains(target));
  }

  querySelector(selector) {
    return findFirst(this, (node) => matchesSelector(node, selector));
  }

  querySelectorAll(selector) {
    return findAll(this, (node) => matchesSelector(node, selector));
  }
}

function createTestDocument() {
  const document = {
    createElement: (tagName) => new TestElement(tagName),
    createDocumentFragment: () => new TestElement("#fragment"),
  };
  document.body = new TestElement("body");
  document.activeElement = document.body;
  return document;
}

function walk(node, visit) {
  for (const child of node.children || []) {
    visit(child);
    walk(child, visit);
  }
}

function findFirst(root, predicate) {
  let result = null;
  walk(root, (node) => {
    if (!result && predicate(node)) result = node;
  });
  return result;
}

function findAll(root, predicate) {
  const result = [];
  walk(root, (node) => {
    if (predicate(node)) result.push(node);
  });
  return result;
}

function datasetKeyFromSelector(selector) {
  return selector
    .slice(6, -1)
    .split("=")[0]
    .replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}

function matchesSelector(node, selector) {
  if (!selector) return false;
  if (selector.includes(" ")) {
    const parts = selector.split(/\s+/);
    const last = parts.pop();
    if (!matchesSelector(node, last)) return false;
    let parent = node.parentNode;
    while (parent) {
      if (matchesSelector(parent, parts.join(" "))) return true;
      parent = parent.parentNode;
    }
    return false;
  }
  if (selector.startsWith(".")) {
    return node.className.split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith("[data-")) {
    const key = datasetKeyFromSelector(selector);
    return Object.prototype.hasOwnProperty.call(node.dataset, key);
  }
  if (selector.includes(".")) {
    const [tag, ...classes] = selector.split(".");
    if (tag && node.tagName !== tag.toLowerCase()) return false;
    return classes.every((className) => node.className.split(/\s+/).includes(className));
  }
  return node.tagName === selector.toLowerCase();
}

function textOf(node) {
  return [node?.textContent || "", ...(node?.children || []).map(textOf)].join(" ").trim();
}

function createHarness({
  selectedCountry = null,
  hgoIdentity = null,
  countryEntries = [],
  countryTree = [],
  childSectionsByParent = new Map(),
  buildCountryRowMetaText = () => "",
  getSelectedLandInspectorCountryCode = () => "",
  t = (value) => value,
} = {}) {
  const host = new TestElement("section");
  const list = new TestElement("div");
  host.appendChild(list);
  const countryInspectorSelected = new TestElement("section");
  const runtimeState = {
    expandedInspectorContinents: new Set(),
    expandedInspectorReleaseParents: new Set(),
    selectedInspectorCountryCode: selectedCountry?.code || "",
  };
  let latestStates = new Map(selectedCountry ? [[selectedCountry.code, selectedCountry]] : []);
  let settingsChangeCalls = 0;
  let coverageCalls = 0;
  const observedVariantSelections = [];

  const controller = createCountryInspectorController({
    runtimeState,
    list,
    searchInput: { value: "", dataset: {}, addEventListener() {} },
    selectedCountryActionsSection: new TestElement("section"),
    countryInspectorDetail: new TestElement("section"),
    countryInspectorSelected,
    countryInspectorColorRow: new TestElement("div"),
    countryInspectorColorSwatch: new TestElement("span"),
    countryInspectorColorInput: new TestElement("input"),
    countryRowRefsByCode: new Map(),
    getLatestCountryStatesByCode: () => latestStates,
    setLatestCountryStatesByCode: (value) => {
      latestStates = value;
    },
    getCountryInspectorColorPickerOpen: () => false,
    setCountryInspectorColorPickerOpen: () => {},
    t,
    normalizeCountryCode: (value) => String(value || "").trim().toUpperCase(),
    normalizeHexColor: (value) => String(value || "").trim(),
    updateScenarioInspectorLayout: () => {},
    scheduleAdaptiveInspectorHeights: () => {},
    flushSidebarRender: () => {},
    createEmptyNote: (value) => {
      const note = new TestElement("div");
      note.textContent = value;
      return note;
    },
    getDynamicCountryEntries: () => countryEntries,
    createCountryInspectorState: (entry, entryIndex) => {
      const group = countryTree.find((node) => node.countries.some((country) => country.code === entry.code));
      return {
        ...entry,
        entryIndex,
        ...(group ? { topLevelGroupId: group.id, topLevelGroupLabel: group.displayLabel } : {}),
      };
    },
    getCountryChildSectionsForParent: (code) => childSectionsByParent.get(String(code || "").trim().toUpperCase()) || [],
    buildCountryRowMetaText,
    getResolvedCountryColor: () => "#000000",
    getDisplayCountryColor: () => "#000000",
    applyCountryColor: () => {},
    incrementSidebarCounter: () => {},
    markDirty: () => {},
    getHgoIdentity: hgoIdentity
      ? ((countryState, options) => (
        typeof hgoIdentity === "function" ? hgoIdentity(countryState, options) : hgoIdentity
      ))
      : null,
    getHgoIdentityCoverage: () => {
      coverageCalls += 1;
      return { flags: 0, total: 0 };
    },
    getHgoIdentityStatus: () => ({ status: "idle" }),
    getSelectedLandInspectorCountryCode,
    onHgoIdentitySettingsChange: () => {
      settingsChangeCalls += 1;
      observedVariantSelections.push({ ...runtimeState.hgoIdentity.variantSelections });
    },
  });

  return {
    controller,
    countryInspectorSelected,
    host,
    runtimeState,
    get coverageCalls() {
      return coverageCalls;
    },
    get settingsChangeCalls() {
      return settingsChangeCalls;
    },
    get observedVariantSelections() {
      return observedVariantSelections;
    },
  };
}

test("HGO identity controls stay cold until the user enables them", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    const harness = createHarness();
    harness.controller.renderList();

    const controls = harness.host.querySelector("[data-hgo-identity-controls]");
    assert.ok(controls);
    assert.equal(harness.runtimeState.hgoIdentity.enabled, false);
    assert.equal(harness.coverageCalls, 0);
    assert.match(textOf(controls.querySelector(".hgo-identity-summary")), /HGO disabled/);

    const enabledInput = controls.querySelector(".hgo-identity-toggle input");
    assert.equal(enabledInput.checked, false);
    enabledInput.checked = true;
    enabledInput.change();

    assert.equal(harness.runtimeState.hgoIdentity.enabled, true);
    assert.equal(harness.settingsChangeCalls, 1);

    harness.controller.renderList();
    const enabledControls = harness.host.querySelector("[data-hgo-identity-controls]");
    const modeButtons = enabledControls.querySelectorAll(".hgo-identity-mode-btn");
    const suggestedInput = enabledControls.querySelector(".hgo-identity-suggested-toggle input");
    const detailsInput = enabledControls.querySelector(".country-inspector-details-toggle input");
    assert.equal(harness.coverageCalls, 1);
    assert.equal(enabledControls.querySelector(".hgo-identity-summary"), null);
    assert.equal(modeButtons.every((button) => button.disabled === false), true);
    assert.equal(suggestedInput.disabled, false);
    assert.equal(detailsInput.checked, false);

    const hgoModeButton = modeButtons.find((button) => button.textContent === "HGO names");
    hgoModeButton.click();
    assert.equal(harness.runtimeState.hgoIdentity.nameMode, "hgo");
    assert.equal(harness.settingsChangeCalls, 2);

    suggestedInput.checked = false;
    suggestedInput.change();
    assert.equal(harness.runtimeState.hgoIdentity.showSuggestedAliases, false);
    assert.equal(harness.settingsChangeCalls, 3);

    detailsInput.checked = true;
    detailsInput.change();
    assert.equal(harness.runtimeState.countryInspectorShowDetails, true);
    assert.equal(harness.settingsChangeCalls, 4);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HGO identity detail uses medium artwork before resolver preferred small artwork", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    const harness = createHarness({
      selectedCountry: { code: "ABK", displayName: "Scenario Abkhazia" },
      hgoIdentity: {
        matchKind: "exact",
        displayName: "Abkhazia",
        hgoNames: { en: "Abkhazia" },
        flag: {
          base: {
            small: { pngPath: "data/hgo_catalogs/flags_png/small/AB/ABK.png" },
            medium: { pngPath: "data/hgo_catalogs/flags_png/medium/AB/ABK.png" },
            full: { pngPath: "data/hgo_catalogs/flags_png/full/AB/ABK.png" },
          },
          preferredBaseFlag: { tier: "small", pngPath: "data/hgo_catalogs/flags_png/small/AB/ABK.png" },
          variants: [],
        },
      },
    });
    harness.runtimeState.hgoIdentity = { enabled: true, nameMode: "hgo", showSuggestedAliases: true };

    harness.controller.renderCountryInspectorDetail();

    const flag = harness.countryInspectorSelected.querySelector(".hgo-identity-detail-flag");
    assert.ok(flag);
    assert.equal(flag.src, "data/hgo_catalogs/flags_png/medium/AB/ABK.png");
    assert.equal(flag.alt, "");
    assert.equal(flag.getAttribute("aria-hidden"), "true");
    assert.equal(harness.countryInspectorSelected.querySelector(".hgo-identity-badges"), null);
    assert.equal(harness.countryInspectorSelected.querySelector(".hgo-identity-name-list"), null);

    harness.runtimeState.countryInspectorShowDetails = true;
    harness.controller.renderCountryInspectorDetail();

    assert.match(textOf(harness.countryInspectorSelected.querySelector(".hgo-identity-badges")), /exact/);
    assert.match(textOf(harness.countryInspectorSelected.querySelector(".hgo-identity-name-list")), /Abkhazia/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("selected land country quick tab appears only for current map land selection", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    let selectedLandCode = "";
    const harness = createHarness({
      selectedCountry: { code: "ABK", displayName: "Scenario Abkhazia" },
      countryEntries: [
        { code: "ABK", displayName: "Scenario Abkhazia" },
        { code: "USA", displayName: "United States" },
      ],
      countryTree: [
        { id: "continent_europe", displayLabel: "Europe", countries: [{ code: "ABK" }] },
        { id: "continent_north_america", displayLabel: "North America", countries: [{ code: "USA" }] },
      ],
      buildCountryRowMetaText: (countryState) => `tag ${countryState.code}`,
      getSelectedLandInspectorCountryCode: () => selectedLandCode,
    });

    harness.controller.renderList();
    assert.equal(harness.host.querySelector("[data-selected-land-country-quick-tab]"), null);

    selectedLandCode = "ABK";
    harness.runtimeState.selectedInspectorCountryCode = "ABK";
    harness.controller.renderCountryInspectorDetail();

    let tab = harness.host.querySelector("[data-selected-land-country-quick-tab]");
    assert.ok(tab);
    assert.equal(tab.classList.contains("hidden"), false);
    assert.match(textOf(tab), /Selected map country/);
    assert.match(textOf(tab), /Scenario Abkhazia/);
    assert.match(textOf(tab), /ABK/);

    selectedLandCode = "USA";
    harness.runtimeState.selectedInspectorCountryCode = "USA";
    harness.controller.refreshCountryRows({
      countryCodes: ["ABK", "USA"],
      refreshInspector: true,
    });

    tab = harness.host.querySelector("[data-selected-land-country-quick-tab]");
    assert.match(textOf(tab), /United States/);
    assert.match(textOf(tab), /USA/);
    assert.doesNotMatch(textOf(tab), /Scenario Abkhazia/);

    selectedLandCode = "";
    harness.controller.renderCountryInspectorDetail();

    tab = harness.host.querySelector("[data-selected-land-country-quick-tab]");
    assert.ok(tab);
    assert.equal(tab.classList.contains("hidden"), true);
    assert.equal(textOf(tab), "");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("country inspector renders Other only for real unclassified top-level countries", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    const groupedHarness = createHarness({
      countryEntries: [
        { code: "GER", displayName: "Germany" },
        { code: "XIK", displayName: "XiKang" },
      ],
      countryTree: [
        { id: "continent_europe", displayLabel: "Europe", countries: [{ code: "GER" }] },
        { id: "scenario_group_china_region", displayLabel: "China Region", countries: [{ code: "XIK" }] },
      ],
    });
    groupedHarness.runtimeState.countryGroupsData = { continents: [{ id: "continent_europe" }] };
    groupedHarness.controller.renderList();

    assert.doesNotMatch(textOf(groupedHarness.host), /Other/);

    const fallbackHarness = createHarness({
      countryEntries: [
        { code: "GER", displayName: "Germany" },
        { code: "UNK", displayName: "Unclassified" },
      ],
      countryTree: [
        { id: "continent_europe", displayLabel: "Europe", countries: [{ code: "GER" }] },
        { id: "continent_other", displayLabel: "Other", countries: [{ code: "UNK" }] },
      ],
    });
    fallbackHarness.runtimeState.countryGroupsData = { continents: [{ id: "continent_europe" }] };
    fallbackHarness.controller.renderList();

    assert.match(textOf(fallbackHarness.host), /Other \(1\)/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("related country child rows hide releasable parent lists", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    const harness = createHarness({
      countryEntries: [
        { code: "GER", displayName: "Germany" },
      ],
      countryTree: [
        { id: "continent_europe", displayLabel: "Europe", countries: [{ code: "GER" }] },
      ],
      childSectionsByParent: new Map([
        ["GER", [{
          id: "releasables",
          label: "可释放国家",
          states: [{
            code: "CHI",
            displayName: "Nanjing China",
            releasable: true,
            parentOwnerTags: ["ROC", "ENG"],
            subregionDisplayLabel: "东亚",
          }],
        }]],
      ]),
      buildCountryRowMetaText: (countryState, { showRelationMeta = false } = {}) => {
        const parts = [];
        if (countryState?.subregionDisplayLabel) parts.push(countryState.subregionDisplayLabel);
        if (countryState?.releasable && showRelationMeta) {
          parts.push("可自以下母国释放：中华民国, 英格兰王国");
        }
        return parts.join(" · ");
      },
    });
    harness.runtimeState.expandedInspectorContinents.add("group::continent_europe");
    harness.runtimeState.expandedInspectorReleaseParents.add("GER");

    harness.controller.renderList();

    let renderedText = textOf(harness.host);
    assert.match(renderedText, /Nanjing China/);
    assert.equal(harness.host.querySelector(".country-select-subaction"), null);
    assert.doesNotMatch(renderedText, /东亚/);
    assert.doesNotMatch(renderedText, /tag CHI/);
    assert.doesNotMatch(renderedText, /可自以下母国释放/);

    const germanyRow = harness.host
      .querySelectorAll(".country-select-row")
      .find((row) => row.dataset.countryCode === "GER");
    germanyRow.querySelector(".country-select-main").click();
    const germanyTitle = germanyRow.querySelector(".country-select-title");
    assert.equal(germanyTitle.textContent, "Germany");

    const detailsInput = harness.host.querySelector(".country-inspector-details-toggle input");
    detailsInput.checked = true;
    detailsInput.change();
    harness.controller.renderList();

    renderedText = textOf(harness.host);
    assert.match(renderedText, /东亚/);
    assert.match(renderedText, /tag CHI/);
    assert.doesNotMatch(renderedText, /可自以下母国释放/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("intentional explorer and related-country toggles restore focus and preserve their scroll anchor", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    const harness = createHarness({
      countryEntries: [{ code: "GER", displayName: "Germany" }],
      countryTree: [{ id: "continent_europe", displayLabel: "Europe", countries: [{ code: "GER" }] }],
      childSectionsByParent: new Map([["GER", [{
        id: "releasables",
        label: "Releasables",
        states: [{ code: "CHI", displayName: "Nanjing China", releasable: true }],
      }]]]),
    });
    harness.host.className = "editor-task-body";
    harness.host.scrollTop = 100;
    harness.runtimeState.countryGroupsData = { continents: [{ id: "continent_europe" }] };
    harness.runtimeState.inspectorExpansionInitialized = true;
    harness.controller.renderList();

    const oldHeader = harness.host.querySelector(".country-explorer-header");
    oldHeader.rectTop = 48;
    oldHeader.focus();
    oldHeader.click();

    let nextHeader = harness.host.querySelector(".country-explorer-header");
    assert.equal(globalThis.document.activeElement, nextHeader);
    assert.deepEqual(nextHeader.focusOptions, { preventScroll: true });
    assert.equal(harness.host.scrollTop, 52);
    assert.equal(nextHeader.getAttribute("aria-expanded"), "true");

    const oldToggle = harness.host.querySelector(".country-children-toggle");
    oldToggle.rectTop = 31;
    oldToggle.focus();
    oldToggle.click();

    const nextToggle = harness.host.querySelector(".country-children-toggle");
    assert.equal(globalThis.document.activeElement, nextToggle);
    assert.deepEqual(nextToggle.focusOptions, { preventScroll: true });
    assert.equal(harness.host.scrollTop, 21);
    assert.ok(harness.host.querySelector("[data-country-code]"));

    harness.controller.renderList();
    const refreshedToggle = harness.host.querySelector(".country-children-toggle");
    assert.equal(globalThis.document.activeElement, refreshedToggle);
    assert.deepEqual(refreshedToggle.focusOptions, { preventScroll: true });

    globalThis.document.activeElement = globalThis.document.body;
    harness.controller.renderList();
    assert.equal(globalThis.document.activeElement, globalThis.document.body);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HGO identity detail replaces raw variant badges with a selectable flag option", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    const harness = createHarness({
      selectedCountry: { code: "ABK", displayName: "Scenario Abkhazia" },
      hgoIdentity: (_countryState, options = {}) => {
        const selected = options.preferredVariantKey === "sov";
        return {
          matchKind: "exact",
          displayName: "Abkhazia",
          hgoNames: { en: "Abkhazia" },
          sourceTag: "ABK",
          tag: "ABK",
          flag: {
            base: {
              medium: { pngPath: "data/hgo_catalogs/flags_png/medium/AB/ABK.png" },
            },
            preferredBaseFlag: { tier: "medium", pngPath: "data/hgo_catalogs/flags_png/medium/AB/ABK.png" },
            preferredVariantKey: selected ? "sov" : "",
            preferredVariantFlag: selected
              ? { tier: "medium", pngPath: "data/hgo_catalogs/flags_png/medium/AB/ABK_SOV.png" }
              : null,
            variants: [{
              key: "sov",
              label: "SOV",
              variantSource: "SOV",
              tiers: {
                medium: { pngPath: "data/hgo_catalogs/flags_png/medium/AB/ABK_SOV.png" },
              },
            }],
          },
        };
      },
    });
    harness.runtimeState.hgoIdentity = {
      enabled: true,
      nameMode: "hgo",
      showSuggestedAliases: true,
      variantSelections: { USA: "democratic" },
    };
    const variantSelections = harness.runtimeState.hgoIdentity.variantSelections;

    harness.controller.renderCountryInspectorDetail();

    assert.equal(harness.countryInspectorSelected.querySelector(".hgo-identity-variant-list"), null);
    const select = harness.countryInspectorSelected.querySelector(".hgo-identity-variant-select");
    assert.ok(select);
    assert.equal(select.querySelectorAll("option").length, 2);
    assert.equal(select.querySelectorAll("option")[1].textContent, "SOV");

    select.value = "sov";
    select.change();

    assert.equal(harness.runtimeState.hgoIdentity.variantSelections.ABK, "sov");
    assert.equal(harness.runtimeState.hgoIdentity.variantSelections, variantSelections);
    assert.equal(harness.runtimeState.hgoIdentity.variantSelections.USA, "democratic");
    assert.equal(harness.settingsChangeCalls, 1);
    assert.deepEqual(harness.observedVariantSelections, [{ USA: "democratic", ABK: "sov" }]);
    select.value = "";
    select.change();
    assert.equal(harness.runtimeState.hgoIdentity.variantSelections.ABK, undefined);
    assert.equal(harness.runtimeState.hgoIdentity.variantSelections, variantSelections);
    assert.equal(harness.runtimeState.hgoIdentity.variantSelections.USA, "democratic");
    assert.equal(harness.settingsChangeCalls, 2);
    assert.deepEqual(harness.observedVariantSelections.at(-1), { USA: "democratic" });
    assert.equal(harness.countryInspectorSelected.querySelector(".hgo-identity-variant-preview"), null);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HGO identity flag option translates ideology variant labels", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createTestDocument();

  try {
    const translations = new Map([
      ["Anarchism ideology", "无政府主义意识形态"],
      ["Authoritarian monarchism", "威权君主制"],
      ["National socialism", "国家社会主义"],
    ]);
    const harness = createHarness({
      selectedCountry: { code: "USA", displayName: "Scenario USA" },
      t: (value) => translations.get(value) || value,
      hgoIdentity: {
        matchKind: "exact",
        displayName: "USA",
        hgoNames: { en: "USA" },
        sourceTag: "USA",
        tag: "USA",
        flag: {
          base: {
            medium: { pngPath: "data/hgo_catalogs/flags_png/medium/US/USA.png" },
          },
          preferredBaseFlag: { tier: "medium", pngPath: "data/hgo_catalogs/flags_png/medium/US/USA.png" },
          preferredVariantKey: "",
          preferredVariantFlag: null,
          variants: [
            {
              key: "anarchism_ideology",
              label: "anarchism_ideology",
              variantSource: "anarchism_ideology",
              tiers: {},
            },
            {
              key: "authoritarian_monarchism",
              label: "authoritarian_monarchism",
              variantSource: "authoritarian_monarchism",
              tiers: {},
            },
            {
              key: "usa_national_socialism",
              label: "usa_national_socialism",
              variantSource: "usa_national_socialism",
              tiers: {},
            },
          ],
        },
      },
    });
    harness.runtimeState.hgoIdentity = { enabled: true, nameMode: "hgo", showSuggestedAliases: true };

    harness.controller.renderCountryInspectorDetail();

    const options = Array.from(harness.countryInspectorSelected.querySelectorAll(".hgo-identity-variant-select option"))
      .map((option) => option.textContent);
    assert.deepEqual(options, [
      "Base flag",
      "无政府主义意识形态",
      "威权君主制",
      "USA · 国家社会主义",
    ]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HGO identity ideology labels are present in the startup UI translation catalog", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../js/ui/sidebar/country_inspector_controller.js"),
    "utf8",
  );
  const labelMapBlock = source.match(/const HGO_VARIANT_LABEL_KEYS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(labelMapBlock, "expected HGO variant label map to be present");

  const labels = Array.from(new Set(
    Array.from(labelMapBlock[1].matchAll(/:\s*"([^"]+)"/g), (match) => match[1]),
  ));
  assert.ok(labels.length > 0, "expected HGO ideology labels to be discovered");

  const missingLabels = labels.filter((label) => {
    const entry = UI_COPY_CATALOG[label];
    return !entry?.zh || entry.zh === label || entry.en !== label;
  });

  assert.deepEqual(missingLabels, []);
});

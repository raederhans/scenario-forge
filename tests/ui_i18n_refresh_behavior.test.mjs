import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import { readRegisteredRuntimeHookSource, registerRuntimeHook } from "../js/core/state/index.js";
import { applyDeclarativeTranslations, toggleLanguage, updateUIText } from "../js/ui/i18n.js";

class TranslationElement {
  constructor(attributes = {}, text = "") {
    this.nodeType = 1;
    this.attributes = new Map(Object.entries(attributes));
    this.dataset = {};
    this.children = [];
    this.value = "";
    this.text = text;
    this.textWrites = 0;
    this.attributeWrites = 0;
    this.classList = { contains: () => false };
  }
  get textContent() { return this.text; }
  set textContent(value) {
    this.text = value;
    this.children = [];
    this.textWrites += 1;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) {
    this.attributes.set(name, value);
    this.attributeWrites += 1;
  }
  matches() { return [...this.attributes.keys()].some((name) => name.startsWith("data-i18n")); }
  querySelector() { return this.semanticTitle || null; }
  querySelectorAll() { return this.children.filter((child) => child.matches()); }
}

function mount(t, nodes = new Map()) {
  const originalDocument = globalThis.document;
  const originalLanguage = state.currentLanguage;
  const originalLocales = state.locales;
  globalThis.document = {
    getElementById: (id) => nodes.get(id) || null,
    querySelectorAll: () => [...nodes.values()].filter((node) => node.matches()),
  };
  state.currentLanguage = "zh";
  state.locales = { ui: {
    Tools: { en: "Tools", zh: "工具" },
    Borders: { en: "Borders", zh: "边界" },
    "Reset Country Colors": { en: "Reset Country Colors", zh: "重置国家颜色" },
  } };
  t.after(() => {
    globalThis.document = originalDocument;
    state.currentLanguage = originalLanguage;
    state.locales = originalLocales;
  });
}

test("declarative refresh avoids equal DOM writes while translating new nodes and changed locale data", (t) => {
  mount(t);
  const node = new TranslationElement({
    "data-i18n": "Tools", "data-i18n-placeholder": "Tools", "data-i18n-title": "Tools",
    "data-i18n-aria-label": "Tools", "data-i18n-alt": "Tools",
  });
  node.value = "a user-entered filter";
  applyDeclarativeTranslations(node);
  assert.equal(node.textContent, "工具");
  assert.equal(node.textWrites, 1);
  assert.equal(node.attributeWrites, 4);
  applyDeclarativeTranslations(node);
  assert.equal(node.textWrites, 1);
  assert.equal(node.attributeWrites, 4);
  assert.equal(node.value, "a user-entered filter");

  const dynamicChild = new TranslationElement({ "data-i18n": "Borders" });
  node.children.push(dynamicChild);
  applyDeclarativeTranslations(node);
  assert.equal(dynamicChild.textContent, "边界");
  state.locales.ui.Tools.zh = "绘图工具";
  applyDeclarativeTranslations(node);
  assert.equal(node.textContent, "绘图工具");
  assert.equal(node.getAttribute("placeholder"), "绘图工具");
  state.currentLanguage = "en";
  applyDeclarativeTranslations(dynamicChild);
  assert.equal(dynamicChild.textContent, "Borders");
});

test("translation updates the semantic title without replacing neighboring controls", (t) => {
  mount(t);
  const node = new TranslationElement({ "data-i18n": "Tools" });
  const title = new TranslationElement();
  const input = new TranslationElement();
  input.value = "retained";
  node.children = [title, input];
  node.semanticTitle = title;
  applyDeclarativeTranslations(node);
  applyDeclarativeTranslations(node);
  assert.equal(title.textContent, "工具");
  assert.equal(title.textWrites, 1);
  assert.deepEqual(node.children, [title, input]);
  assert.equal(node.textWrites, 0);
  assert.equal(input.value, "retained");
});

test("full UI refresh honors a declarative key instead of overwriting it with a legacy label", (t) => {
  const node = new TranslationElement({ "data-i18n": "Borders" });
  const legacyNode = new TranslationElement();
  mount(t, new Map([["lblCurrentTool", node], ["lblBordersPanel", legacyNode]]));
  updateUIText();
  assert.equal(node.textContent, "边界");
  assert.equal(node.textWrites, 1);
  assert.equal(legacyNode.textContent, "边界");
  updateUIText();
  assert.equal(node.textWrites, 1);
  assert.equal(legacyNode.textWrites, 1);
});

test("UI refresh preserves an armed confirmation label and restores the idle label after disarming", (t) => {
  const button = new TranslationElement({ "data-i18n": "Reset Country Colors" }, "Click again to confirm");
  button.dataset.confirmState = "armed";
  mount(t, new Map([["resetCountryColors", button]]));
  updateUIText();
  assert.equal(button.textContent, "Click again to confirm");
  assert.equal(button.textWrites, 0);
  delete button.dataset.confirmState;
  updateUIText();
  assert.equal(button.textContent, "重置国家颜色");
  assert.equal(button.textWrites, 1);
});

test("language toggle refreshes each directly scheduled UI hook once and retains dynamic state", async (t) => {
  const search = new TranslationElement();
  search.value = "typed search";
  const fileName = new TranslationElement({}, "my-map.json");
  fileName.dataset.projectFileState = "selected";
  mount(t, new Map([["countrySearch", search], ["projectFileName", fileName]]));
  const originalStorage = globalThis.localStorage;
  const originalScenario = state.activeScenarioId;
  const persisted = [];
  globalThis.localStorage = { setItem: (...args) => persisted.push(args) };
  state.activeScenarioId = "";
  const calls = new Map();
  const hookNames = [
    "updatePaintModeUIFn", "refreshSampleProjectBannerFn", "updateToolbarInputsFn", "updateDevWorkspaceUIFn",
    "renderPaletteFn", "renderCountryListFn", "renderPresetTreeFn", "updateParentBorderCountryListFn",
    "renderWaterRegionListFn", "renderSpecialRegionListFn", "refreshProjectAccountLanguageFn", "renderNowFn",
    "ensureFullLocalizationDataReadyFn",
  ];
  const originals = hookNames.map((name) => [name, readRegisteredRuntimeHookSource(state, name)]);
  hookNames.forEach((name) => registerRuntimeHook(state, name, () => calls.set(name, (calls.get(name) || 0) + 1)));
  t.after(() => {
    originals.forEach(([name, callback]) => registerRuntimeHook(state, name, callback));
    globalThis.localStorage = originalStorage;
    state.activeScenarioId = originalScenario;
  });
  updateUIText();
  for (const name of hookNames.slice(0, 4)) assert.equal(calls.get(name), 1, `${name} in updateUIText`);
  calls.clear();
  await toggleLanguage();
  for (const name of hookNames) assert.equal(calls.get(name), 1, `${name} in toggleLanguage`);
  assert.equal(state.currentLanguage, "en");
  assert.deepEqual(persisted, [["map_lang", "en"]]);
  assert.equal(search.value, "typed search");
  assert.equal(fileName.textContent, "my-map.json");
});

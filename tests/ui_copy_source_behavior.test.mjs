import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { applyBaseLocalizationSnapshot, setCurrentLanguage } from "../js/core/state/content_state.js";
import { t, clearMissingUiKeys, getMissingUiKeys } from "../js/core/i18n.js";
import { UI_COPY_CATALOG } from "../js/core/i18n_catalog.js";
import { installAppTestApi } from "../js/core/app_test_api.js";
import { updateUIText } from "../js/ui/i18n.js";
import { buildCatalog } from "../tools/build_ui_copy.mjs";

function restoreState(context) {
  const language = state.currentLanguage;
  const locales = state.locales;
  clearMissingUiKeys();
  context.after(() => {
    setCurrentLanguage(state, language);
    applyBaseLocalizationSnapshot(state, { uiLocales: locales.ui, geoLocales: locales.geo });
    clearMissingUiKeys();
  });
}

test("UI uses catalog display values in both languages regardless of runtime snapshots", (context) => {
  restoreState(context);
  applyBaseLocalizationSnapshot(state, {
    uiLocales: { "Paint mode color": { en: "Old color", zh: "旧颜色" } },
    geoLocales: { Place: { en: "Place", zh: "地点" } },
  });
  setCurrentLanguage(state, "zh");
  assert.equal(t("Paint mode color", "ui"), "着色");
  assert.equal(t("Transport guide", "ui"), "交通指南");
  assert.equal(t("Place"), "地点");
  setCurrentLanguage(state, "en");
  assert.equal(t("Paint mode color", "ui"), "Color");
  assert.equal(t("Place"), "Place");
  assert.equal(t("startup.readonly.pending", "ui"), "Map details are loading. You can pan and zoom.");
});

test("UI interpolation retains two-argument behavior and replaces all supplied placeholders", (context) => {
  restoreState(context);
  const key = "{count} preset lines; {present} already on map";
  setCurrentLanguage(state, "en");
  assert.equal(t(key, "ui"), key);
  assert.equal(t(key, "ui", { count: 3, present: 0 }), "3 preset lines; 0 already on map");
  setCurrentLanguage(state, "zh");
  assert.equal(t(key, "ui", { count: 3, present: 1 }), "3 条预置防线；1 条已在地图上");
});

test("plural entries select one and other and fall back to other", (context) => {
  restoreState(context);
  const entry = UI_COPY_CATALOG["Added {count} defense lines"];
  const original = entry.en;
  context.after(() => { entry.en = original; });
  entry.en = { one: "Added {count} defense line", other: "Added {count} defense lines" };
  setCurrentLanguage(state, "en");
  assert.equal(t("Added {count} defense lines", "ui", { count: 1 }), "Added 1 defense line");
  assert.equal(t("Added {count} defense lines", "ui", { count: 3 }), "Added 3 defense lines");
  assert.equal(t("Added {count} defense lines", "ui", { count: 0 }), "Added 0 defense lines");
  entry.en = { other: "Added {count} defense lines" };
  assert.equal(t("Added {count} defense lines", "ui", { count: 1 }), "Added 1 defense lines");
  setCurrentLanguage(state, "zh");
  assert.equal(t("Added {count} defense lines", "ui", { count: 3 }), "已添加 3 条防线");
});

test("missing UI keys are deduplicated by language and exposed as detached diagnostics", (context) => {
  restoreState(context);
  const target = {};
  installAppTestApi(target);
  const api = target.__scenarioForgeTestApi;
  setCurrentLanguage(state, "zh");
  assert.equal(t("missing.ui.fixture", "ui"), "missing.ui.fixture");
  t("missing.ui.fixture", "ui");
  setCurrentLanguage(state, "en");
  t("missing.ui.fixture", "ui");
  t("missing.geo.fixture", "geo");
  const expected = [{ key: "missing.ui.fixture", language: "zh" }, { key: "missing.ui.fixture", language: "en" }];
  assert.deepEqual(api.getMissingUiKeys(), expected);
  const snapshot = api.getMissingUiKeys();
  snapshot[0].key = "changed";
  snapshot.pop();
  assert.deepEqual(api.getMissingUiKeys(), expected);
  api.clearMissingUiKeys();
  assert.deepEqual(api.getMissingUiKeys(), []);
});

test("legacy UI mapping resolves every key from the catalog", (context) => {
  restoreState(context);
  const original = globalThis.document;
  context.after(() => { globalThis.document = original; });
  const nodes = new Map();
  globalThis.document = {
    documentElement: {},
    querySelectorAll: () => [],
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        textContent: "", dataset: {},
        getAttribute: () => null, setAttribute() {}, querySelector: () => null,
        classList: { contains: () => false },
      });
      return nodes.get(id);
    },
  };
  updateUIText();
  assert.deepEqual(getMissingUiKeys(), []);
});

test("catalog generation validates translations and preserves plural forms without translator notes", () => {
  const entry = { en: { one: "{count} item", other: "{count} items" }, zh: "{count} 项", note: "计数" };
  assert.deepEqual(buildCatalog({ Count: entry }), { Count: { zh: entry.zh, en: entry.en } });
  for (const invalid of [
    { en: "Text" }, { zh: "文字" }, { en: 1, zh: "文字" },
    { en: { one: "Text" }, zh: "文字" }, { en: { other: 1 }, zh: "文字" },
    { en: { other: "Text", invalid: "Text" }, zh: "文字" },
    { en: "{count} items", zh: "项目" },
    { en: { one: "item", other: "{count} items" }, zh: "{count} 项" },
  ]) assert.throws(() => buildCatalog({ Invalid: invalid }), /Invalid/);
});

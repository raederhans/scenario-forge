import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { FileManager } from "../js/core/file_manager.js";
import { importProjectTextThroughFunnel } from "../js/core/interaction_funnel.js";
import { undoHistory, redoHistory } from "../js/core/history_manager.js";
import { LegendManager } from "../js/core/legend_manager.js";
import { getTooltipCountryContext } from "../js/core/i18n.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";

test("the inspector commits one localized edit, refreshes names and restores them on clear and undo", () => {
  const code = "GER";
  const feature = { type: "Feature", id: "one", properties: { ISO_A3: code, cntr_code: code },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
  Object.assign(state, {
    currentLanguage: "en", mapSemanticMode: "political", historyPast: [],
    countryNameOverrides: { GER: { zh: "德意志" } },
    scenarioCountriesByTag: { GER: { display_name_en: "Germany" } },
    landData: { type: "FeatureCollection", features: [feature] }, sovereigntyByFeatureId: { one: code },
    sovereignBaseColors: { GER: "#334455" },
  });
  const input = Object.assign(new EventTarget(), { defaultValue: "Germany", dataset: { code, language: "en" } });
  input.blur = () => input.dispatchEvent(new Event("blur"));
  const controller = createCountryInspectorController({
    runtimeState: state, normalizeCountryCode: value => value,
    countryInspectorSelected: { querySelector: selector => selector === "#countryNameOverride" ? input : null },
    markDirty() {}, flushSidebarRender() {},
  });
  controller.bindEvents();
  function assertNames(expected) {
    const title = {};
    controller.syncCountryRowVisuals({ title }, { code, displayName: "Germany" });
    assert.equal(title.textContent, expected);
    assert.equal(getTooltipCountryContext(feature).countryDisplayName, expected);
    assert.equal(LegendManager.generate(state, { mode: "direct-area" }).entries[0].label, expected);
  }
  input.value = "  New Germany  ";
  input.dispatchEvent(Object.assign(new Event("keydown"), { key: "Enter" }));
  input.blur();
  assert.equal(state.historyPast.length, 1);
  assertNames("New Germany");
  input.value = "";
  input.blur();
  assertNames("Germany");
  assert.deepEqual(state.countryNameOverrides, { GER: { zh: "德意志" } });
  assert.ok(undoHistory());
  assertNames("New Germany");
  assert.ok(undoHistory());
  assertNames("Germany");
  assert.ok(redoHistory());
  assertNames("New Germany");
  state.currentLanguage = input.dataset.language = "zh";
  assertNames("德意志");
  input.value = "新版国名";
  input.blur();
  assertNames("新版国名");
  assert.equal(state.countryNameOverrides.GER.en, "New Germany");
});

test("project import restores both languages and clears overrides for older documents", async () => {
  const overrides = { GER: { en: "New Germany", zh: "新德国" } };
  const project = FileManager.buildProjectPayload({ styleConfig: {}, countryNameOverrides: overrides });
  for (const expected of [overrides, {}]) {
    if (!Object.keys(expected).length) delete project.countryNameOverrides;
    const result = await importProjectTextThroughFunnel(JSON.stringify(project), {
      ui: { t: key => key, showToast() {}, showAppDialog: async () => false },
      hooks: { refreshColorState() {} },
    });
    assert.match(result.status, /^committed/, result.error?.stack);
    await result.completion;
    assert.deepEqual(state.countryNameOverrides, expected);
    assert.deepEqual(FileManager.buildProjectPayload(state).countryNameOverrides, expected);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { undoHistory } from "../js/core/history_manager.js";
import { t } from "../js/core/i18n.js";
import { refreshColorState } from "../js/core/map_renderer/public.js";
import { registerRuntimeHook, state } from "../js/core/state.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

function scene(ctx) {
  const { add, doc } = harness(ctx);
  ctx.mock.method(globalThis, "requestAnimationFrame", () => 1);
  const countries = { GER: { code: "GER" }, CH: { code: "CH", releasable: true, parent_owner_tag: "GER" } };
  Object.assign(state, {
    activeScenarioId: "sample", currentLanguage: "en", selectedInspectorCountryCode: "GER",
    scenarioCountriesByTag: countries, politicalOverrides: {}, politicalAlliances: {},
    scenarioBundleCacheById: { sample: { countriesPayload: {
      countries: { GER: { alliance: "axis", ruling_ideology: "fascism" }, GB: { ruling_ideology: "democratic" } },
      alliances: { axis: { name_en: "Axis" }, allies: { name_en: "Allies" } },
    } } },
    politicalDisplayMode: "country", historyPast: [], historyFuture: [],
  });
  const card = add();
  card.insertBefore = node => card.prepend(node);
  const fields = add("div", card, "countryPoliticalFields");
  const alliance = add("select", fields, "countryAlliance");
  add("select", fields, "countryIdeology");
  add("button", fields, "deleteCountryAlliance");
  const draft = add("div", fields, "newAllianceFields");
  add("input", draft, "newAllianceName");
  add("input", draft, "newAllianceColor");
  add("span", draft, "allianceColorConflict");
  add("button", draft, "createCountryAlliance");
  globalThis.Option = function (textContent, value) {
    return Object.assign(doc.createElement("option"), { textContent, value });
  };
  ctx.after(() => { delete globalThis.Option; });
  const controller = createCountryInspectorController({
    runtimeState: state, countryInspectorSelected: card, t, normalizeCountryCode: code => code,
    getLatestCountryStatesByCode: () => new Map(Object.entries(countries)),
    updateScenarioInspectorLayout() {}, scheduleAdaptiveInspectorHeights() {}, setCountryInspectorColorPickerOpen() {},
  });
  controller.bindEvents();
  const render = controller.renderCountryInspectorDetail;
  return { alliance, render };
}

function change(select, value) {
  select.value = value;
  select.fire("change");
}

test("HOI4 1939 德国改投同盟后地块颜色改变，撤销可复原", ctx => {
  const { alliance, render } = scene(ctx);
  const payload = JSON.parse(readFileSync(new URL("../data/scenarios/hoi4_1939/countries.json", import.meta.url)));
  const owners = { berlin: "GER", rome: "ITA", london: "ENG" };
  Object.assign(state, {
    activeScenarioId: "hoi4_1939", scenarioBundleCacheById: { hoi4_1939: { countriesPayload: payload } },
    politicalDisplayMode: "alliance", scenarioBaselineOwnersByFeatureId: owners,
    landDataFull: null, landData: { features: Object.keys(owners).map(id => ({ id })) },
    visualOverrides: {}, sovereignBaseColors: { GER: "#aaaaaa", ITA: "#bbbbbb", ENG: "#cccccc" },
  });
  registerRuntimeHook(state, "refreshColorStateFn", refreshColorState);
  refreshColorState({ renderNow: true });
  render();
  assert.equal(state.colors.berlin, "#2f2f2f");
  change(alliance, "allies");
  assert.equal(state.colors.berlin, "#1f4e9c");
  undoHistory();
  render();
  assert.equal(state.colors.berlin, "#2f2f2f");
});

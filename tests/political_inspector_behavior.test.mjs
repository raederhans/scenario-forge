import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { undoHistory } from "../js/core/history_manager.js";
import { t } from "../js/core/i18n.js";
import { refreshColorState } from "../js/core/map_renderer/public.js";
import { getPoliticalDisplayLegend } from "../js/core/political_display_mode.js";
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
  const refresh = ctx.mock.fn();
  registerRuntimeHook(state, "refreshColorStateFn", refresh);
  const card = add();
  card.insertBefore = node => card.prepend(node);
  const fields = add("div", card, "countryPoliticalFields");
  const alliance = add("select", fields, "countryAlliance");
  const ideology = add("select", fields, "countryIdeology");
  const del = add("button", fields, "deleteCountryAlliance");
  const draft = add("div", fields, "newAllianceFields");
  const name = add("input", draft, "newAllianceName");
  const color = add("input", draft, "newAllianceColor");
  color.defaultValue = "#008080";
  const conflict = add("span", draft, "allianceColorConflict");
  const create = add("button", draft, "createCountryAlliance");
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
  render();
  return { fields, alliance, ideology, del, draft, name, color, conflict, create, refresh, render };
}

function change(select, value) {
  select.value = value;
  select.fire("change");
}

test("HOI4 1939 德国改投同盟后地块和图例同步更新，撤销可复原", ctx => {
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
  const labels = () => getPoliticalDisplayLegend(state).entries.map(entry => entry.label);
  const before = labels();
  assert.equal(state.colors.berlin, "#2f2f2f");
  change(alliance, "allies");
  assert.equal(state.colors.berlin, "#1f4e9c");
  assert.ok(labels().includes(`${payload.alliances.allies.name_en} (2 countries)`));
  assert.ok(labels().includes(`${payload.alliances.axis.name_en} (1 countries)`));
  undoHistory();
  render();
  assert.equal(alliance.value, "");
  assert.equal(state.colors.berlin, "#2f2f2f");
  assert.deepEqual(labels(), before);
});

test("阵营与政体可单独覆盖和恢复，默认项反映剧本或母国来源", ctx => {
  const { fields, alliance, ideology, del, render, refresh } = scene(ctx);
  assert.equal(fields.hidden, false);
  assert.equal(alliance.children[0].textContent, "Scenario default (Axis)");
  change(alliance, "allies");
  assert.equal(del.hidden, true);
  change(ideology, "democratic");
  assert.deepEqual(state.politicalOverrides.GER, { alliance: "allies", ideology: "democratic" });
  assert.equal(refresh.mock.callCount(), 0);
  change(alliance, ":unaligned");
  assert.equal(state.politicalOverrides.GER.alliance, null);
  change(alliance, "");
  assert.deepEqual(state.politicalOverrides.GER, { ideology: "democratic" });
  state.selectedInspectorCountryCode = "CH";
  render();
  assert.equal(alliance.children[0].textContent, "Scenario default (Unaligned)");
  change(ideology, "fascism");
  assert.equal(ideology.children[0].textContent, "Inherited from parent (Democratic)");
  change(ideology, "");
  assert.equal(state.politicalOverrides.CH, undefined);
  undoHistory();
  render();
  assert.equal(ideology.value, "fascism");
  state.activeScenarioId = "";
  render();
  assert.equal(fields.hidden, true);
});

test("行内新建阵营检查撞色、分配成员并支持删除，草稿随检查对象切换关闭", ctx => {
  const { alliance, del, draft, name, color, conflict, create, render } = scene(ctx);
  change(alliance, ":new");
  assert.equal(draft.hidden, false);
  assert.equal(create.disabled, true);
  name.value = "<League>";
  name.fire("input");
  color.value = "#1f4e9c";
  color.fire("input");
  assert.equal(conflict.hidden, false);
  assert.equal(create.disabled, true);
  color.value = "#008080";
  color.fire("input");
  assert.equal(create.disabled, false);
  create.click();
  assert.equal(draft.hidden, true);
  assert.equal(alliance.value, "custom_1");
  assert.equal(alliance.children.find(option => option.value === "custom_1").textContent, "<League>");
  assert.equal(del.hidden, false);
  change(alliance, ":new");
  state.selectedInspectorCountryCode = "CH";
  render();
  assert.equal(draft.hidden, true);
  change(alliance, "custom_1");
  del.click();
  assert.deepEqual(state.politicalAlliances, {});
  assert.deepEqual(state.politicalOverrides, { GER: { alliance: null }, CH: { alliance: null } });
  assert.equal(alliance.value, ":unaligned");
  assert.equal(del.hidden, true);
});

test("空白剧本显示四种政体及当前覆盖，自定义阵营达上限时关闭创建入口", ctx => {
  const { alliance, ideology, render } = scene(ctx);
  state.activeScenarioId = "blank_base";
  state.scenarioBundleCacheById.blank_base = { countriesPayload: { countries: {} } };
  state.politicalOverrides = { GER: { ideology: "socialist" } };
  state.politicalAlliances = Object.fromEntries(Array.from({ length: 16 }, (_, i) =>
    [`custom_${i + 1}`, { name: String(i), color: `#1234${String(i).padStart(2, "0")}` }]));
  render();
  assert.deepEqual(ideology.children.map(option => option.value), ["", "democratic", "fascism", "communism", "neutrality", "socialist"]);
  assert.equal(ideology.value, "socialist");
  assert.equal(alliance.children.at(-1).disabled, true);
});

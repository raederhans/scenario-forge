import assert from "node:assert/strict";
import test from "node:test";
import { t } from "../js/core/i18n.js";
import { state } from "../js/core/state.js";
import { off, on } from "../js/core/state/bus.js";
import { flushPanelRefreshNow } from "../js/core/state/changes.js";
import { callRuntimeHook, STATE_BUS_EVENTS } from "../js/core/state/index.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { createCountryInspectorModel } from "../js/ui/sidebar/country_inspector_model.js";
import { createStrategicOverlayController } from "../js/ui/sidebar/strategic_overlay_controller.js";
import { openLegendColorEditor } from "../js/ui/toolbar/palette_country_editor.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";
import { d3, makeFixture } from "./helpers/river_paint_fixture.mjs";

const color = "#abcdef";

async function scene(ctx) {
  const dom = harness(ctx);
  const { state: map, cells } = await makeFixture();
  const fields = {
    ...map, currentLanguage: "zh", scenarioCountriesByTag: { FR: { code: "FR", display_name_zh: "法国" } },
    scenarioBaselineOwnersByFeatureId: { N: "FR", P: "FR" }, selectedInspectorCountryCode: "",
    countryGroupsData: { continents: [{ id: "continent_europe", label: "Europe" }] },
    countryPalette: {}, countryNameOverrides: {}, expandedInspectorContinents: new Set(),
    legendLabels: { [color]: "边区" }, visualOverrides: { N: color }, historyPast: [], historyFuture: [],
  };
  fields.riverPaint.overrides[cells[0].id] = color;
  const previous = Object.fromEntries(Object.keys(fields).map(key => [key, state[key]]));
  Object.assign(state, fields);
  ctx.after(() => Object.assign(state, previous));
  ctx.mock.method(globalThis, "requestAnimationFrame", () => 1);
  const create = dom.doc.createElement;
  dom.doc.createElement = tag => {
    const element = create(tag);
    if (tag === "dialog") {
      element.showModal = () => { element.open = true; };
      element.close = () => element.fire("close");
    }
    return element;
  };
  dom.doc.createDocumentFragment = () => create("fragment");
  return { ...dom, cell: cells[0].id };
}

test("图例以图例标签预填名称，登记后选中新国家，底图模式隐藏登记入口", async ctx => {
  const { doc } = await scene(ctx);
  const open = () => {
    openLegendColorEditor(doc, state, { color }, () => {});
    return doc.body.querySelector("dialog");
  };
  const dialog = open();
  assert.equal(dialog.querySelector("select").children[1].textContent, "法国（FR）");
  const name = dialog.querySelectorAll("input").find(input => input.type === "text");
  assert.equal(name.value, "边区");
  name.value = "海岸共和国";
  dialog.querySelectorAll("button").find(button => button.textContent === "登记为新国家").click();
  assert.equal(state.selectedInspectorCountryCode, "P01");
  assert.equal(state.scenarioCountriesByTag.P01.display_name, "海岸共和国");
  assert.equal(doc.body.querySelector("dialog"), null);
  state.activeScenarioId = "";
  assert.ok(!open().querySelectorAll("button").some(button => button.textContent === "登记为新国家"));
});

test("快捷卡登记后显示项目分组，检查器改名、改色并取消登记", async ctx => {
  const { add, cell } = await scene(ctx);
  const host = add();
  const list = add("div", host);
  const card = add();
  for (const element of [host, card]) element.insertBefore = node => element.prepend(node);
  const name = add("input", card, "countryNameOverride");
  const status = add("span", card, "countryLabelStatus");
  add("div", card, "countryTerritoryStats");
  const previousD3 = globalThis.d3;
  globalThis.d3 = d3;
  ctx.after(() => { globalThis.d3 = previousD3; });
  const unregister = add("button", card, "unregisterProjectCountry");
  const row = add("div", card);
  const input = add("input", row);
  input.style.removeProperty = key => delete input.style[key];
  input.blur = () => input.fire("blur");
  let latest = new Map();
  const identity = () => callRuntimeHook(state, "resolveBorderIdentityFn", "N", state.landIndex.get("N"));
  const controller = createCountryInspectorController({
    runtimeState: state, list, countryInspectorSelected: card, countryInspectorColorRow: row,
    countryInspectorColorInput: input, countryRowRefsByCode: new Map(), t,
    normalizeCountryCode: code => code, normalizeHexColor: value => value,
    getSelectedLandColorIdentity: () => identity().startsWith("color:") ? identity() : "",
    getDynamicCountryEntries: () => Object.values(state.scenarioCountriesByTag),
    createCountryInspectorState: createCountryInspectorModel(state, t).createCountryInspectorState,
    getLatestCountryStatesByCode: () => latest, setLatestCountryStatesByCode: value => { latest = value; },
    getCountryChildSectionsForParent: () => [], getResolvedCountryColor: entry => state.sovereignBaseColors[entry.code],
    getDisplayCountryColor: entry => state.sovereignBaseColors[entry.code],
    getCountryLabelStatus: () => "Does not fit or is obscured in this view",
    updateScenarioInspectorLayout() {}, scheduleAdaptiveInspectorHeights() {}, setCountryInspectorColorPickerOpen() {},
  });
  controller.bindEvents();
  const { REFRESH_COUNTRY_INSPECTOR_DETAIL, RENDER_COUNTRY_LIST } = STATE_BUS_EVENTS;
  on(REFRESH_COUNTRY_INSPECTOR_DETAIL, controller.renderCountryInspectorDetail);
  on(RENDER_COUNTRY_LIST, controller.renderList);
  ctx.after(() => {
    off(REFRESH_COUNTRY_INSPECTOR_DETAIL, controller.renderCountryInspectorDetail);
    off(RENDER_COUNTRY_LIST, controller.renderList);
  });
  controller.renderList();
  const quick = host.querySelector("[data-selected-land-country-quick-tab]").querySelector("button");
  assert.equal(quick.textContent, "未登记颜色 #abcdef · 登记为新国家");
  quick.click();
  flushPanelRefreshNow();
  assert.equal(identity(), "P01");
  const group = list.querySelector('[data-inspector-group-key="group::project_countries"]');
  assert.equal(group.querySelector(".country-row-title").textContent, "项目新国家 (1)");
  assert.ok(group.parentElement.querySelector('[data-country-code="P01"]').classList.contains("is-selected"));
  assert.equal(unregister.hidden, false);
  assert.equal(status.textContent, "国名尚未显示，可使用手动地图文字。");
  assert.equal(name.value, "边区");
  name.value = "新边区";
  name.fire("blur");
  assert.equal(state.legendLabels[color], "新边区");
  assert.equal(state.countryNameOverrides.P01.zh, "新边区");
  assert.equal(row.classList.contains("hidden"), false);
  assert.equal(input.disabled, false);
  assert.equal(input.value, color);
  input.value = state.sovereignBaseColors.FR;
  input.fire("change");
  assert.equal(input.value, color);
  input.value = "#998877";
  input.fire("change");
  assert.equal(state.sovereignBaseColors.P01, "#998877");
  assert.equal(state.visualOverrides.N, "#998877");
  assert.equal(state.riverPaint.overrides[cell], "#998877");
  assert.equal(state.historyPast.at(-1).kind, "recolor-project-country");
  state.visualOverrides = {};
  state.riverPaint = { ...state.riverPaint, overrides: {} };
  controller.renderCountryInspectorDetail();
  assert.equal(status.textContent, "无参考领土。");
  unregister.click();
  flushPanelRefreshNow();
  assert.equal(state.selectedInspectorCountryCode, "");
  assert.equal(unregister.hidden, true);
  assert.equal(list.querySelector('[data-country-code="P01"]'), null);
});

test("地图文字绑定显示剧本国家与项目国家的名称和代码", async ctx => {
  const { doc, add } = await scene(ctx);
  openLegendColorEditor(doc, state, { color }, () => {});
  doc.body.querySelectorAll("button").find(button => button.textContent === "登记为新国家").click();
  const section = add();
  add("div", section, "mapLabelFields");
  add("div", section, "mapLabelPlacementHint");
  add("button", section, "toolMapTextBtn");
  const select = id => {
    const field = new HTMLSelectElement("select", doc);
    field.id = id;
    section.appendChild(field);
    return field;
  };
  select("mapLabelList");
  const countries = select("mapLabelCountry");
  const source = { ...state, mapLabels: [{ id: "note", countryCode: "P01" }], mapLabelEditor: { selectedId: "note", active: false } };
  const controller = createStrategicOverlayController({
    state: source, elements: { mapLabelSection: section, strategicCommandButtons: [] },
    helpers: { t, normalizeAnnotationView: () => ({}) },
  });
  controller.refreshUI({ scopes: ["operationalLines"] });
  assert.equal(countries.value, "P01");
  assert.deepEqual(countries.children.slice(1).map(option => [option.value, option.textContent]),
    [["FR", "法国（FR）"], ["P01", "边区（P01）"]]);
});

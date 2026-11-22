import assert from "node:assert/strict";
import test from "node:test";
import { t } from "../js/core/i18n.js";
import { completeMapPointPick } from "../js/core/map_point_picker.js";
import { registerRuntimeHook, state } from "../js/core/state.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

function scene(ctx, tag) {
  const { add, doc } = harness(ctx);
  ctx.mock.method(globalThis, "requestAnimationFrame", () => 1);
  const city = (id, name, host, population) => ({
    type: "Feature", id, geometry: { type: "Point", coordinates: [1, 2] },
    properties: { name, __city_host_feature_id: host, __city_population: population },
  });
  const owners = { port: "P01", east: "AA", west: "AA" };
  const countries = { AA: { code: "AA" }, P01: { code: "P01", project_country: true } };
  Object.assign(state, {
    landIndex: new Map(Object.keys(owners).map(id => [id, { id }])),
    activeScenarioId: "sample", currentLanguage: "zh", selectedInspectorCountryCode: tag,
    scenarioCountriesByTag: countries, sovereigntyByFeatureId: { port: "AA", east: "AA", west: "AA" },
    scenarioCityOverridesData: { capitals_by_tag: { AA: "old" } },
    worldCitiesData: { features: [
      city("old", "旧港", "port", 90), city("town", "东城", "east", 10), city("metro", "西城", "west", 50),
    ] },
    projectCities: [], capitalOverrides: {}, cityNameOverrides: {}, historyPast: [], historyFuture: [],
  });
  registerRuntimeHook(state, "resolveBorderIdentityFn", id => owners[id]);
  const card = add();
  card.insertBefore = node => card.prepend(node);
  const details = add("details", card, "countryCities");
  details.open = details.hidden = true;
  for (const id of ["inspectorCapital", "capitalActions", "capitalStatus", "capitalOutside", "capitalPickHint"]) add("div", details, id);
  for (const id of ["setCapital", "resetCapital", "clearCapital", "largestCapital", "deleteCapitalCity", "placeCapital"]) add("button", details, id);
  for (const id of ["capitalCityName", "cityNameOverride", "inspectorCityHidden"]) add("input", details, id).value = "";
  const picker = add("select", details, "inspectorCity");
  Object.defineProperty(picker, "selectedOptions", { get: () => picker.children.filter(option => option.value === picker.value) });
  const replace = picker.replaceChildren.bind(picker);
  picker.replaceChildren = (...options) => {
    replace(...options);
    picker.value = options[0]?.value || "";
  };
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
  controller.renderCountryInspectorDetail();
  return { el: id => doc.getElementById(id), details, picker, owners, controller };
}

test("项目国家可从实际领土选首都；失去领土后保留首都名并提示隐藏星标", ctx => {
  const { details, el, picker, owners, controller } = scene(ctx, "P01");
  assert.equal(details.hidden, false);
  assert.deepEqual(picker.children.map(option => option.value), ["old"]);
  assert.equal(el("resetCapital").hidden, true);
  assert.equal(el("capitalStatus").textContent, "未设定");
  el("setCapital").click();
  assert.equal(el("capitalStatus").textContent, "旧港 · 项目设定");
  assert.equal(picker.children[0].textContent, "★ 旧港");
  owners.port = "AA";
  controller.renderCountryInspectorDetail();
  assert.equal(el("largestCapital").disabled, true);
  assert.equal(el("capitalOutside").hidden, false);
  assert.equal(el("capitalStatus").textContent, "旧港 · 项目设定");
});

test("境外旧首都、改设、恢复、无首都和最大城市均反映在首都行", ctx => {
  const { el, picker, controller } = scene(ctx, "AA");
  assert.equal(el("capitalStatus").textContent, "旧港 · 剧本默认");
  assert.equal(picker.selectedOptions[0].textContent, "★ 旧港（境外）");
  assert.equal(el("capitalOutside").hidden, false);
  assert.equal(el("setCapital").disabled, true);
  assert.equal(el("setCapital").title, "请选择本国境内的城市");
  assert.equal(el("resetCapital").disabled, true);
  picker.value = "town";
  picker.fire("change");
  assert.equal(el("setCapital").disabled, false);
  el("setCapital").click();
  assert.equal(el("capitalStatus").textContent, "东城 · 项目设定");
  assert.equal(el("capitalOutside").hidden, true);
  assert.equal(el("resetCapital").disabled, false);
  el("resetCapital").click();
  assert.equal(el("capitalStatus").textContent, "旧港 · 剧本默认");
  el("clearCapital").click();
  assert.deepEqual(state.capitalOverrides.AA, { cityId: null });
  assert.equal(el("capitalStatus").textContent, "已设为无首都");
  el("largestCapital").click();
  assert.equal(state.capitalOverrides.AA.cityId, "metro");
  assert.equal(el("capitalStatus").textContent, "西城 · 项目设定");
  state.currentLanguage = "en";
  controller.renderCountryInspectorDetail();
  assert.equal(el("capitalStatus").textContent, "西城 · Project setting");
  assert.equal(picker.children[0].textContent, "旧港 (outside territory)");
});

test("地图取点可取消，完成后显示并可删除新首都", async ctx => {
  const { el } = scene(ctx, "P01");
  const place = el("placeCapital");
  assert.equal(place.disabled, true);
  el("capitalCityName").value = "新港";
  el("capitalCityName").fire("input");
  assert.equal(place.disabled, false);
  place.click();
  assert.deepEqual(state.mapPointPicker, { active: true, purpose: "capital" });
  assert.equal(el("capitalPickHint").hidden, false);
  assert.equal(place.textContent, "取消");
  place.click();
  await Promise.resolve();
  assert.equal(el("capitalPickHint").hidden, true);
  assert.equal(state.mapPointPicker.active, false);
  assert.equal(state.historyPast.length, 0);
  assert.deepEqual(state.projectCities, []);
  place.click();
  completeMapPointPick({ lon: 1, lat: 2, hostFeatureId: "port" });
  await Promise.resolve();
  assert.deepEqual(state.projectCities[0], {
    id: "project_city_1", lon: 1, lat: 2, hostFeatureId: "port", tier: "minor", name: { en: "新港", zh: "新港" },
  });
  assert.equal(el("capitalStatus").textContent, "新港 · 项目设定");
  assert.equal(el("capitalPickHint").hidden, true);
  assert.equal(el("deleteCapitalCity").hidden, false);
  el("deleteCapitalCity").click();
  assert.deepEqual(state.projectCities, []);
  assert.equal(el("capitalStatus").textContent, "未设定");
  assert.equal(el("deleteCapitalCity").hidden, true);
});

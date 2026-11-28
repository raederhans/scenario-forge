import assert from "node:assert/strict";
import test from "node:test";
import { t } from "../js/core/i18n.js";
import { cancelMapPointPick, completeMapPointPick } from "../js/core/map_point_picker.js";
import { registerRuntimeHook, state } from "../js/core/state.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

function scene(ctx) {
  const { add, doc } = harness(ctx);
  ctx.mock.method(globalThis, "requestAnimationFrame", () => 1);
  ctx.mock.method(globalThis, "setTimeout", () => 1);
  const countries = { P01: { code: "P01", project_country: true }, AA: { code: "AA" } };
  const owners = { port: "P01", east: "AA" };
  Object.assign(state, {
    activeScenarioId: "sample", currentLanguage: "zh", selectedInspectorCountryCode: "P01",
    scenarioCountriesByTag: countries, sovereignBaseColors: { P01: "#123456", AA: "#abcdef" },
    sovereigntyByFeatureId: owners, landIndex: new Map(Object.keys(owners).map(id => [id, { id }])),
    worldCitiesData: { features: [{ type: "Feature", id: "town", geometry: { type: "Point", coordinates: [1, 2] },
      properties: { name: "港城", __city_host_feature_id: "port" } }] },
    projectCities: [], capitalOverrides: {}, cityNameOverrides: {}, historyPast: [], historyFuture: [],
  });
  registerRuntimeHook(state, "resolveBorderIdentityFn", id => owners[id]);
  ctx.after(cancelMapPointPick);
  const card = add();
  card.insertBefore = node => card.prepend(node);
  const cities = add("details", card, "countryCities");
  cities.open = true;
  for (const id of ["capitalStatus", "capitalOutside", "capitalPickHint", "inspectorCapital", "capitalActions"]) add("div", cities, id);
  for (const id of ["setCapital", "resetCapital", "clearCapital", "largestCapital", "deleteCapitalCity", "placeCapital"]) add("button", cities, id);
  for (const id of ["capitalCityName", "cityNameOverride", "inspectorCityHidden"]) add("input", cities, id).value = "";
  const picker = add("select", cities, "inspectorCity");
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
    runtimeState: state, countryInspectorSelected: card,
    t, normalizeCountryCode: code => code, normalizeHexColor: color => color,
    getDisplayCountryColor: country => state.sovereignBaseColors[country.code],
    getLatestCountryStatesByCode: () => new Map(Object.entries(countries)),
    updateScenarioInspectorLayout() {}, scheduleAdaptiveInspectorHeights() {}, setCountryInspectorColorPickerOpen() {},
  });
  controller.bindEvents();
  controller.renderCountryInspectorDetail();
  const el = id => doc.getElementById(id);
  function startPick(cityName) {
    el("capitalCityName").value = cityName;
    el("capitalCityName").fire("input");
    el("placeCapital").click();
  }
  return { el, picker, startPick, controller };
}

test("删除只作用于下拉选中的项目城市，包括已经卸任的首都", async ctx => {
  const { el, picker, startPick } = scene(ctx);
  for (const name of ["第一港", "第二港"]) {
    startPick(name);
    completeMapPointPick({ lon: 1, lat: 2, hostFeatureId: "port" });
    await Promise.resolve();
  }
  const [former, capital] = state.projectCities;
  const button = el("deleteCapitalCity");
  picker.value = "town";
  picker.fire("change");
  el("setCapital").click();
  picker.value = former.id;
  picker.fire("change");
  button.click();
  assert.deepEqual(state.projectCities, [capital]);
  assert.equal(state.capitalOverrides.P01.cityId, "town");
});

test("取点时切换检查器国家会取消待处理的地图点击", async ctx => {
  const { startPick, controller } = scene(ctx);
  startPick("新港");
  state.selectedInspectorCountryCode = "AA";
  controller.renderCountryInspectorDetail();
  assert.equal(completeMapPointPick({ lon: 1, lat: 2, hostFeatureId: "port" }), false);
  await Promise.resolve();
  assert.deepEqual(state.projectCities, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { t } from "../js/core/i18n.js";
import { cancelMapPointPick, completeMapPointPick } from "../js/core/map_point_picker.js";
import { registerRuntimeHook, state } from "../js/core/state.js";
import { initToast } from "../js/ui/components/toast.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { openLegendColorEditor } from "../js/ui/toolbar/palette_country_editor.js";
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
  add("div", doc.body, "toastViewport");
  initToast();
  const card = add();
  card.insertBefore = node => card.prepend(node);
  const name = add("input", card, "countryNameOverride");
  const color = add("input", card);
  color.style.removeProperty = () => {};
  color.blur = () => color.fire("blur");
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
    runtimeState: state, countryInspectorSelected: card, countryInspectorColorInput: color,
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
  function switchCountry() {
    state.selectedInspectorCountryCode = "AA";
    controller.renderCountryInspectorDetail();
  }
  function openLegend(owner) {
    const create = doc.createElement.bind(doc);
    ctx.mock.method(doc, "createElement", tag => {
      const node = create(tag);
      if (tag === "dialog") Object.assign(node, { showModal() {}, close() { node.fire("close"); } });
      return node;
    });
    openLegendColorEditor(doc, state, { owner, color: "#123456" }, () => {});
    return doc.querySelector("dialog");
  }
  return { el, name, color, picker, startPick, switchCountry, openLegend };
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
  assert.equal(button.hidden, true);
  el("setCapital").click();
  picker.value = former.id;
  picker.fire("change");
  assert.equal(button.hidden, false);
  button.click();
  assert.deepEqual(state.projectCities, [capital]);
  assert.equal(state.capitalOverrides.P01.cityId, "town");
});

test("取点时切换检查器国家会取消待处理的地图点击", async ctx => {
  const { el, startPick, switchCountry } = scene(ctx);
  startPick("新港");
  assert.equal(el("capitalPickHint").hidden, false);
  switchCountry();
  assert.equal(el("capitalPickHint").hidden, true);
  assert.equal(completeMapPointPick({ lon: 1, lat: 2, hostFeatureId: "port" }), false);
  await Promise.resolve();
  assert.deepEqual(state.projectCities, []);
});

for (const entry of ["图例", "检查器"]) {
  test(entry + "改为其他国家底色时显示合并提示", ctx => {
    const { el, color, openLegend } = scene(ctx);
    if (entry === "检查器") {
      color.value = "#abcdef";
      color.fire("change");
    } else {
      const dialog = openLegend("P01");
      dialog.querySelector("input").value = "#abcdef";
      dialog.querySelector("button").click();
    }
    assert.equal(el("toastViewport").querySelector(".toast-warning")?.querySelector(".toast-message").textContent,
      "该颜色已属于其他国家，可用“合并到国家”");
    assert.equal(state.sovereignBaseColors.P01, "#123456");
  });
}

test("登记国名、项目国名和新首都名最多输入 120 字", ctx => {
  const { el, name, openLegend, switchCountry } = scene(ctx);
  assert.equal(openLegend("").querySelector(".input").maxLength, 120);
  assert.equal(name.getAttribute("maxlength"), "120");
  assert.equal(el("capitalCityName").maxLength, 120);
  switchCountry();
  assert.equal(name.hasAttribute("maxlength"), false);
});

for (const [location, hostFeatureId] of [["他国", "east"], ["海上", ""]]) {
  test("首都放在" + location + "时提示原因并保留原状态", async ctx => {
    const { el, startPick } = scene(ctx);
    startPick("新港");
    completeMapPointPick({ lon: 3, lat: 4, hostFeatureId });
    await Promise.resolve();
    assert.equal(el("toastViewport").querySelector(".toast-warning")?.querySelector(".toast-message").textContent,
      "首都只能放在本国实际版图内");
    assert.deepEqual(state.projectCities, []);
    assert.deepEqual(state.capitalOverrides, {});
  });
}

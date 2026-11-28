import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { getCountryLocateIds } from "../js/core/country_override_reset_command.js";
import { buildTooltipModel, getOwnershipDisplayName, t } from "../js/core/i18n.js";
import { selectLandFeatureById } from "../js/core/map_renderer/public.js";
import { createCountryLabelSourceOwner } from "../js/core/renderer/country_label_source.js";
import { createCountryLabelCoverageOwner } from "../js/core/renderer/country_label_coverage.js";
import { state } from "../js/core/state.js";
import { callRuntimeHook, readRegisteredRuntimeHookSource, registerRuntimeHook } from "../js/core/state/index.js";
import { emit } from "../js/core/state/bus.js";
import { createCountryInspectorController } from "../js/ui/sidebar/country_inspector_controller.js";
import { createRegionSearchController } from "../js/ui/sidebar/region_search_controller.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");
const topojson = require("../vendor/topojson-client.min.js");
const owner = (id, feature) => callRuntimeHook(state, "resolveBorderIdentityFn", id, feature);

function scene(ctx) {
  const dom = harness(ctx);
  ctx.mock.method(globalThis, "requestAnimationFrame", () => 1);
  const features = ["east", "west", "remote"].map((id, i) => ({
    type: "Feature", id, properties: { name: "Borderland" },
    geometry: { type: "Polygon", coordinates: [[[i, 0], [i, 1], [i + 1, 1], [i + 1, 0], [i, 0]]] },
  }));
  const entry = { tag: "REL", preset_source: { type: "feature_selection", feature_ids: ["east", "west"] } };
  const fields = {
    currentLanguage: "zh", activeScenarioId: "test", mapSemanticMode: "political",
    countryNames: { GER: "德国", FRA: "法国", REL: "释放国" },
    scenarioCountriesByTag: { GER: {}, FRA: {}, REL: { releasable: true } },
    scenarioReleasableIndex: { byTag: { REL: entry } },
    scenarioBaselineOwnersByFeatureId: { east: "GER", west: "GER", remote: "FRA" },
    sovereignBaseColors: { GER: "#111111", FRA: "#222222", REL: "#333333" },
    visualOverrides: { east: "#222222" }, legendLabels: {}, colorRevision: 1,
    selectedInspectorCountryCode: "", landData: { features }, landIndex: new Map(features.map(f => [f.id, f])),
    activeScenarioManifest: { detail_chunk_manifest_url: "chunks" },
    scenarioBundleCacheById: { test: { chunkRegistry: { byLayer: { political: [
      { id: "world", globalCoverage: true, lod: "coarse" },
    ] } }, chunkPayloadCacheById: { world: { payload: { features } } } } },
  };
  const saved = Object.fromEntries(Object.keys(fields).map(key => [key, state[key]]));
  Object.assign(state, fields);
  const originalD3 = globalThis.d3;
  globalThis.d3 = d3;
  ctx.after(() => { Object.assign(state, saved); globalThis.d3 = originalD3; });
  return { ...dom, features };
}

test("hover and map selection follow the painted country and distinguish named and unregistered colors", ctx => {
  const { features: [east] } = scene(ctx);
  assert.equal(buildTooltipModel(east).lines.at(-1), "法国（原属德国）");
  assert.equal(selectLandFeatureById("east"), true);
  assert.equal(state.selectedInspectorCountryCode, "FRA");
  state.visualOverrides.east = "#abcdef";
  assert.equal(buildTooltipModel(east).lines.at(-1), "未登记颜色 #abcdef（原属德国）");
  selectLandFeatureById("east");
  assert.equal(state.selectedInspectorCountryCode, "");
  state.legendLabels["#abcdef"] = "边区";
  assert.equal(buildTooltipModel(east).lines.at(-1), "边区（原属德国）");
});

test("inspector reports loaded area and transfers, distinguishes unreleased names and converts the selected label", ctx => {
  const { add, features } = scene(ctx);
  const card = add();
  card.insertBefore = node => card.prepend(node);
  const stats = add("div", card, "countryTerritoryStats");
  const status = add("span", card, "countryLabelStatus");
  const button = add("button", card, "convertCountryLabel");
  button.hidden = true;
  let converted;
  const controller = createCountryInspectorController({
    runtimeState: state, countryInspectorSelected: card, t, normalizeCountryCode: code => code,
    getLatestCountryStatesByCode: () => new Map(["FRA", "GER", "REL"].map(code => [code, { code }])),
    getCountryLabelStatus: () => "Does not fit or is obscured in this view",
    convertCountryLabelToMapLabel: code => { converted = code; },
    updateScenarioInspectorLayout() {}, scheduleAdaptiveInspectorHeights() {}, setCountryInspectorColorPickerOpen() {},
  });
  controller.bindEvents();
  state.selectedInspectorCountryCode = "FRA";
  controller.renderCountryInspectorDetail();
  const area = Math.round((d3.geoArea(features[0]) + d3.geoArea(features[2])) * 6371 ** 2).toLocaleString("zh");
  assert.equal(stats.textContent, `实际 2 块 · 约 ${area} km² · 获得 1 块 / 失去 0 块 · 已加载范围 · 来源：德国 × 1`);
  state.selectedInspectorCountryCode = "GER";
  controller.renderCountryInspectorDetail();
  assert.match(stats.textContent, /失去 1 块.*去向：法国 × 1/);
  button.click();
  assert.equal(button.hidden, false);
  assert.equal(converted, "GER");
  state.selectedInspectorCountryCode = "REL";
  controller.renderCountryInspectorDetail();
  assert.equal(status.textContent, "无参考版图，释放后生成国名。");
  state.visualOverrides.east = "#333333";
  state.colorRevision++;
  controller.renderCountryInspectorDetail();
  assert.match(stats.textContent, /实际 1 块/);
  assert.equal(status.textContent, "国名尚未显示，可使用手动地图文字。");
});

test("release and undo update only affected label geometries and locate painted preset members", async ctx => {
  const { features } = scene(ctx);
  const source = createCountryLabelSourceOwner({ state, topojson, resolveBorderIdentity: owner, yieldTask: () => Promise.resolve() });
  ctx.after(() => source.dispose());
  const geometry = code => source.getSource().countries.find(item => item.countryCode === code)?.geometry;
  await source.prepare();
  // 国名按实际版图：east 已涂成法国色，开局就计入法国国名形状。
  assert.equal(d3.geoContains(geometry("FRA"), d3.geoCentroid(features[0])), true);
  assert.equal(d3.geoContains(geometry("GER"), d3.geoCentroid(features[0])), false);
  assert.deepEqual(getCountryLocateIds(state, "REL"), []);
  state.visualOverrides = { east: "#333333", remote: "#333333" };
  state.colorRevision++;
  await source.prepare();
  assert.deepEqual(getCountryLocateIds(state, "REL"), ["east"]);
  assert.equal(d3.geoContains(geometry("REL"), [0.5, 0.5]), true);
  assert.equal(d3.geoContains(geometry("GER"), [0.5, 0.5]), false);
  assert.equal(geometry("FRA"), undefined);
  delete state.visualOverrides.remote;
  state.colorRevision++;
  await source.prepare();
  const restoredFrance = geometry("FRA");
  assert.equal(d3.geoContains(restoredFrance, d3.geoCentroid(features[2])), true);
  assert.equal(d3.geoContains(restoredFrance, d3.geoCentroid(features[0])), false);
  state.visualOverrides = {};
  state.colorRevision++;
  await source.prepare();
  assert.equal(geometry("FRA"), restoredFrance);
  assert.equal(geometry("REL"), undefined);
  assert.equal(d3.geoContains(geometry("GER"), d3.geoCentroid(features[0])), true);
});

test("country row badge appears on full annexation and clears when one region returns", async ctx => {
  const { add } = scene(ctx);
  const source = createCountryLabelSourceOwner({ state, topojson, yieldTask: () => Promise.resolve() });
  ctx.after(() => source.dispose());
  await source.prepare();
  const coverage = createCountryLabelCoverageOwner({ state, peekSource: source.peekSource, resolveBorderIdentity: owner });
  const originalHook = readRegisteredRuntimeHookSource(state, "getSuppressedCountryCodesFn");
  registerRuntimeHook(state, "getSuppressedCountryCodesFn", coverage.getSuppressedCodes);
  ctx.after(() => registerRuntimeHook(state, "getSuppressedCountryCodesFn", originalHook));
  const card = add();
  add("input", card, "countryNameOverride");
  const controller = createCountryInspectorController({
    runtimeState: state, countryInspectorSelected: card, t, normalizeCountryCode: code => code,
    countryRowRefsByCode: new Map(), getResolvedCountryColor: () => "#111111",
  });
  controller.bindEvents();
  const rowHost = add();
  controller.renderCountrySelectRow(rowHost, { code: "GER" });
  const badge = rowHost.querySelector("small");
  assert.equal(badge.textContent, "已吞并");
  emit("labels:drawn");
  assert.equal(badge.hidden, true);
  state.visualOverrides.west = "#222222";
  coverage.notifyColorsChanged(["west"]);
  emit("labels:drawn");
  assert.equal(badge.hidden, false);
  delete state.visualOverrides.east;
  coverage.notifyColorsChanged(["east"]);
  emit("labels:drawn");
  assert.equal(badge.hidden, true);
});

test("global region search disambiguates equal place names by effective ownership", ctx => {
  const { doc, add } = scene(ctx);
  const search = createRegionSearchController({ documentRef: doc, state, t,
    getFeatureOwnerCode: owner, getOwnerLabel: getOwnershipDisplayName, getFeatureLabel: f => f.properties.name,
  });
  const host = add();
  search.mount(host);
  assert.equal(host.children[0].classList.contains("hidden"), false);
  const input = doc.getElementById("regionSearchInput");
  input.value = "borderland";
  input.fire("input");
  const hits = doc.getElementById("regionSearchResults").children;
  assert.deepEqual(hits.map(hit => hit.children[1].textContent), ["east · 法国", "west · 德国", "remote · 法国"]);
  search.setCountry("GER");
  input.value = "borderland";
  input.fire("input");
  assert.equal(doc.getElementById("regionSearchResults").children.length, 1);
});

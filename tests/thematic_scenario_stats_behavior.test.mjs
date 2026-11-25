import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultStyleConfig } from "../js/core/state/ui_state.js";
import { SCENARIO_STATS_METRICS } from "../js/core/thematic/thematic_scenario_stats_data.js";
import { getThematicIndicator, loadThematicIndicatorData, formatThematicIndicatorValue } from "../js/core/thematic/thematic_indicator_catalog.js";
import { ensureThematicWgiData } from "../js/core/thematic/thematic_wgi_runtime.js";
import { getThematicWgiLegend, getThematicWgiFeatureInspection, getThematicWgiViewModel,
  normalizeThematicWgiStyle, resolveThematicWgiFeatureColor, THEMATIC_WGI_MISSING_COLOR,
  THEMATIC_WGI_UNMATCHED_COLOR } from "../js/core/thematic/thematic_wgi_view_model.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
import { drawThematicWgiExportLegend } from "../js/core/renderer/thematic_wgi_export_legend.js";
import { createThematicWgiOwner } from "../js/ui/toolbar/thematic_wgi_owner.js";
import { Element } from "./helpers/legend_element.mjs";
import { createTooltipFixture } from "./helpers/isolated_tooltip_fixture.mjs";
import { createDeferredPromise } from "./helpers/deferred_promise.mjs";

const hash = "a".repeat(64);
const population = "scenario_population";
const factories = ["scenario_factories_total", "scenario_civilian_factories", "scenario_military_factories",
  "scenario_factories_per_million", "scenario_military_factory_share"];
const feature = { id: "capital", properties: { ISO_A3: "RUS" } };

function fixture(scenarioId = "tno_1962", metricId = population) {
  const identity = { layer_id: "scenario_country_stats_v1", data_version: "scenario-country-stats-v1", schema_version: 1 };
  const entry = { path: scenarioId + ".json", baseline_hash: hash, // 与真实产物一致：HOI4 用 "1936.1.1.12"，TNO 用 "1962-01-01"。
  as_of_date: scenarioId === "tno_1962" ? "1962-01-01" : scenarioId.slice(-4) + ".1.1.12" };
  const metrics = Object.fromEntries(SCENARIO_STATS_METRICS.map(({ id, unit }) => [id, {
    available: scenarioId !== "tno_1962" || !factories.includes(id), unit,
  }]));
  const row = (people) => ({ ...Object.fromEntries(Object.keys(metrics).map((id) => [id, null])), [population]: people });
  const manifest = { ...identity, scenarios: { [scenarioId]: entry }, metric_ids: Object.keys(metrics) };
  const doc = { ...identity, ...entry, scenario_id: scenarioId, metrics,
    countries: { WRS: row(5000000), TOM: row(0), KOM: row(null) } };
  const requests = [];
  const fetchJson = async (path) => {
    requests.push(path);
    const base = "data/thematic_layers/scenario/country_stats_v1/";
    if (path === base + "manifest.json") return manifest;
    assert.equal(path, base + entry.path);
    return doc;
  };
  const state = { activeScenarioId: scenarioId, scenarioBaselineHash: hash, currentLanguage: "en",
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true, metricId }) },
    landData: { features: [feature] }, scenarioBaselineOwnersByFeatureId: {
      capital: "WRS", other: "WRS", unloaded: "TOM", missing: "KOM", unmapped: "XYZ" },
    scenarioCountriesByTag: { WRS: { base_iso2: "RU" }, TOM: { base_iso2: "RU" } } };
  const loadData = (options) => loadThematicIndicatorData({ ...options, fetchJson });
  return { doc, manifest, state, loadData, requests };
}

function exportedLegendText(state) {
  const texts = [];
  const ctx = { save() {}, restore() {}, setTransform() {}, strokeRect() {}, fillRect() {},
    measureText: (s) => ({ width: s.length * 6 }), fillText: (s) => texts.push(s) };
  assert.ok(drawThematicWgiExportLegend({ width: 1000, height: 800, getContext: () => ctx }, state));
  return texts;
}

test("baseline tags drive the map, tooltip, complete coverage and exported legend", async () => {
  for (const id of ["hoi4_1936", "hoi4_1939", "tno_1962"]) {
    const { state, doc, loadData } = fixture(id);
    if (id === "tno_1962") {
      state.scenarioBaselineOwnersByFeatureId.surface = "ATL";
      doc.non_political_tags = ["ATL"];
    }
    await ensureThematicWgiData(state, { loadData });
    state.visualOverrides = { capital: "#abcdef" };
    state.sovereigntyByFeatureId = { capital: "TOM" };
    const metric = getThematicIndicator(population);
    assert.equal(resolveFeatureColor("capital", { state, feature }).color, metric.colors[2]);
    assert.equal(getThematicWgiFeatureInspection(state, { id: "unloaded" }).value, 0);
    assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 2, missing: 1, unmatched: 1 });
    assert.equal(resolveThematicWgiFeatureColor(state, { id: "missing" }), THEMATIC_WGI_MISSING_COLOR);
    for (const id of ["unmapped", "no-tag"]) assert.equal(resolveThematicWgiFeatureColor(state, { id }), THEMATIC_WGI_UNMATCHED_COLOR);
    for (const properties of [{ water_type: "sea" }, { special_type: "zone" }, { atl_color_rule: "land" }]) {
      assert.equal(resolveThematicWgiFeatureColor(state, { ...feature, properties }), null);
    }
    const tooltip = createTooltipFixture(state).getTooltipText(feature);
    const legend = getThematicWgiLegend(state);
    assert.ok(tooltip.includes("5,000,000 people"));
    assert.ok(tooltip.includes(legend.source));
    assert.equal(legend.source, id.toUpperCase().replace("_", " ")
      + " state data · scenario start · split states apportioned by 2020 population or area");
    assert.ok(legend.title.endsWith(` · ${id.slice(-4)}`), legend.title);
    assert.match(legend.referenceNote, /baseline ownership/);
    const texts = exportedLegendText(state);
    for (const text of [legend.title, legend.source, ...legend.entries.map((entry) => entry.label)]) assert.ok(texts.includes(text));
  }
});

test("metric-specific sources follow language changes in the legend, tooltip and export", async () => {
  for (const { id } of SCENARIO_STATS_METRICS) {
    const { state, loadData } = fixture("hoi4_1936", id);
    await ensureThematicWgiData(state, { loadData });
    const derived = ["scenario_population_density", "scenario_factories_per_million", "scenario_military_factory_share"];
    const sources = id === "scenario_land_area_km2"
      ? ["Scenario parcel geometry area (GHSL 2020 companion)", "剧本地块几何面积（GHSL 2020 配套）"]
      : id === "scenario_core_share" ? ["Scenario cores × parcel area", "剧本核心归属 × 地块面积"]
      : derived.includes(id) ? ["Derived from scenario state data and parcel area", "由剧本州数据与地块面积计算"]
      : ["HOI4 1936 state data · scenario start · split states apportioned by 2020 population or area",
        "HOI4 1936 州数据 · 剧本开局 · 跨国州按 2020 人口或面积拆分"];
    for (const [index, language] of ["en", "zh"].entries()) {
      state.currentLanguage = language;
      const source = sources[index];
      assert.equal(getThematicWgiLegend(state).source, source);
      assert.ok(createTooltipFixture(state).getTooltipText(feature).includes(source));
      assert.ok(exportedLegendText(state).includes(source));
    }
  }
});

test("malformed documents fail the load and are fetched again on retry", async () => {
  for (const corrupt of [
    (doc) => { doc.countries = []; }, (doc) => { doc.countries.WRS = null; },
    (doc) => { doc.countries.WRS = []; }, (doc) => { delete doc.countries.WRS.scenario_oil; },
    (doc) => { doc.countries.WRS.scenario_oil = "3"; }, (doc) => { doc.countries.WRS.scenario_oil = Infinity; },
    (doc) => { delete doc.metrics.scenario_oil; }, (doc) => { doc.metrics.scenario_oil.available = 1; },
    (doc) => { doc.non_political_tags = "ATL"; }, (doc) => { doc.non_political_tags = [0]; },
  ]) {
    const { doc, state, loadData, requests } = fixture();
    const valid = structuredClone(doc);
    corrupt(doc);
    await assert.rejects(loadData({ scenarioId: state.activeScenarioId, metricId: population, baselineHash: hash }));
    await ensureThematicWgiData(state, { loadData });
    assert.equal(getThematicWgiViewModel(state).status, "failed");
    Object.assign(doc, valid, { non_political_tags: [] });
    const before = requests.length;
    await ensureThematicWgiData(state, { loadData, retry: true });
    assert.ok(requests.slice(before).some((path) => path.endsWith("/tno_1962.json")));
    assert.equal(getThematicWgiViewModel(state).status, "ready");
  }
});

test("identity, version and baseline mismatches fail closed", async () => {
  for (const [target, field, bad] of [
    ...["manifest", "doc"].flatMap((key) => [[key, "layer_id", "old"], [key, "data_version", "old"], [key, "schema_version", 0]]),
    ["doc", "baseline_hash", "b".repeat(64)], ["doc", "scenario_id", "hoi4_1939"], ["state", "scenarioBaselineHash", "b".repeat(64)],
  ]) {
    const f = fixture();
    f[target][field] = bad;
    await ensureThematicWgiData(f.state, { loadData: f.loadData });
    assert.equal(getThematicWgiViewModel(f.state).status, "failed", field);
    assert.equal(resolveThematicWgiFeatureColor(f.state, feature), null);
  }
  const { state, loadData } = fixture();
  delete state.scenarioBaselineHash;
  await ensureThematicWgiData(state, { loadData });
  assert.equal(getThematicWgiViewModel(state).status, "ready");
  state.scenarioBaselineHash = "c".repeat(64);
  assert.equal(getThematicWgiViewModel(state).status, "version-unavailable");
  assert.equal(getThematicWgiLegend(state), null);
});

test("a late request from the previous scenario cannot replace the current data", async () => {
  const first = fixture("hoi4_1936"), second = fixture("hoi4_1939");
  const pending = createDeferredPromise();
  const old = ensureThematicWgiData(first.state, { loadData: async (options) => {
    await pending.promise;
    return first.loadData(options);
  } });
  first.state.activeScenarioId = second.state.activeScenarioId;
  const current = await ensureThematicWgiData(first.state, { loadData: second.loadData });
  pending.resolve();
  assert.equal(await old, null);
  assert.equal(first.state.thematicWgiRuntime.data, current);
  assert.equal(current.year, 1939);
});

test("historical selectors default to population and respect document availability even while off", async () => {
  const { state, doc, loadData } = fixture();
  state.styleConfig = createDefaultStyleConfig();
  const select = new Element("select"), toggle = new Element("input"), status = new Element("p");
  const first = createDeferredPromise();
  let attempts = 0;
  const loadSelected = (options) => options.scenarioId === "modern_world"
    ? { ...normalizeThematicWgiStyle({ metricId: options.metricId }), supportedScenarios: ["modern_world"], byIsoA3: {} }
    : loadData(options);
  const owner = createThematicWgiOwner({ runtimeState: state, showLegend() {},
    documentRef: { getElementById: (id) => ({ thematicWgiMetric: select, toggleThematicWgi: toggle, thematicWgiStatus: status })[id],
      createElement: (tag) => new Element(tag) },
    ensureData: (s, options) => ensureThematicWgiData(s, { ...options, loadData: loadSelected }),
    loadScenarioDocument: () => ++attempts === 1 ? first.promise : Promise.resolve(doc) });
  owner.render();
  assert.deepEqual(select.children[0].children.filter((o) => !o.disabled).map((o) => o.value), [population]);
  first.reject(new Error("Temporary failure"));
  await Promise.resolve();
  owner.render();
  await Promise.resolve();
  assert.equal(attempts, 2);
  assert.equal(select.value, population);
  assert.deepEqual(select.children.map((g) => g.label), ["Scenario data (start)", "Modern reference (2023/2024)"]);
  assert.deepEqual(select.children.map((g) => g.children.length), [12, 16]);
  const disabled = select.children[0].children.filter((o) => o.disabled);
  assert.deepEqual(disabled.map((o) => o.value), factories);
  assert.ok(disabled.every((o) => o.textContent.includes("Unavailable")));
  toggle.checked = true;
  toggle.fire("change");
  assert.equal(state.styleConfig.thematic.metricId, population);
  await ensureThematicWgiData(state, { loadData });
  for (const metricId of factories) {
    state.styleConfig.thematic = normalizeThematicWgiStyle({ enabled: true, metricId });
    await ensureThematicWgiData(state, { loadData });
    assert.equal(owner.render().status, "metric-unavailable");
    assert.equal(select.value, metricId);
    assert.equal(resolveThematicWgiFeatureColor(state, feature), null);
  }
  state.activeScenarioId = "modern_world";
  owner.render();
  const placeholder = select.children[0];
  assert.equal(select.value, factories.at(-1));
  assert.equal(placeholder.value, select.value);
  assert.equal(placeholder.disabled, true);
  assert.equal(placeholder.textContent, "Unavailable saved metric");
  assert.equal(status.textContent, "Saved indicator is unavailable. Choose a supported indicator.");
  select.value = select.children[1].value;
  select.fire("change");
  await ensureThematicWgiData(state, { loadData: loadSelected });
  assert.equal(state.styleConfig.thematic.metricId, select.value);
  assert.equal(select.children.length, 16);
  assert.ok(select.children.every((option) => !option.value.startsWith("scenario_")));
  assert.equal(status.textContent, "Indicator data loaded.");
  state.activeScenarioId = "rcw_1919";
  assert.equal(owner.render().supported, false);
});

test("native quantities display their units and factory intensity retains one decimal place", () => {
  for (const [id, expected] of [["land_area_km2", "1,234 km²"], ["factories_total", "1,234 factories"],
    ["factories_per_million", "1234.0 factories/million people"], ["core_share", "1234.0%"], ["steel", "1,234 resource points"]]) {
    assert.equal(formatThematicIndicatorValue(getThematicIndicator("scenario_" + id), 1234), expected);
  }
});

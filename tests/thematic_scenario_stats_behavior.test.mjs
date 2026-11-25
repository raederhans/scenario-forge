import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultStyleConfig } from "../js/core/state/ui_state.js";
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
  const metrics = { [population]: { available: true, unit: "persons" } };
  for (const id of factories) metrics[id] = { available: scenarioId !== "tno_1962", unit: getThematicIndicator(id).unit };
  const manifest = { ...identity, scenarios: { [scenarioId]: entry }, metric_ids: Object.keys(metrics) };
  const doc = { ...identity, ...entry, scenario_id: scenarioId, metrics,
    countries: { WRS: { [population]: 5000000 }, TOM: { [population]: 0 }, KOM: { [population]: null } } };
  const fetchJson = async (path) => {
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
  return { doc, manifest, state, loadData };
}

test("baseline tags drive the map, tooltip, complete coverage and exported legend", async () => {
  for (const id of ["hoi4_1936", "hoi4_1939", "tno_1962"]) {
    const { state, loadData } = fixture(id);
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
    assert.match(legend.source, /^(HOI4|TNO) (1936|1939|1962) state data/);
    assert.ok(legend.title.endsWith(` · ${id.slice(-4)}`), legend.title);
    assert.match(legend.referenceNote, /baseline ownership/);
    const texts = [];
    const ctx = { save() {}, restore() {}, setTransform() {}, strokeRect() {}, fillRect() {},
      measureText: (s) => ({ width: s.length * 6 }), fillText: (s) => texts.push(s) };
    assert.ok(drawThematicWgiExportLegend({ width: 1000, height: 800, getContext: () => ctx }, state));
    for (const text of [legend.title, legend.source, ...legend.entries.map((entry) => entry.label)]) assert.ok(texts.includes(text));
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
  const select = new Element("select"), toggle = new Element("input");
  const owner = createThematicWgiOwner({ runtimeState: state, showLegend() {},
    documentRef: { getElementById: (id) => ({ thematicWgiMetric: select, toggleThematicWgi: toggle })[id],
      createElement: (tag) => new Element(tag) },
    ensureData: (s, options) => ensureThematicWgiData(s, { ...options, loadData }),
    loadScenarioDocument: async () => doc });
  owner.render();
  await Promise.resolve();
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
  assert.equal(select.children.length, 16);
  assert.ok(select.children.every((option) => !option.value.startsWith("scenario_")));
  state.activeScenarioId = "rcw_1919";
  assert.equal(owner.render().supported, false);
});

test("native quantities display their units and factory intensity retains one decimal place", () => {
  for (const [id, expected] of [["land_area_km2", "1,234 km²"], ["factories_total", "1,234 factories"],
    ["factories_per_million", "1234.0 factories/million people"], ["core_share", "1234.0%"], ["steel", "1,234 resource points"]]) {
    assert.equal(formatThematicIndicatorValue(getThematicIndicator("scenario_" + id), 1234), expected);
  }
});

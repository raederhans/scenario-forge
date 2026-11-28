import assert from "node:assert/strict";
import test from "node:test";
import { SCENARIO_STATS_METRICS } from "../js/core/thematic/thematic_scenario_stats_data.js";
import { getThematicIndicator, loadThematicIndicatorData } from "../js/core/thematic/thematic_indicator_catalog.js";
import { ensureThematicWgiData } from "../js/core/thematic/thematic_wgi_runtime.js";
import { getThematicWgiFeatureInspection, normalizeThematicWgiStyle } from "../js/core/thematic/thematic_wgi_view_model.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
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

test("scenario statistics follow baseline ownership", async () => {
  for (const id of ["hoi4_1936", "hoi4_1939", "tno_1962"]) {
    const { state, loadData } = fixture(id);
    await ensureThematicWgiData(state, { loadData });
    state.visualOverrides = { capital: "#abcdef" };
    state.sovereigntyByFeatureId = { capital: "TOM" };
    const metric = getThematicIndicator(population);
    assert.equal(resolveFeatureColor("capital", { state, feature }).color, metric.colors[2]);
    assert.equal(getThematicWgiFeatureInspection(state, { id: "unloaded" }).value, 0);
    const tooltip = createTooltipFixture(state).getTooltipText(feature);
    assert.ok(tooltip.includes("5,000,000 people"));
  }
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

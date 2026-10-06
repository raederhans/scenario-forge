import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { THEMATIC_POPULATION_METRICS } from "../js/core/thematic_population_data.js";
import {
  getThematicIndicator, loadThematicIndicatorData, formatThematicIndicatorValue,
} from "../js/core/thematic_indicator_catalog.js";
import { ensureThematicWgiData } from "../js/core/thematic_wgi_runtime.js";
import { setThematicWgiStyleState } from "../js/core/state/actions/thematic_wgi_actions.js";
import {
  normalizeThematicWgiStyle, getThematicWgiColor, getThematicWgiLegend,
  getThematicWgiFeatureInspection, getThematicWgiViewModel,
} from "../js/core/thematic_wgi_view_model.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
import { createTooltipFixture } from "./helpers/isolated_tooltip_fixture.mjs";
import { drawThematicWgiExportLegend } from "../js/core/renderer/thematic_wgi_export_legend.js";

const fetchJson = async (path) => {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
};
const dataByMetric = new Map(await Promise.all(THEMATIC_POPULATION_METRICS.map(async ({ id }) => [id,
  await loadThematicIndicatorData({ metricId: id, fetchJson })])));
const SCENARIOS = ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"];
const TOTAL_NOTE = "Modern reference-country total, not the population of the scenario territory.";
const THRESHOLDS = {
  wdi_population_total: [1e6, 1e7, 5e7, 1e8],
  wdi_population_density: [25, 100, 250, 1000],
  wdi_urban_population_share: [20, 40, 60, 80],
  wdi_population_65_plus_share: [5, 10, 15, 20],
  wdi_total_fertility_rate: [1.5, 2.1, 3, 5],
};
function fixture(metricId = "wdi_population_total", scenarioId = "modern_world") {
  return { activeScenarioId: scenarioId, currentLanguage: "en", width: 1000,
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true, metricId }) },
    thematicWgiRuntime: { status: "ready", data: dataByMetric.get(metricId), revision: 1 },
    visualOverrides: { sample: "#123456" },
    scenarioBaselineOwnersByFeatureId: { sample: "GER" }, scenarioCountriesByTag: { GER: { base_iso2: "DE" } } };
}
const feature = { id: "sample", properties: { ISO_A2: "AT" } };
function tooltipFor(state, row = feature) {
  return createTooltipFixture(state).getTooltipText(row);
}
function exportedLegend(state) {
  const texts = [], swatches = [];
  const ctx = { save() {}, restore() {}, setTransform() {}, strokeRect() {},
    measureText: (text) => ({ width: text.length * 6 }),
    fillRect() { swatches.push(this.fillStyle); }, fillText(text) { texts.push(text); } };
  assert.equal(drawThematicWgiExportLegend({ width: 2000, height: 1200, getContext: () => ctx }, state), true);
  return { texts, swatches };
}

test("population uses five fixed raw-value bins including exact boundaries, zero and missing states", () => {
  for (const { id } of THEMATIC_POPULATION_METRICS) {
    const metric = getThematicIndicator(id);
    assert.deepEqual(metric.thresholds, THRESHOLDS[id]);
    assert.equal(metric.colors.length, 5);
    assert.equal(getThematicWgiColor({ status: "value", value: 0, normalizedValue: 100, metricId: id }), metric.colors[0]);
    for (const [index, boundary] of THRESHOLDS[id].entries()) {
      assert.equal(getThematicWgiColor({ status: "value", value: boundary - 0.001, normalizedValue: 0, metricId: id }), metric.colors[index]);
      assert.equal(getThematicWgiColor({ status: "value", value: boundary, normalizedValue: 0, metricId: id }), metric.colors[index + 1]);
    }
    const missing = getThematicWgiColor({ status: "missing", value: null, metricId: id });
    const unmatched = getThematicWgiColor({ status: "unmatched", value: null, metricId: id });
    assert.notEqual(missing, unmatched);
    assert.notEqual(missing, metric.colors[0]);
    assert.notEqual(unmatched, metric.colors[0]);
  }
});

test("all five WDI indicators retain raw units, year, source and five bins across four scenarios", () => {
  for (const { id } of THEMATIC_POPULATION_METRICS) {
    const metric = getThematicIndicator(id);
    for (const scene of SCENARIOS) {
      const state = fixture(id, scene);
      const observation = getThematicWgiFeatureInspection(state, feature);
      assert.equal(observation.joinKey, scene === "modern_world" ? "AUT" : "DEU");
      assert.equal(observation.value, dataByMetric.get(id).byIsoA3[observation.joinKey].value);
      assert.equal(observation.unit, metric.unit);
      assert.equal(resolveFeatureColor("sample", { state, feature }).color, getThematicWgiColor(observation));
      assert.equal(state.visualOverrides.sample, "#123456");
      const tooltip = tooltipFor(state);
      assert.match(tooltip, /2023/);
      assert.match(tooltip, /World Bank WDI/);
      assert.doesNotMatch(tooltip, /2024|UNDP|World Bank WGI|\/ 100|confidence interval|置信区间|100 分/);
      assert.ok(tooltip.includes(formatThematicIndicatorValue(metric, observation.value)), id);
      if (metric.unit === "persons") assert.match(tooltip, /[\d,]+ people/);
      if (metric.unit === "persons_per_km2") assert.match(tooltip, /[\d,.]+ people\/km²/);
      if (metric.unit === "percent") assert.match(tooltip, /\d+\.\d%/);
      if (metric.unit === "births_per_woman") assert.match(tooltip, /\d+\.\d{2} births\/woman/);
      const legend = getThematicWgiLegend(state);
      assert.equal(legend.binCount, 5);
      assert.equal(legend.entries.length, 7);
      assert.equal(legend.referenceNote.includes("2023"), scene !== "modern_world");
      assert.equal(legend.referenceNote.includes(TOTAL_NOTE), scene !== "modern_world" && metric.unit === "persons");
      assert.equal(tooltip.includes(TOTAL_NOTE), scene !== "modern_world" && metric.unit === "persons");
      const { texts, swatches } = exportedLegend(state);
      assert.ok(texts.includes(metric.attribution));
      for (const label of metric.labels) assert.ok(texts.includes(label));
      assert.equal(swatches.length, 8);
      assert.deepEqual(swatches.slice(1, 6), metric.colors);
      if (legend.referenceNote) {
        const noteStart = texts.indexOf(legend.note) + 1;
        const noteEnd = texts.indexOf(metric.labels[0]);
        assert.equal(texts.slice(noteStart, noteEnd).join(" "), legend.referenceNote,
          "export keeps the entire wrapped reference note");
      }
    }
  }
});

test("density above the auxiliary maximum keeps its full raw value in tooltip and highest map bin", () => {
  const metricId = "wdi_population_density";
  const data = dataByMetric.get(metricId);
  const highest = Object.values(data.byIsoA3).filter((row) => row.status === "value")
    .sort((a, b) => b.value - a.value)[0];
  assert.ok(highest.value > 1000, "official package contains high national density");
  assert.equal(highest.normalizedValue, 100);
  const state = fixture(metricId);
  const row = { id: "sample", properties: { ISO_A3: highest.joinKey } };
  const observation = getThematicWgiFeatureInspection(state, row);
  assert.equal(observation.value, highest.value);
  const metric = getThematicIndicator(metricId);
  assert.ok(tooltipFor(state, row).includes(formatThematicIndicatorValue(metric, highest.value)));
  assert.equal(getThematicWgiColor(observation), metric.colors[4]);
});

test("zero observations render their raw units while source gaps retain missing tooltip and color", () => {
  for (const { id } of THEMATIC_POPULATION_METRICS) {
    const metric = getThematicIndicator(id);
    for (const value of [0, null]) {
      const state = fixture(id);
      const data = state.thematicWgiRuntime.data;
      state.thematicWgiRuntime.data = { ...data, byIsoA3: { ...data.byIsoA3,
        AUT: { ...data.byIsoA3.AUT, value, normalizedValue: value,
          status: value === null ? "missing" : "value", sourceStatus: value === null ? "source_gap" : "observed" },
      } };
      const observation = getThematicWgiFeatureInspection(state, feature);
      assert.equal(observation.value, value);
      assert.equal(resolveFeatureColor("sample", { state, feature }).color, getThematicWgiColor(observation));
      const tooltip = tooltipFor(state);
      if (value === null) {
        assert.match(tooltip, /Source missing/);
        assert.notEqual(getThematicWgiColor(observation), metric.colors[0]);
      } else {
        assert.ok(tooltip.includes(formatThematicIndicatorValue(metric, 0)), id);
        assert.doesNotMatch(tooltip, /Source missing/);
        assert.equal(getThematicWgiColor(observation), metric.colors[0]);
      }
    }
  }
});

test("population follows actual historical reference-country groups without summing territories and excludes special surfaces", async () => {
  for (const [scene, tag, iso] of [["hoi4_1936", "CZE", "CZE"], ["hoi4_1939", "GER", "DEU"], ["tno_1962", "WRS", "RUS"]]) {
    const manifest = await fetchJson(`data/scenarios/${scene}/manifest.json`);
    const [topology, { owners }, { countries }] = await Promise.all([
      fetchJson(manifest.runtime_topology_url), fetchJson(manifest.owners_url), fetchJson(manifest.countries_url),
    ]);
    const features = topology.objects.political.geometries.map((geometry) => ({
      id: geometry.properties?.id ?? geometry.id, properties: geometry.properties,
    }));
    const state = { ...fixture("wdi_population_total", scene), scenarioBaselineOwnersByFeatureId: owners,
      scenarioCountriesByTag: countries, landData: { features } };
    const owned = features.filter((row) => owners[row.id] === tag && !row.properties?.water_type
      && !row.properties?.special_type && !row.properties?.atl_color_rule);
    assert.ok(owned.length > 1, `${scene}/${tag} spans multiple features`);
    const observations = owned.map((row) => getThematicWgiFeatureInspection(state, row));
    assert.deepEqual([...new Set(observations.map((row) => row.joinKey))], [iso]);
    const raw = dataByMetric.get("wdi_population_total").byIsoA3[iso].value;
    assert.ok(raw > 0);
    assert.deepEqual([...new Set(observations.map((row) => row.value))], [raw]);
    const grouped = { ...state, landData: { features: owned } };
    assert.deepEqual(getThematicWgiViewModel(grouped).coverage, { matched: 1, missing: 0, unmatched: 0 });
    for (const properties of [{ water_type: "sea" }, { special_type: "zone" }, { atl_color_rule: "land" }]) {
      assert.equal(getThematicWgiFeatureInspection(state, { ...feature, properties }), null);
    }
    const unknown = { ...state, scenarioCountriesByTag: { [tag]: { base_iso2: "ZZZ" } } };
    assert.equal(getThematicWgiFeatureInspection(unknown, owned[0]).status, "unmatched");
  }
});

test("WGI to population and population to HDI switches fence stale success and failure responses", async () => {
  const wgiMetric = "wgi_government_effectiveness_score_0_100";
  const [wgiData, hdiData] = await Promise.all([
    loadThematicIndicatorData({ metricId: wgiMetric, fetchJson }),
    loadThematicIndicatorData({ metricId: "undp_hdi", fetchJson }),
  ]);
  const populationId = "wdi_population_total", populationData = dataByMetric.get(populationId);
  for (const [firstId, secondId, firstData, secondData] of [
    [wgiMetric, populationId, wgiData, populationData],
    [populationId, "undp_hdi", populationData, hdiData],
  ]) {
    for (const fail of [false, true]) {
      const state = fixture(firstId);
      state.thematicWgiRuntime = { status: "idle", revision: 0 };
      let finish, reject;
      const oldData = new Promise((resolve, no) => { finish = resolve; reject = no; });
      const old = ensureThematicWgiData(state, { loadData: () => oldData });
      await Promise.resolve();
      setThematicWgiStyleState(state, normalizeThematicWgiStyle({ enabled: true, metricId: secondId }));
      await ensureThematicWgiData(state, { loadData: async () => secondData });
      if (fail) reject(new Error("stale source failed")); else finish(firstData);
      assert.equal(await old, null);
      assert.equal(state.thematicWgiRuntime.status, "ready");
      assert.strictEqual(state.thematicWgiRuntime.data, secondData);
    }
  }
});

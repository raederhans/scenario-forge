import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  THEMATIC_POPULATION_DATA_VERSION, THEMATIC_POPULATION_LAYER_ID, THEMATIC_POPULATION_METRIC_ID,
  THEMATIC_POPULATION_METRICS, isThematicPopulationMetricSupported, loadThematicPopulationData,
} from "../js/core/thematic_population_data.js";

const SCENARIOS = ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"];
const IDS = THEMATIC_POPULATION_METRICS.map(({ id }) => id);
const RAW = [750000000, 500, 65.5, 14.4, 2.4];
const NORMALIZED = [50, 50, 65.5, 14.4, 30];

function fixture() {
  const manifest = {
    schema_version: 1, layer_id: THEMATIC_POPULATION_LAYER_ID,
    provenance: [{ source_id: "world_bank_wdi_population", version: "2026-07-13", release: "World Development Indicators", selected_year: 2023 }],
    period: { year: 2023 }, source_policy: "real_source_cache_only", status: "experimental",
    metric_ids: [...IDS], runtime_consumer: {
      data_version: THEMATIC_POPULATION_DATA_VERSION, status: "main_map_ready", supports_main_map_render: true,
      supported_scenarios: [...SCENARIOS], supported_metrics: [...IDS],
    },
  };
  const observed = Object.fromEntries(THEMATIC_POPULATION_METRICS.map(({ id, unit }, index) => [id, {
    raw_value: RAW[index], normalized_value: NORMALIZED[index], unit, year: 2023, source_status: "observed",
  }]));
  const missing = Object.fromEntries(THEMATIC_POPULATION_METRICS.map(({ id, unit }) => [id, {
    raw_value: null, normalized_value: null, unit, year: 2023, source_status: "source_gap",
  }]));
  const metrics = {
    schema_version: 1, layer_id: THEMATIC_POPULATION_LAYER_ID, geography_level: "admin0", join_key_type: "iso_a3",
    metric_ids: [...IDS], features: [
      { join_key: "AAA", name: "Synthetic observed country", values: observed },
      { join_key: "BBB", name: "Synthetic source gap", values: missing },
    ],
  };
  return { manifest, metrics };
}

function fetcher(data = fixture()) {
  return async (path) => path.endsWith("manifest.json") ? data.manifest : data.metrics;
}

test("population descriptors expose five raw-unit indicators and reject invalid selections before fetching", async () => {
  assert.deepEqual(THEMATIC_POPULATION_METRICS, [
    { id: "wdi_population_total", labelEn: "Total population", labelZh: "总人口", unit: "persons" },
    { id: "wdi_population_density", labelEn: "National population density", labelZh: "国家平均人口密度", unit: "persons_per_km2" },
    { id: "wdi_urban_population_share", labelEn: "Urban population share", labelZh: "城镇人口占比", unit: "percent" },
    { id: "wdi_population_65_plus_share", labelEn: "Population aged 65 and above", labelZh: "65岁及以上人口占比", unit: "percent" },
    { id: "wdi_total_fertility_rate", labelEn: "Total fertility rate", labelZh: "总和生育率", unit: "births_per_woman" },
  ]);
  assert.ok(Object.isFrozen(THEMATIC_POPULATION_METRICS));
  for (const descriptor of THEMATIC_POPULATION_METRICS) {
    assert.ok(Object.isFrozen(descriptor));
    assert.equal(isThematicPopulationMetricSupported(descriptor.id), true);
  }
  assert.equal(isThematicPopulationMetricSupported("unknown"), false);
  const mustNotFetch = () => assert.fail("invalid options must not fetch");
  await assert.rejects(loadThematicPopulationData({ metricId: "unknown", fetchJson: mustNotFetch }), /Unsupported population metric/);
  await assert.rejects(loadThematicPopulationData({ scenarioId: "blank_base", fetchJson: mustNotFetch }), /Unsupported population scenario/);
  await assert.rejects(loadThematicPopulationData({ fetchJson: null }), /fetchJson must be a function/);
});

test("all indicators preserve raw values, separate auxiliary scores and deeply freeze payloads", async () => {
  const data = fixture();
  data.metrics.features[0].values.wdi_population_total.uncertainty = { interval: [700000000, 800000000] };
  const paths = [];
  const fetchJson = async (path) => {
    paths.push(path);
    return path.endsWith("manifest.json") ? data.manifest : data.metrics;
  };
  const payloads = await Promise.all(IDS.map((metricId) => loadThematicPopulationData({ metricId, fetchJson })));
  assert.deepEqual(paths, [
    "data/thematic_layers/population/wdi_population_v1/manifest.json",
    "data/thematic_layers/population/wdi_population_v1/metrics.admin0.json",
  ]);
  assert.equal(new Set(payloads).size, 5);
  for (const [index, payload] of payloads.entries()) {
    const observation = payload.byIsoA3.AAA;
    assert.equal(payload.layerId, THEMATIC_POPULATION_LAYER_ID);
    assert.equal(payload.dataVersion, THEMATIC_POPULATION_DATA_VERSION);
    assert.equal(payload.year, 2023);
    assert.equal(observation.value, RAW[index]);
    assert.equal(observation.normalizedValue, NORMALIZED[index]);
    assert.equal(observation.metricId, IDS[index]);
    assert.equal(observation.unit, THEMATIC_POPULATION_METRICS[index].unit);
    assert.equal(observation.name, "Synthetic observed country");
    assert.equal(observation.joinKey, "AAA");
    assert.equal(observation.year, 2023);
    assert.equal(observation.status, "value");
    assert.equal(payload.byIsoA3.BBB.status, "missing");
    assert.equal(payload.byIsoA3.BBB.value, null);
    assert.equal(payload.byIsoA3.BBB.normalizedValue, null);
    assert.equal(Object.hasOwn(payload.byIsoA3.BBB, "uncertainty"), false);
    if (index > 0) assert.equal(Object.hasOwn(observation, "uncertainty"), false);
    assert.equal(payload.byIsoA3.ZZZ, undefined);
    assert.deepEqual(payload.counts, { features: 2, values: 1, missing: 1 });
    for (const value of [payload, payload.byIsoA3, payload.supportedScenarios, payload.counts, observation]) {
      assert.ok(Object.isFrozen(value));
    }
    for (const scenarioId of SCENARIOS) {
      assert.strictEqual(await loadThematicPopulationData({ metricId: IDS[index], scenarioId, fetchJson }), payload);
    }
  }
  assert.equal(paths.length, 2);
  assert.strictEqual(await loadThematicPopulationData({ fetchJson }), payloads[0]);
  assert.ok(Object.isFrozen(payloads[0].byIsoA3.AAA.uncertainty.interval));
  assert.notStrictEqual(payloads[0].byIsoA3.AAA.uncertainty, data.metrics.features[0].values.wdi_population_total.uncertainty);
  assert.equal(Object.isFrozen(data.metrics.features[0].values.wdi_population_total), false);
  data.metrics.features[0].values.wdi_population_total.raw_value = 1;
  assert.equal(payloads[0].byIsoA3.AAA.value, RAW[0], "source mutation cannot change the cached snapshot");
});

test("raw endpoints remain observed and clamped normalization does not replace raw values", async () => {
  const cases = [
    ["wdi_population_total", 0, 0], ["wdi_population_total", 1500000000, 100], ["wdi_population_total", 2000000000, 100],
    ["wdi_population_density", 0, 0], ["wdi_population_density", 1000, 100], ["wdi_population_density", 2000, 100],
    ["wdi_urban_population_share", 0, 0], ["wdi_urban_population_share", 100, 100],
    ["wdi_population_65_plus_share", 0, 0], ["wdi_population_65_plus_share", 100, 100],
    ["wdi_total_fertility_rate", 0, 0], ["wdi_total_fertility_rate", 8, 100], ["wdi_total_fertility_rate", 10, 100],
  ];
  for (const [metricId, raw_value, normalized_value] of cases) {
    const data = fixture();
    Object.assign(data.metrics.features[0].values[metricId], { raw_value, normalized_value });
    const result = (await loadThematicPopulationData({ metricId, fetchJson: fetcher(data) })).byIsoA3.AAA;
    assert.equal(result.value, raw_value);
    assert.equal(result.normalizedValue, normalized_value);
    assert.equal(result.status, "value");
  }
});

test("invalid raw types, ranges, normalization and gap statuses fail closed for each selected indicator", async () => {
  for (const metricId of IDS) {
    const unit = THEMATIC_POPULATION_METRICS.find(({ id }) => id === metricId).unit;
    for (const raw_value of [-1, NaN, Infinity, "0.5", undefined, true, false,
      ...(unit === "persons" ? [1.1] : []), ...(unit === "percent" ? [100.1] : [])]) {
      const data = fixture();
      data.metrics.features[0].values[metricId].raw_value = raw_value;
      await assert.rejects(loadThematicPopulationData({ metricId, fetchJson: fetcher(data) }), /raw value range/);
    }
    for (const mutate of [
      (metric) => { metric.normalized_value += 0.001; },
      (metric) => { metric.normalized_value = NaN; },
      (metric) => { metric.normalized_value = "85"; },
      (metric) => { metric.normalized_value = false; },
      (metric) => { metric.normalized_value = 101; },
      (metric) => { metric.normalized_value = null; },
      (metric) => { metric.year = 2024; },
      (metric) => { delete metric.year; },
      (metric) => { metric.unit = "score_0_100"; },
      (metric) => { delete metric.unit; },
      (metric) => { metric.source_status = "source_gap"; },
      (metric) => { delete metric.source_status; },
    ]) {
      const data = fixture();
      mutate(data.metrics.features[0].values[metricId]);
      await assert.rejects(loadThematicPopulationData({ metricId, fetchJson: fetcher(data) }), /Invalid population data/);
    }
    for (const mutate of [
      (metric) => { metric.source_status = "observed"; },
      (metric) => { metric.normalized_value = 0; },
    ]) {
      const data = fixture();
      mutate(data.metrics.features[1].values[metricId]);
      await assert.rejects(loadThematicPopulationData({ metricId, fetchJson: fetcher(data) }), /Invalid population data/);
    }
  }
  for (const [index, metricId] of IDS.entries()) {
    const tolerant = fixture();
    tolerant.metrics.features[0].values[metricId].normalized_value += 5e-9;
    assert.equal((await loadThematicPopulationData({ metricId, fetchJson: fetcher(tolerant) })).byIsoA3.AAA.value, RAW[index]);
  }
});

test("source identity, stale versions, fixtures and invalid consumer declarations are rejected", async () => {
  const mutations = [
    (data) => { data.manifest = null; },
    (data) => { data.manifest.layer_id = "other"; },
    (data) => { data.manifest.schema_version = 2; },
    (data) => { data.manifest.provenance = []; },
    (data) => { data.manifest.provenance = "world_bank_wdi_population"; },
    (data) => { data.manifest.provenance[0].source_id = "synthetic_fixture"; },
    (data) => { delete data.manifest.provenance[0].source_id; },
    (data) => { data.manifest.provenance[0].version = "2024"; },
    (data) => { delete data.manifest.provenance[0].version; },
    (data) => { data.manifest.provenance[0].release = "Other Indicators"; },
    (data) => { delete data.manifest.provenance[0].release; },
    (data) => { data.manifest.provenance[0].selected_year = 2022; },
    (data) => { delete data.manifest.provenance[0].selected_year; },
    (data) => { data.manifest.period.year = 2022; },
    (data) => { delete data.manifest.period; },
    (data) => { data.manifest.status = "fixture"; },
    (data) => { delete data.manifest.source_policy; },
    (data) => { data.manifest.source_policy = "fixture_only"; },
    (data) => { data.manifest.runtime_consumer.data_version = "wdi-2025-07-13:2022"; },
    (data) => { delete data.manifest.runtime_consumer.data_version; },
    (data) => { delete data.manifest.runtime_consumer; },
    (data) => { data.manifest.runtime_consumer.status = "catalog_only"; },
    (data) => { data.manifest.runtime_consumer.supports_main_map_render = "true"; },
    (data) => { data.manifest.runtime_consumer.supported_scenarios = []; },
    (data) => { data.manifest.runtime_consumer.supported_scenarios = ["tno_1962"]; },
    (data) => { data.manifest.runtime_consumer.supported_scenarios = ["modern_world", "blank_base"]; },
    (data) => { data.manifest.runtime_consumer.supported_scenarios = ["modern_world", "modern_world"]; },
    (data) => { data.manifest.runtime_consumer.supported_metrics = []; },
    (data) => { data.manifest.runtime_consumer.supported_metrics = ["wdi_population_total", "wdi_population_total"]; },
    (data) => { data.manifest.runtime_consumer.supported_metrics = ["fake_hdi"]; },
    (data) => { data.manifest.metric_ids = []; },
    (data) => { data.metrics = null; },
    (data) => { data.metrics.status = "fixture"; },
    (data) => { data.metrics.schema_version = 2; },
    (data) => { data.metrics.layer_id = "other"; },
    (data) => { data.metrics.geography_level = "admin1"; },
    (data) => { data.metrics.join_key_type = "feature_id"; },
    (data) => { data.metrics.metric_ids = []; },
    (data) => { data.metrics.features = []; },
    (data) => { data.metrics.features.push(data.metrics.features[0]); },
    (data) => { data.metrics.features[0].join_key = "aa"; },
    (data) => { data.metrics.features[0].join_key = "aaa"; },
    (data) => { data.metrics.features[0].join_key = 123; },
    (data) => { delete data.metrics.features[0].join_key; },
    (data) => { data.metrics.features[0] = null; },
    (data) => { delete data.metrics.features[0].values.wdi_population_total; },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    await assert.rejects(loadThematicPopulationData({ fetchJson: fetcher(data) }), /Invalid population data/);
  }
});

test("selected metric support is checked without consuming unrelated indicator rows", async () => {
  const data = fixture();
  data.manifest.runtime_consumer.supported_metrics = ["wdi_population_density"];
  for (const row of data.metrics.features) delete row.values.wdi_population_total;
  const fetchJson = fetcher(data);
  const payload = await loadThematicPopulationData({ metricId: "wdi_population_density", fetchJson });
  assert.equal(payload.byIsoA3.AAA.value, RAW[1]);
  await assert.rejects(loadThematicPopulationData({ fetchJson }), /runtime metric support/);
});

test("same-fetcher network and validation failures allow a fresh successful retry", async () => {
  for (const failure of ["network", "validation"]) {
    let invalid = true;
    let calls = 0;
    const fetchJson = async (path) => {
      calls += 1;
      if (invalid && failure === "network") throw new Error("offline");
      const data = fixture();
      if (invalid) data.metrics.features[0].values.wdi_population_total.normalized_value = 0;
      return path.endsWith("manifest.json") ? data.manifest : data.metrics;
    };
    await assert.rejects(loadThematicPopulationData({ fetchJson }), failure === "network" ? /offline/ : /normalization/);
    invalid = false;
    const [a, b] = await Promise.all([loadThematicPopulationData({ fetchJson }), loadThematicPopulationData({ fetchJson })]);
    assert.strictEqual(a, b);
    assert.equal(a.byIsoA3.AAA.value, RAW[0]);
    assert.equal(calls, 4);
    assert.strictEqual(await loadThematicPopulationData({ fetchJson }), a);
    assert.equal(calls, 4);
  }
});

test("different fetchers keep independent document snapshots", async () => {
  const original = fixture();
  const updated = fixture();
  Object.assign(updated.metrics.features[0].values.wdi_population_total, {
    raw_value: 1500000000, normalized_value: 100,
  });
  const [a, b] = await Promise.all([
    loadThematicPopulationData({ fetchJson: fetcher(original) }),
    loadThematicPopulationData({ fetchJson: fetcher(updated) }),
  ]);
  assert.notStrictEqual(a, b);
  assert.equal(a.byIsoA3.AAA.value, RAW[0]);
  assert.equal(b.byIsoA3.AAA.value, 1500000000);
});

test("unadvertised historical scenarios fail closed and evict documents for corrected retry", async () => {
  let data = fixture();
  data.manifest.runtime_consumer.supported_scenarios = ["modern_world"];
  let calls = 0;
  const fetchJson = async (path) => {
    calls += 1;
    return path.endsWith("manifest.json") ? data.manifest : data.metrics;
  };
  await loadThematicPopulationData({ fetchJson });
  await assert.rejects(loadThematicPopulationData({ scenarioId: "hoi4_1939", fetchJson }), /not advertised/);
  data = fixture();
  const payload = await loadThematicPopulationData({ scenarioId: "hoi4_1939", fetchJson });
  assert.deepEqual(payload.supportedScenarios, SCENARIOS);
  assert.equal(calls, 4);
});

const manifestPath = new URL("../data/thematic_layers/population/wdi_population_v1/manifest.json", import.meta.url);
const metricsPath = new URL("../data/thematic_layers/population/wdi_population_v1/metrics.admin0.json", import.meta.url);
test("checked-in WDI package preserves every official raw value and source gap for all five indicators", async () => {
  const data = {
    manifest: JSON.parse(await readFile(manifestPath)), metrics: JSON.parse(await readFile(metricsPath)),
  };
  const fetchJson = fetcher(data);
  for (const metricId of IDS) {
    const payload = await loadThematicPopulationData({ metricId, fetchJson });
    for (const row of data.metrics.features) {
      const result = payload.byIsoA3[row.join_key];
      const source = row.values[metricId];
      assert.equal(result.value, source.raw_value, `${metricId}/${row.join_key}`);
      assert.equal(result.normalizedValue, source.normalized_value);
      assert.equal(result.status, source.raw_value === null ? "missing" : "value");
      assert.equal(result.unit, source.unit);
      assert.equal(Object.hasOwn(result, "uncertainty"), Object.hasOwn(source, "uncertainty"));
    }
    assert.ok(payload.counts.values > 100, `${metricId} has broad source coverage`);
  }
});

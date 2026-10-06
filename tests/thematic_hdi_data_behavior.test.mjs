import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  THEMATIC_HDI_DATA_VERSION, THEMATIC_HDI_LAYER_ID, THEMATIC_HDI_METRIC_ID,
  THEMATIC_HDI_METRICS, isThematicHdiMetricSupported, loadThematicHdiData,
} from "../js/core/thematic_hdi_data.js";

const SCENARIOS = ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"];
const IDS = THEMATIC_HDI_METRICS.map(({ id }) => id);
const RAW = [0.85, 78.5, 14.4, 10.5, 30000];
const NORMALIZED = [85, 90, 80, 70, Math.log(300) / Math.log(750) * 100];

function fixture() {
  const manifest = {
    schema_version: 1, layer_id: THEMATIC_HDI_LAYER_ID,
    provenance: [{ source_id: "undp_hdr_2025", version: "2025", release: "Human Development Report 2025", selected_year: 2023 }],
    period: { year: 2023 }, source_policy: "real_source_cache_only", status: "experimental",
    metric_ids: [...IDS], runtime_consumer: {
      data_version: THEMATIC_HDI_DATA_VERSION, status: "main_map_ready", supports_main_map_render: true,
      supported_scenarios: [...SCENARIOS], supported_metrics: [...IDS],
    },
  };
  const observed = Object.fromEntries(THEMATIC_HDI_METRICS.map(({ id, unit }, index) => [id, {
    raw_value: RAW[index], normalized_value: NORMALIZED[index], unit, year: 2023, source_status: "observed",
  }]));
  const missing = Object.fromEntries(THEMATIC_HDI_METRICS.map(({ id, unit }) => [id, {
    raw_value: null, normalized_value: null, unit, year: 2023, source_status: "source_gap",
  }]));
  const metrics = {
    schema_version: 1, layer_id: THEMATIC_HDI_LAYER_ID, geography_level: "admin0", join_key_type: "iso_a3",
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

test("HDI descriptors expose five raw-unit indicators and reject invalid selections before fetching", async () => {
  assert.deepEqual(THEMATIC_HDI_METRICS, [
    { id: "undp_hdi", labelEn: "Human Development Index", labelZh: "人类发展指数", unit: "index_0_1" },
    { id: "undp_life_expectancy", labelEn: "Life expectancy", labelZh: "预期寿命", unit: "years" },
    { id: "undp_expected_schooling", labelEn: "Expected years of schooling", labelZh: "预期受教育年限", unit: "years" },
    { id: "undp_mean_schooling", labelEn: "Mean years of schooling", labelZh: "平均受教育年限", unit: "years" },
    { id: "undp_gni_per_capita", labelEn: "GNI per capita", labelZh: "人均国民总收入", unit: "usd_2021_ppp" },
  ]);
  assert.ok(Object.isFrozen(THEMATIC_HDI_METRICS));
  for (const descriptor of THEMATIC_HDI_METRICS) {
    assert.ok(Object.isFrozen(descriptor));
    assert.equal(isThematicHdiMetricSupported(descriptor.id), true);
  }
  assert.equal(isThematicHdiMetricSupported("unknown"), false);
  const mustNotFetch = () => assert.fail("invalid options must not fetch");
  await assert.rejects(loadThematicHdiData({ metricId: "unknown", fetchJson: mustNotFetch }), /Unsupported HDI metric/);
  await assert.rejects(loadThematicHdiData({ scenarioId: "blank_base", fetchJson: mustNotFetch }), /Unsupported HDI scenario/);
  await assert.rejects(loadThematicHdiData({ fetchJson: null }), /fetchJson must be a function/);
});

test("all indicators preserve raw values, separate shading scores and deeply freeze payloads", async () => {
  const data = fixture();
  data.metrics.features[0].values.undp_hdi.uncertainty = { interval: [0.8, 0.9] };
  const paths = [];
  const fetchJson = async (path) => {
    paths.push(path);
    return path.endsWith("manifest.json") ? data.manifest : data.metrics;
  };
  const payloads = await Promise.all(IDS.map((metricId) => loadThematicHdiData({ metricId, fetchJson })));
  assert.deepEqual(paths, [
    "data/thematic_layers/social/human_development_v1/manifest.json",
    "data/thematic_layers/social/human_development_v1/metrics.admin0.json",
  ]);
  assert.equal(new Set(payloads).size, 5);
  for (const [index, payload] of payloads.entries()) {
    const observation = payload.byIsoA3.AAA;
    assert.equal(payload.layerId, THEMATIC_HDI_LAYER_ID);
    assert.equal(payload.dataVersion, THEMATIC_HDI_DATA_VERSION);
    assert.equal(payload.year, 2023);
    assert.equal(observation.value, RAW[index]);
    assert.equal(observation.normalizedValue, NORMALIZED[index]);
    assert.equal(observation.metricId, IDS[index]);
    assert.equal(observation.unit, THEMATIC_HDI_METRICS[index].unit);
    assert.equal(observation.name, "Synthetic observed country");
    assert.equal(observation.joinKey, "AAA");
    assert.equal(observation.year, 2023);
    assert.equal(observation.status, "value");
    assert.equal(payload.byIsoA3.BBB.status, "missing");
    assert.equal(payload.byIsoA3.BBB.value, null);
    assert.equal(payload.byIsoA3.BBB.normalizedValue, null);
    assert.equal(payload.byIsoA3.ZZZ, undefined);
    assert.deepEqual(payload.counts, { features: 2, values: 1, missing: 1 });
    for (const value of [payload, payload.byIsoA3, payload.supportedScenarios, payload.counts, observation]) {
      assert.ok(Object.isFrozen(value));
    }
    for (const scenarioId of SCENARIOS) {
      assert.strictEqual(await loadThematicHdiData({ metricId: IDS[index], scenarioId, fetchJson }), payload);
    }
  }
  assert.equal(paths.length, 2);
  assert.strictEqual(await loadThematicHdiData({ fetchJson }), payloads[0]);
  assert.ok(Object.isFrozen(payloads[0].byIsoA3.AAA.uncertainty.interval));
  assert.notStrictEqual(payloads[0].byIsoA3.AAA.uncertainty, data.metrics.features[0].values.undp_hdi.uncertainty);
  assert.equal(Object.isFrozen(data.metrics.features[0].values.undp_hdi), false);
  data.metrics.features[0].values.undp_hdi.raw_value = 0.2;
  assert.equal(payloads[0].byIsoA3.AAA.value, 0.85, "source mutation cannot change the cached snapshot");
});

test("raw endpoints remain observed and clamped normalization does not replace raw values", async () => {
  const cases = [
    ["undp_hdi", 0, 0], ["undp_hdi", 1, 100],
    ["undp_life_expectancy", 0, 0], ["undp_life_expectancy", 20, 0], ["undp_life_expectancy", 100, 100],
    ["undp_expected_schooling", 0, 0], ["undp_expected_schooling", 30, 100],
    ["undp_mean_schooling", 0, 0], ["undp_mean_schooling", 20, 100],
    ["undp_gni_per_capita", 1, 0], ["undp_gni_per_capita", 100, 0], ["undp_gni_per_capita", 75000, 100],
  ];
  for (const [metricId, raw_value, normalized_value] of cases) {
    const data = fixture();
    Object.assign(data.metrics.features[0].values[metricId], { raw_value, normalized_value });
    const result = (await loadThematicHdiData({ metricId, fetchJson: fetcher(data) })).byIsoA3.AAA;
    assert.equal(result.value, raw_value);
    assert.equal(result.normalizedValue, normalized_value);
    assert.equal(result.status, "value");
  }
});

test("invalid raw types, ranges, normalization and gap statuses fail closed for each selected indicator", async () => {
  for (const metricId of IDS) {
    for (const raw_value of [-1, NaN, Infinity, "0.5", undefined, ...(metricId === "undp_hdi" ? [1.1] : []),
      ...(metricId === "undp_gni_per_capita" ? [0] : [])]) {
      const data = fixture();
      data.metrics.features[0].values[metricId].raw_value = raw_value;
      await assert.rejects(loadThematicHdiData({ metricId, fetchJson: fetcher(data) }), /raw value range/);
    }
    for (const mutate of [
      (metric) => { metric.normalized_value += 0.001; },
      (metric) => { metric.normalized_value = NaN; },
      (metric) => { metric.normalized_value = "85"; },
      (metric) => { metric.normalized_value = 101; },
      (metric) => { metric.normalized_value = null; },
      (metric) => { metric.year = 2024; },
      (metric) => { metric.unit = "score_0_100"; },
      (metric) => { metric.source_status = "source_gap"; },
    ]) {
      const data = fixture();
      mutate(data.metrics.features[0].values[metricId]);
      await assert.rejects(loadThematicHdiData({ metricId, fetchJson: fetcher(data) }), /Invalid HDI data/);
    }
    for (const mutate of [
      (metric) => { metric.source_status = "observed"; },
      (metric) => { metric.normalized_value = 0; },
    ]) {
      const data = fixture();
      mutate(data.metrics.features[1].values[metricId]);
      await assert.rejects(loadThematicHdiData({ metricId, fetchJson: fetcher(data) }), /Invalid HDI data/);
    }
  }
  const tolerant = fixture();
  tolerant.metrics.features[0].values.undp_hdi.normalized_value += 5e-9;
  assert.equal((await loadThematicHdiData({ fetchJson: fetcher(tolerant) })).byIsoA3.AAA.value, 0.85);
});

test("source identity, stale versions, fixtures and invalid consumer declarations are rejected", async () => {
  const mutations = [
    (data) => { data.manifest = null; },
    (data) => { data.manifest.layer_id = "other"; },
    (data) => { data.manifest.schema_version = 2; },
    (data) => { data.manifest.provenance = []; },
    (data) => { data.manifest.provenance = "undp_hdr_2025"; },
    (data) => { data.manifest.provenance[0].source_id = "synthetic_fixture"; },
    (data) => { data.manifest.provenance[0].version = "2024"; },
    (data) => { data.manifest.provenance[0].release = "Human Development Report 2024"; },
    (data) => { data.manifest.provenance[0].selected_year = 2022; },
    (data) => { data.manifest.period.year = 2022; },
    (data) => { data.manifest.status = "fixture"; },
    (data) => { delete data.manifest.source_policy; },
    (data) => { data.manifest.source_policy = "fixture_only"; },
    (data) => { data.manifest.runtime_consumer.data_version = "undp-hdr-2024:2022"; },
    (data) => { data.manifest.runtime_consumer.status = "catalog_only"; },
    (data) => { data.manifest.runtime_consumer.supports_main_map_render = "true"; },
    (data) => { data.manifest.runtime_consumer.supported_scenarios = []; },
    (data) => { data.manifest.runtime_consumer.supported_scenarios = ["tno_1962"]; },
    (data) => { data.manifest.runtime_consumer.supported_scenarios = ["modern_world", "blank_base"]; },
    (data) => { data.manifest.runtime_consumer.supported_scenarios = ["modern_world", "modern_world"]; },
    (data) => { data.manifest.runtime_consumer.supported_metrics = []; },
    (data) => { data.manifest.runtime_consumer.supported_metrics = ["undp_hdi", "undp_hdi"]; },
    (data) => { data.manifest.runtime_consumer.supported_metrics = ["fake_hdi"]; },
    (data) => { data.manifest.metric_ids = []; },
    (data) => { data.metrics = null; },
    (data) => { data.metrics.status = "fixture"; },
    (data) => { data.metrics.layer_id = "other"; },
    (data) => { data.metrics.geography_level = "admin1"; },
    (data) => { data.metrics.join_key_type = "feature_id"; },
    (data) => { data.metrics.metric_ids = []; },
    (data) => { data.metrics.features = []; },
    (data) => { data.metrics.features.push(data.metrics.features[0]); },
    (data) => { data.metrics.features[0].join_key = "aa"; },
    (data) => { delete data.metrics.features[0].values.undp_hdi; },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    await assert.rejects(loadThematicHdiData({ fetchJson: fetcher(data) }), /Invalid HDI data/);
  }
});

test("selected metric support is checked without consuming unrelated indicator rows", async () => {
  const data = fixture();
  data.manifest.runtime_consumer.supported_metrics = ["undp_life_expectancy"];
  for (const row of data.metrics.features) delete row.values.undp_hdi;
  const fetchJson = fetcher(data);
  const payload = await loadThematicHdiData({ metricId: "undp_life_expectancy", fetchJson });
  assert.equal(payload.byIsoA3.AAA.value, 78.5);
  await assert.rejects(loadThematicHdiData({ fetchJson }), /runtime metric support/);
});

test("same-fetcher network and validation failures allow a fresh successful retry", async () => {
  for (const failure of ["network", "validation"]) {
    let invalid = true;
    let calls = 0;
    const fetchJson = async (path) => {
      calls += 1;
      if (invalid && failure === "network") throw new Error("offline");
      const data = fixture();
      if (invalid) data.metrics.features[0].values.undp_hdi.normalized_value = 0;
      return path.endsWith("manifest.json") ? data.manifest : data.metrics;
    };
    await assert.rejects(loadThematicHdiData({ fetchJson }), failure === "network" ? /offline/ : /normalization/);
    invalid = false;
    const [a, b] = await Promise.all([loadThematicHdiData({ fetchJson }), loadThematicHdiData({ fetchJson })]);
    assert.strictEqual(a, b);
    assert.equal(a.byIsoA3.AAA.value, 0.85);
    assert.equal(calls, 4);
    assert.strictEqual(await loadThematicHdiData({ fetchJson }), a);
    assert.equal(calls, 4);
  }
});

test("unadvertised historical scenarios fail closed and evict documents for corrected retry", async () => {
  let data = fixture();
  data.manifest.runtime_consumer.supported_scenarios = ["modern_world"];
  let calls = 0;
  const fetchJson = async (path) => {
    calls += 1;
    return path.endsWith("manifest.json") ? data.manifest : data.metrics;
  };
  await loadThematicHdiData({ fetchJson });
  await assert.rejects(loadThematicHdiData({ scenarioId: "hoi4_1939", fetchJson }), /not advertised/);
  data = fixture();
  const payload = await loadThematicHdiData({ scenarioId: "hoi4_1939", fetchJson });
  assert.deepEqual(payload.supportedScenarios, SCENARIOS);
  assert.equal(calls, 4);
});

const manifestPath = new URL("../data/thematic_layers/social/human_development_v1/manifest.json", import.meta.url);
const metricsPath = new URL("../data/thematic_layers/social/human_development_v1/metrics.admin0.json", import.meta.url);
test("checked-in UNDP package preserves every official raw value and source gap for all five indicators", {
  skip: !existsSync(manifestPath) || !existsSync(metricsPath),
}, async () => {
  const data = {
    manifest: JSON.parse(await readFile(manifestPath)), metrics: JSON.parse(await readFile(metricsPath)),
  };
  const fetchJson = fetcher(data);
  for (const metricId of IDS) {
    const payload = await loadThematicHdiData({ metricId, fetchJson });
    for (const row of data.metrics.features) {
      const result = payload.byIsoA3[row.join_key];
      const source = row.values[metricId];
      assert.equal(result.value, source.raw_value, `${metricId}/${row.join_key}`);
      assert.equal(result.normalizedValue, source.normalized_value);
      assert.equal(result.status, source.raw_value === null ? "missing" : "value");
    }
    assert.ok(payload.counts.values > 100, `${metricId} has broad source coverage`);
  }
});

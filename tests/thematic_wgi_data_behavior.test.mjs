import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  THEMATIC_WGI_DATA_VERSION,
  THEMATIC_WGI_LAYER_ID,
  THEMATIC_WGI_METRIC_ID,
  THEMATIC_WGI_METRICS,
  THEMATIC_WGI_SCENARIO_IDS,
  isThematicWgiMetricSupported,
  getThematicWgiObservation,
  loadThematicWgiData,
  resolveThematicWgiJoinKey,
} from "../js/core/thematic_wgi_data.js";

const dataRoot = new URL("../data/thematic_layers/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("political/wgi_state_capacity_v1/manifest.json", dataRoot)));
const metrics = JSON.parse(await readFile(new URL("political/wgi_state_capacity_v1/metrics.admin0.json", dataRoot)));
const mapping = JSON.parse(await readFile(new URL("wgi_country_code_mapping.json", dataRoot)));
const ruleOfLawId = "wgi_rule_of_law_score_0_100";

function supportedManifest() {
  const result = structuredClone(manifest);
  result.runtime_consumer.supported_metrics = THEMATIC_WGI_METRICS.map((metric) => metric.id);
  return result;
}

function fixtureFetcher(manifestPayload = manifest, metricsPayload = metrics) {
  return async (path) => path.endsWith("manifest.json") ? manifestPayload : metricsPayload;
}

function fixtureMetrics() {
  const result = structuredClone(metrics);
  result.features = result.features.slice(0, 1);
  return result;
}

test("historical requests share official payloads only when the manifest advertises that scenario", async () => {
  let manifestPayload = supportedManifest();
  manifestPayload.runtime_consumer.supported_scenarios = ["modern_world"];
  let fetches = 0;
  const fetchJson = async (path) => {
    fetches += 1;
    return path.endsWith("manifest.json") ? manifestPayload : metrics;
  };
  await loadThematicWgiData({ fetchJson });
  await assert.rejects(loadThematicWgiData({ fetchJson, scenarioId: "hoi4_1939" }), /not advertised/);
  manifestPayload = structuredClone(manifestPayload);
  manifestPayload.runtime_consumer.supported_scenarios = [...THEMATIC_WGI_SCENARIO_IDS];
  const historical = await loadThematicWgiData({ fetchJson, scenarioId: "hoi4_1939" });
  assert.ok(Object.isFrozen(historical.supportedScenarios));
  for (const scenarioId of THEMATIC_WGI_SCENARIO_IDS) {
    assert.strictEqual(await loadThematicWgiData({ fetchJson, scenarioId }), historical);
  }
  assert.equal(fetches, 4, "one initial pair and one retry pair, no per-scenario downloads");
  for (const scenarioId of ["blank_base", "hgo_1936", "unknown"]) {
    await assert.rejects(loadThematicWgiData({ scenarioId, fetchJson: () => assert.fail("must not fetch") }), /Unsupported WGI scenario/);
  }
});

test("WGI loader defaults to pinned Government Effectiveness and deeply freezes observations", async () => {
  const payload = await loadThematicWgiData({ fetchJson: fixtureFetcher() });
  assert.equal(payload.layerId, THEMATIC_WGI_LAYER_ID);
  assert.equal(payload.metricId, THEMATIC_WGI_METRIC_ID);
  assert.equal(payload.dataVersion, THEMATIC_WGI_DATA_VERSION);
  assert.equal(payload.year, 2024);
  assert.deepEqual(payload.range, [0, 100]);
  assert.deepEqual(payload.counts, { features: 215, values: 213, missing: 2 });
  const usa = getThematicWgiObservation(payload, "USA");
  const sourceUsa = metrics.features.find((row) => row.join_key === "USA").values[THEMATIC_WGI_METRIC_ID];
  assert.equal(usa.status, "value");
  assert.equal(usa.value, sourceUsa.normalized_value);
  assert.deepEqual(usa.uncertainty, sourceUsa.uncertainty);
  assert.notEqual(usa.uncertainty, sourceUsa.uncertainty);
  for (const value of [payload, payload.byIsoA3, payload.range, payload.counts, usa, usa.uncertainty, usa.uncertainty.score_confidence_interval_90]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.hasOwn(usa, "wgi_state_capacity_composite_0_100"), false);
  assert.equal(Object.isFrozen(sourceUsa.uncertainty), false);
});

test("supported descriptors expose six official dimensions while rejecting composites before fetching", async () => {
  assert.deepEqual(THEMATIC_WGI_METRICS, [
    { id: THEMATIC_WGI_METRIC_ID, labelEn: "Government effectiveness", labelZh: "政府效能" },
    { id: ruleOfLawId, labelEn: "Rule of law", labelZh: "法治" },
    { id: "wgi_voice_and_accountability_score_0_100", labelEn: "Voice and accountability", labelZh: "发声与问责" },
    { id: "wgi_political_stability_score_0_100", labelEn: "Political stability and absence of violence", labelZh: "政治稳定与免于暴力" },
    { id: "wgi_regulatory_quality_score_0_100", labelEn: "Regulatory quality", labelZh: "监管质量" },
    { id: "wgi_control_of_corruption_score_0_100", labelEn: "Control of corruption", labelZh: "腐败控制" },
  ]);
  assert.equal(Object.isFrozen(THEMATIC_WGI_METRICS), true);
  for (const metric of THEMATIC_WGI_METRICS) {
    assert.equal(Object.isFrozen(metric), true);
    assert.equal(isThematicWgiMetricSupported(metric.id), true);
  }
  for (const metricId of ["unknown", "wgi_state_capacity_composite_0_100"]) {
    assert.equal(isThematicWgiMetricSupported(metricId), false);
    await assert.rejects(loadThematicWgiData({ metricId, fetchJson: () => assert.fail("must not fetch") }), /Unsupported WGI metric/);
  }
});

test("all six metrics share pinned source documents and preserve every official score, gap and uncertainty", async () => {
  let calls = 0;
  const fetchJson = async (path) => {
    calls += 1;
    return path.endsWith("manifest.json") ? manifest : metrics;
  };
  const payloads = await Promise.all(THEMATIC_WGI_METRICS.map(({ id: metricId }) =>
    loadThematicWgiData({ fetchJson, metricId })));
  assert.equal(calls, 2, "switching dimensions reuses the manifest and metric documents");
  assert.equal(new Set(payloads).size, 6);
  for (const payload of payloads) {
    let observed = 0;
    for (const row of metrics.features) {
      const source = row.values[payload.metricId];
      const result = getThematicWgiObservation(payload, row.join_key);
      assert.equal(result.value, source.raw_value, `${payload.metricId}/${row.join_key}`);
      assert.equal(result.status, source.raw_value === null ? "missing" : "value");
      assert.deepEqual(result.uncertainty, source.uncertainty ?? null);
      assert.ok(Object.isFrozen(result));
      if (source.raw_value !== null) observed += 1;
    }
    assert.ok(observed > 200, `${payload.metricId} has broad official coverage`);
    assert.deepEqual(payload.counts, {
      features: metrics.features.length, values: observed, missing: metrics.features.length - observed,
    });
    assert.strictEqual(await loadThematicWgiData({ fetchJson, metricId: payload.metricId }), payload);
  }
  assert.equal(calls, 2);
});

test("metric switches and concurrent loads share documents but preserve distinct immutable official payloads", async () => {
  let calls = 0;
  const fetchJson = async (path) => {
    calls += 1;
    return path.endsWith("manifest.json") ? supportedManifest() : metrics;
  };
  const [ge, rl, sameRl] = await Promise.all([
    loadThematicWgiData({ fetchJson }),
    loadThematicWgiData({ fetchJson, metricId: ruleOfLawId }),
    loadThematicWgiData({ fetchJson, metricId: ruleOfLawId }),
  ]);
  assert.equal(calls, 2);
  assert.equal(rl, sameRl);
  assert.notEqual(ge, rl);
  assert.equal(rl.metricId, ruleOfLawId);
  assert.equal(rl.dataVersion, ge.dataVersion);
  assert.equal(rl.year, 2024);
  const source = metrics.features.find((row) => row.join_key === "USA").values[ruleOfLawId];
  const observation = getThematicWgiObservation(rl, "USA");
  assert.equal(observation.value, source.raw_value);
  assert.deepEqual(observation.uncertainty, source.uncertainty);
  for (const value of [rl, rl.byIsoA3, observation, observation.uncertainty, observation.uncertainty.score_confidence_interval_90]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(await loadThematicWgiData({ fetchJson }), ge);
  assert.equal(await loadThematicWgiData({ fetchJson, metricId: ruleOfLawId }), rl);
  assert.equal(calls, 2);
});

test("Rule of Law validates selected rows and advertised runtime support independently of GE", async () => {
  const unadvertised = supportedManifest();
  unadvertised.runtime_consumer.supported_metrics = [THEMATIC_WGI_METRIC_ID];
  await assert.rejects(loadThematicWgiData({ metricId: ruleOfLawId, fetchJson: fixtureFetcher(unadvertised) }), /runtime metric support/);
  const absentMetric = structuredClone(metrics);
  absentMetric.metric_ids = [THEMATIC_WGI_METRIC_ID];
  await assert.rejects(loadThematicWgiData({ metricId: ruleOfLawId, fetchJson: fixtureFetcher(supportedManifest(), absentMetric) }), /official metric/);
  const absentManifestMetric = supportedManifest();
  absentManifestMetric.metric_ids = [THEMATIC_WGI_METRIC_ID];
  await assert.rejects(loadThematicWgiData({ metricId: ruleOfLawId, fetchJson: fixtureFetcher(absentManifestMetric) }), /runtime metric support/);
  for (const mutate of [
    (metric) => { metric.year = 2023; },
    (metric) => { metric.unit = "percentile"; },
    (metric) => { metric.raw_value = 1; },
    (metric) => { metric.normalized_value = 101; },
    (metric) => { metric.source_status = "source_gap"; },
  ]) {
    const data = fixtureMetrics();
    mutate(data.features[0].values[ruleOfLawId]);
    await assert.rejects(loadThematicWgiData({ metricId: ruleOfLawId, fetchJson: fixtureFetcher(supportedManifest(), data) }), /Invalid WGI data/);
  }
  const validRl = fixtureMetrics();
  delete validRl.features[0].values[THEMATIC_WGI_METRIC_ID];
  const rl = await loadThematicWgiData({ metricId: ruleOfLawId, fetchJson: fixtureFetcher(supportedManifest(), validRl) });
  assert.equal(rl.counts.values, 1, "only selected official rows are consumed");
});

test("direct loading rejects fixtures, disabled runtime and unsupported declarations while accepting older GE-only support", async () => {
  const mutations = [
    (value) => { value.status = "fixture"; },
    (value) => { value.source_policy = "fixture_only"; },
    (value) => { delete value.source_policy; },
    (value) => { value.runtime_consumer.status = "catalog_only"; },
    (value) => { value.runtime_consumer.supports_main_map_render = false; },
    (value) => { value.runtime_consumer.supports_main_map_render = "true"; },
    (value) => { value.runtime_consumer.supported_scenarios = []; },
    (value) => { value.runtime_consumer.supported_scenarios = ["modern_world", "blank_base"]; },
    (value) => { value.runtime_consumer.supported_scenarios = ["modern_world", "modern_world"]; },
    (value) => { value.runtime_consumer.supported_scenarios = ["tno_1962"]; },
    (value) => { value.runtime_consumer.supported_scenarios = "modern_world"; },
    (value) => { value.runtime_consumer.supported_metrics = []; },
    (value) => { value.runtime_consumer.supported_metrics = [THEMATIC_WGI_METRIC_ID, THEMATIC_WGI_METRIC_ID]; },
    (value) => { value.runtime_consumer.supported_metrics = [THEMATIC_WGI_METRIC_ID, "wgi_state_capacity_composite_0_100"]; },
    (value) => { value.runtime_consumer.supported_metrics = [THEMATIC_WGI_METRIC_ID, "unknown"]; },
    (value) => { value.runtime_consumer.supported_metrics = THEMATIC_WGI_METRIC_ID; },
    (value) => { value.metric_ids = [THEMATIC_WGI_METRIC_ID]; },
    (value) => { value.metric_ids = THEMATIC_WGI_METRIC_ID; },
  ];
  for (const mutate of mutations) {
    const invalid = supportedManifest();
    mutate(invalid);
    await assert.rejects(loadThematicWgiData({ fetchJson: fixtureFetcher(invalid) }), /Invalid WGI data/);
  }
  const olderManifest = supportedManifest();
  olderManifest.runtime_consumer.supported_metrics = [THEMATIC_WGI_METRIC_ID];
  const fetchJson = fixtureFetcher(olderManifest);
  assert.equal((await loadThematicWgiData({ fetchJson })).metricId, THEMATIC_WGI_METRIC_ID);
  await assert.rejects(loadThematicWgiData({ fetchJson, metricId: ruleOfLawId }), /runtime metric support/);
});

test("Rule of Law keeps zero, 100, source gaps and unmatched geographies distinct", async () => {
  const data = structuredClone(metrics);
  data.features = data.features.slice(0, 3);
  for (const [index, value] of [0, 100, null].entries()) {
    Object.assign(data.features[index].values[ruleOfLawId], {
      raw_value: value, normalized_value: value, source_status: value === null ? "source_gap" : "observed",
    });
  }
  const payload = await loadThematicWgiData({ metricId: ruleOfLawId, fetchJson: fixtureFetcher(supportedManifest(), data) });
  assert.deepEqual(payload.counts, { features: 3, values: 2, missing: 1 });
  assert.equal(getThematicWgiObservation(payload, data.features[0].join_key).value, 0);
  assert.equal(getThematicWgiObservation(payload, data.features[1].join_key).value, 100);
  assert.equal(getThematicWgiObservation(payload, data.features[2].join_key).status, "missing");
  assert.equal(getThematicWgiObservation(payload, "ZZZ").status, "unmatched");
});

test("failed metric validation evicts stale documents so a corrected response can recover on retry", async () => {
  let calls = 0;
  let responseMetrics = fixtureMetrics();
  responseMetrics.features[0].values[ruleOfLawId].year = 2023;
  const fetchJson = async (path) => {
    calls += 1;
    return path.endsWith("manifest.json") ? supportedManifest() : responseMetrics;
  };
  await assert.rejects(loadThematicWgiData({ fetchJson, metricId: ruleOfLawId }), /metric year or unit/);
  assert.equal(calls, 2);
  responseMetrics = metrics;
  const rl = await loadThematicWgiData({ fetchJson, metricId: ruleOfLawId });
  assert.equal(calls, 4, "retry fetches a fresh manifest and metrics package");
  assert.equal(rl.metricId, ruleOfLawId);
  assert.equal(rl.byIsoA3.USA.value, metrics.features.find((row) => row.join_key === "USA").values[ruleOfLawId].normalized_value);
  const ge = await loadThematicWgiData({ fetchJson });
  assert.equal(ge.metricId, THEMATIC_WGI_METRIC_ID);
  assert.equal(await loadThematicWgiData({ fetchJson, metricId: ruleOfLawId }), rl);
  assert.equal(await loadThematicWgiData({ fetchJson }), ge);
  assert.equal(calls, 4, "successful metric switches continue sharing the recovered package");
});

test("zero remains a value; source null and unmapped geography are distinct", async () => {
  const data = fixtureMetrics();
  const row = data.features[0];
  row.values[THEMATIC_WGI_METRIC_ID].raw_value = 0;
  row.values[THEMATIC_WGI_METRIC_ID].normalized_value = 0;
  const payload = await loadThematicWgiData({ fetchJson: fixtureFetcher(manifest, data) });
  assert.equal(getThematicWgiObservation(payload, row.join_key).status, "value");
  assert.equal(getThematicWgiObservation(payload, row.join_key).value, 0);
  const realPayload = await loadThematicWgiData({ fetchJson: fixtureFetcher() });
  assert.equal(getThematicWgiObservation(realPayload, "NCL").status, "missing");
  assert.equal(getThematicWgiObservation(realPayload, "PYF").value, null);
  assert.deepEqual(getThematicWgiObservation(realPayload, "ZZZ"), {
    status: "unmatched", value: null, joinKey: "ZZZ", uncertainty: null,
  });
  assert.equal(getThematicWgiObservation(realPayload, "").status, "unmatched");
});

test("lazy requests share success and permit retry after failure", async () => {
  let calls = 0;
  let fail = true;
  const fetchJson = async (path) => {
    calls += 1;
    if (fail) throw new Error("offline");
    return path.endsWith("manifest.json") ? manifest : metrics;
  };
  assert.equal(calls, 0);
  await assert.rejects(loadThematicWgiData({ fetchJson }), /offline/);
  fail = false;
  const [a, b] = await Promise.all([loadThematicWgiData({ fetchJson }), loadThematicWgiData({ fetchJson })]);
  assert.equal(calls, 4);
  assert.equal(a, b);
  assert.equal(await loadThematicWgiData({ fetchJson }), a);
  assert.equal(calls, 4);
});

test("loader rejects release drift, invalid score ranges, coercion, and inconsistent official rows", async () => {
  const wrongManifest = structuredClone(manifest);
  wrongManifest.provenance[0].version = "8";
  await assert.rejects(loadThematicWgiData({ fetchJson: fixtureFetcher(wrongManifest) }), /release version/);
  const wrongRuntimeVersion = structuredClone(manifest);
  wrongRuntimeVersion.runtime_consumer.data_version = "wgi-2025-revision-v8:2024";
  await assert.rejects(loadThematicWgiData({ fetchJson: fixtureFetcher(wrongRuntimeVersion) }), /runtime data version/);
  for (const value of [-1, 101, NaN, Infinity, "50", undefined]) {
    const data = fixtureMetrics();
    const metric = data.features[0].values[THEMATIC_WGI_METRIC_ID];
    metric.raw_value = value;
    metric.normalized_value = value;
    await assert.rejects(loadThematicWgiData({ fetchJson: fixtureFetcher(manifest, data) }), /score range/);
  }
  for (const mutate of [
    (data) => { data.features[0].values[THEMATIC_WGI_METRIC_ID].year = 2023; },
    (data) => { data.features[0].values[THEMATIC_WGI_METRIC_ID].raw_value = 1; },
    (data) => { data.features.push(data.features[0]); },
    (data) => { delete data.features[0].values[THEMATIC_WGI_METRIC_ID]; },
  ]) {
    const data = fixtureMetrics();
    mutate(data);
    await assert.rejects(loadThematicWgiData({ fetchJson: fixtureFetcher(manifest, data) }), /Invalid WGI data/);
  }
});

test("join prefers explicit ISO_A3 then explicit geographic alpha2 without scenario or feature-id inference", () => {
  assert.equal(resolveThematicWgiJoinKey({ properties: { ISO_A3: " usa " } }, "FR"), "USA");
  assert.equal(resolveThematicWgiJoinKey({ properties: { ISO_A3: "-99", iso_a3: "fra" } }, "US"), "FRA");
  assert.equal(resolveThematicWgiJoinKey({ properties: { ISO_A3: "-99", cntr_code: "US" } }), "USA");
  assert.equal(resolveThematicWgiJoinKey({ properties: { cntr_code: "FR" } }, "US"), "USA");
  assert.equal(resolveThematicWgiJoinKey({}, "UK"), "GBR");
  assert.equal(resolveThematicWgiJoinKey({}, "EL"), "GRC");
  assert.equal(resolveThematicWgiJoinKey({}, "XK"), "XKX");
  assert.equal(resolveThematicWgiJoinKey({ id: "US-123", properties: { owner: "US", group: "USA", ADM0_A3: "USA", SOV_A3: "USA" } }), "");
  assert.equal(resolveThematicWgiJoinKey({}, "USA"), "");
  assert.equal(resolveThematicWgiJoinKey({}, "ZZ"), "");
});

test("explicit geographic mapping covers all 215 checked-in WGI join keys", () => {
  const mappingTargets = new Set(Object.values(mapping.by_iso_a2));
  assert.equal(Object.keys(mapping.by_iso_a2).length, 240);
  for (const row of metrics.features) assert.equal(mappingTargets.has(row.join_key), true, row.join_key);
  for (const [iso2, iso3] of Object.entries(mapping.by_iso_a2)) {
    assert.equal(resolveThematicWgiJoinKey({}, iso2), iso3);
  }
});

test("real modern-world geometry uses geographic origin and reports coverage without fabricating values", async (t) => {
  const topology = JSON.parse(await readFile(new URL("../data/scenarios/modern_world/runtime_topology.topo.json", import.meta.url)));
  const payload = await loadThematicWgiData({ fetchJson: fixtureFetcher() });
  const counts = { value: 0, missing: 0, unmatched: 0 };
  const countries = new Set();
  for (const feature of topology.objects.political.geometries) {
    const key = resolveThematicWgiJoinKey(feature);
    const observation = getThematicWgiObservation(payload, key);
    counts[observation.status] += 1;
    if (key) countries.add(key);
    if (observation.status !== "value") assert.equal(observation.value, null);
  }
  assert.equal(counts.value + counts.missing + counts.unmatched, 22948);
  assert.ok(counts.value > 22000);
  assert.equal(counts.missing, 0);
  assert.ok(counts.unmatched > 0);
  t.diagnostic(`Modern-world features: ${JSON.stringify(counts)}; explicit geographic countries: ${countries.size}`);
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { THEMATIC_HDI_DATA_VERSION, THEMATIC_HDI_LAYER_ID, THEMATIC_HDI_METRICS, loadThematicHdiData } from "../js/core/thematic/thematic_hdi_data.js";

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

test("source gaps have no raw or normalized value", async () => {
  const payload = await loadThematicHdiData({ fetchJson: fetcher() });
  assert.equal(payload.byIsoA3.BBB.status, "missing");
  assert.equal(payload.byIsoA3.BBB.value, null);
  assert.equal(payload.byIsoA3.BBB.normalizedValue, null);
});

test("a different data layer identity is rejected", async () => {
  const data = fixture();
  data.metrics.layer_id = "other";
  await assert.rejects(loadThematicHdiData({ fetchJson: fetcher(data) }), /Invalid HDI data/);
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

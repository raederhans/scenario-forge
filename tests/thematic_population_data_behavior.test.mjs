import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  THEMATIC_POPULATION_DATA_VERSION,
  THEMATIC_POPULATION_LAYER_ID,
  THEMATIC_POPULATION_METRICS,
  loadThematicPopulationData,
} from "../js/core/thematic/thematic_population_data.js";

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

test("zero population remains observed and source gaps remain missing", async () => {
  const metricId = "wdi_population_total";
  const data = fixture();
  Object.assign(data.metrics.features[0].values[metricId], { raw_value: 0, normalized_value: 0 });
  const payload = await loadThematicPopulationData({ metricId, fetchJson: fetcher(data) });
  assert.equal(payload.byIsoA3.AAA.value, 0);
  assert.equal(payload.byIsoA3.AAA.status, "value");
  assert.equal(payload.byIsoA3.BBB.status, "missing");
  assert.equal(payload.byIsoA3.BBB.value, null);
});

test("invalid population raw value is rejected", async () => {
  const metricId = "wdi_population_total";
  const data = fixture();
  data.metrics.features[0].values[metricId].raw_value = -1;
  await assert.rejects(loadThematicPopulationData({ metricId, fetchJson: fetcher(data) }), /raw value range/);
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
      assert.equal(result.status, source.raw_value === null ? "missing" : "value");
    }
  }
});

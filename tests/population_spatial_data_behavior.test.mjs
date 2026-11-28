import test from "node:test";
import assert from "node:assert/strict";

import { loadPopulationData, POPULATION_LAYER_ID, POPULATION_DATA_VERSION, POPULATION_SCENARIO_IDS, normalizePopulationTile, samplePopulationDensityLonLat } from "../js/core/thematic/population_spatial_data.js";

const geometry = "a".repeat(64);
function fixture() {
  const manifest = { schema_version: 1, layer_id: POPULATION_LAYER_ID, data_version: POPULATION_DATA_VERSION,
    source_policy: "real_source_cache_only", coverage_status: "complete", period: { year: 2020 },
    source: { dataset: "GHS_POP", product: "GHS_POP_E2020_GLOBE_R2023A_54009_1000_V1_0", release: "R2023A", epoch: 2020, resolution_m: 1000, unit: "persons" },
    provenance: { land_area_method: "full_political_polygon_minus_natural_earth_lakes_in_equal_area_mollweide",
      partition_method: "equal_share_by_exact_overlap_multiplicity" },
    runtime_consumer: { status: "main_map_ready", supports_main_map_render: true, data_version: POPULATION_DATA_VERSION, supported_scenarios: [...POPULATION_SCENARIO_IDS] },
    scenarios: Object.fromEntries(POPULATION_SCENARIO_IDS.map((id) => [id, { features_url: `${id}.json`, geometry_version: geometry, feature_count: 2, core_feature_count: 2, extra_feature_count: 0 }])) };
  const document = { schema_version: 1, layer_id: POPULATION_LAYER_ID, data_version: POPULATION_DATA_VERSION,
    source_epoch: 2020, scenario_id: "modern_world", geometry_version: geometry, feature_count: 2,
    features: {
      A: { population: 0, land_area_km2: 2, density: 0, coverage_fraction: 1, status: "ok", source_epoch: 2020 },
      B: { population: null, land_area_km2: 3, density: null, coverage_fraction: 0, status: "no_data", source_epoch: 2020 },
    } };
  return { manifest, document };
}
const fetcher = ({ manifest, document }) => async (url) => url.endsWith("manifest.json") ? manifest : document;

test("population loader caches immutable feature rows with zero separate from missing", async () => {
  const source = fixture();
  let calls = 0;
  const fetchJson = async (url) => { calls += 1; return fetcher(source)(url); };
  const [one, two] = await Promise.all([loadPopulationData({ fetchJson }), loadPopulationData({ fetchJson })]);
  assert.equal(one, two);
  assert.equal(calls, 2);
  assert.equal(one.byFeatureId.A.population, 0);
  assert.equal(one.sourceResolution, 1000);
  assert.equal(one.areaMethod, source.manifest.provenance.land_area_method);
  assert.equal(one.partitionMethod, source.manifest.provenance.partition_method);
  assert.equal(one.byFeatureId.B.population, null);
  assert.deepEqual(one.counts, { features: 2, observed: 1, partial: 0, missing: 1, unestimated: 0, water: 0 });
  assert.ok(Object.isFrozen(one.byFeatureId.A));
  assert.ok(Object.isFrozen(one.byFeatureId));
  source.document.features.A.population = 44;
  assert.equal(one.byFeatureId.A.population, 0);
});

function tile() { return { schema_version: 1, layer_id: POPULATION_LAYER_ID, data_version: POPULATION_DATA_VERSION, source_epoch: 2020,
  crs: "ESRI:54009", bounds: [-1000, -1000, 1000, 1000], width: 2, height: 2, cell_size_m: 1000,
  cells: [[0, 0, 1], [1, 20, 0.5]] }; }

test("heatmap samples count/valid area and treats omitted sparse cells as unknown", () => {
  const overview = normalizePopulationTile(tile());
  const snapshot = { status: "ready", overview, detail: [] };
  assert.equal(samplePopulationDensityLonLat(snapshot, -0.001, 0.001).density, 0);
  assert.equal(samplePopulationDensityLonLat(snapshot, 0.001, 0.001).density, 40);
  assert.equal(samplePopulationDensityLonLat(snapshot, 0.001, -0.001).density, null);
  assert.equal(samplePopulationDensityLonLat({ ...snapshot, status: "loading" }, -0.001, 0.001).status, "no_data");
  const bad = tile(); bad.cells.push([0, 1, 1]);
  assert.throws(() => normalizePopulationTile(bad), /count\/covered-area/);
  assert.throws(() => normalizePopulationTile({ ...tile(), layer_id: "other_layer" }), /tile identity/);
  assert.ok(Object.isFrozen(overview.cells[0]));
});

test("covered detail no-data stays unknown while an unloaded detail region uses overview", () => {
  const overview = normalizePopulationTile(tile());
  const empty = tile(); empty.cells = [];
  const snapshot = { status: "ready", overview, detail: [normalizePopulationTile(empty)] };
  assert.equal(samplePopulationDensityLonLat(snapshot, -0.001, 0.001, { lod: "detail" }).density, null);
  assert.equal(samplePopulationDensityLonLat({ ...snapshot, detail: [] }, -0.001, 0.001, { lod: "detail" }).density, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { loadPopulationData, POPULATION_LAYER_ID, POPULATION_DATA_VERSION,
  POPULATION_SCENARIO_IDS, normalizePopulationTile, samplePopulationDensityLonLat,
  loadPopulationRasterTile, loadPopulationRasterTiles, lonLatToPopulationGrid } from "../js/core/population_spatial_data.js";

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

test("population admits only pinned source, full source coverage and full feature membership", async () => {
  for (const mutate of [
    ({ manifest }) => { manifest.coverage_status = "partial"; },
    ({ manifest }) => { manifest.source.epoch = 2015; },
    ({ manifest }) => { manifest.source.resolution_m = 100; },
    ({ manifest }) => { manifest.runtime_consumer.status = "source_pending"; },
    ({ manifest }) => { manifest.runtime_consumer.supported_scenarios.pop(); },
    ({ document }) => { document.source_epoch = 2025; },
    ({ document }) => { document.geometry_version = "b".repeat(64); },
    ({ document }) => { delete document.features.B; },
    ({ document }) => { document.features.A.density = 100; },
    ({ document }) => { document.features.B.population = 0; },
    ({ document }) => { document.features.A.population = "0"; },
    ({ document }) => { document.features.A.coverage_fraction = 0; },
  ]) {
    const source = fixture(); mutate(source);
    await assert.rejects(loadPopulationData({ fetchJson: fetcher(source) }), /Invalid population data/);
  }
  await assert.rejects(loadPopulationData({ fetchJson: fetcher(fixture()), geometryVersion: "b".repeat(64) }), /geometry version/);
});

test("failed validation evicts documents and permits a fresh corrected response", async () => {
  const source = fixture(); source.manifest.coverage_status = "partial";
  let calls = 0;
  const fetchJson = async (url) => { calls += 1; return fetcher(source)(url); };
  await assert.rejects(loadPopulationData({ fetchJson }), /incomplete/);
  source.manifest.coverage_status = "complete";
  assert.equal((await loadPopulationData({ fetchJson })).byFeatureId.A.population, 0);
  assert.equal(calls, 3);
});

test("partial population retains known count with no full-density claim", async () => {
  const source = fixture();
  Object.assign(source.document.features.A, { status: "partial_coverage", population: 40, density: null, coverage_fraction: 0.5 });
  const payload = await loadPopulationData({ fetchJson: fetcher(source) });
  assert.equal(payload.byFeatureId.A.population, 40);
  assert.equal(payload.byFeatureId.A.density, null);
  assert.equal(payload.counts.partial, 1);
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

test("population grid projection matches pyproj ESRI:54009 WGS84 coordinates", () => {
  // Independently generated with pyproj Transformer EPSG:4326 -> ESRI:54009.
  for (const [lon, lat, expectedX, expectedY] of [
    [0, 0, 0, 0], [103.8, 1.3, 10401470.038683299, 160733.04229176464],
    [-73.98, 40.75, -6239330.638724673, 4873057.325796802],
    [10, 80, 326659.9581479899, 8527486.04177697],
  ]) {
    const [x, y] = lonLatToPopulationGrid(lon, lat);
    assert.ok(Math.abs(x - expectedX) < 0.001, `${lon},${lat} easting`);
    assert.ok(Math.abs(y - expectedY) < 0.001, `${lon},${lat} northing`);
  }
  // Near-pole Newton convergence requires more iterations than middle latitudes.
  const polar = lonLatToPopulationGrid(90, 89.9999);
  assert.ok(Math.abs(polar[0] - 1381.0010722437403) < 0.1);
  assert.ok(Math.abs(polar[1] - 9020047.742355583) < 0.1);
  assert.ok(lonLatToPopulationGrid(0, 89.9999999).every(Number.isFinite), "valid near-pole input cannot produce NaN coordinates");
});

test("failed raster requests can retry while successful requests share one tile", async () => {
  let fail = true, calls = 0;
  const fetchJson = async () => { calls += 1; if (fail) throw new Error("offline"); return tile(); };
  await assert.rejects(loadPopulationRasterTile("overview.json", { fetchJson }), /offline/);
  fail = false;
  const [a, b] = await Promise.all([loadPopulationRasterTile("overview.json", { fetchJson }), loadPopulationRasterTile("overview.json", { fetchJson })]);
  assert.equal(a, b); assert.equal(calls, 2);
});

test("raster default loads overview only; viewport detail selection remains bounded", async () => {
  const calls = [];
  const fetchJson = async (url) => { calls.push(url); return tile(); };
  const raster = { overview_url: "overview.json", detail_tiles: [
    { id: "one", url: "one.json" }, { id: "two", url: "two.json" },
  ] };
  const initial = await loadPopulationRasterTiles(raster, { fetchJson });
  assert.equal(initial.detail.length, 0); assert.equal(calls.length, 1);
  const refined = await loadPopulationRasterTiles(raster, { fetchJson, detailTileIds: ["two"] });
  assert.equal(refined.detail.length, 1); assert.equal(calls.length, 2);
  assert.match(calls[1], /two.json$/);
  await assert.rejects(loadPopulationRasterTiles(raster, { fetchJson, detailTileIds: ["unknown"] }), /unknown viewport/);
});

test("covered detail no-data stays unknown while an unloaded detail region uses overview", () => {
  const overview = normalizePopulationTile(tile());
  const empty = tile(); empty.cells = [];
  const snapshot = { status: "ready", overview, detail: [normalizePopulationTile(empty)] };
  assert.equal(samplePopulationDensityLonLat(snapshot, -0.001, 0.001, { lod: "detail" }).density, null);
  assert.equal(samplePopulationDensityLonLat({ ...snapshot, detail: [] }, -0.001, 0.001, { lod: "detail" }).density, 0);
});

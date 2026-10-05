import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { validateWaterGeometry } from "../tools/check_water_geometry.mjs";
import { readJsonSource } from "./helpers/read_json_source.mjs";
import {
  getFeatureId,
  getManifestChunksByLayer,
  readManifestChunkPayload,
  readRepoFile,
} from "./helpers/scenario_chunk_contract_support.mjs";

const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");
const d3 = require("../vendor/d3.v7.min.js");
const WAVE6_WATERS = JSON.parse(fs.readFileSync(new URL("./fixtures/ocean_wave6_probes.json", import.meta.url), "utf8"));
const WAVE7_WATERS = JSON.parse(fs.readFileSync(new URL("./fixtures/ocean_wave7_probes.json", import.meta.url), "utf8"));
const WAVE6_WATER_PROBES = WAVE6_WATERS.map(({ slug, point }) => ({
  id: `${slug}-interior`, point, expectedIds: [`marine_${slug}`], expectedCount: 1, expectedLand: false,
}));
const WAVE6_LAND_PROBES = WAVE6_WATERS.map(({ slug, land }) => ({
  id: `land-near-${slug}`, point: land, expectedCount: 0, expectedLand: true,
}));
const TNO_WAVE6_WATER_PROBES = WAVE6_WATER_PROBES.map((probe) => ({
  ...probe, expectedIds: probe.expectedIds.map((id) => id.replace("marine_", "tno_")),
}));
const WAVE7_WATER_PROBES = WAVE7_WATERS.map(({ slug, point }) => ({
  id: `${slug}-interior`, point, expectedIds: [`marine_${slug}`], expectedCount: 1, expectedLand: false,
}));
const WAVE7_LAND_PROBES = WAVE7_WATERS.map(({ slug, land }) => ({
  id: `land-near-${slug}`, point: land, expectedCount: 0, expectedLand: true,
}));
const TNO_WAVE7_WATER_PROBES = WAVE7_WATER_PROBES.map((probe) => ({
  ...probe, expectedIds: probe.expectedIds.map((id) => id.replace("marine_", "tno_")),
}));

function assertTnoMetadata(byId, waters, waveLabel) {
  for (const { slug, waterType, regionGroup, parentSlug, point } of waters) {
    const id = `tno_${slug}`;
    const entry = byId.get(id);
    assert.ok(entry, `${waveLabel} named water ${id} must reach the final TNO payload`);
    assert.equal(entry.properties.region_group, regionGroup, id);
    assert.equal(entry.properties.parent_id, parentSlug ? `tno_${parentSlug}` : "", id);
    assert.equal(entry.properties.water_type, waterType, id);
    const area = d3.geoArea(entry);
    assert.ok(Number.isFinite(area) && area > 0 && area < 2 * Math.PI, `${id} local spherical area`);
    if (parentSlug) {
      assert.equal(d3.geoContains(byId.get(`tno_${parentSlug}`), point), false, `parent must exclude ${id}`);
    }
  }
}
const assertWave6TnoMetadata = (byId) => assertTnoMetadata(byId, WAVE6_WATERS, "wave 6");
const assertWave7TnoMetadata = (byId) => assertTnoMetadata(byId, WAVE7_WATERS, "wave 7");

const feature = (id, coordinates, properties = {}) => ({
  type: "Feature",
  properties: { id, water_type: "ocean", region_group: "ocean_macro", ...properties },
  geometry: { type: "Polygon", coordinates: [coordinates] },
});
const collection = (...features) => ({ type: "FeatureCollection", features });

function densifiedRectangle(id, minLon, minLat, maxLon, maxLat, properties = {}, step = 1) {
  const ring = [];
  const append = (start, end) => {
    const span = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
    const count = Math.max(1, Math.ceil(span / step));
    for (let index = 0; index < count; index += 1) {
      const ratio = index / count;
      ring.push([start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]);
    }
  };
  const corners = [[minLon, minLat], [minLon, maxLat], [maxLon, maxLat], [maxLon, minLat], [minLon, minLat]];
  for (let index = 1; index < corners.length; index += 1) append(corners[index - 1], corners[index]);
  ring.push(corners[0]);
  return feature(id, ring, properties);
}

function errorCodes(result) {
  return new Set(result.errors.map((error) => error.code));
}

const WAVE4_WATER_PROBES = [
  { id: "white-sea-interior", point: [42.906271, 67.658248], expectedIds: ["marine_white_sea"], expectedCount: 1, expectedLand: false },
  { id: "iceland-sea-interior", point: [-11.23928, 67.57079], expectedIds: ["marine_iceland_sea"], expectedCount: 1, expectedLand: false },
  { id: "lincoln-sea-interior", point: [-52.277912, 82.786277], expectedIds: ["marine_lincoln_sea"], expectedCount: 1, expectedLand: false },
  { id: "gulf-of-mannar-interior", point: [78.873752, 8.098401], expectedIds: ["marine_gulf_of_mannar"], expectedCount: 1, expectedLand: false },
  { id: "palk-strait-and-bay-interior", point: [79.589502, 9.956368], expectedIds: ["marine_palk_strait_and_palk_bay"], expectedCount: 1, expectedLand: false },
  { id: "lakshadweep-sea-interior", point: [76.289919, 5.660971], expectedIds: ["marine_lakshadweep_sea"], expectedCount: 1, expectedLand: false },
  { id: "bransfield-strait-interior", point: [-55.884628, -62.258402], expectedIds: ["marine_bransfield_strait"], expectedCount: 1, expectedLand: false },
  { id: "drake-passage-interior", point: [-61.814093, -59.590098], expectedIds: ["marine_drake_passage"], expectedCount: 1, expectedLand: false },
  { id: "tryoshnikova-gulf-interior", point: [94.345128, -65.939219], expectedIds: ["marine_tryoshnikova_gulf"], expectedCount: 1, expectedLand: false },
];
const WAVE4_LAND_PROBES = [
  { id: "land-near-white-sea", point: [43.77351481454682, 67.2780001058116], expectedCount: 0, expectedLand: true },
  { id: "land-near-iceland-sea", point: [-13.63875618735027, 65.50462241980982], expectedCount: 0, expectedLand: true },
  { id: "land-near-lincoln-sea", point: [-52.58144262204082, 82.27472770320016], expectedCount: 0, expectedLand: true },
  { id: "land-near-gulf-of-mannar", point: [78.1352360824472, 8.494709321895218], expectedCount: 0, expectedLand: true },
  { id: "land-near-palk-strait-and-bay", point: [79.64371211141159, 10.29361881457156], expectedCount: 0, expectedLand: true },
  { id: "land-near-lakshadweep-sea", point: [77.32226871660014, 8.137447694956405], expectedCount: 0, expectedLand: true },
  { id: "land-near-bransfield-strait", point: [-58, -64], expectedCount: 0, expectedLand: true },
  { id: "land-near-drake-passage", point: [-60.79116016013324, -62.47727234425912], expectedCount: 0, expectedLand: true },
  { id: "land-near-tryoshnikova-gulf", point: [94.34513, -66.68922], expectedCount: 0, expectedLand: true },
];
const TNO_WAVE4_WATER_PROBES = WAVE4_WATER_PROBES.map((probe) => ({
  ...probe,
  expectedIds: probe.expectedIds.map((id) => id.replace("marine_", "tno_")),
}));
const NORTH_SEA_DETAILS = [
  { slug: "dornoch_firth", waterType: "channel", point: [-3.912293956280313, 57.90968620512397], land: [-3.947792441632354, 57.982585740643565] },
  { slug: "firth_of_tay", waterType: "channel", point: [-3.0741913345063456, 56.426683599211486], land: [-3.065318591483891, 56.399083973451475] },
  { slug: "tees_bay", waterType: "bay", point: [-1.1667179279440574, 54.66552974268499], land: [-1.1945051423223239, 54.67705442700283] },
  { slug: "bridlington_bay", waterType: "bay", point: [-0.11685520303616029, 53.99902297420898], land: [-0.1706854670007638, 54.07344290831883] },
  { slug: "westray_firth", waterType: "channel", point: [-3.0207864977734378, 59.22873594667968], land: [-3.0007864977734378, 59.308735946679676] },
  { slug: "stronsay_firth", waterType: "channel", point: [-2.7444210914167813, 59.0420697540752], land: [-2.8093480577799403, 58.98809069906988] },
  { slug: "scapa_flow", waterType: "bay", point: [-3.0289193163085937, 58.88811042794921], land: [-3.045190842201188, 58.95559621358031] },
  { slug: "yell_sound", waterType: "channel", point: [-1.2419149839117443, 60.613799467494026], land: [-1.1601170117011657, 60.613799467494026] },
];
const NORTH_SEA_WATER_PROBES = [
  ...NORTH_SEA_DETAILS.map(({ slug, point }) => ({ id: `${slug}-interior`, point, expectedIds: [`marine_${slug}`], expectedCount: 1, expectedLand: false })),
  { id: "protected-firth-of-forth-interior", point: [-3.05, 56.0], expectedIds: ["marine_firth_of_forth"], expectedCount: 1, expectedLand: false },
  { id: "protected-moray-firth-interior", point: [-3.44, 57.75], expectedIds: ["marine_moray_firth"], expectedCount: 1, expectedLand: false },
  { id: "protected-pentland-firth-interior", point: [-3.02, 58.75], expectedIds: ["marine_pentland_firth"], expectedCount: 1, expectedLand: false },
];
const NORTH_SEA_LAND_PROBES = NORTH_SEA_DETAILS.map(({ slug, land }) => ({
  id: `land-near-${slug}`, point: land, expectedCount: 0, expectedLand: true,
}));
const TNO_NORTH_SEA_WATER_PROBES = NORTH_SEA_WATER_PROBES.map((probe) => ({
  ...probe, expectedIds: probe.expectedIds.map((id) => id.replace("marine_", "tno_")),
}));

function assertNorthSeaDetailMetadata(byId) {
  const parent = byId.get("tno_north_sea");
  assert.ok(parent, "North Sea parent must remain in the final TNO payload");
  for (const { slug, waterType, point } of NORTH_SEA_DETAILS) {
    const id = `tno_${slug}`;
    const entry = byId.get(id);
    assert.ok(entry, `North Sea detail ${id} must reach the final payload`);
    assert.equal(entry.properties.region_group, "marine_detail", id);
    assert.equal(entry.properties.parent_id, "tno_north_sea", id);
    assert.equal(entry.properties.water_type, waterType, id);
    const area = d3.geoArea(entry);
    assert.ok(Number.isFinite(area) && area > 0 && area < 2 * Math.PI, `${id} must have valid local spherical area`);
    assert.equal(d3.geoContains(parent, point), false, `North Sea parent must exclude ${id}`);
  }
}

const BASE_PROBES = [
  ...WAVE6_WATER_PROBES.map((probe) => ({ ...probe, expectedOcean: true })),
  ...WAVE6_LAND_PROBES.map((probe) => ({ ...probe, expectedOcean: false })),
  ...WAVE7_WATER_PROBES.map((probe) => ({ ...probe, expectedOcean: true })),
  ...WAVE7_LAND_PROBES.map((probe) => ({ ...probe, expectedOcean: false })),
  ...WAVE4_WATER_PROBES.map((probe) => ({ ...probe, expectedOcean: true })),
  ...WAVE4_LAND_PROBES.map((probe) => ({ ...probe, expectedOcean: false })),
  ...NORTH_SEA_WATER_PROBES.map((probe) => ({ ...probe, expectedOcean: true })),
  ...NORTH_SEA_LAND_PROBES.map((probe) => ({ ...probe, expectedOcean: false })),
  { id: "north-pole", point: [0, 89], group: "ocean_macro", expectedCount: 1, expectedIds: ["marine_arctic_ocean"], expectedLand: false, expectedOcean: true },
  { id: "antarctic-interior", point: [90, -80], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
  { id: "antarctica-land-near-riiser-larsen-and-lazarev", point: [10, -73], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
  { id: "antarctica-land-near-cooperation-and-cosmonauts", point: [65, -72], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
  { id: "antarctica-land-near-davis-sea", point: [95, -70], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
  { id: "antarctica-land-near-bellingshausen-and-amundsen", point: [-90, -75], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
  { id: "antarctica-land-near-mawson-sea", point: [108.8871, -67.3722], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
  { id: "antarctica-land-near-dumont-durville-sea", point: [144.6087, -67.996], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
  { id: "antarctica-land-near-somov-sea", point: [161.289, -71.0676], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
  { id: "southern-atlantic-sector", point: [0, -62], group: "ocean_macro", expectedCount: 1, expectedIds: ["marine_southern_ocean"], expectedLand: false, expectedOcean: true },
  { id: "southern-indian-sector", point: [60, -62], group: "ocean_macro", expectedCount: 1, expectedIds: ["marine_southern_ocean"], expectedLand: false, expectedOcean: true },
  { id: "southern-pacific-sector", point: [-150, -62], group: "ocean_macro", expectedCount: 1, expectedIds: ["marine_southern_ocean"], expectedLand: false, expectedOcean: true },
  { id: "mid-atlantic", point: [-30, 30], group: "ocean_macro", expectedCount: 1, expectedLand: false, expectedOcean: true },
  { id: "dateline-east", point: [179.5, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false, expectedOcean: true },
  { id: "dateline-west", point: [-179.5, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false, expectedOcean: true },
];

function validateBaseTopologyAsset(relativePath) {
  const topology = JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
  return validateWaterGeometry(topology, {
    objectName: "water_regions",
    land: { topology, objectName: "land" },
    ocean: { topology, objectName: "ocean" },
    probes: BASE_PROBES,
  });
}

test("tiny boundary segments do not turn a concave polygon exterior into water", () => {
  const concave = feature("concave-short-edge", [
    [0, 0], [0, 1], [0.1, 1], [0.1, 0.1], [0.1000000005, 0.1], [1, 0.1], [1, 0], [0, 0],
  ], { water_type: "sea", region_group: "marine_macro" });
  const result = validateWaterGeometry(concave, {
    probes: [{ id: "outside-concavity", point: [0.2, 0.2], expectedCount: 0 },
      { id: "inside-arm", point: [0.05, 0.5], expectedCount: 1 }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("accepts densified planar water geometry with stable D3 fill and hit semantics", () => {
  const result = validateWaterGeometry(collection(densifiedRectangle("polar-water", 20, 65, 160, 85)), {
    probes: [{ id: "interior", point: [90, 75], group: "ocean_macro", expectedCount: 1 }],
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.ok(result.stats.sampledPointCount > 0);
  assert.ok(result.stats.maximumEdgeDriftDeg < result.stats.maxEdgeDriftDeg);
});

test("rejects an undensified long latitude edge whose D3 great-circle fill changes source semantics", () => {
  const legacy = feature("legacy-south-indian", [[20, -70], [20, -60], [147, -60], [147, -70], [20, -70]]);
  const result = validateWaterGeometry(collection(legacy));

  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("planar-geodesic-edge-drift"), JSON.stringify(result.errors, null, 2));
  assert.ok(result.stats.maximumEdgeDriftDeg > 5);
});

test("rejects a reversed local ring that D3 interprets as the hemisphere complement", () => {
  const reversed = feature("reversed", [[-10, 70], [10, 70], [10, 80], [-10, 80], [-10, 70]]);
  const result = validateWaterGeometry(collection(reversed));

  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("hemisphere-complement"), JSON.stringify(result.errors, null, 2));
});

test("rejects invalid rings and accepts a split antimeridian feature on both sides", () => {
  const invalid = feature("unclosed", [[0, 0], [0, 5], [5, 5], [5, 0]]);
  const invalidResult = validateWaterGeometry(collection(invalid));
  assert.equal(invalidResult.ok, false);
  assert.ok(errorCodes(invalidResult).has("unclosed-ring"), JSON.stringify(invalidResult.errors, null, 2));

  const east = densifiedRectangle("east-part", 170, 60, 180, 80);
  const west = densifiedRectangle("west-part", -180, 60, -170, 80);
  const dateline = {
    type: "Feature",
    properties: { id: "dateline-water", water_type: "ocean", region_group: "ocean_macro" },
    geometry: { type: "MultiPolygon", coordinates: [east.geometry.coordinates, west.geometry.coordinates] },
  };
  const datelineResult = validateWaterGeometry(collection(dateline), {
    probes: [
      { id: "east", point: [179, 70], group: "ocean_macro", expectedCount: 1 },
      { id: "west", point: [-179, 70], group: "ocean_macro", expectedCount: 1 },
    ],
  });
  assert.equal(datelineResult.ok, true, JSON.stringify(datelineResult.errors, null, 2));
});

test("allows a shared boundary but rejects same-level interior overlap", () => {
  const west = densifiedRectangle("west", -20, -10, 0, 10);
  const east = densifiedRectangle("east", 0, -10, 20, 10);
  const adjacent = validateWaterGeometry(collection(west, east), {
    probes: [{ id: "shared-boundary", point: [0, 0], group: "ocean_macro" }],
  });
  assert.equal(adjacent.ok, true, JSON.stringify(adjacent.errors, null, 2));

  const overlappingEast = densifiedRectangle("overlapping-east", -5, -10, 20, 10);
  const overlap = validateWaterGeometry(collection(west, overlappingEast));
  assert.equal(overlap.ok, false);
  assert.ok(errorCodes(overlap).has("same-level-interior-overlap"), JSON.stringify(overlap.errors, null, 2));
});

test("applies the physical land exclusion to oceans while leaving lakes independent", () => {
  const land = collection(densifiedRectangle("land", 0, 0, 10, 10, { water_type: undefined, region_group: undefined }));
  const ocean = densifiedRectangle("ocean", 2, 2, 8, 8);
  const lake = densifiedRectangle("lake", 2, 2, 8, 8, { water_type: "lake", region_group: "inland_lake" });

  const oceanResult = validateWaterGeometry(collection(ocean), { land });
  assert.equal(oceanResult.ok, false);
  assert.ok(errorCodes(oceanResult).has("ocean-intersects-land"), JSON.stringify(oceanResult.errors, null, 2));

  const lakeResult = validateWaterGeometry(collection(lake), { land });
  assert.equal(lakeResult.ok, true, JSON.stringify(lakeResult.errors, null, 2));
});

test("final base topology keeps polar, Antarctic, mid-latitude, and dateline ocean contracts", () => {
  const result = validateBaseTopologyAsset("../data/europe_topology.json");

  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.stats.checkedFeatureCount, 246 + WAVE7_WATERS.length);
});

test("final detail topology keeps the base and wave 7 water contract", () => {
  const result = validateBaseTopologyAsset("../data/europe_topology.na_v2.json");

  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.stats.checkedFeatureCount, 246 + WAVE7_WATERS.length);
});

test("final TNO runtime topology excludes Antarctic land and keeps polar/dateline continuity", () => {
  const topology = readJsonSource(new URL("../data/scenarios/tno_1962/runtime_topology.topo.json", import.meta.url));
  const result = validateWaterGeometry(topology, {
    objectName: "scenario_water",
    land: { topology, objectName: "land_mask" },
    probes: [
      ...TNO_WAVE6_WATER_PROBES,
      ...WAVE6_LAND_PROBES,
      ...TNO_WAVE7_WATER_PROBES,
      ...WAVE7_LAND_PROBES,
      ...TNO_WAVE4_WATER_PROBES,
      ...WAVE4_LAND_PROBES,
      ...TNO_NORTH_SEA_WATER_PROBES,
      ...NORTH_SEA_LAND_PROBES,
      { id: "antarctic-indian-80e", point: [80, -70], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctic-indian-90e", point: [90, -75], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctica-land-near-riiser-larsen-and-lazarev", point: [10, -73], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctica-land-near-cooperation-and-cosmonauts", point: [65, -72], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctica-land-near-davis-sea", point: [95, -70], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctica-land-near-bellingshausen-and-amundsen", point: [-90, -75], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctica-land-near-mawson-sea", point: [108.8871, -67.3722], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctica-land-near-dumont-durville-sea", point: [144.6087, -67.996], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctica-land-near-somov-sea", point: [161.289, -71.0676], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "southern-atlantic-sector", point: [0, -62], expectedIds: ["tno_south_atlantic_antarctic_ocean"], expectedCount: 1, expectedLand: false },
      { id: "southern-indian-sector", point: [60, -62], expectedIds: ["tno_south_indian_antarctic_ocean"], expectedCount: 1, expectedLand: false },
      { id: "southern-pacific-sector", point: [-150, -62], expectedIds: ["tno_south_pacific_antarctic_ocean"], expectedCount: 1, expectedLand: false },
      { id: "arctic", point: [0, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      { id: "dateline-east", point: [179.5, 75], expectedIds: ["tno_east_siberian_sea"], expectedCount: 1, expectedLand: false },
      { id: "dateline-west", point: [-179.5, 75], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      { id: "mid-atlantic", point: [-30, 30], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      // Coastal coordinates clipped by the physical mask must remain excluded;
      // paired interiors ensure that clipping has not removed the named bays.
      { id: "swansea-coastal-mask", point: [-3.99, 51.58], expectedCount: 0, expectedLand: true },
      { id: "humber-coastal-mask", point: [-0.18, 53.63], expectedCount: 0, expectedLand: true },
      { id: "cardigan-coastal-mask", point: [-4.63, 52.12], expectedCount: 0, expectedLand: true },
      { id: "swansea-interior", point: [-3.88, 51.54], expectedIds: ["tno_swansea_bay"], expectedLand: false },
      { id: "humber-interior", point: [0.02, 53.60], expectedIds: ["tno_humber_estuary"], expectedLand: false },
      { id: "cardigan-interior", point: [-4.50, 52.43], expectedIds: ["tno_cardigan_bay"], expectedLand: false },
    ],
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.stats.checkedFeatureCount, 239 + WAVE7_WATERS.length);
});

test("final TNO water chunks exactly preserve source and runtime geometry before their merged payload overrides topology", () => {
  const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
  const source = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "water_regions.geojson"));
  const topology = readJsonSource(new URL("../data/scenarios/tno_1962/runtime_topology.topo.json", import.meta.url));
  const runtime = topojson.feature(topology, topology.objects.scenario_water);
  const waterChunks = getManifestChunksByLayer(chunkManifest, "water");

  assert.equal(waterChunks.length, 9, "the canonical TNO water payload should remain bounded to one coarse and eight detail chunks");

  const sourceById = new Map(source.features.map((entry) => [getFeatureId(entry), entry]));
  const runtimeById = new Map(runtime.features.map((entry) => [getFeatureId(entry), entry]));
  assert.equal(sourceById.size, 239 + WAVE7_WATERS.length);
  assert.equal(runtimeById.size, 239 + WAVE7_WATERS.length);
  assertWave6TnoMetadata(sourceById);
  assertWave6TnoMetadata(runtimeById);
  assertWave7TnoMetadata(sourceById);
  assertWave7TnoMetadata(runtimeById);
  assertNorthSeaDetailMetadata(sourceById);
  assertNorthSeaDetailMetadata(runtimeById);
  assert.equal(source.features.length, sourceById.size, "final TNO source water ids must be unique");
  assert.equal(runtime.features.length, runtimeById.size, "decoded TNO runtime water ids must be unique");
  for (const id of ["lake_ladoga", "lake_onega", "lake_vanern", "lake_vattern", "lake_saimaa", "lake_paijanne", "lake_inari", "lake_pielinen"]) {
    assert.ok(sourceById.has(id), `major Nordic lake ${id} must reach the published water payload`);
  }
  for (const slug of ["white_sea", "iceland_sea", "lincoln_sea", "gulf_of_mannar", "palk_strait_and_palk_bay",
    "lakshadweep_sea", "bransfield_strait", "drake_passage", "tryoshnikova_gulf"]) {
    assert.ok(sourceById.has(`tno_${slug}`), `new named water ${slug} must reach all final water payloads`);
  }
  for (const { slug } of WAVE7_WATERS) {
    assert.ok(sourceById.has(`tno_${slug}`), `wave 7 named water ${slug} must reach all final water payloads`);
  }

  const mergedFeatures = [];
  const mergedIds = new Set();
  const detailIds = new Set();
  for (const chunk of waterChunks) {
    const payload = readManifestChunkPayload(chunk);
    assert.equal(payload.features.length, chunk.feature_count, `${chunk.id} payload must match its manifest feature count`);
    for (const entry of payload.features) {
      const id = getFeatureId(entry);
      const sourceEntry = sourceById.get(id);
      const runtimeEntry = runtimeById.get(id);
      assert.ok(sourceEntry, `${chunk.id} contains unknown source water id ${id}`);
      assert.ok(runtimeEntry, `${chunk.id} contains unknown runtime water id ${id}`);
      assert.deepEqual(entry.geometry, sourceEntry.geometry, `${chunk.id}:${id} geometry drifted from final source`);
      assert.deepEqual(entry.properties, sourceEntry.properties, `${chunk.id}:${id} properties drifted from final source`);
      assert.deepEqual(entry.geometry, runtimeEntry.geometry, `${chunk.id}:${id} geometry drifted from decoded runtime topology`);
      assert.deepEqual(entry.properties, runtimeEntry.properties, `${chunk.id}:${id} properties drifted from decoded runtime topology`);
      if (chunk.lod === "detail") detailIds.add(id);
      if (!mergedIds.has(id)) {
        mergedIds.add(id);
        mergedFeatures.push(entry);
      }
    }
  }

  assert.deepEqual(detailIds, new Set(sourceById.keys()), "the eight detail chunks must cover every final source water id");
  assert.deepEqual(mergedIds, new Set(sourceById.keys()), "the runtime-style first-ID merge must cover every final source water id");

  const merged = { type: "FeatureCollection", features: mergedFeatures };
  const mergedById = new Map(merged.features.map((entry) => [getFeatureId(entry), entry]));
  assertWave6TnoMetadata(mergedById);
  assertWave7TnoMetadata(mergedById);
  assertNorthSeaDetailMetadata(mergedById);
  const result = validateWaterGeometry(merged, {
    land: { topology, objectName: "land_mask" },
    probes: [
      ...TNO_WAVE6_WATER_PROBES,
      ...WAVE6_LAND_PROBES,
      ...TNO_WAVE7_WATER_PROBES,
      ...WAVE7_LAND_PROBES,
      ...TNO_WAVE4_WATER_PROBES,
      ...WAVE4_LAND_PROBES,
      ...TNO_NORTH_SEA_WATER_PROBES,
      ...NORTH_SEA_LAND_PROBES,
      { id: "antarctic-indian-80e", point: [80, -70], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctic-indian-90e", point: [90, -75], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "arctic", point: [0, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      { id: "dateline-east", point: [179.5, 75], expectedIds: ["tno_east_siberian_sea"], expectedCount: 1, expectedLand: false },
      { id: "dateline-west", point: [-179.5, 75], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      { id: "mid-atlantic", point: [-30, 30], group: "ocean_macro", expectedCount: 1, expectedLand: false },
    ],
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.stats.checkedFeatureCount, 239 + WAVE7_WATERS.length);
});

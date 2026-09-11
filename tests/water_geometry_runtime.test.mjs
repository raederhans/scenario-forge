import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { validateWaterGeometry } from "../tools/check_water_geometry.mjs";
import {
  getFeatureId,
  getManifestChunksByLayer,
  readManifestChunkPayload,
  readRepoFile,
} from "./helpers/scenario_chunk_contract_support.mjs";

const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");

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

const BASE_PROBES = [
  { id: "north-pole", point: [0, 89], group: "ocean_macro", expectedCount: 1, expectedIds: ["marine_arctic_ocean"], expectedLand: false, expectedOcean: true },
  { id: "antarctic-interior", point: [90, -80], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
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
  assert.equal(result.stats.checkedFeatureCount, 71);
});

test("final detail topology keeps the same 71-feature ocean contract", () => {
  const result = validateBaseTopologyAsset("../data/europe_topology.na_v2.json");

  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.stats.checkedFeatureCount, 71);
});

test("final TNO runtime topology excludes Antarctic land and keeps polar/dateline continuity", () => {
  const topology = JSON.parse(fs.readFileSync(new URL("../data/scenarios/tno_1962/runtime_topology.topo.json", import.meta.url), "utf8"));
  const result = validateWaterGeometry(topology, {
    objectName: "scenario_water",
    land: { topology, objectName: "land_mask" },
    probes: [
      { id: "antarctic-indian-80e", point: [80, -70], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctic-indian-90e", point: [90, -75], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "arctic", point: [0, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      { id: "dateline-east", point: [179.5, 75], group: "ocean_macro", expectedCount: 1, expectedLand: false },
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
  assert.equal(result.stats.checkedFeatureCount, 141);
});

test("final TNO water chunks exactly preserve source and runtime geometry before their merged payload overrides topology", () => {
  const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
  const source = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "water_regions.geojson"));
  const topology = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "runtime_topology.topo.json"));
  const runtime = topojson.feature(topology, topology.objects.scenario_water);
  const waterChunks = getManifestChunksByLayer(chunkManifest, "water");

  assert.equal(waterChunks.length, 9, "the canonical TNO water payload should remain bounded to one coarse and eight detail chunks");

  const sourceById = new Map(source.features.map((entry) => [getFeatureId(entry), entry]));
  const runtimeById = new Map(runtime.features.map((entry) => [getFeatureId(entry), entry]));
  assert.equal(sourceById.size, 141);
  assert.equal(runtimeById.size, 141);

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
  const result = validateWaterGeometry(merged, {
    land: { topology, objectName: "land_mask" },
    probes: [
      { id: "antarctic-indian-80e", point: [80, -70], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "antarctic-indian-90e", point: [90, -75], group: "ocean_macro", expectedCount: 0, expectedLand: true },
      { id: "arctic", point: [0, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      { id: "dateline-east", point: [179.5, 75], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      { id: "dateline-west", point: [-179.5, 75], group: "ocean_macro", expectedCount: 1, expectedLand: false },
      { id: "mid-atlantic", point: [-30, 30], group: "ocean_macro", expectedCount: 1, expectedLand: false },
    ],
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.stats.checkedFeatureCount, 141);
});

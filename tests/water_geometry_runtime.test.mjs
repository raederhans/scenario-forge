import assert from "node:assert/strict";
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

test("rejects a reversed local ring that D3 interprets as the hemisphere complement", () => {
  const reversed = feature("reversed", [[-10, 70], [10, 70], [10, 80], [-10, 80], [-10, 70]]);
  const result = validateWaterGeometry(collection(reversed));

  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("hemisphere-complement"), JSON.stringify(result.errors, null, 2));
});

test("split antimeridian geometry covers both sides", () => {
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

test("TNO water chunks preserve source and runtime geometry", () => {
  const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
  const source = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "water_regions.geojson"));
  const topology = readJsonSource(new URL("../data/scenarios/tno_1962/runtime_topology.topo.json", import.meta.url));
  const runtime = topojson.feature(topology, topology.objects.scenario_water);
  const waterChunks = getManifestChunksByLayer(chunkManifest, "water");

  const sourceById = new Map(source.features.map((entry) => [getFeatureId(entry), entry]));
  const runtimeById = new Map(runtime.features.map((entry) => [getFeatureId(entry), entry]));
  const detailIds = new Set();
  for (const chunk of waterChunks) {
    const payload = readManifestChunkPayload(chunk);
    for (const entry of payload.features) {
      const id = getFeatureId(entry);
      const sourceEntry = sourceById.get(id);
      const runtimeEntry = runtimeById.get(id);
      assert.ok(sourceEntry, `${chunk.id} contains unknown source water id ${id}`);
      assert.ok(runtimeEntry, `${chunk.id} contains unknown runtime water id ${id}`);
      assert.deepEqual(entry.geometry, sourceEntry.geometry, `${chunk.id}:${id} geometry drifted from final source`);
      assert.deepEqual(entry.geometry, runtimeEntry.geometry, `${chunk.id}:${id} geometry drifted from decoded runtime topology`);
      if (chunk.lod === "detail") detailIds.add(id);
    }
  }

  assert.deepEqual(detailIds, new Set(sourceById.keys()), "the eight detail chunks must cover every final source water id");
});

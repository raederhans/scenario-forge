import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";

function createHarness() {
  const sandbox = vm.createContext({});
  for (const path of ["../vendor/d3.v7.min.js", "../vendor/topojson-client.min.js", "../js/core/scenario_chunk_format_shared.js"]) {
    vm.runInContext(fs.readFileSync(new URL(path, import.meta.url), "utf8"), sandbox);
  }
  return { sandbox, ...sandbox.__scenarioForgeScenarioChunkFormatShared };
}

function makeTopology() {
  const shell = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
  const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
  return {
    type: "Topology",
    arcs: [shell.slice().reverse(), hole.slice().reverse(), shell, hole, shell.slice(0, -1), shell.slice().reverse(), shell],
    objects: { political: { type: "GeometryCollection", geometries: [
      { type: "Polygon", id: "reversed", arcs: [[0], [1]] },
      { type: "Polygon", id: "correct", arcs: [[2], [3]] },
      { type: "Polygon", id: "open", arcs: [[4]] },
      { type: "MultiPolygon", id: "multi", arcs: [[[5]], [[6]]] },
      { type: "Point", id: "point", coordinates: [20, 20] },
    ] } },
  };
}

function rings(geometry) {
  return geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : geometry.coordinates;
}

test("political decoding matches renderer winding and preserves untouched rings and shared arc points", (t) => {
  const { sandbox, decodeScenarioChunkPayload } = createHarness();
  const previousD3 = globalThis.d3;
  globalThis.d3 = sandbox.d3;
  t.after(() => {
    if (previousD3 === undefined) delete globalThis.d3;
    else globalThis.d3 = previousD3;
  });
  const topology = makeTopology();
  const snapshot = structuredClone(topology);
  const owner = createPoliticalCollectionOwner({ state: {}, helpers: { getFeatureId: (feature) => feature.id } });
  let decoded;
  let originalGeometries;
  let expected;
  const collection = decodeScenarioChunkPayload(topology, {
    feature(input, object) {
      decoded = sandbox.topojson.feature(input, object);
      originalGeometries = decoded.features.map((feature) => feature.geometry);
      expected = decoded.features.map((feature) => owner.normalizeFeatureGeometry({ ...feature, sphericalArea: 100 }).geometry);
      return decoded;
    },
  });
  assert.equal(collection, decoded);
  collection.features.forEach((feature, index) => {
    assert.deepEqual(structuredClone(feature.geometry), structuredClone(expected[index]));
    assert.equal(feature.sphericalArea, sandbox.d3.geoArea(feature));
    assert.equal(Object.getOwnPropertyDescriptor(feature, "sphericalArea").enumerable, true);
    assert.equal(Object.hasOwn(feature.properties, "sphericalArea"), false);
    if (feature.geometry.type !== "Point") assert.notEqual(feature.geometry, originalGeometries[index]);
  });
  const allRings = collection.features.slice(0, 4).flatMap((feature) => rings(feature.geometry));
  const oldRings = originalGeometries.slice(0, 4).flatMap(rings);
  allRings.forEach((ring, index) => {
    if ([2, 3, 6].includes(index)) assert.equal(ring, oldRings[index]);
    else assert.notEqual(ring, oldRings[index]);
    assert.deepEqual(ring[0], ring.at(-1));
    for (const point of ring) assert.ok(topology.arcs[index].includes(point));
    const area = sandbox.d3.geoArea({ type: "Polygon", coordinates: [ring] });
    assert.equal(area <= Math.PI * 2, ![1, 3].includes(index));
  });
  assert.deepEqual(topology, snapshot);
  assert.equal(collection.features[4].geometry, originalGeometries[4]);
});

test("orientation returns the original collection and skips failed or nonfinite areas without partial mutation", () => {
  const { sandbox, orientPoliticalFeatureCollection } = createHarness();
  for (const failAt of ["Polygon", "Feature"]) {
    for (const result of [NaN, Infinity, "throw"]) {
      const collection = sandbox.topojson.feature(makeTopology(), makeTopology().objects.political);
      const feature = collection.features[0];
      const geometry = feature.geometry;
      const oriented = orientPoliticalFeatureCollection(collection, (object) => {
        if (object.type === failAt && (failAt === "Polygon" || object.id === "reversed")) {
          if (result === "throw") throw new Error("area failed");
          return result;
        }
        return sandbox.d3.geoArea(object);
      });
      assert.equal(oriented, collection);
      assert.equal(feature.geometry, geometry);
      assert.equal(Object.hasOwn(feature, "sphericalArea"), false);
      assert.equal(collection.features.at(-1).sphericalArea, 0);
    }
  }
});

test("decoding without d3 preserves the original decoded collection", () => {
  const { sandbox, decodeScenarioChunkPayload } = createHarness();
  sandbox.d3 = undefined;
  const topology = makeTopology();
  const decoded = sandbox.topojson.feature(topology, topology.objects.political);
  assert.equal(decodeScenarioChunkPayload(topology, { feature: () => decoded }), decoded);
  assert.equal(Object.hasOwn(decoded.features[0], "sphericalArea"), false);
  assert.equal(decodeScenarioChunkPayload(decoded), decoded);
});

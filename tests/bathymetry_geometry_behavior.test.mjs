import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { normalizeBathymetryFeatureCollection } from "../js/core/renderer/bathymetry_geometry.js";

const vendor = vm.createContext({});
for (const file of ["d3.v7.min.js", "topojson-client.min.js"]) {
  vm.runInContext(fs.readFileSync(new URL(`../vendor/${file}`, import.meta.url), "utf8"), vendor);
}
const { d3, topojson } = vendor;
const square = (x, y, size) => [[x,y], [x+size,y], [x+size,y+size], [x,y+size], [x,y]];
const feature = (type, coordinates) => ({ type: "Feature", properties: { depth: 100 }, geometry: { type, coordinates } });
const collection = (...features) => ({ type: "FeatureCollection", features });
const normalize = (value) => normalizeBathymetryFeatureCollection(value, d3);

function assertLocal(result) {
  for (const item of result.collection.features) {
    assert.ok(d3.geoArea(item) > 0 && d3.geoArea(item) < 2 * Math.PI);
    const bounds = d3.geoBounds(item);
    assert.ok(bounds.flat().every(Number.isFinite));
    assert.ok(bounds[0][1] > -90 || bounds[1][1] < 90);
    const polygons = item.geometry.type === "Polygon" ? [item.geometry.coordinates] : item.geometry.coordinates;
    for (const coordinates of polygons) {
      const area = d3.geoArea({ type: "Polygon", coordinates });
      assert.ok(area > 0 && area < Math.PI * 2);
    }
  }
}

test("normalizes exterior and hole independently without mutating the input", () => {
  const outer = square(10, 10, 10);
  const hole = square(12, 12, 2).reverse();
  const input = collection(feature("Polygon", [outer, hole]));
  const before = JSON.stringify(input);
  const result = normalize(input);
  assertLocal(result);
  assert.equal(result.diagnostics.rewoundRingCount, 2);
  assert.equal(JSON.stringify(input), before);
  const normalized = result.collection.features[0];
  assert.equal(d3.geoContains(normalized, [13,13]), false);
  assert.equal(d3.geoContains(normalized, [11,11]), true);
  assert.equal(normalize(result.collection).diagnostics.rewoundRingCount, 0);
});

test("normalizes every MultiPolygon component, including antimeridian rings", () => {
  const dateline = [[179,0], [-179,0], [-179,2], [179,2], [179,0]];
  const result = normalize(collection(feature("MultiPolygon", [[square(10,10,2)], [dateline]])));
  assertLocal(result);
  assert.equal(result.diagnostics.polygonCount, 2);
  const normalized = result.collection.features[0];
  assert.equal(d3.geoContains(normalized, [180,1]), true);
  assert.equal(d3.geoContains(normalized, [0,1]), false);
});

test("reports invalid rings and preserves valid components", () => {
  const result = normalize(collection(feature("MultiPolygon", [[square(10,10,2)], [[[0,0],[1,0],[1,1]]]])));
  assert.equal(result.diagnostics.rejectedPolygonCount, 1);
  assert.equal(result.collection.features[0].geometry.coordinates.length, 1);
  assert.equal(result.diagnostics.issues[0].reason, "invalid-ring-coordinates");
});

test("removes a collapsed zero-area hole without losing its valid exterior", () => {
  const result = normalize(collection(feature("Polygon", [square(10,10,2), [[11,11],[11,11],[11,11],[11,11]]])));
  assert.equal(result.diagnostics.removedDegenerateHoleCount, 1);
  assert.equal(result.diagnostics.rejectedPolygonCount, 0);
  assert.equal(result.collection.features[0].geometry.coordinates.length, 1);
  assertLocal(result);
});

test("rejects a polygon whose holes leave an invalid spherical scope", () => {
  const result = normalize(collection(feature("Polygon", [square(10,10,1), square(9,9,3)])));
  assert.equal(result.collection.features.length, 0);
  assert.equal(result.diagnostics.issues[0].reason, "invalid-local-spherical-scope");
});

test("local inverted ring no longer projects a world-sized fill", () => {
  const input = collection(feature("Polygon", [square(47.1,71.6,0.2)]));
  const path = d3.geoPath(d3.geoEquirectangular().scale(100));
  const before = path.bounds(input.features[0]);
  const after = path.bounds(normalize(input).collection.features[0]);
  assert.ok(before[1][0] - before[0][0] > 600);
  assert.ok(after[1][0] - after[0][0] < 1);
  assert.ok(after[1][1] - after[0][1] < 1);
});

for (const asset of ["global_bathymetry.topo.json", "scenarios/tno_1962/bathymetry.topo.json"]) {
  test(`real bathymetry asset has local spherical fill after normalization: ${asset}`, () => {
    const topology = JSON.parse(fs.readFileSync(new URL(`../data/${asset}`, import.meta.url), "utf8"));
    const object = topology.objects.bathymetry_bands;
    assert.ok(object);
    const input = topojson.feature(topology, object);
    const before = JSON.stringify(input);
    const invalidBefore = input.features.filter((item) => d3.geoArea(item) > Math.PI * 2).length;
    const result = normalize(input);
    assertLocal(result);
    assert.equal(result.collection.features.length, input.features.length);
    assert.equal(result.diagnostics.rejectedPolygonCount, 0);
    assert.ok(result.diagnostics.rewoundRingCount >= invalidBefore);
    assert.equal(JSON.stringify(input), before);
    console.log(asset, JSON.stringify({ features: input.features.length, invalidBefore, ...result.diagnostics }));
  });
}

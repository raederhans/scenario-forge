import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";

import { createProjectedGeometryBoundsOwner } from "../js/core/renderer/projected_geometry_bounds_owner.js";

const sandbox = {};
vm.runInNewContext(fs.readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), sandbox);
const { d3 } = sandbox;

test("multipart islands keep their components until geometry changes", () => {
  const projection = (p) => p;
  const owner = createProjectedGeometryBoundsOwner({ getters: { getProjection: () => projection } });
  const feature = { type: "Feature", id: "islands", geometry: { type: "MultiPolygon", coordinates: [
    [[[1, 2], [2, 3], [3, 2], [1, 2]]], [[[10, 20], [20, 30], [30, 20], [10, 20]]],
  ] } };
  const first = owner.collectFeatureHitGeometries(feature);
  assert.equal(owner.collectFeatureHitGeometries({ ...feature }), first);
  const replacement = owner.collectFeatureHitGeometries({ ...feature, geometry: structuredClone(feature.geometry) });
  assert.notEqual(replacement[0], first[0]);
});

function createFeature(id, geometry) {
  return {
    type: "Feature",
    id,
    properties: { id },
    geometry,
  };
}

test("water sanitation preserves lake holes", () => {
  const owner = createProjectedGeometryBoundsOwner({ getters: { getD3: () => d3 } });
  const holed = { type: "Polygon", coordinates: [
    [[-10, -10], [-10, 10], [10, 10], [10, -10], [-10, -10]],
    [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]],
  ] };
  const antimeridian = { type: "Polygon", coordinates: [
    [[170, -10], [170, 10], [-170, 10], [-170, -10], [170, -10]],
  ] };
  const reversed = { type: "Polygon", coordinates: [holed.coordinates[0].slice().reverse()] };
  const original = createFeature("WATER", { type: "GeometryCollection", geometries: [holed, antimeridian, reversed] });
  const [first] = owner.sanitizeWaterRegionFeatures([original]);
  assert.equal(first.geometry.type, "MultiPolygon");
  assert.deepEqual(first.geometry.coordinates, [holed.coordinates, antimeridian.coordinates]);
  assert.equal(d3.geoContains(first, [0, 0]), false, "the lake hole must remain empty");
  assert.equal(d3.geoContains(first, [5, 0]), true);
  assert.equal(d3.geoContains(first, [179, 0]), true);
});

test("projected dateline bounds match the native geographic path", () => {
  const projection = d3.geoEqualEarth().precision(0.1).scale(128).translate([380, 250]);
  const path = d3.geoPath(projection).pointRadius(2);
  const owner = createProjectedGeometryBoundsOwner({ getters: {
    getProjection: () => projection, getPathCanvas: () => path, getBoundsPath: () => path,
  } });
  const shape = { type: "LineString", coordinates: [[-179, 40], [179, 42]] };
  const expected = path.bounds(shape);
  const first = owner.computeProjectedGeoBounds(shape, { allowCoordinateFallback: false });
  assert.deepEqual([first.minX, first.minY, first.maxX, first.maxY],
    [expected[0][0], expected[0][1], expected[1][0], expected[1][1]]);
});

test("real D3 keeps the world-bounds check for edges that round onto a pole", () => {
  const owner = createProjectedGeometryBoundsOwner({ getters: { getD3: () => d3 } });
  const equator = [[-180, 0], [-90, 0], [0, 0], [90, 0], [180, 0]];
  // Neither arc reaches a pole, but D3 rounds each one's extreme onto it.
  const nearAntipodal = owner.getSphericalGeometryDiagnostics({ type: "MultiLineString", coordinates: [
    [[0, 89], [179.99999, 89]], [[0, -89], [179.99999, -89]], equator,
  ] });
  assert.equal(nearAntipodal.isWorldBounds, true);
  assert.equal(nearAntipodal.invalid, true);
});

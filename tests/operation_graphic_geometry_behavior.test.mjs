import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { getLineMidpointFromCoordinates, getOperationGraphicEditorMidpoints, createProjectedOperationGraphicPath, projectOperationGraphicSegments } from "../js/core/renderer/operation_graphic_geometry.js";

const sandbox = {};
vm.runInNewContext(fs.readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), sandbox);
const d3 = sandbox.d3;

test("strategic paths split at the geographic seam", () => {
  const projection = d3.geoEqualEarth().scale(100).translate([500, 250]);
  const crossing = [[170, 0], [-170, 0]];
  const segments = projectOperationGraphicSegments(crossing, projection, d3);
  assert.equal(segments.length, 2);
  assert.ok(segments.every((segment) => Math.max(...segment.map((p) => p[0])) - Math.min(...segment.map((p) => p[0])) < 30));
  assert.equal((createProjectedOperationGraphicPath(crossing, projection, d3).match(/M/g) || []).length, 2);
});

test("closed strategic regions rejoin and close both clipped pieces in either winding", () => {
  const projection = d3.geoEqualEarth().scale(100).translate([500, 250]);
  const ring = [[170, -10], [-170, -10], [-170, 10], [170, 10]];
  for (const points of [ring, [...ring].reverse()]) {
    const segments = projectOperationGraphicSegments(points, projection, d3, { closed: true });
    assert.equal(segments.length, 2);
    assert.ok(segments.every((segment) => Math.max(...segment.map((p) => p[0])) - Math.min(...segment.map((p) => p[0])) < 30));
    const path = createProjectedOperationGraphicPath(points, projection, d3, { closed: true });
    assert.equal((path.match(/M/g) || []).length, 2);
    assert.equal((path.match(/Z/g) || []).length, 2);
    assert.equal(path.includes("NaN"), false);
  }
});

test("line label midpoint follows segment lengths and ignores degenerate segments", () => {
  assert.deepEqual(getLineMidpointFromCoordinates([[0, 0], [2, 0], [2, 6]]), [2, 2]);
  assert.deepEqual(getLineMidpointFromCoordinates([[0, 0], [0, 0], [4, 0]]), [2, 0]);
  assert.equal(getLineMidpointFromCoordinates([[0, 0], [0, 0]]), null);
  assert.equal(getLineMidpointFromCoordinates([]), null);
});

test("editor midpoint handles closing edge without mutating vertices", () => {
  const points = [[0, 0], [4, 0], [4, 4]];
  const before = structuredClone(points);
  const open = getOperationGraphicEditorMidpoints(points);
  const closed = getOperationGraphicEditorMidpoints(points, { closed: true });
  assert.equal(open.length, 2);
  assert.deepEqual(closed[2], { id: "opg-midpoint-2", insertIndex: 3, coord: [2, 2] });
  assert.deepEqual(points, before);
});

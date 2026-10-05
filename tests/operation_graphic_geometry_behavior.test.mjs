import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import {
  getLineMidpointFromCoordinates, getMultiLineLabelAnchor,
  getOperationGraphicPreset, getOperationalLinePreset,
  getOperationGraphicMinPoints, getOperationalLineMinPoints,
  getOperationGraphicEditorMidpoints, getOperationGraphicLabelAnchor,
  normalizeOperationGraphicStylePreset, normalizeOperationalLineStylePreset,
  normalizeOperationGraphicStroke, normalizeOperationGraphicWidth, normalizeOperationGraphicOpacity,
  createProjectedOperationGraphicPath, projectOperationGraphicSegments,
} from "../js/core/renderer/operation_graphic_geometry.js";

const sandbox = {};
vm.runInNewContext(fs.readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), sandbox);
const d3 = sandbox.d3;

test("strategic paths split at the geographic seam and retain ordinary curves", () => {
  const projection = d3.geoEqualEarth().scale(100).translate([500, 250]);
  const crossing = [[170, 0], [-170, 0]];
  const segments = projectOperationGraphicSegments(crossing, projection, d3);
  assert.equal(segments.length, 2);
  assert.ok(segments.every((segment) => Math.max(...segment.map((p) => p[0])) - Math.min(...segment.map((p) => p[0])) < 30));
  assert.equal((createProjectedOperationGraphicPath(crossing, projection, d3).match(/M/g) || []).length, 2);
  const ordinary = [[0, 0], [10, 20], [20, 0]];
  for (const closed of [false, true]) {
    const curve = closed ? d3.curveCatmullRomClosed.alpha(0.5) : d3.curveCatmullRom.alpha(0.5);
    assert.equal(createProjectedOperationGraphicPath(ordinary, projection, d3, { closed }), d3.line().curve(curve)(ordinary.map(projection)));
  }
  const rotated = d3.geoEqualEarth().rotate([90, 0]);
  assert.equal(projectOperationGraphicSegments([[80, 0], [100, 0]], rotated, d3).length, 2);
});

test("geographic midpoint, centroid, and edit handles stay at the dateline", () => {
  const points = [[170, 0], [-170, 0]];
  const before = structuredClone(points);
  assert.deepEqual(getLineMidpointFromCoordinates(points), [180, 0]);
  assert.deepEqual(getLineMidpointFromCoordinates([...points].reverse()), [-180, 0]);
  assert.deepEqual(getMultiLineLabelAnchor({ coordinates: [points] }, "centroid"), [180, 0]);
  assert.deepEqual(getOperationGraphicEditorMidpoints(points)[0].coord, [180, 0]);
  assert.deepEqual(points, before);
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
  const rotated = d3.geoEqualEarth().rotate([90, 0]);
  assert.equal(projectOperationGraphicSegments([[80, -10], [100, -10], [100, 10], [80, 10]], rotated, d3, { closed: true }).length, 2);
});

test("graphic and line presets preserve defaults and return independent records", () => {
  const attack = getOperationGraphicPreset("attack");
  assert.equal(attack.markerEnd, "url(#strategic-arrow-attack)");
  assert.deepEqual(getOperationGraphicPreset("unknown"), attack);
  attack.stroke = "changed";
  assert.equal(getOperationGraphicPreset("attack").stroke, "#7f1d1d");
  assert.equal(getOperationGraphicPreset("theater").closed, true);
  assert.equal(getOperationGraphicPreset("encirclement").closed, true);
  assert.deepEqual(getOperationalLinePreset("unknown"), getOperationalLinePreset("frontline"));
  assert.equal(getOperationalLinePreset("offensive_line").width, 2.5);
  assert.equal(getOperationalLinePreset("spearhead_line").dasharray, "14 5 2 5");
  assert.equal(getOperationGraphicMinPoints("encirclement"), 3);
  assert.equal(getOperationGraphicMinPoints(), 2);
  assert.equal(getOperationalLineMinPoints(), 2);
});

test("style normalization retains fallback choices and existing numeric semantics", () => {
  assert.equal(normalizeOperationGraphicStylePreset(" NAVAL "), "naval");
  assert.equal(normalizeOperationGraphicStylePreset("unknown", " RETREAT "), "retreat");
  assert.equal(normalizeOperationalLineStylePreset(null, "unknown"), "frontline");
  assert.equal(normalizeOperationalLineStylePreset(" DEFENSIVE_LINE "), "defensive_line");
  assert.equal(normalizeOperationGraphicStroke(" #AbC123 "), "#abc123");
  assert.equal(normalizeOperationGraphicStroke("#abc"), "");
  assert.equal(normalizeOperationGraphicWidth(Infinity), 16);
  assert.equal(normalizeOperationGraphicWidth(-3), 0);
  assert.equal(normalizeOperationGraphicOpacity(0), 1);
  assert.equal(normalizeOperationGraphicOpacity(-1), 0);
});

test("line label midpoint follows segment lengths and ignores degenerate segments", () => {
  assert.deepEqual(getLineMidpointFromCoordinates([[0, 0], [2, 0], [2, 6]]), [2, 2]);
  assert.deepEqual(getLineMidpointFromCoordinates([[0, 0], [0, 0], [4, 0]]), [2, 0]);
  assert.equal(getLineMidpointFromCoordinates([[0, 0], [0, 0]]), null);
  assert.equal(getLineMidpointFromCoordinates([]), null);
  const geometry = { coordinates: [[[0, 0], [1, 0]], [[0, 0], [2, 0], [2, 6]]] };
  assert.deepEqual(getMultiLineLabelAnchor(geometry), [2, 2]);
  assert.deepEqual(getMultiLineLabelAnchor(geometry, "centroid"), [4 / 3, 2]);
});

test("editor midpoint handles closing edge without mutating vertices", () => {
  const points = [[0, 0], [4, 0], [4, 4]];
  const before = structuredClone(points);
  const open = getOperationGraphicEditorMidpoints(points);
  const closed = getOperationGraphicEditorMidpoints(points, { closed: true });
  assert.equal(open.length, 2);
  assert.deepEqual(closed[2], { id: "opg-midpoint-2", insertIndex: 3, coord: [2, 2] });
  assert.deepEqual(points, before);
  assert.deepEqual(getOperationGraphicEditorMidpoints([]), []);
});

test("graphic labels retain closed centroid and open perpendicular offset", () => {
  assert.equal(getOperationGraphicLabelAnchor([]), null);
  const point = [3, 4];
  assert.equal(getOperationGraphicLabelAnchor([point]), point);
  assert.deepEqual(getOperationGraphicLabelAnchor([[0, 0], [10, 0]]), [5, 9]);
  assert.deepEqual(getOperationGraphicLabelAnchor([[0, 0], [10, 0], [5, 6]], { closed: true }), [5, 2]);
});

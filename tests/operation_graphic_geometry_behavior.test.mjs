import assert from "node:assert/strict";
import test from "node:test";
import {
  getLineMidpointFromCoordinates, getMultiLineLabelAnchor,
  getOperationGraphicPreset, getOperationalLinePreset,
  getOperationGraphicMinPoints, getOperationalLineMinPoints,
  getOperationGraphicEditorMidpoints, getOperationGraphicLabelAnchor,
  normalizeOperationGraphicStylePreset, normalizeOperationalLineStylePreset,
  normalizeOperationGraphicStroke, normalizeOperationGraphicWidth, normalizeOperationGraphicOpacity,
} from "../js/core/renderer/operation_graphic_geometry.js";

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

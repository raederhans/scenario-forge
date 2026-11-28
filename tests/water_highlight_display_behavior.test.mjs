import test from "node:test";
import assert from "node:assert/strict";
import { createWaterHighlightDisplay } from "../js/core/renderer/water_highlight_display.js";

function createProjection({ scale = 1, translate = [0, 0] } = {}) {
  let currentScale = scale;
  let currentTranslate = [...translate];
  const projection = {
    scale(value) {
      if (value === undefined) return currentScale;
      currentScale = value;
      return projection;
    },
    translate(value) {
      if (value === undefined) return [...currentTranslate];
      currentTranslate = [...value];
      return projection;
    },
    stream(sink) {
      return {
        polygonStart: () => sink.polygonStart?.(),
        polygonEnd: () => sink.polygonEnd?.(),
        lineStart: () => sink.lineStart?.(),
        lineEnd: () => sink.lineEnd?.(),
        point(x, y) {
          sink.point?.(x * currentScale + currentTranslate[0], y * currentScale + currentTranslate[1]);
        },
      };
    },
  };
  return projection;
}

function geoStream(feature, stream) {
  stream.polygonStart();
  for (const ring of feature.coordinates ?? feature.geometry.coordinates) {
    stream.lineStart();
    for (const [x, y] of ring) stream.point(x, y);
    stream.lineEnd();
  }
  stream.polygonEnd();
}

function segmentedSquare(size, segments = 40, offset = [0, 0]) {
  const [ox, oy] = offset;
  const points = [];
  for (let index = 0; index <= segments; index += 1) points.push([ox + size * index / segments, oy]);
  points.push([ox + size, oy + size], [ox, oy + size], [ox, oy]);
  return points;
}

test("highlight simplification preserves the polygon hole", () => {
  const original = {
    type: "Feature",
    properties: { id: "sea" },
    geometry: {
      type: "Polygon",
      coordinates: [
        segmentedSquare(10),
        [[2, 2], [2, 5], [5, 5], [5, 2], [2, 2]],
      ],
    },
  };
  const owner = createWaterHighlightDisplay({ geoStream });
  const display = owner.get(original, createProjection(), 1);

  assert.ok(display);
  assert.equal(display.polylines.length, 2, "outer boundary and visible hole remain separate closed rings");
  assert.ok(display.polylines[0].points.length < original.geometry.coordinates[0].length / 4,
    "collinear projected points are removed");
  assert.ok(display.polylines.every((line) => line.closed));
});

test("changing projection translation moves the highlighted boundary", () => {
  const feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [segmentedSquare(10, 30)] },
  };
  const projection = createProjection();
  const owner = createWaterHighlightDisplay({ geoStream });
  const first = owner.get(feature, projection, 1);

  projection.translate([100, 20]);
  const panned = owner.get(feature, projection, 1);
  assert.notEqual(panned, first);
  assert.ok(panned.svgPath.startsWith("M100,20"));
});

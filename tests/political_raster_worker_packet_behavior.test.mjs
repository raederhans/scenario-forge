import assert from "node:assert/strict";

import test from "node:test";

import {
  buildWorkerPixelRingsForGeometry,
  collectRasterPolygonalGeometryParts,
} from "../js/core/map_renderer/political_raster_worker_packet.js";

test("collectRasterPolygonalGeometryParts flattens geometry collections to polygons", () => {
  const geometry = {
    type: "GeometryCollection",
    geometries: [
      {
        type: "Polygon",
        coordinates: [[[0, 0], [2, 0], [0, 2], [0, 0]]],
      },
      {
        type: "MultiPolygon",
        coordinates: [
          [[[10, 10], [12, 10], [10, 12], [10, 10]]],
          [[[20, 20], [22, 20], [20, 22], [20, 20]]],
        ],
      },
      {
        type: "LineString",
        coordinates: [[99, 99], [100, 100]],
      },
    ],
  };

  const parts = collectRasterPolygonalGeometryParts(geometry);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((part) => part.type), ["Polygon", "Polygon", "Polygon"]);
});

test("buildWorkerPixelRingsForGeometry projects geometry collection polygon rings", () => {
  const geometry = {
    type: "GeometryCollection",
    geometries: [
      {
        type: "Polygon",
        coordinates: [[[0, 0], [2, 0], [0, 2], [0, 0]]],
      },
      {
        type: "MultiPolygon",
        coordinates: [
          [[[10, 10], [12, 10], [10, 12], [10, 10]]],
        ],
      },
    ],
  };

  const rings = buildWorkerPixelRingsForGeometry(geometry, ([x, y]) => [x * 2, y * 3]);
  assert.deepEqual(rings, [
    [[0, 0], [4, 0], [0, 6], [0, 0]],
    [[20, 30], [24, 30], [20, 36], [20, 30]],
  ]);
});

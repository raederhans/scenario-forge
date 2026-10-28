import test from "node:test";
import assert from "node:assert/strict";
import { packWaterGeometry } from "../js/core/renderer/water_geometry_transport.js";
import { decodePackedRasterUpdates, streamPackedRasterGeometry } from "../js/core/renderer/packed_geometry.js";

test("water transport matches recursive packing for a fixed multi-ring MultiPolygon", async () => {
  const geometry = { type: "MultiPolygon", coordinates: [
    [
      [[-0, 0], [3.125, 0], [3.125, 4], [-0, 0]],
      [[1, 1], [1, 2], [2, 1], [1, 1]],
    ],
    [[], [[-12.75, 8], [-10, 8], [-10, 9.5], [-12.75, 8]]],
  ] };
  const updates = [
    { id: "multi", feature: geometry },
    { id: "collection", feature: { type: "Feature", geometry: {
      type: "GeometryCollection", geometries: [
        geometry, { type: "Point", coordinates: [-0, 1 / 3, 7] },
        { type: "Sphere" }, null,
      ],
    } } },
  ];
  const coordinates = [], lengths = [];
  const depths = { Point: 1, MultiPoint: 2, LineString: 2, MultiLineString: 3, Polygon: 3, MultiPolygon: 4 };
  function walk(value, depth) {
    lengths.push(value.length);
    for (const child of value) {
      if (depth > 1) walk(child, depth - 1);
      else coordinates.push(child);
    }
  }
  function describe(feature) {
    if (!feature) return null;
    if (feature.type === "Feature") return describe(feature.geometry);
    if (feature.type === "GeometryCollection") {
      return { type: feature.type, geometries: feature.geometries.map(describe) };
    }
    if (feature.type === "Sphere") return { type: "Sphere" };
    const result = { type: feature.type, coordinates: [coordinates.length, lengths.length] };
    walk(feature.coordinates, depths[feature.type]);
    return result;
  }
  const value = updates.map(({ id, feature }) => ({ id, feature: describe(feature) }));
  const packed = await packWaterGeometry(updates);
  assert.deepEqual(packed.payload.value, value);
  assert.deepEqual(new Uint8Array(packed.payload.coordinates.buffer), new Uint8Array(new Float64Array(coordinates).buffer));
  assert.deepEqual(new Uint8Array(packed.payload.lengths.buffer), new Uint8Array(new Uint32Array(lengths).buffer));
  assert.deepEqual(packed.transfer, [packed.payload.coordinates.buffer, packed.payload.lengths.buffer]);
});

test("water transport yields within a 20000-point ring", async () => {
  let visitedFirstPoint = false;
  let visitedLastPoint = false;
  const ring = Array.from({ length: 20000 }, (_, index) => [index / 7, index / 11]);
  Object.defineProperty(ring, 0, {
    get() { visitedFirstPoint = true; return [0, 0]; },
  });
  Object.defineProperty(ring, ring.length - 1, {
    get() { visitedLastPoint = true; return [19999 / 7, 19999 / 11]; },
  });
  let yieldsInsideRing = 0;
  await packWaterGeometry([{ id: "large", feature: { type: "Polygon", coordinates: [ring] } }], {
    scalarBatchSize: 4096,
    yieldTask: async () => { if (visitedFirstPoint && !visitedLastPoint) yieldsInsideRing++; },
  });
  assert.ok(yieldsInsideRing > 0);
});

test("water transport preserves invalid coordinate errors", async () => {
  for (const coordinates of [null, [null], [[null]]]) {
    await assert.rejects(packWaterGeometry([{ id: "invalid", feature: { type: "Polygon", coordinates } }]),
      { name: "TypeError", message: "Invalid water coordinates." });
  }
  for (const number of [NaN, Infinity, -Infinity, "1"]) {
    await assert.rejects(packWaterGeometry([{ id: "invalid", feature: { type: "Polygon", coordinates: [[[number, 0]]] } }]),
      { name: "TypeError", message: "Nonfinite water coordinate." });
  }
});

test("water transport yields inside one ring and preserves Float64 holes", async () => {
  const ring = Array.from({ length: 8000 }, (_, i) => [i / 1000003, Math.sin(i)]);
  ring.push(ring[0]);
  const hole = [[0, 0], [0, 0.1], [0.1, 0], [0, 0]];
  let yields = 0;
  const packed = await packWaterGeometry([{ id: "water", feature: { type: "Polygon", coordinates: [ring, hole] } }], {
    scalarBatchSize: 256, yieldTask: async () => { yields++; },
  });
  assert.ok(yields > 50);
  const [entry] = decodePackedRasterUpdates(packed.payload);
  const lines = []; let current;
  streamPackedRasterGeometry(entry.feature, {
    polygonStart() {}, polygonEnd() {}, lineStart() { current = []; lines.push(current); },
    lineEnd() {}, point(x, y) { current.push([x, y]); },
  });
  assert.deepEqual(lines, [ring.slice(0, -1), hole.slice(0, -1)]);
  assert.equal(ring.length, 8001);
  assert.equal(packed.transfer[0], packed.payload.coordinates.buffer);
});

test("water transport cancellation interrupts a single huge ring", async () => {
  const controller = new AbortController();
  const geometry = { type: "Polygon", coordinates: [Array.from({ length: 74484 }, () => [1, 2])] };
  let yields = 0;
  await assert.rejects(packWaterGeometry([{ id: "large", feature: geometry }], {
    signal: controller.signal, scalarBatchSize: 128,
    yieldTask: async () => { if (++yields === 2) controller.abort(); },
  }), { name: "AbortError" });
  assert.equal(yields, 2);
});

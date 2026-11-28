import test from "node:test";
import assert from "node:assert/strict";
import { packWaterGeometry } from "../js/core/renderer/water_geometry_transport.js";

test("water transport matches recursive packing for a fixed multi-ring MultiPolygon", async () => {
  const geometry = { type: "MultiPolygon", coordinates: [
    [
      [[-0, 0], [3.125, 0], [3.125, 4], [-0, 0]],
      [[1, 1], [1, 2], [2, 1], [1, 1]],
    ],
    [[], [[-12.75, 8], [-10, 8], [-10, 9.5], [-12.75, 8]]],
  ] };
  const updates = [{ id: "multi", feature: geometry }];
  const coordinates = [], lengths = [];
  function walk(value, depth) {
    lengths.push(value.length);
    for (const child of value) {
      if (depth > 1) walk(child, depth - 1);
      else coordinates.push(child);
    }
  }
  walk(geometry.coordinates, 4);
  const value = [{ id: "multi", feature: { type: "MultiPolygon", coordinates: [0, 0] } }];
  const packed = await packWaterGeometry(updates);
  assert.deepEqual(packed.payload.value, value);
  assert.deepEqual(new Uint8Array(packed.payload.coordinates.buffer), new Uint8Array(new Float64Array(coordinates).buffer));
  assert.deepEqual(new Uint8Array(packed.payload.lengths.buffer), new Uint8Array(new Uint32Array(lengths).buffer));
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

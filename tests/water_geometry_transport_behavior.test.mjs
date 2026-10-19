import test from "node:test";
import assert from "node:assert/strict";
import { packWaterGeometry } from "../js/core/renderer/water_geometry_transport.js";
import { decodePackedRasterUpdates, streamPackedRasterGeometry } from "../js/core/renderer/packed_geometry.js";

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

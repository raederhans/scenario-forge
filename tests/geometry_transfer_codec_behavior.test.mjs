import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import "../js/core/geometry_transfer_codec_shared.js";
const { pack, unpack } = globalThis.__scenarioForgeGeometryTransferCodecShared;

const shapes = { type: "FeatureCollection", bbox: [-180, -90, 180, 90], features: [{
  type: "Feature", id: "a", properties: { coordinates: ["opaque"], type: "Point", label: "地块" },
  geometry: { type: "GeometryCollection", bbox: [1, 2, 3, 4], geometries: [
    { type: "Point", coordinates: [-0, Infinity, NaN, 1.2345678901234567], custom: "kept" },
    { type: "MultiPoint", coordinates: [[1, 2], [3, 4, 5]] },
    { type: "LineString", coordinates: [[1, 2], [2, 3]] },
    { type: "MultiLineString", coordinates: [[], [[1, 2], [2, 3]]] },
    { type: "Polygon", coordinates: [[[0, 0], [0, 10], [10, 10], [0, 0]], [[1, 1], [2, 1], [1, 2], [1, 1]]] },
    { type: "MultiPolygon", coordinates: [[], [[[0, 0, 3], [1, 1, 4], [0, 0, 3]]]] },
    { type: "Polygon", coordinates: [] },
  ] },
}, { type: "Feature", id: "null", geometry: null }] };

test("real MessageChannel transfer preserves dimensions, holes, foreign members and original geometry", async () => {
  const before = structuredClone(shapes);
  const encoded = pack(shapes, { minCoordinateCount: 0 });
  const { port1, port2 } = new MessageChannel();
  try {
    const received = new Promise((resolve) => port2.once("message", resolve));
    port1.postMessage(encoded.payload, encoded.transferables);
    assert.ok(encoded.transferables.every((buffer) => buffer.byteLength === 0));
    assert.deepEqual(unpack(await received), before);
    assert.deepEqual(shapes, before);
    assert.ok(Array.isArray(shapes.features[0].geometry.geometries[0].coordinates));
  } finally { port1.close(); port2.close(); }
});

test("small, empty and unsupported coordinate inputs retain the original message path", () => {
  for (const value of [shapes, { type: "Point", coordinates: [] }, { type: "Point", coordinates: [1, "2"] }, { unrelated: true }]) {
    const result = pack(value);
    assert.equal(result.payload, value);
    assert.deepEqual(result.transferables, []);
  }
});

test("large repeated geometry and mixed null removal updates roundtrip without detaching sources", () => {
  const geometry = { type: "Polygon", coordinates: [Array.from({ length: 10_000 }, (_, i) => [i / 100, -i / 200, i])] };
  const input = [{ id: "a", feature: { type: "Feature", geometry } }, { id: "b", feature: { type: "Feature", geometry } }, { id: "removed", feature: null }];
  const result = pack(input);
  assert.equal(result.transferables.length, 2);
  assert.deepEqual(unpack(structuredClone(result.payload, { transfer: result.transferables })), input);
  assert.equal(geometry.coordinates[0].length, 10_000);
});

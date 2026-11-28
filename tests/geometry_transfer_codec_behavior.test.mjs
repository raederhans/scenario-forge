import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import "../js/core/geometry_transfer_codec_shared.js";
const { pack, unpack, unpackAsync } = globalThis.__scenarioForgeGeometryTransferCodecShared;

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
    const payload = await received;
    assert.deepEqual(unpack(payload), before);
    assert.deepEqual(await unpackAsync(payload), unpack(payload));
    assert.deepEqual(shapes, before);
    assert.ok(Array.isArray(shapes.features[0].geometry.geometries[0].coordinates));
  } finally { port1.close(); port2.close(); }
});

test("legacy fixed wire fixtures remain readable", async () => {
  for (const encoding of ["geo-f64-v1", "geo-f64-v2"]) {
    const arcs = [[[1, 2], [3, 4]]];
    const payload = {
      encoding,
      value: {
        topology: { type: "Topology", objects: {}, arcs: encoding === "geo-f64-v2" ? [0, 0] : arcs },
        collection: { type: "LineString", coordinates: [4, 4] },
      },
      coordinates: new Float64Array([1, 2, 3, 4, 1, 2, 3, 4]),
      lengths: new Uint32Array([1, 2, 2, 2, 2, 2, 2]),
    };
    const expected = {
      topology: { type: "Topology", objects: {}, arcs },
      collection: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
    };
    assert.deepEqual(unpack(payload), expected);
    assert.deepEqual(await unpackAsync(payload), expected);
  }
});

test("v3 preserves shared rings, lines and geometry roots without merging equal independent points", async () => {
  const line = [[1, 2], [1, 2], [3, 4]];
  const lines = [line, line];
  const input = {
    polygon: { type: "Polygon", coordinates: lines },
    multiLine: { type: "MultiLineString", coordinates: lines },
    topology: { type: "Topology", objects: {}, arcs: lines },
    line: { type: "LineString", coordinates: line },
    point: { type: "Point", coordinates: line[0] },
  };
  const { payload } = pack(input, { shareReferences: true, minCoordinateCount: 0, includeTopologyArcs: true });
  assert.equal(payload.encoding, "geo-f64-v3");
  assert.equal(payload.coordinates.length, 6);
  for (const result of [unpack(payload), await unpackAsync(payload)]) {
    assert.deepEqual(result, input);
    assert.equal(result.polygon.coordinates, result.multiLine.coordinates);
    assert.equal(result.polygon.coordinates, result.topology.arcs);
    assert.equal(result.polygon.coordinates[0], result.polygon.coordinates[1]);
    assert.equal(result.line.coordinates, result.polygon.coordinates[0]);
    assert.equal(result.point.coordinates, result.line.coordinates[0]);
    assert.notEqual(result.line.coordinates[0], result.line.coordinates[1]);
  }
});

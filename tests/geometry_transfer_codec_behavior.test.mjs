import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { MessageChannel } from "node:worker_threads";
import "../js/core/geometry_transfer_codec_shared.js";
const { pack, unpack, unpackAsync } = globalThis.__scenarioForgeGeometryTransferCodecShared;
const topojson = createRequire(import.meta.url)("../vendor/topojson-client.min.js");

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

test("startup v3 transfers topology arcs and nested points while preserving opaque members", async () => {
  const topology = {
    type: "Topology", transform: { scale: [0.01, 0.02], translate: [-180, -90] },
    arcs: [[], [[-0, 1], [2, -3, 4], [5, 6]], [[1.2345678901234567, -1e-20]]],
    coordinates: ["foreign topology metadata"],
    objects: { mixed: { type: "GeometryCollection", geometries: [
      { type: "Point", coordinates: [123, 456], properties: { type: "Point", coordinates: ["opaque"] } },
      { type: "Polygon", arcs: [[1, -3]], properties: { id: "water" } },
    ] } },
  };
  const envelope = { taskId: "startup", payload: { base: { topology_primary: topology } },
    baseDecodedCollections: { waterRegionsData: shapes }, metrics: { decodeMs: 7 } };
  const before = structuredClone(envelope);
  const encoded = pack(envelope, { shareReferences: true, minCoordinateCount: 0, includeTopologyArcs: true });
  assert.equal(encoded.payload.encoding, "geo-f64-v3");
  const { port1, port2 } = new MessageChannel();
  try {
    const received = new Promise((resolve) => port2.once("message", resolve));
    port1.postMessage(encoded.payload, encoded.transferables);
    assert.ok(encoded.transferables.every((buffer) => buffer.byteLength === 0));
    const payload = await received;
    assert.deepEqual(unpack(payload), before);
    assert.deepEqual(await unpackAsync(payload), unpack(payload));
    assert.deepEqual(envelope, before);
  } finally { port1.close(); port2.close(); }
});

test("v3 keeps topology arcs opt-in and invalid coordinates retain the ordinary path", () => {
  const topology = { type: "Topology", arcs: [[[1, 2], [3, 4]]], objects: {} };
  const old = pack({ topology, decoded: shapes }, { minCoordinateCount: 0, shareReferences: true });
  assert.equal(old.payload.encoding, "geo-f64-v3");
  assert.deepEqual(old.payload.value.topology.arcs, topology.arcs);
  assert.deepEqual(unpack(structuredClone(old.payload)), { topology, decoded: shapes });
  for (const value of [topology, { ...topology, arcs: [[[1, "2"]]] }]) {
    const result = pack(value, { shareReferences: true, includeTopologyArcs: true });
    assert.equal(result.payload, value);
    assert.deepEqual(result.transferables, []);
  }
});

for (const includeTopologyArcs of [false, true]) {
  test(`async v3 unpack yields and preserves opaque references with topology arcs ${includeTopologyArcs}`, async () => {
    const topology = { type: "Topology", arcs: [[], [[1, 2], [3, 4]]], objects: {} };
    const { payload } = pack({ topology, decoded: shapes }, { minCoordinateCount: 0, includeTopologyArcs, shareReferences: true });
    let clock = 0, yields = 0;
    const result = await unpackAsync(payload, {
      nowMs: () => { clock += 4; return clock; },
      yieldControl: async () => { yields += 1; },
    });
    assert.deepEqual(result, unpack(payload));
    assert.ok(yields > 0);
    assert.equal(result.decoded.features[0].properties, payload.value.decoded.features[0].properties);
    assert.equal(result.decoded.features[0].geometry.bbox === payload.value.decoded.features[0].geometry.bbox, false);
    if (!includeTopologyArcs) assert.equal(result.topology.arcs, payload.value.topology.arcs);
  });
}

test("async unpack slices a single topology's arcs by line", async () => {
  const topology = { type: "Topology", arcs: Array.from({ length: 100 }, (_, i) => [[i, -i], [i + 1, 2]]), objects: {} };
  const { payload } = pack(topology, { shareReferences: true, minCoordinateCount: 0, includeTopologyArcs: true });
  let clock = 0, yields = 0;
  const result = await unpackAsync(payload, {
    nowMs: () => { clock += 4; return clock; },
    yieldControl: async () => { yields += 1; },
  });
  assert.deepEqual(result, unpack(payload));
  assert.equal(yields, 50);
});

test("async unpack rejects unsupported encodings with the synchronous error", async () => {
  for (const payload of [null, { encoding: "geo-f64-v4" }]) {
    let expected;
    try { unpack(payload); } catch (error) { expected = error; }
    await assert.rejects(unpackAsync(payload), { name: expected.name, message: expected.message });
  }
});

for (const encoding of ["geo-f64-v1", "geo-f64-v2"]) {
  test(`${encoding} fixed wire fixture remains readable`, async () => {
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
  });
}

for (const topologyFirst of [true, false]) {
  test(`v3 preserves unquantized TopoJSON shared points before and after MessageChannel transfer, topology first ${topologyFirst}`, async () => {
    const topology = {
      type: "Topology",
      arcs: [
        [[1, 0], [1, 0.5], [1, 1]],
        [[1, 1], [0, 1], [0, 0], [1, 0]],
        [[1, 0], [2, 0], [2, 1], [1, 1]],
      ],
      objects: { adjacent: { type: "GeometryCollection", geometries: [
        { type: "Polygon", arcs: [[0, 1]] },
        { type: "Polygon", arcs: [[-1, 2]] },
      ] } },
    };
    const collection = topojson.feature(topology, topology.objects.adjacent);
    const input = topologyFirst ? { topology, collection } : { collection, topology };
    const before = structuredClone(input);
    const assertShared = (result) => {
      assert.deepEqual(result, before);
      const left = result.collection.features[0].geometry.coordinates[0];
      const right = result.collection.features[1].geometry.coordinates[0];
      assert.equal(left[1], right[1]);
      assert.equal(left[1], result.topology.arcs[0][1]);
    };
    assertShared(input);
    const encoded = pack(input, { shareReferences: true, minCoordinateCount: 0, includeTopologyArcs: true });
    assert.equal(encoded.payload.encoding, "geo-f64-v3");
    assert.equal(encoded.payload.coordinates.length, 22);
    assertShared(unpack(encoded.payload));
    assertShared(await unpackAsync(encoded.payload));
    const { port1, port2 } = new MessageChannel();
    try {
      const received = new Promise((resolve) => port2.once("message", resolve));
      port1.postMessage(encoded.payload, encoded.transferables);
      assert.ok(encoded.transferables.every((buffer) => buffer.byteLength === 0));
      const payload = await received;
      assert.equal(payload.coordinates.length, 22);
      assertShared(unpack(payload));
      assertShared(await unpackAsync(payload));
      assertShared(input);
    } finally { port1.close(); port2.close(); }
  });
}

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

test("v3 applies minCoordinateCount to unique coordinate scalars", () => {
  const point = [1, 2];
  const input = { type: "MultiPoint", coordinates: [point, point, point] };
  const ordinary = pack(input, { shareReferences: true, minCoordinateCount: 3 });
  assert.equal(ordinary.payload, input);
  assert.deepEqual(ordinary.transferables, []);
  const encoded = pack(input, { shareReferences: true, minCoordinateCount: 2 });
  assert.equal(encoded.payload.encoding, "geo-f64-v3");
  assert.equal(encoded.payload.coordinates.length, 2);
  assert.deepEqual(unpack(encoded.payload), input);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import "../js/core/geometry_transfer_codec_shared.js";
import { decodePackedRasterUpdates, streamPackedRasterGeometry, drawPackedRasterGeometry } from "../js/core/renderer/packed_geometry.js";
import { createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";
const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
const codec = globalThis.__scenarioForgeGeometryTransferCodecShared;
const geometry = { type: "GeometryCollection", geometries: [
  { type: "Polygon", coordinates: [[[170, 65], [-170, 65], [-175, 85], [170, 65]]] },
  { type: "Polygon", coordinates: [[[0, 0], [0, 40], [40, 40], [40, 0], [0, 0]], [[10, 10], [20, 10], [20, 20], [10, 10]]] },
  { type: "MultiPolygon", coordinates: [[[[50, 0], [50, 20], [60, 0], [50, 0]]]] },
  { type: "Point", coordinates: [12, 12, 8] },
  { type: "MultiPoint", coordinates: [[-12, 12], [-10, 0]] },
  { type: "MultiLineString", coordinates: [[[-10, 0], [20, 10], [0, 0]], [[-2, 1], [3, 4]]] },
  { type: "LineString", coordinates: [[30, 3], [45, 10]] },
] };
const feature = { type: "Feature", properties: { id: "region" }, geometry };
function transport(updates) {
  const encoded = codec.pack(updates, { minCoordinateCount: 0 });
  return structuredClone(encoded.payload, { transfer: encoded.transferables });
}
class Path {
  commands = [];
  moveTo(...args) { this.commands.push(["moveTo", ...args]); }
  lineTo(...args) { this.commands.push(["lineTo", ...args]); }
  closePath(...args) { this.commands.push(["closePath", ...args]); }
  arc(...args) { this.commands.push(["arc", ...args]); }
}
const compact = () => decodePackedRasterUpdates(transport([{ id: "region", feature }]))[0].feature;

test("packed source streaming equals real d3.geoStream for all supported geometry types", () => {
  const expected = [], actual = [];
  const sink = (out) => Object.fromEntries(["point", "lineStart", "lineEnd", "polygonStart", "polygonEnd", "sphere"].map((key) => [key, (...args) => out.push([key, ...args])]));
  d3.geoStream(feature, sink(expected));
  streamPackedRasterGeometry(compact(), sink(actual));
  assert.deepEqual(actual, expected);
});

test("packed drawing equals real D3 commands including holes, dateline and projection changes", () => {
  for (const rotation of [[0, 0, 0], [5, 6, 7], [170, 10, 0]]) {
    const projection = d3.geoEqualEarth().scale(180).translate([200, 150]).rotate(rotation).precision(0.1).clipAngle(170).clipExtent([[0, 0], [800, 600]]);
    const expected = new Path(), actual = new Path();
    d3.geoPath(projection, expected).pointRadius(2)(feature);
    drawPackedRasterGeometry(compact(), projection, actual, 2);
    assert.deepEqual(actual.commands, expected.commands);
    assert.ok(actual.commands.length > 20);
  }
});

test("packed features own bounded buffers rather than retaining a whole upload", () => {
  const small = { type: "Point", coordinates: [1, 2, 3] };
  const input = [{ id: "large", feature }, { id: "small", feature: small }];
  const saved = structuredClone(input), packet = transport(input);
  const updates = decodePackedRasterUpdates(packet);
  const retained = updates[1].feature;
  assert.equal(retained.coordinates.byteLength, 24);
  assert.equal(retained.lengths.byteLength, 4);
  assert.notEqual(updates[0].feature.coordinates.buffer, retained.coordinates.buffer);
  assert.notEqual(packet.coordinates.buffer, retained.coordinates.buffer);
  assert.equal(retained.weights.decoded, 256 + 24 + 4);
  assert.deepEqual(input, saved, "source geometry is never detached or rewritten");
});

test("malformed packed offsets and lengths reject before rendering or large allocation", () => {
  assert.throws(() => decodePackedRasterUpdates({ encoding: "other" }), /Invalid packed/);
  const invalidOffset = transport([{ id: "region", feature }]);
  invalidOffset.value[0].feature.geometry.geometries[0].coordinates = [-1, 0];
  assert.throws(() => decodePackedRasterUpdates(invalidOffset), /Invalid packed/);
  const invalidLength = transport([{ id: "region", feature }]);
  invalidLength.lengths[0] = 0xffffffff;
  assert.throws(() => decodePackedRasterUpdates(invalidLength), /Invalid packed/);
});

function harness(options = {}) {
  const draws = [];
  const kernel = createGeometryRasterWorkerKernel({ d3, createPath: () => new Path(), yieldTask: async () => {},
    createCanvas: (width, height) => ({ width, height, getContext: () => ({
      setTransform() {}, translate() {}, scale() {}, clearRect() {},
      fill(path) { draws.push(["fill", path.commands, this.fillStyle]); },
      stroke(path) { draws.push(["stroke", path.commands, this.strokeStyle, this.lineWidth]); },
    }), transferToImageBitmap: () => ({ close() {} }) }), ...options });
  return { kernel, draws };
}
function packet(extra = {}) {
  return { sceneKey: "tno", projectionKey: 1, projectionOptions: {}, kind: "political",
    geometryUpdates: [{ id: "region", feature }], entries: [{ id: "region", fillColor: "#123456", strokeColor: "#654321", lineWidth: 0.3 }],
    width: 800, height: 600, dpr: 2, transform: { x: 3, y: 4, k: 2.5 }, ...extra };
}

test("real worker kernel draws identical packed/plain commands and reuses paths across hit/color frames", async () => {
  const raw = harness(), packed = harness();
  const input = packet();
  await raw.kernel.render(input);
  const result = await packed.kernel.render({ ...input, geometryUpdates: null, geometryTransport: transport(input.geometryUpdates) });
  assert.equal(result.geometryTransportMode, "packed-f64");
  assert.deepEqual(packed.draws, raw.draws);
  assert.equal((await packed.kernel.render(packet({ geometryUpdates: [], kind: "hit" }))).pathBuildCount, 0);
  assert.equal((await packed.kernel.render(packet({ geometryUpdates: [], projectionKey: 2 }))).pathBuildCount, 1);
  await packed.kernel.render(packet({ geometryUpdates: [{ id: "region", feature: null }], entries: [] }));
  await assert.rejects(packed.kernel.render(packet({ geometryUpdates: [] })), /Missing raster geometry/);
});

test("packed cache pressure preserves active data and eviction acknowledgements", async () => {
  const { kernel } = harness({ geometryCacheBudget: 1, pathCacheBudget: 1 });
  const first = await kernel.render(packet({ geometryUpdates: [], geometryTransport: transport(packet().geometryUpdates) }));
  assert.ok(first.cacheBudget.geometry.overBudgetBytes > 0);
  assert.equal((await kernel.render(packet({ geometryUpdates: [] }))).pathBuildCount, 1);
  const retired = await kernel.render(packet({ geometryUpdates: [], entries: [] }));
  assert.deepEqual(retired.evictedGeometryIds, ["region"]);
  assert.equal(retired.cacheBudget.geometry.entries, 0);
});


test("point radius numeric coercion matches D3", () => {
  const projection = d3.geoEqualEarth();
  const expected = new Path(), actual = new Path();
  d3.geoPath(projection, expected).pointRadius("3")(feature);
  drawPackedRasterGeometry(compact(), projection, actual, "3");
  assert.deepEqual(actual.commands, expected.commands);
});

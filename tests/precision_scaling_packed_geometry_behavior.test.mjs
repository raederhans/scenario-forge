import { RecordingPath as Path } from "./helpers/recording_path.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import "../js/core/geometry_transfer_codec_shared.js";
import { decodePackedRasterUpdates, streamPackedRasterGeometry, drawPackedRasterGeometry } from "../js/core/renderer/packed_geometry.js";

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

test("malformed packed offsets and lengths reject before rendering or large allocation", () => {
  assert.throws(() => decodePackedRasterUpdates({ encoding: "other" }), /Invalid packed/);
  const invalidOffset = transport([{ id: "region", feature }]);
  invalidOffset.value[0].feature.geometry.geometries[0].coordinates = [-1, 0];
  assert.throws(() => decodePackedRasterUpdates(invalidOffset), /Invalid packed/);
  const invalidLength = transport([{ id: "region", feature }]);
  invalidLength.lengths[0] = 0xffffffff;
  assert.throws(() => decodePackedRasterUpdates(invalidLength), /Invalid packed/);
});

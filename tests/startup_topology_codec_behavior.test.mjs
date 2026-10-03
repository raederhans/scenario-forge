import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import "../js/core/json_resource_decoder_shared.js";

const require = createRequire(import.meta.url);
const codec = require("../js/core/startup_topology_codec_shared.js");
const v7Fixture = JSON.parse(readFileSync(new URL("./fixtures/startup_topology_v7.json", import.meta.url), "utf8"));

const fixture = {
  type: "Topology",
  transform: { scale: [0.1, 0.1], translate: [-180, -90] },
  bbox: [-180, -90, 180, 90],
  objects: {
    water_regions: {
      type: "GeometryCollection",
      geometries: [{ type: "LineString", properties: { id: "water-1", source: "MarineRegions" }, arcs: [0] }],
    },
  },
  arcs_encoding: {
    encoding: "topology-delta-zigzag-uleb128-cross-arc-origin-v1",
    arc_count: 3,
    point_count: 5,
    arc_lengths_u32_le_base64: "AwAAAAIAAAAAAAAA",
    delta_pairs_zigzag_uleb128_base64: "GAkIAAMGBgMAAg==",
    first_delta_mode: "first pair stores this arc absolute integer start minus previous nonempty arc start",
  },
};

function cloneFixture() {
  return structuredClone(fixture);
}

function encodeSigned(value, target) {
  let encoded = value >= 0 ? value * 2 : -value * 2 - 1;
  while (encoded >= 128) {
    target.push((encoded % 128) + 128);
    encoded = Math.floor(encoded / 128);
  }
  target.push(encoded);
}

function encodedTopologyFromDeltaArcs(arcs) {
  const lengths = Buffer.alloc(arcs.length * 4);
  const stream = [];
  let pointCount = 0;
  arcs.forEach((arc, arcIndex) => {
    lengths.writeUInt32LE(arc.length, arcIndex * 4);
    pointCount += arc.length;
    for (const [x, y] of arc) {
      encodeSigned(x, stream);
      encodeSigned(y, stream);
    }
  });
  return {
    type: "Topology",
    transform: { scale: [1, 1], translate: [0, 0] },
    objects: {},
    arcs_encoding: {
      encoding: codec.encoding,
      arc_count: arcs.length,
      point_count: pointCount,
      arc_lengths_u32_le_base64: lengths.toString("base64"),
      delta_pairs_zigzag_uleb128_base64: Buffer.from(stream).toString("base64"),
      first_delta_mode: "first pair stores this arc absolute integer start minus previous nonempty arc start",
    },
  };
}

test("startup topology codec restores exact cross-arc integer deltas and preserves metadata", () => {
  const decoded = codec.decodeTopology(fixture);
  assert.deepEqual(decoded.arcs, [
    [[12, -5], [4, 0], [-2, 3]],
    [[15, -7], [0, 1]],
    [],
  ]);
  assert.equal(Object.hasOwn(decoded, "arcs_encoding"), false);
  assert.deepEqual(decoded.transform, fixture.transform);
  assert.deepEqual(decoded.objects, fixture.objects);
  assert.deepEqual(decoded.bbox, fixture.bbox);
});

test("startup topology codec passes legacy TopoJSON through unchanged", () => {
  const legacy = { type: "Topology", arcs: [[[0, 0], [1, -1]]], objects: {} };
  assert.equal(codec.decodeTopology(legacy), legacy);
  assert.equal(codec.decodeTopology(null), null);
});

test("startup topology codec rejects unknown, contradictory, and count-mismatched descriptors", () => {
  const unknown = cloneFixture();
  unknown.arcs_encoding.encoding = "future-format";
  assert.throws(() => codec.decodeTopology(unknown), /unsupported/);

  const wrongType = cloneFixture();
  wrongType.type = "FeatureCollection";
  assert.throws(() => codec.decodeTopology(wrongType), /not a Topology/);

  const contradictory = cloneFixture();
  contradictory.arcs = [];
  assert.throws(() => codec.decodeTopology(contradictory), /both arcs and arcs_encoding/);

  const wrongPointCount = cloneFixture();
  wrongPointCount.arcs_encoding.point_count += 1;
  assert.throws(() => codec.decodeTopology(wrongPointCount), /point_count does not match/);

  const tooManyArcs = cloneFixture();
  tooManyArcs.arcs_encoding.arc_count = 1_000_001;
  assert.throws(() => codec.decodeTopology(tooManyArcs), /arc_count is invalid/);
});

test("startup topology codec rejects invalid base64, truncated or trailing streams", () => {
  const invalidBase64 = cloneFixture();
  invalidBase64.arcs_encoding.arc_lengths_u32_le_base64 = "%%%";
  assert.throws(() => codec.decodeTopology(invalidBase64), /base64/);

  const truncated = cloneFixture();
  truncated.arcs_encoding.delta_pairs_zigzag_uleb128_base64 = Buffer
    .from(truncated.arcs_encoding.delta_pairs_zigzag_uleb128_base64, "base64")
    .subarray(0, -1)
    .toString("base64");
  assert.throws(() => codec.decodeTopology(truncated), /size is invalid|truncated/);

  const trailing = cloneFixture();
  trailing.arcs_encoding.delta_pairs_zigzag_uleb128_base64 = Buffer
    .concat([Buffer.from(trailing.arcs_encoding.delta_pairs_zigzag_uleb128_base64, "base64"), Buffer.from([0])])
    .toString("base64");
  assert.throws(() => codec.decodeTopology(trailing), /trailing bytes/);
});

test("startup topology codec rejects predictor overflow and overlong varints", () => {
  const overflow = encodedTopologyFromDeltaArcs([
    [[100, 0]],
    [[2_147_483_548, 0]],
  ]);
  assert.throws(() => codec.decodeTopology(overflow), /predictor overflow/);

  const overlong = cloneFixture();
  const bytes = Buffer.from(overlong.arcs_encoding.delta_pairs_zigzag_uleb128_base64, "base64");
  overlong.arcs_encoding.delta_pairs_zigzag_uleb128_base64 = Buffer
    .concat([bytes.subarray(0, 0), Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80]), bytes.subarray(2)])
    .toString("base64");
  assert.throws(() => codec.decodeTopology(overlong), /varint exceeds uint32/);
});

for (const fallback of [false, true]) {
  test(`v7 restores Python wire closed arcs and nested signed references via ${fallback ? "fallback" : "native"} gzip`, async () => {
    const native = globalThis.DecompressionStream;
    if (fallback) globalThis.DecompressionStream = undefined;
    try {
      const input = structuredClone(v7Fixture.encoded);
      const decoded = await codec.decodeStartupTopology(input);
      assert.deepEqual(decoded, v7Fixture.source);
      assert.deepEqual(input, v7Fixture.encoded, "decoding must not mutate wire metadata or references");
      assert.deepEqual(decoded.objects.political.properties.arcs, ["opaque"]);
      assert.equal(Object.hasOwn(decoded, "arc_references_encoding"), false);
    } finally {
      globalThis.DecompressionStream = native;
    }
  });
}

test("async startup decoder preserves legacy identity and accepts v6 arcs", async () => {
  const legacy = structuredClone(v7Fixture.source);
  assert.equal(await codec.decodeStartupTopology(legacy), legacy);
  assert.equal(await codec.decodeStartupTopology(null), null);
  assert.deepEqual(await codec.decodeStartupTopology(fixture), codec.decodeTopology(fixture));
});

function setGzip(descriptor, key, bytes) {
  descriptor[key] = gzipSync(Buffer.from(bytes)).toString("base64");
}

test("v7 rejects malformed counts, closed flags and corrupted gzip", async () => {
  for (const [mutate, message] of [
    [(value) => { value.arcs_encoding.delta_bytes = 1_000; }, /delta_bytes is invalid/],
    [(value) => { value.arcs_encoding.arc_count = 0; }, /nonzero/],
    [(value) => { setGzip(value.arcs_encoding, "closed_gzip_base64", [0x80]); }, /unused closed flags/],
    [(value) => { setGzip(value.arcs_encoding, "closed_gzip_base64", [0x04]); }, /invalid closed arc/],
    [(value) => { setGzip(value.arcs_encoding, "closed_gzip_base64", [0, 0]); }, /declared limit/],
    [(value) => { value.arcs_encoding.lengths_gzip_base64 = "%%%="; }, /base64/],
    [(value) => {
      const bytes = Buffer.from(value.arcs_encoding.deltas_gzip_base64, "base64");
      bytes[bytes.length - 8] ^= 0xff;
      value.arcs_encoding.deltas_gzip_base64 = bytes.toString("base64");
    }, /decompress/i],
  ]) {
    const value = structuredClone(v7Fixture.encoded);
    mutate(value);
    await assert.rejects(codec.decodeStartupTopology(value), message);
  }
});

test("v7 rejects conflicting references, invalid indices, unused signs and trailing bytes", async () => {
  for (const [mutate, message] of [
    [(value) => { value.arc_references_encoding.encoding = "future"; }, /reference encoding/],
    [(value) => { value.objects.political.arcs = []; }, /conflicting arc references/],
    [(value) => {
      const size = value.arc_references_encoding.refs_bytes;
      setGzip(value.arc_references_encoding, "refs_gzip_base64", [8, ...Array(size - 1).fill(0)]);
    }, /reference index out of range/],
    [(value) => {
      const descriptor = value.arc_references_encoding;
      const size = Math.ceil(descriptor.reference_count / 8);
      setGzip(descriptor, "signs_gzip_base64", [...Array(size - 1).fill(0), 0x80]);
    }, /unused reference signs/],
    [(value) => {
      const descriptor = value.arc_references_encoding;
      descriptor.reference_count += 1;
    }, /count|limit|length/],
    [(value) => {
      const descriptor = value.arc_references_encoding;
      const bytes = gunzipSync(Buffer.from(descriptor.refs_gzip_base64, "base64"));
      descriptor.refs_bytes += 1;
      setGzip(descriptor, "refs_gzip_base64", [...bytes, 0]);
    }, /trailing bytes/],
  ]) {
    const value = structuredClone(v7Fixture.encoded);
    mutate(value);
    await assert.rejects(codec.decodeStartupTopology(value), message);
  }
});

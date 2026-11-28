import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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

test("startup topology codec rejects a truncated stream", () => {
  const truncated = cloneFixture();
  truncated.arcs_encoding.delta_pairs_zigzag_uleb128_base64 = Buffer
    .from(truncated.arcs_encoding.delta_pairs_zigzag_uleb128_base64, "base64")
    .subarray(0, -1)
    .toString("base64");
  assert.throws(() => codec.decodeTopology(truncated), /size is invalid|truncated/);
});

test("v7 restores the compressed Python wire fixture", async () => {
  const input = structuredClone(v7Fixture.encoded);
  const decoded = await codec.decodeStartupTopology(input);
  assert.deepEqual(decoded, v7Fixture.source);
});

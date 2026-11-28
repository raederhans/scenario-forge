import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { loadScenarioChunkFile } from "../js/core/scenario/bundle_loader.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const vendorContext = vm.createContext({});
vm.runInContext(source("../vendor/topojson-client.min.js"), vendorContext);
const topojson = vendorContext.topojson;

// Absolute arcs include a shared border, reversed arcs, closed rings, a hole,
// multiple polygon components, and decimals that must survive without rounding.
const topology = {
  type: "Topology",
  objects: { political: { type: "GeometryCollection", geometries: [
    { type: "Polygon", id: 0, properties: { name: "岛", nested: { tags: ["A", "B"] } }, arcs: [[0, 1, 2, 3], [4]] },
    { type: "Polygon", id: "neighbor", properties: { rank: 2 }, arcs: [[-2, 5]] },
    { type: "MultiPolygon", id: "islands", properties: {}, arcs: [[[6]], [[-8]]] },
  ] } },
  arcs: [
    [[0.123456789012345, 0], [4, 0]],
    [[4, 0], [4, 4]],
    [[4, 4], [0.123456789012345, 4]],
    [[0.123456789012345, 4], [0.123456789012345, 0]],
    [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]],
    [[4, 0], [8, 0], [8, 4], [4, 4]],
    [[10.123456789012345, -0.000000000001], [11, 0], [11, 1], [10.123456789012345, -0.000000000001]],
    [[20, 0], [21, 0], [21, 1], [20, 0]],
  ],
};
const expected = {
  type: "FeatureCollection", features: [
    { type: "Feature", id: 0, properties: { name: "岛", nested: { tags: ["A", "B"] } }, geometry: {
      type: "Polygon", coordinates: [
        [[0.123456789012345, 0], [4, 0], [4, 4], [0.123456789012345, 4], [0.123456789012345, 0]],
        [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]],
      ],
    } },
    { type: "Feature", id: "neighbor", properties: { rank: 2 }, geometry: {
      type: "Polygon", coordinates: [[[4, 4], [4, 0], [8, 0], [8, 4], [4, 4]]],
    } },
    { type: "Feature", id: "islands", properties: {}, geometry: {
      type: "MultiPolygon", coordinates: [
        [[[10.123456789012345, -0.000000000001], [11, 0], [11, 1], [10.123456789012345, -0.000000000001]]],
        [[[20, 0], [21, 1], [21, 0], [20, 0]]],
      ],
    } },
  ],
};
const normalObject = (value) => structuredClone(value);

const jsonResponse = (payload, compressed = false) => new Response(
  compressed ? gzipSync(JSON.stringify(payload)) : JSON.stringify(payload),
);

function installVendor(t) {
  const previous = globalThis.topojson;
  globalThis.topojson = topojson;
  t.after(() => {
    if (previous === undefined) delete globalThis.topojson;
    else globalThis.topojson = previous;
  });
}

for (const compressed of [false, true]) {
  test(`main loader returns GeoJSON from ${compressed ? "gzip" : "plain"} TopoJSON`, async (t) => {
    installVendor(t);
    const controller = new AbortController();
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      assert.equal(options.signal, controller.signal);
      return jsonResponse(topology, compressed);
    });
    const result = await loadScenarioChunkFile(`political.json${compressed ? ".gz" : ""}`, {
      useWorker: false, signal: controller.signal,
    });
    assert.deepEqual(normalObject(result.payload), expected);
    assert.equal(result.reason, "main-thread");
    assert.equal(result.metrics.compressed, compressed);
    assert.equal(result.metrics.decodedBytes, Buffer.byteLength(JSON.stringify(topology)));
  });
}

test("main loader rejects invalid topology", async (t) => {
  installVendor(t);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  t.after(() => { globalThis.fetch = previousFetch; });

  await assert.rejects(loadScenarioChunkFile("bad.json", {
    useWorker: false, d3Client: { json: async () => ({ type: "Topology", objects: {}, arcs: [] }) },
  }), /requires.*political/);
});

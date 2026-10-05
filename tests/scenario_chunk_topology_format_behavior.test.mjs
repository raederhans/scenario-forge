import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { loadScenarioChunkFile } from "../js/core/scenario/bundle_loader.js";
import { terminateStartupWorker } from "../js/core/startup_worker_client.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const workerSource = source("../js/workers/startup_boot.worker.js");
const importedScripts = new Map([
  ["feature_identity_shared.js", source("../js/core/feature_identity_shared.js")],
  ["json_resource_decoder_shared.js", source("../js/core/json_resource_decoder_shared.js")],
  ["scenario_chunk_format_shared.js", source("../js/core/scenario_chunk_format_shared.js")],
  ["geometry_transfer_codec_shared.js", source("../js/core/geometry_transfer_codec_shared.js")],
  ["topojson-client.min.js", source("../vendor/topojson-client.min.js")],
]);
const vendorContext = vm.createContext({});
vm.runInContext(importedScripts.get("topojson-client.min.js"), vendorContext);
const topojson = vendorContext.topojson;
const { decodeScenarioChunkPayload } = globalThis.__scenarioForgeScenarioChunkFormatShared;

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

function createWorkerHarness({ fetchResource, onPost = null } = {}) {
  const posted = [];
  const context = {
    AbortController, ArrayBuffer, Blob, DecompressionStream, DOMException,
    Response, TextDecoder, TextEncoder, Uint8Array, URL, console, performance,
    location: { href: "https://example.test/js/workers/startup_boot.worker.js", origin: "https://example.test" },
    fetch: fetchResource,
    postMessage(message) {
      const cloned = normalObject(message);
      posted.push(cloned);
      onPost?.(cloned);
    },
    importScripts(...urls) {
      for (const url of urls) {
        const filename = new URL(url).pathname.split("/").at(-1);
        assert.ok(importedScripts.has(filename), `unexpected worker import: ${url}`);
        vm.runInContext(importedScripts.get(filename), context, { filename });
      }
    },
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(workerSource, context, { filename: "startup_boot.worker.js" });
  return { posted, context };
}

async function workerReply(harness, message) {
  harness.context.onmessage({ data: { type: "DECODE_RUNTIME_CHUNK", taskId: "format-test", ...message } });
  for (let attempt = 0; attempt < 50 && !harness.posted.length; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(harness.posted.length, 1);
  return harness.posted[0];
}

function installVendor(t) {
  const previous = globalThis.topojson;
  globalThis.topojson = topojson;
  t.after(() => {
    if (previous === undefined) delete globalThis.topojson;
    else globalThis.topojson = previous;
  });
}

test("shared decoder preserves exact coordinates, arc direction, holes, components and feature metadata", () => {
  const original = structuredClone(topology);
  assert.deepEqual(normalObject(decodeScenarioChunkPayload(topology, topojson)), expected);
  assert.deepEqual(topology, original, "decoding must not mutate the transfer payload");
});

test("plain collections and non-geometry metadata retain their original identity", () => {
  for (const payload of [expected, { chunks: [] }, { featureIds: ["a"] }, { schema: "mesh", arcs: [] }, null]) {
    assert.equal(decodeScenarioChunkPayload(payload, null), payload);
  }
});

test("invalid topology and missing or invalid decoders fail explicitly", () => {
  for (const payload of [
    { type: "Topology", objects: {}, arcs: [] },
    { type: "Topology", objects: { political: { type: "Polygon", arcs: [] } }, arcs: [] },
    { type: "Topology", objects: { political: { type: "GeometryCollection" } }, arcs: [] },
    { ...topology, arcs: undefined },
  ]) assert.throws(() => decodeScenarioChunkPayload(payload, topojson), /requires.*political/);
  assert.throws(() => decodeScenarioChunkPayload(topology, null), /decoder is not available/);
  assert.throws(() => decodeScenarioChunkPayload(topology, { feature: () => null }), /did not return/);
  assert.throws(() => decodeScenarioChunkPayload(topology, { feature: () => ({ type: "FeatureCollection", features: [] }) }), /did not return/);
  const invalidArc = structuredClone(topology);
  invalidArc.objects.political.geometries[0].arcs = [[999]];
  assert.throws(() => decodeScenarioChunkPayload(invalidArc, topojson));
});

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

  test(`worker loader returns GeoJSON from ${compressed ? "gzip" : "plain"} TopoJSON through the real client`, async (t) => {
    terminateStartupWorker();
    const previous = globalThis.Worker;
    let request;
    globalThis.Worker = class {
      constructor() {
        this.harness = createWorkerHarness({
          fetchResource: async (_url, options) => {
            assert.ok(options.signal);
            return jsonResponse(topology, compressed);
          },
          onPost: (message) => this.onmessage({ data: message }),
        });
      }
      postMessage(message) { request = message; this.harness.context.onmessage({ data: message }); }
      terminate() {}
    };
    t.after(() => {
      terminateStartupWorker();
      if (previous === undefined) delete globalThis.Worker;
      else globalThis.Worker = previous;
    });
    t.mock.method(globalThis, "fetch", () => { throw new Error("worker success must not fall back"); });
    const result = await loadScenarioChunkFile(`https://example.test/political.json${compressed ? ".gz" : ""}`, { useWorker: true });
    assert.equal(request.chunkType, "scenario-chunk");
    assert.equal(result.reason, "worker");
    assert.deepEqual(result.payload, expected);
    assert.equal(result.metrics.compressed, compressed);
  });
}

test("main loader retains plain payload identity and rejects invalid topology", async (t) => {
  installVendor(t);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  t.after(() => { globalThis.fetch = previousFetch; });
  for (const payload of [expected, { chunks: [] }, { mesh: { arcs: [] } }, { featureIds: ["a"] }]) {
    const result = await loadScenarioChunkFile("plain.json", { useWorker: false, d3Client: { json: async () => payload } });
    assert.equal(result.payload, payload);
  }
  await assert.rejects(loadScenarioChunkFile("bad.json", {
    useWorker: false, d3Client: { json: async () => ({ type: "Topology", objects: {}, arcs: [] }) },
  }), /requires.*political/);
});

test("worker rejects malformed scenario topology and preserves ordinary metadata", async () => {
  const bad = createWorkerHarness({ fetchResource: async () => jsonResponse({ type: "Topology", objects: {}, arcs: [] }) });
  const error = await workerReply(bad, { chunkType: "scenario-chunk", chunkUrl: "/bad.json" });
  assert.equal(error.type, "ERROR");
  assert.match(error.message, /requires.*political/);
  assert.equal("chunkPayload" in error, false);
  const metadata = { chunks: [], featureIds: ["a"], mesh: { arcs: [] } };
  const plain = createWorkerHarness({ fetchResource: async () => jsonResponse(metadata) });
  assert.deepEqual((await workerReply(plain, { chunkType: "scenario-chunk", chunkUrl: "/meta.json" })).chunkPayload, metadata);
});

test("full runtime topology keeps its raw topology and separate decoded collections", async () => {
  const harness = createWorkerHarness({ fetchResource: async () => jsonResponse(topology) });
  const reply = await workerReply(harness, { chunkType: "runtime-topology", runtimeTopologyUrl: "/runtime.topo.json" });
  assert.equal(reply.type, "RUNTIME_CHUNK_READY");
  assert.deepEqual(reply.runtimePoliticalTopology, topology);
  assert.deepEqual(reply.decodedCollections.politicalData, expected);
  assert.equal("chunkPayload" in reply, false);
});

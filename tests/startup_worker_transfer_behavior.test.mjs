import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { isMainThread, parentPort, Worker as ThreadWorker, workerData } from "node:worker_threads";

const workerUrl = new URL("../js/workers/startup_boot.worker.js", import.meta.url);
const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");

// Run classic scripts in the worker's own realm: a separate VM context would
// make plain fixture objects fail the codec's Object.prototype check.
if (!isMainThread) {
  globalThis.self = globalThis;
  globalThis.location = { href: workerUrl.href, origin: "https://fixture.test" };
  let packedSource = null;
  globalThis.importScripts = (...urls) => {
    for (const url of urls) {
      if (url.endsWith("/topojson-client.min.js")) {
        globalThis.topojson = topojson;
      } else {
        vm.runInThisContext(readFileSync(new URL(url), "utf8"), { filename: url });
      }
    }
    const codec = globalThis.__scenarioForgeGeometryTransferCodecShared;
    globalThis.__scenarioForgeGeometryTransferCodecShared = {
      ...codec,
      pack(value, options) {
        packedSource = { value, before: structuredClone(value) };
        return codec.pack(value, options);
      },
    };
  };
  globalThis.fetch = async (url) => {
    const resource = workerData.resources[new URL(url).pathname];
    return resource === undefined
      ? new Response("missing fixture", { status: 404 })
      : new Response(JSON.stringify(resource), { headers: { "Content-Type": "application/json" } });
  };
  globalThis.postMessage = (message, transfer = []) => {
    const source = packedSource;
    packedSource = null;
    const byteLengthsBefore = transfer.map((buffer) => buffer.byteLength);
    parentPort.postMessage(message, transfer);
    // This happens after the actual worker_threads transfer, not a mocked post.
    const byteLengthsAfter = transfer.map((buffer) => buffer.byteLength);
    let sourceIntact = false;
    let sourceFailure = "";
    try {
      if (source) {
        assert.deepEqual(source.value, source.before);
        sourceIntact = true;
      }
    } catch (error) {
      sourceFailure = error.message;
    }
    parentPort.postMessage({
      testTransferAudit: true, taskId: message.taskId,
      byteLengthsBefore, byteLengthsAfter, sourceIntact, sourceFailure,
      source: source?.before,
    });
  };
  vm.runInThisContext(readFileSync(workerUrl, "utf8"), { filename: workerUrl.href });
  parentPort.on("message", (message) => globalThis.onmessage({ data: message }));
} else {
  const client = await import("../js/core/startup_worker_client.js");

  function makeTopology(pointCount = 8192) {
    const arc = Array.from({ length: pointCount }, (_, index) => (
      index === 0 ? [0, 0] : [index % 2, (index + 1) % 2]
    ));
    arc[pointCount - 1] = [-Math.floor((pointCount - 1) / 2), -Math.floor((pointCount - 2) / 2)];
    const polygon = {
      type: "Polygon", id: "fixture-land", arcs: [[0]],
      properties: { iso_a2: "UK", name: "测试地块", type: "Point", coordinates: ["opaque"] },
    };
    const point = { type: "Point", id: "fixture-water", coordinates: [2, 3], properties: { label: "水域" } };
    return {
      type: "Topology", bbox: [-180, -90, 180, 90],
      transform: { scale: [0.01, 0.02], translate: [-180, -90] },
      coordinates: ["foreign topology metadata"], arcs: [arc],
      objects: {
        political: { type: "GeometryCollection", geometries: [polygon], computed_neighbors: [[]] },
        water_regions: { type: "GeometryCollection", geometries: [point] },
        scenario_water: { type: "GeometryCollection", geometries: [point] },
      },
    };
  }

  function makeResources(pointCount) {
    const topology = makeTopology(pointCount);
    const collection = topojson.feature(topology, topology.objects.political);
    return {
      "/topology.json": topology,
      "/locales.json": { ui: { ready: "准备完成" }, geo: { "fixture-land": "地块" } },
      "/aliases.json": { alias_to_stable_key: { "地块": "fixture-land" } },
      "/chunk.json": collection,
      "/bundle.json": {
        scenario_id: "transfer-fixture",
        base: { topology_primary: topology },
        scenario: {
          runtime_topology_bootstrap: topology,
          bootstrap_strategy: "fixture", geo_locale_patch: { "fixture-land": "地块" },
          countries: { countries: { GB: { name: "Britain" } } },
          owners: { owners: { "fixture-land": "GB" } },
          controllers: { controllers: { "fixture-land": "GB" } },
          cores: { cores: { "fixture-land": ["GB"] } },
        },
      },
    };
  }

  async function withWorker(resources, run) {
    const originalWorker = globalThis.Worker;
    const originalLocation = globalThis.location;
    let adapter;
    class BrowserWorkerAdapter {
      constructor(url) {
        assert.equal(url.href, workerUrl.href);
        adapter = this;
        this.requests = [];
        this.responses = [];
        this.audits = new Map();
        this.auditWaiters = new Map();
        this.thread = new ThreadWorker(new URL(import.meta.url), { workerData: { resources } });
        this.thread.on("message", (message) => {
          if (message.testTransferAudit) {
            this.audits.set(message.taskId, message);
            this.auditWaiters.get(message.taskId)?.resolve(message);
            this.auditWaiters.delete(message.taskId);
          } else {
            this.responses.push(message);
            this.onmessage?.({ data: message });
          }
        });
        this.thread.on("error", (error) => {
          for (const waiter of this.auditWaiters.values()) waiter.reject(error);
          this.auditWaiters.clear();
          this.onerror?.({ error, message: error.message });
        });
      }
      postMessage(message, transfer) {
        this.requests.push(structuredClone(message));
        this.thread.postMessage(message, transfer);
      }
      audit(taskId) {
        if (this.audits.has(taskId)) return Promise.resolve(this.audits.get(taskId));
        return new Promise((resolve, reject) => this.auditWaiters.set(taskId, { resolve, reject }));
      }
      terminate() {
        this.termination = this.thread.terminate();
      }
    }
    globalThis.Worker = BrowserWorkerAdapter;
    globalThis.location = { href: "https://fixture.test/app/", search: "" };
    try {
      await run(() => adapter);
    } finally {
      client.terminateStartupWorker();
      await adapter?.termination;
      globalThis.Worker = originalWorker;
      globalThis.location = originalLocation;
    }
  }

  function expectedCollections(topology, runtime = false) {
    const names = runtime ? {
      politicalData: "political", scenarioLandMaskData: "land_mask",
      scenarioContextLandMaskData: "context_land_mask", scenarioWaterRegionsData: "scenario_water",
      scenarioSpecialRegionsData: "scenario_special_land", scenarioAtlantropaData: "scenario_atlantropa",
    } : {
      landData: "political", specialZonesData: "special_zones", riversData: "rivers",
      waterRegionsData: "water_regions", oceanData: "ocean", landBgData: "land",
      urbanData: "urban", physicalData: "physical",
    };
    return Object.fromEntries(Object.entries(names).map(([field, objectName]) => [
      field, topology.objects[objectName] ? topojson.feature(topology, topology.objects[objectName]) : null,
    ]));
  }

  const readyCases = [
    {
      type: "BASE_STARTUP_READY", requestType: "LOAD_BASE_STARTUP",
      load: () => client.loadBaseStartupViaWorker({
        topologyUrl: "/topology.json", localesUrl: "/locales.json", geoAliasesUrl: "/aliases.json",
      }),
      check(result, resources) {
        assert.deepEqual(result.topologyPrimary, resources["/topology.json"]);
        assert.deepEqual(result.locales, resources["/locales.json"]);
        assert.deepEqual(result.geoAliases, resources["/aliases.json"]);
        assert.deepEqual(result.decodedCollections, expectedCollections(resources["/topology.json"]));
      },
    },
    {
      type: "STARTUP_BUNDLE_READY", requestType: "LOAD_STARTUP_BUNDLE",
      load: () => client.loadStartupBundleViaWorker({ startupBundleUrl: "/bundle.json", scenarioId: "transfer-fixture", language: "zh" }),
      check(result, resources) {
        assert.deepEqual(result.payload, resources["/bundle.json"]);
        assert.deepEqual(result.baseDecodedCollections, expectedCollections(resources["/topology.json"]));
        assert.deepEqual(result.runtimeDecodedCollections, expectedCollections(resources["/topology.json"], true));
        assert.deepEqual(result.runtimePoliticalMeta.canonicalCountryByFeatureId, { "fixture-land": "GB" });
        assert.equal(result.metrics.startupBundle.language, "zh");
      },
    },
    {
      type: "SCENARIO_RUNTIME_BOOTSTRAP_READY", requestType: "LOAD_SCENARIO_RUNTIME_BOOTSTRAP",
      load: () => client.loadScenarioRuntimeBootstrapViaWorker({ runtimeTopologyUrl: "/topology.json" }),
      check(result, resources) {
        assert.deepEqual(result.runtimePoliticalTopology, resources["/topology.json"]);
        assert.deepEqual(result.decodedCollections, expectedCollections(resources["/topology.json"], true));
        assert.deepEqual(result.runtimePoliticalMeta, {
          featureIds: ["fixture-land"], featureIndexById: { "fixture-land": 0 },
          canonicalCountryByFeatureId: { "fixture-land": "GB" }, neighborGraph: [[]],
        });
      },
    },
  ];

  async function assertTransport(adapter, result, { type, requestType, field, encoding }) {
    const wire = adapter.responses.at(-1);
    const request = adapter.requests.at(-1);
    assert.equal(wire.type, type);
    assert.equal(request.type, requestType);
    assert.equal(wire.taskId, request.taskId);
    assert.ok(wire.taskId.startsWith(`${requestType}:`));
    assert.ok(wire.geometryTransport, "large geometry must use the transfer path");
    assert.equal(wire.geometryTransport.field, field);
    assert.equal(wire.geometryTransport.payload.encoding, encoding);
    assert.ok(wire.geometryTransport.payload.coordinates instanceof Float64Array);
    assert.ok(wire.geometryTransport.payload.lengths instanceof Uint32Array);
    assert.ok(wire.geometryTransport.payload.coordinates.length >= 16384);
    assert.ok(Number.isFinite(result.metrics.geometryPackingMs));
    assert.ok(Number.isFinite(result.metrics.geometryUnpackingMs));
    const { geometryUnpackingMs, ...metrics } = result.metrics;
    assert.ok(geometryUnpackingMs >= 0);
    assert.deepEqual(metrics, wire.metrics);
    const audit = await adapter.audit(wire.taskId);
    assert.equal(audit.sourceIntact, true, audit.sourceFailure);
    assert.equal(audit.byteLengthsBefore.length, 2);
    assert.ok(audit.byteLengthsBefore.every((length) => length > 0));
    assert.deepEqual(audit.byteLengthsAfter, [0, 0]);
    if (field === "message") {
      assert.equal(wire.geometryTransport.payload.value.taskId, request.taskId);
      assert.equal(audit.source.taskId, request.taskId);
      for (const [key, value] of Object.entries(result)) {
        if (key !== "metrics") assert.deepEqual(value, audit.source[key]);
      }
    } else {
      assert.equal(wire[field], null);
      assert.deepEqual(result[field], audit.source);
    }
  }

  for (const ready of readyCases) {
    test(`${ready.type} transfers the full v2 envelope through the real worker and client`, async () => {
      const resources = makeResources();
      const before = structuredClone(resources);
      await withWorker(resources, async (adapter) => {
        const result = await ready.load();
        ready.check(result, resources);
        await assertTransport(adapter(), result, { ...ready, field: "message", encoding: "geo-f64-v2" });
        assert.deepEqual(resources, before);
      });
    });
  }

  test("v6 encoded base topology is restored before decoding and full-envelope transfer", async () => {
    const resources = makeResources();
    // Fixed wire bytes cover nonzero cross-arc origins, a reverse arc reference,
    // and an empty arc. The runtime topology exercises the real v2 threshold.
    const baseTopology = {
      type: "Topology", bbox: [-180, -90, 180, 90],
      transform: { scale: [0.1, 0.1], translate: [-180, -90] },
      objects: {
        political: { type: "GeometryCollection", computed_neighbors: [[]], geometries: [{
          type: "LineString", id: "encoded-land", arcs: [0, -2],
          properties: { iso_a2: "UK", label: "编码地块", coordinates: ["opaque"] },
        }] },
        water_regions: { type: "GeometryCollection", geometries: [{
          type: "LineString", id: "encoded-water", arcs: [1], properties: { label: "水域" },
        }] },
      },
      arcs: [[[12, -5], [4, 0], [-2, 3]], [[15, -7], [0, 1]], []],
    };
    const { arcs, ...encodedTopology } = baseTopology;
    encodedTopology.arcs_encoding = {
      encoding: "topology-delta-zigzag-uleb128-cross-arc-origin-v1",
      arc_count: 3, point_count: 5,
      arc_lengths_u32_le_base64: "AwAAAAIAAAAAAAAA",
      delta_pairs_zigzag_uleb128_base64: "GAkIAAMGBgMAAg==",
      first_delta_mode: "first pair stores this arc absolute integer start minus previous nonempty arc start",
    };
    resources["/bundle.json"].version = 6;
    resources["/bundle.json"].base.topology_primary = encodedTopology;
    const before = structuredClone(resources);
    const expectedBundle = structuredClone(resources["/bundle.json"]);
    expectedBundle.base.topology_primary = baseTopology;
    await withWorker(resources, async (adapter) => {
      const result = await readyCases[1].load();
      assert.deepEqual(result.payload, expectedBundle);
      assert.equal(Object.hasOwn(result.payload.base.topology_primary, "arcs_encoding"), false);
      assert.deepEqual(result.payload.base.topology_primary.arcs, arcs);
      assert.deepEqual(result.baseDecodedCollections, expectedCollections(baseTopology));
      assert.deepEqual(result.runtimeDecodedCollections, expectedCollections(resources["/topology.json"], true));
      await assertTransport(adapter(), result, {
        type: "STARTUP_BUNDLE_READY", requestType: "LOAD_STARTUP_BUNDLE", field: "message", encoding: "geo-f64-v2",
      });
      assert.deepEqual(resources, before);
    });
  });

  test("v6 unknown, false and null base topology descriptors reject the worker task", async () => {
    for (const descriptor of [{ encoding: "future-format" }, false, null]) {
      const resources = makeResources(5);
      const { arcs: _arcs, ...encodedTopology } = resources["/bundle.json"].base.topology_primary;
      encodedTopology.arcs_encoding = descriptor;
      resources["/bundle.json"].version = 6;
      resources["/bundle.json"].base.topology_primary = encodedTopology;
      await withWorker(resources, async (adapter) => {
        await assert.rejects(client.loadStartupBundleViaWorker({
          startupBundleUrl: "/bundle.json", scenarioId: "transfer-fixture", timeoutMs: 2000,
        }), /\[startup_topology_codec\] encoding is unsupported/);
        const wire = adapter().responses.at(-1);
        assert.equal(wire.type, "ERROR");
        assert.equal(wire.stage, "LOAD_STARTUP_BUNDLE");
        assert.equal(wire.taskId, adapter().requests.at(-1).taskId);
        assert.equal(wire.geometryTransport, undefined);
        assert.ok(adapter().responses.every((response) => response.type !== "STARTUP_BUNDLE_READY"));
      });
    }
  });

  for (const chunkType of ["runtime-topology", "water-regions"]) {
    test(`RUNTIME_CHUNK_READY retains v1 ${chunkType === "runtime-topology" ? "decodedCollections" : "chunkPayload"} transfer compatibility`, async () => {
      const resources = makeResources();
      await withWorker(resources, async (adapter) => {
        const result = await client.decodeRuntimeChunkViaWorker({
          runtimeTopologyUrl: "/topology.json", chunkUrl: "/chunk.json", chunkType,
        });
        const field = chunkType === "runtime-topology" ? "decodedCollections" : "chunkPayload";
        if (chunkType === "runtime-topology") {
          assert.deepEqual(result.runtimePoliticalTopology, resources["/topology.json"]);
          assert.deepEqual(result.decodedCollections, expectedCollections(resources["/topology.json"], true));
          assert.equal(result.chunkPayload, null);
        } else {
          assert.deepEqual(result.chunkPayload, resources["/chunk.json"]);
          assert.equal(result.runtimePoliticalTopology, null);
          assert.equal(result.decodedCollections, null);
        }
        await assertTransport(adapter(), result, {
          type: "RUNTIME_CHUNK_READY", requestType: "DECODE_RUNTIME_CHUNK", field, encoding: "geo-f64-v1",
        });
      });
    });
  }

  test("small startup and chunk payloads retain ordinary messages without transport metrics", async () => {
    const resources = makeResources(5);
    await withWorker(resources, async (adapter) => {
      for (const ready of readyCases) {
        const result = await ready.load();
        ready.check(result, resources);
        const wire = adapter().responses.at(-1);
        assert.equal(wire.type, ready.type);
        assert.equal(wire.taskId, adapter().requests.at(-1).taskId);
        assert.equal(wire.geometryTransport, undefined);
        assert.equal(result.metrics.geometryPackingMs, undefined);
        assert.equal(result.metrics.geometryUnpackingMs, undefined);
        const audit = await adapter().audit(wire.taskId);
        assert.deepEqual(audit.byteLengthsBefore, []);
        assert.deepEqual(audit.byteLengthsAfter, []);
      }
      const result = await client.decodeRuntimeChunkViaWorker({ chunkUrl: "/chunk.json", chunkType: "water-regions" });
      assert.deepEqual(result.chunkPayload, resources["/chunk.json"]);
      const wire = adapter().responses.at(-1);
      assert.equal(wire.geometryTransport, undefined);
      assert.equal(result.metrics.geometryPackingMs, undefined);
      assert.equal(result.metrics.geometryUnpackingMs, undefined);
      assert.deepEqual((await adapter().audit(wire.taskId)).byteLengthsAfter, []);
    });
  });
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import "../js/core/geometry_transfer_codec_shared.js";

const workerSource = await readFile(new URL("../js/workers/startup_boot.worker.js", import.meta.url), "utf8");
const codecSource = await readFile(new URL("../js/core/geometry_transfer_codec_shared.js", import.meta.url), "utf8");
const topologyCodecSource = await readFile(new URL("../js/core/startup_topology_codec_shared.js", import.meta.url), "utf8");

function createWorkerHarness({ feature = () => null, fetchResource = null, onPostMessage = null } = {}) {
  const posted = [];
  const transferLists = [];
  const pendingFetches = new Map();
  const self = {
    location: {
      href: "https://example.test/js/workers/startup_boot.worker.js",
      origin: "https://example.test",
    },
    postMessage(message, transferables = []) {
      posted.push(message);
      transferLists.push(transferables);
      onPostMessage?.(message, transferables);
    },
  };
  const context = {
    AbortController,
    DOMException,
    Error,
    String,
    URL,
    console,
    performance: { now: () => 1 },
    self,
    globalThis: null,
    importScripts(...urls) {
      if (urls.some((url) => String(url).includes("geometry_transfer_codec_shared.js"))) {
        vm.runInContext(codecSource, context, { filename: "geometry_transfer_codec_shared.js" });
      }
      if (urls.some((url) => String(url).includes("startup_topology_codec_shared.js"))) {
        vm.runInContext(topologyCodecSource, context, { filename: "startup_topology_codec_shared.js" });
      }
      context.__scenarioForgeFeatureIdentityShared = {
        defaultCountryCodeNormalizer: (value) => String(value || "").toUpperCase(),
        getFeatureId: (feature) => feature?.id || null,
        getCountryCode: () => "",
      };
      self.topojson = {
        feature(input, object) {
          context.__startupTestFeatureResult = feature(input, object);
          return vm.runInContext("JSON.parse(JSON.stringify(__startupTestFeatureResult))", context);
        },
      };
    },
    fetch(url, options = {}) {
      if (fetchResource) return fetchResource(url, options);
      const taskUrl = String(url);
      if (taskUrl.includes("slow")) {
        return new Promise((_resolve, reject) => {
          pendingFetches.set(taskUrl, { signal: options.signal, reject });
          options.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => '{"task":"fast"}',
      });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(workerSource, context, { filename: "startup_boot.worker.js" });
  return { pendingFetches, posted, self, transferLists };
}

async function flushWorker() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test("startup worker cancels only its matching decode task and passes its signal to fetch", async () => {
  const { pendingFetches, posted, self } = createWorkerHarness();

  self.onmessage({ data: {
    type: "DECODE_RUNTIME_CHUNK",
    taskId: "slow-task",
    chunkType: "custom",
    chunkUrl: "/slow.json",
  } });
  self.onmessage({ data: {
    type: "DECODE_RUNTIME_CHUNK",
    taskId: "fast-task",
    chunkType: "custom",
    chunkUrl: "/fast.json",
  } });
  await flushWorker();

  const slowFetch = pendingFetches.get("https://example.test/slow.json");
  assert.ok(slowFetch?.signal);
  assert.equal(slowFetch.signal.aborted, false);
  assert.deepEqual(
    posted.filter((message) => message.type === "RUNTIME_CHUNK_READY").map((message) => message.taskId),
    ["fast-task"],
  );

  self.onmessage({ data: { type: "CANCEL_TASK", taskId: "slow-task" } });
  await flushWorker();

  assert.equal(slowFetch.signal.aborted, true);
  assert.equal(posted.some((message) => message.type === "RUNTIME_CHUNK_READY" && message.taskId === "slow-task"), false);
  assert.equal(posted.some((message) => message.type === "ERROR" && message.taskId === "slow-task"), false);
  assert.equal(
    posted.filter((message) => message.type === "RUNTIME_CHUNK_READY").find((message) => message.taskId === "fast-task")?.chunkPayload?.task,
    "fast",
  );
});

test("cached base topology decodes in the worker without fetching or returning the raw topology again", async () => {
  const decodeCalls = [];
  const topology = { type: "Topology", objects: {
    political: { type: "GeometryCollection", geometries: [{ id: "A" }] },
    rivers: { type: "GeometryCollection", geometries: [{ id: "river" }] },
  } };
  const { posted, self } = createWorkerHarness({
    feature: (input, object) => {
      assert.equal(input, topology);
      decodeCalls.push(object);
      return { type: "FeatureCollection", features: object.geometries };
    },
    fetchResource: () => { throw new Error("warm topology must not trigger a fetch"); },
  });
  self.onmessage({ data: {
    type: "LOAD_BASE_STARTUP", taskId: "warm-base", cachedTopologyPrimary: topology,
    needTopologyPrimary: false, needLocales: false, needGeoAliases: false,
  } });
  await flushWorker();
  assert.equal(posted.length, 1);
  const reply = posted[0];
  assert.equal(reply.type, "BASE_STARTUP_READY");
  assert.equal(reply.topologyPrimary, null, "the caller already holds the raw topology");
  assert.equal(reply.locales, null);
  assert.equal(reply.geoAliases, null);
  assert.equal(reply.decodedCollections.landData.features[0].id, "A");
  assert.equal(reply.decodedCollections.riversData.features[0].id, "river");
  assert.equal(decodeCalls.length, 2);
});

test("warm base decode still fetches missing localization only", async () => {
  const urls = [];
  const topology = { type: "Topology", objects: { political: { geometries: [] } } };
  const { posted, self } = createWorkerHarness({
    feature: () => ({ type: "FeatureCollection", features: [] }),
    fetchResource: async (url) => {
      urls.push(String(url));
      return { ok: true, text: async () => '{"ui":{"hello":"Hello"},"geo":{}}' };
    },
  });
  self.onmessage({ data: {
    type: "LOAD_BASE_STARTUP", taskId: "warm-base-locales", cachedTopologyPrimary: topology,
    needTopologyPrimary: false, needLocales: true, needGeoAliases: false,
    localesUrl: "/locales.json",
  } });
  await flushWorker();
  assert.deepEqual(urls, ["https://example.test/locales.json"]);
  assert.equal(posted[0].type, "BASE_STARTUP_READY");
  assert.equal(posted[0].locales.ui.hello, "Hello");
  assert.ok(posted[0].decodedCollections.landData);
});

function makeTopology(id, coordinatePairs = 10_000) {
  const coordinates = Array.from({ length: coordinatePairs }, (_, index) => [
    index + 0.123456789012345,
    -index - 0.987654321098765,
  ]);
  return {
    type: "Topology",
    objects: {
      political: {
        type: "GeometryCollection",
        geometries: [{
          id,
          properties: { name: `Country ${id}`, source: "startup-transfer-test" },
          type: "Polygon",
          coordinates: [coordinates],
        }],
      },
    },
  };
}

function decodeFixtureFeatureCollection(_topology, object) {
  return {
    type: "FeatureCollection",
    features: (object.geometries || []).map((geometry) => ({
      type: "Feature",
      id: geometry.id,
      properties: geometry.properties,
      geometry: {
        type: geometry.type,
        coordinates: geometry.coordinates,
      },
    })),
  };
}

test("large base and startup-bundle geometry use whole-message transfers without detaching source topology", async () => {
  const baseTopology = makeTopology("base-large");
  const runtimeTopology = makeTopology("runtime-large", 9_000);
  const startupBundle = {
    scenario_id: "large-transfer-fixture",
    base: { topology_primary: baseTopology },
    scenario: {
      runtime_topology_bootstrap: runtimeTopology,
      runtime_political_meta: { featureIds: ["runtime-meta"], neighborGraph: [[0, 1]] },
      bootstrap_strategy: "fixture",
      countries: { countries: { AAA: { name: "Fixture" } } },
      owners: { owners: { AAA: "fixture-owner" } },
      controllers: { controllers: { AAA: "fixture-controller" } },
      cores: { cores: { AAA: ["BBB"] } },
    },
  };
  const { posted, self, transferLists } = createWorkerHarness({
    feature: decodeFixtureFeatureCollection,
    fetchResource: async () => ({ ok: true, text: async () => JSON.stringify(startupBundle) }),
  });

  self.onmessage({ data: {
    type: "LOAD_BASE_STARTUP",
    taskId: "large-base-transfer",
    cachedTopologyPrimary: baseTopology,
    needTopologyPrimary: false,
    needLocales: false,
    needGeoAliases: false,
  } });
  await flushWorker();

  const baseWire = posted[0];
  const baseReply = { ...baseWire, ...globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(structuredClone(baseWire.geometryTransport.payload)), metrics: baseWire.metrics };
  assert.equal(baseReply.type, "BASE_STARTUP_READY");
  assert.equal(baseReply.taskId, "large-base-transfer");
  assert.equal(baseWire.decodedCollections, undefined);
  assert.equal(baseReply.geometryTransport.field, "message");
  assert.equal(baseReply.geometryTransport.payload.encoding, "geo-f64-v2");
  assert.equal(transferLists[0].length, 2);
  assert.equal(transferLists[0][0], baseReply.geometryTransport.payload.coordinates.buffer);
  assert.equal(transferLists[0][1], baseReply.geometryTransport.payload.lengths.buffer);
  assert.equal(typeof baseReply.metrics.geometryPackingMs, "number");
  assert.equal(baseReply.metrics.topologyPrimary, null);
  assert.equal(baseTopology.objects.political.geometries[0].coordinates[0].length, 10_000);
  assert.equal(baseTopology.objects.political.geometries[0].coordinates[0][1][0], 1.123456789012345);

  self.onmessage({ data: {
    type: "LOAD_STARTUP_BUNDLE",
    taskId: "large-bundle-transfer",
    startupBundleUrl: "/startup-bundle.json",
    scenarioId: "large-transfer-fixture",
    language: "en",
  } });
  await flushWorker();

  const bundleWire = posted[1];
  const bundleReply = { ...bundleWire, ...globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(structuredClone(bundleWire.geometryTransport.payload)), metrics: bundleWire.metrics };
  assert.equal(bundleReply.type, "STARTUP_BUNDLE_READY");
  assert.equal(bundleReply.taskId, "large-bundle-transfer");
  assert.equal(bundleWire.baseDecodedCollections, undefined);
  assert.equal(bundleReply.geometryTransport.field, "message");
  assert.equal(bundleReply.geometryTransport.payload.encoding, "geo-f64-v2");
  assert.equal(transferLists[1].length, 2);
  assert.equal(transferLists[1][0], bundleReply.geometryTransport.payload.coordinates.buffer);
  assert.equal(typeof bundleReply.metrics.geometryPackingMs, "number");
  assert.equal(bundleReply.metrics.startupBundle.scenarioId, "large-transfer-fixture");
  assert.equal(bundleReply.metrics.runtimeTopology.featureCount, 1);
  assert.deepEqual(structuredClone(bundleReply.runtimePoliticalMeta.featureIds), ["runtime-meta"]);
  assert.equal(bundleReply.payload.base.topology_primary.objects.political.geometries[0].coordinates[0].length, 10_000);
  assert.equal(bundleReply.payload.scenario.runtime_topology_bootstrap.objects.political.geometries[0].coordinates[0].length, 9_000);
  assert.equal(Array.isArray(bundleReply.runtimeDecodedCollections.politicalData.features[0].geometry.coordinates), true);
  assert.equal(bundleReply.runtimeDecodedCollections.politicalData.features[0].geometry.coordinates[0].length, 9_000);
  assert.equal(bundleReply.runtimeDecodedCollections.politicalData.features[0].geometry.coordinates[0][1][0], 1.123456789012345);
});

test("small base and startup-bundle geometries keep their inline response fields", async () => {
  const smallTopology = makeTopology("small", 20);
  smallTopology.arcs = [[[1, 2], [3, 4]]];
  const startupBundle = {
    scenario_id: "small-inline-fixture",
    base: { topology_primary: smallTopology },
    scenario: {},
  };
  const { posted, self, transferLists } = createWorkerHarness({
    feature: decodeFixtureFeatureCollection,
    fetchResource: async () => ({ ok: true, text: async () => JSON.stringify(startupBundle) }),
  });

  self.onmessage({ data: {
    type: "LOAD_BASE_STARTUP",
    taskId: "small-base-inline",
    cachedTopologyPrimary: smallTopology,
    needTopologyPrimary: false,
    needLocales: false,
    needGeoAliases: false,
  } });
  await flushWorker();
  self.onmessage({ data: {
    type: "LOAD_STARTUP_BUNDLE",
    taskId: "small-bundle-inline",
    startupBundleUrl: "/startup-bundle.json",
    scenarioId: "small-inline-fixture",
  } });
  await flushWorker();

  assert.equal(posted[0].geometryTransport, undefined);
  assert.equal(Array.isArray(posted[0].decodedCollections.landData.features[0].geometry.coordinates), true);
  assert.equal(transferLists[0].length, 0);
  assert.equal(posted[1].geometryTransport, undefined);
  assert.equal(posted[1].topologyTransport, undefined);
  assert.deepEqual(structuredClone(posted[1].payload.base.topology_primary.arcs), smallTopology.arcs);
  assert.equal(Array.isArray(posted[1].baseDecodedCollections.landData.features[0].geometry.coordinates), true);
  assert.equal(transferLists[1].length, 0);
});

test("large worker replies cross a real structured transfer and restore through the startup client", async () => {
  const baseTopology = makeTopology("client-base");
  baseTopology.arcs = [[], Array.from({ length: 10_000 }, (_, index) => [index + 0.123456789012345, -index - 0.5, index % 5])];
  baseTopology.transform = { scale: [0.1, 0.2], translate: [-180, -90] };
  const topologyOnly = { ...baseTopology, objects: {} };
  const sourceSnapshot = structuredClone(baseTopology);
  const runtimeTopology = makeTopology("client-runtime", 9_000);
  const startupBundle = {
    scenario_id: "client-transfer-fixture",
    base: { topology_primary: baseTopology },
    scenario: { runtime_topology_bootstrap: runtimeTopology },
  };
  let workerHarness = null;
  let startupWorkerClient = null;
  let corruptNextTopology = false;
  const originalWorker = globalThis.Worker;

  class FakeWorker {
    constructor() {
      FakeWorker.instance = this;
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage(message) {
      workerHarness.self.onmessage({ data: structuredClone(message) });
    }

    terminate() {
      this.terminated = true;
    }
  }

  try {
    workerHarness = createWorkerHarness({
      feature: decodeFixtureFeatureCollection,
      fetchResource: async url => ({ ok: true, text: async () => JSON.stringify(
        String(url).includes("base-only") ? topologyOnly : startupBundle,
      ) }),
      onPostMessage(message, transferables) {
        assert.equal(transferables.length, message.geometryTransport ? 2 : 0);
        assert.ok(transferables.every((buffer) => buffer.byteLength > 0));
        const transferredMessage = structuredClone(message, { transfer: transferables });
        assert.ok(transferables.every((buffer) => buffer.byteLength === 0));
        if (corruptNextTopology) {
          transferredMessage.geometryTransport.payload.encoding = "unsupported";
          corruptNextTopology = false;
        }
        FakeWorker.instance.onmessage({ data: transferredMessage });
      },
    });
    globalThis.Worker = FakeWorker;
    startupWorkerClient = await import(
      new URL(`../js/core/startup_worker_client.js?actual-worker-transfer=${Date.now()}`, import.meta.url),
    );

    const baseResult = await startupWorkerClient.loadBaseStartupViaWorker({
      cachedTopologyPrimary: baseTopology,
      needTopologyPrimary: false,
      needLocales: false,
      needGeoAliases: false,
    });
    assert.equal(workerHarness.posted[0].geometryTransport.field, "message");
    assert.equal(workerHarness.posted[0].topologyTransport, undefined, "cached raw topology must not be retransmitted");
    assert.deepEqual(baseResult.decodedCollections.landData, decodeFixtureFeatureCollection(baseTopology, baseTopology.objects.political));
    assert.equal(baseResult.decodedCollections.landData.features[0].geometry.coordinates[0].length, 10_000);
    assert.equal(baseResult.decodedCollections.landData.features[0].geometry.coordinates[0][1][0], 1.123456789012345);
    assert.equal(typeof baseResult.metrics.geometryUnpackingMs, "number");
    assert.equal(baseTopology.objects.political.geometries[0].coordinates[0].length, 10_000);

    const bundleResult = await startupWorkerClient.loadStartupBundleViaWorker({
      startupBundleUrl: "/startup-bundle.json",
      scenarioId: "client-transfer-fixture",
    });
    assert.equal(workerHarness.posted[1].geometryTransport.field, "message");
    assert.equal(workerHarness.transferLists[1].length, 2, "all startup geometries and arcs share one transport");
    assert.equal(workerHarness.posted[1].geometryTransport.payload.encoding, "geo-f64-v2");
    assert.deepEqual(bundleResult.baseDecodedCollections.landData, decodeFixtureFeatureCollection(baseTopology, baseTopology.objects.political));
    assert.equal(bundleResult.baseDecodedCollections.landData.features[0].geometry.coordinates[0].length, 10_000);
    assert.equal(bundleResult.baseDecodedCollections.landData.features[0].geometry.coordinates[0][1][0], 1.123456789012345);
    assert.equal(bundleResult.runtimeDecodedCollections.politicalData.features[0].geometry.coordinates[0].length, 9_000);
    assert.deepEqual(bundleResult.runtimePoliticalMeta.featureIds, ["client-runtime"]);
    assert.equal(typeof bundleResult.metrics.geometryUnpackingMs, "number");
    assert.equal(bundleResult.payload.base.topology_primary.objects.political.geometries[0].coordinates[0].length, 10_000);
    assert.equal(bundleResult.payload.scenario.runtime_topology_bootstrap.objects.political.geometries[0].coordinates[0].length, 9_000);
    assert.deepEqual(bundleResult.payload.base.topology_primary, sourceSnapshot);
    assert.equal(typeof bundleResult.metrics.geometryPackingMs, "number");

    const loadTopologyOnly = () => startupWorkerClient.loadBaseStartupViaWorker({
      topologyUrl: "/base-only.json", needLocales: false, needGeoAliases: false,
    });
    const topologyResult = await loadTopologyOnly();
    assert.equal(workerHarness.posted[2].geometryTransport.payload.encoding, "geo-f64-v2");
    assert.equal(workerHarness.transferLists[2].length, 2);
    assert.deepEqual(topologyResult.topologyPrimary, topologyOnly);
    assert.equal(typeof topologyResult.metrics.geometryUnpackingMs, "number");

    corruptNextTopology = true;
    await assert.rejects(loadTopologyOnly(), /Unsupported geometry transport encoding/);
    assert.deepEqual((await loadTopologyOnly()).topologyPrimary, topologyOnly, "a failed response must not poison later tasks");
    assert.deepEqual(baseTopology, sourceSnapshot, "transfer must only detach newly allocated buffers");
  } finally {
    startupWorkerClient?.terminateStartupWorker();
    globalThis.Worker = originalWorker;
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workerSource = await readFile(new URL("../js/workers/startup_boot.worker.js", import.meta.url), "utf8");

function createWorkerHarness({ feature = () => null, fetchResource = null } = {}) {
  const posted = [];
  const pendingFetches = new Map();
  const self = {
    location: {
      href: "https://example.test/js/workers/startup_boot.worker.js",
      origin: "https://example.test",
    },
    postMessage(message) {
      posted.push(message);
    },
  };
  const context = {
    AbortController,
    DOMException,
    Error,
    JSON,
    Map,
    Object,
    Promise,
    String,
    URL,
    console,
    performance: { now: () => 1 },
    self,
    globalThis: null,
    importScripts() {
      context.__scenarioForgeFeatureIdentityShared = {
        defaultCountryCodeNormalizer: (value) => String(value || "").toUpperCase(),
        getFeatureId: (feature) => feature?.id || null,
        getCountryCode: () => "",
      };
      self.topojson = { feature };
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
  return { pendingFetches, posted, self };
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

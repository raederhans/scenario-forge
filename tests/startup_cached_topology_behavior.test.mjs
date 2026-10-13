import assert from "node:assert/strict";
import test from "node:test";
import { loadStartupBootArtifacts } from "../js/core/data_loader.js";
import { terminateStartupWorker } from "../js/core/startup_worker_client.js";
import { decodeStartupPrimaryCollectionsIntoState } from "../js/core/state/content_state.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("startup cache reads run independently while warm-worker and fallback behavior stays intact", async () => {
  const prior = {
    indexedDB: globalThis.indexedDB,
    Worker: globalThis.Worker,
    fetch: globalThis.fetch,
    location: globalThis.location,
    warn: console.warn,
  };
  const topology = { type: "Topology", objects: { political: { geometries: [] } } };
  const decoded = { landData: { type: "FeatureCollection", features: [{ id: "cached" }] } };
  const locales = { ui: { cached: "yes" }, geo: {} };
  const geoAliases = { alias_to_stable_key: { cached: "CACHE" } };
  const messages = [];
  const cacheReadKeys = [];
  const resourceLoads = [];
  const pendingReads = [];
  let cacheReadHandler = (key) => makeRequest(cacheEntryFor(key));
  let failWorker = false;

  function makeRequest(result) {
    const value = { result };
    queueMicrotask(() => value.onsuccess?.());
    return value;
  }

  function cacheEntryFor(key) {
    return key.startsWith("startup-base-topology")
      ? { payload: { topologyPrimary: topology } }
      : { payload: { locales, geoAliases } };
  }

  function makePendingRead(key) {
    const request = { result: null, error: null };
    const pending = {
      key,
      resolve(result) {
        request.result = result;
        request.onsuccess?.();
      },
      reject(error) {
        request.error = error;
        request.onerror?.();
      },
    };
    pendingReads.push(pending);
    return request;
  }

  globalThis.indexedDB = {
    open: () => makeRequest({
      transaction: () => ({
        objectStore: () => ({
          get: (key) => {
            cacheReadKeys.push(key);
            return cacheReadHandler(key);
          },
        }),
      }),
    }),
  };
  globalThis.fetch = async (url) => {
    if (String(url).includes("manifest")) {
      return {
        ok: true,
        json: async () => ({ version: 1, generated_at: "fixture", outputs: {} }),
      };
    }
    resourceLoads.push(url);
    globalThis.location.search = "?startup_cache=0";
    return new Response(JSON.stringify(topology), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  globalThis.location = { search: "" };
  globalThis.Worker = class {
    postMessage(message) {
      messages.push(message);
      const workerData = { type: "BASE_STARTUP_READY", taskId: message.taskId, decodedCollections: decoded };
      if (message.needLocales) workerData.locales = locales;
      if (message.needGeoAliases) workerData.geoAliases = geoAliases;
      queueMicrotask(() => this.onmessage?.({ data: failWorker
        ? { type: "ERROR", taskId: message.taskId, message: "fixture decode failure" }
        : workerData,
      }));
    }
    terminate() {}
  };

  const mainThreadLoads = [];
  const d3Client = {
    json: async (url) => {
      mainThreadLoads.push(url);
      globalThis.location.search = "?startup_cache=0";
      if (url.includes("topology")) {
        return topology;
      }
      if (url.includes("geo_aliases")) return geoAliases;
      return locales;
    },
  };

  try {
    // Hold the first request open. A setImmediate fence drains the current
    // promise jobs without relying on a wall-clock threshold.
    cacheReadHandler = (key) => makePendingRead(key);
    const firstReadStarted = createDeferred();
    const originalReadHandler = cacheReadHandler;
    cacheReadHandler = (key) => {
      const request = originalReadHandler(key);
      if (pendingReads.length === 1) firstReadStarted.resolve();
      return request;
    };
    let warmFinished = false;
    const warmPromise = loadStartupBootArtifacts({ d3Client }).then((result) => {
      warmFinished = true;
      return result;
    });
    await firstReadStarted.promise;
    await new Promise(setImmediate);
    assert.equal(pendingReads.length, 2, "localization read starts while topology read remains pending");
    assert.equal(messages.length, 0, "worker work waits until both cache reads settle");

    const topologyRead = pendingReads.find(({ key }) => key.startsWith("startup-base-topology"));
    const localizationRead = pendingReads.find(({ key }) => key.startsWith("startup-localization"));
    localizationRead.resolve(cacheEntryFor(localizationRead.key));
    await new Promise(setImmediate);
    assert.equal(warmFinished, false);
    assert.equal(messages.length, 0, "one completed read does not start worker work early");
    topologyRead.resolve(cacheEntryFor(topologyRead.key));

    const warm = await warmPromise;
    assert.equal(warm.startupBootCacheState.baseTopology, "hit");
    assert.equal(warm.startupBootCacheState.localization, "hit");
    assert.equal(warm.topologyPrimary, topology);
    assert.equal(warm.locales, locales);
    assert.equal(warm.geoAliases, geoAliases);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].cachedTopologyPrimary, topology);
    assert.equal(messages[0].needTopologyPrimary, false);
    assert.equal(messages[0].needLocales, false);
    assert.equal(messages[0].needGeoAliases, false);
    assert.equal(warm.decodedCollections, decoded);
    let mainDecodeCount = 0;
    const topojsonClient = { feature: () => { mainDecodeCount += 1; return decoded.landData; } };
    decodeStartupPrimaryCollectionsIntoState({ topologyPrimary: warm.topologyPrimary }, {
      startupDecodedCollections: warm.decodedCollections, topojsonClient,
    });
    assert.equal(mainDecodeCount, 0);

    cacheReadHandler = (key) => makeRequest(cacheEntryFor(key));
    const readsBeforeWorkerDisabled = cacheReadKeys.length;
    const workerDisabled = await loadStartupBootArtifacts({ useWorker: false, d3Client });
    assert.equal(workerDisabled.topologyPrimary, topology);
    assert.equal(cacheReadKeys.length - readsBeforeWorkerDisabled, 2);
    assert.equal(messages.length, 1);

    failWorker = true;
    const fallback = await loadStartupBootArtifacts({ d3Client });
    assert.equal(fallback.topologyPrimary, topology);
    assert.equal(fallback.decodedCollections, null);
    decodeStartupPrimaryCollectionsIntoState({ topologyPrimary: fallback.topologyPrimary }, {
      startupDecodedCollections: fallback.decodedCollections, topojsonClient,
    });
    assert.equal(mainDecodeCount, 1, "worker failure retains the existing synchronous recovery path");

    // Reject localization while holding topology. The independent topology
    // result must still be observed before the worker/main-thread path starts.
    failWorker = false;
    pendingReads.length = 0;
    const errorReadStarted = createDeferred();
    cacheReadHandler = (key) => {
      const request = makePendingRead(key);
      if (pendingReads.length === 1) errorReadStarted.resolve();
      return request;
    };
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    let partialFinished = false;
    const partialPromise = loadStartupBootArtifacts({ d3Client }).then((result) => {
      partialFinished = true;
      return result;
    });
    await errorReadStarted.promise;
    await new Promise(setImmediate);
    assert.equal(pendingReads.length, 2);
    const pendingTopology = pendingReads.find(({ key }) => key.startsWith("startup-base-topology"));
    const pendingLocalization = pendingReads.find(({ key }) => key.startsWith("startup-localization"));
    pendingLocalization.reject(new Error("fixture localization read failure"));
    await new Promise(setImmediate);
    assert.equal(partialFinished, false);
    assert.equal(messages.length, 2, "a single cache failure does not start fallback before the other read settles");
    // The subsequent cache write is intentionally bypassed; this fake DB
    // models reads only and has no write transaction implementation.
    globalThis.location.search = "?startup_cache=0";
    pendingTopology.resolve(cacheEntryFor(pendingTopology.key));
    const partial = await partialPromise;
    globalThis.location.search = "";
    console.warn = originalWarn;
    assert.equal(partial.startupBootCacheState.baseTopology, "hit");
    assert.equal(partial.topologyPrimary, topology);
    assert.equal(partial.locales, locales);
    assert.ok(warnings.some(([message]) => message === "[data_loader] Startup localization cache read failed."));
    assert.equal(messages.length, 3);
    assert.equal(messages.at(-1).needTopologyPrimary, false);
    assert.equal(messages.at(-1).needLocales, true);
    assert.equal(messages.at(-1).needGeoAliases, true);

    // One absent entry produces one read before ordinary loading, with no retry.
    globalThis.location = { search: "" };
    const readsBeforeMiss = cacheReadKeys.length;
    cacheReadHandler = (key) => makeRequest(key.startsWith("startup-base-topology")
      ? null
      : cacheEntryFor(key));
    const miss = await loadStartupBootArtifacts({ useWorker: false, d3Client });
    globalThis.location.search = "";
    assert.equal(miss.startupBootCacheState.localization, "hit");
    assert.deepEqual(miss.topologyPrimary, topology);
    assert.equal(cacheReadKeys.length - readsBeforeMiss, 2, "a missing entry is not retried");
    assert.equal(resourceLoads.filter((url) => url.includes("topology")).length, 1);

    cacheReadHandler = (key) => makeRequest(cacheEntryFor(key));
    const readsBeforeScenarioScoped = cacheReadKeys.length;
    const scenarioScoped = await loadStartupBootArtifacts({
      localeLevel: "startup",
      localesUrl: "data/scenarios/fixture/locales.startup.json",
      geoAliasesUrl: "data/scenarios/fixture/geo_aliases.startup.json",
      useWorker: false,
      d3Client,
    });
    assert.equal(scenarioScoped.startupBootCacheState.localization, "scenario-scoped");
    assert.equal(cacheReadKeys.length - readsBeforeScenarioScoped, 1, "scenario localization only reads the shared topology entry");

    const readsBeforeDisabled = cacheReadKeys.length;
    const disabled = await loadStartupBootArtifacts({ useStartupCache: false, useWorker: false, d3Client });
    assert.equal(disabled.startupBootCacheState.enabled, false);
    assert.equal(cacheReadKeys.length, readsBeforeDisabled, "disabled startup cache performs no entry reads");
  } finally {
    console.warn = prior.warn;
    terminateStartupWorker();
    Object.assign(globalThis, prior);
  }
});

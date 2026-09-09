import assert from "node:assert/strict";
import test from "node:test";
import { loadStartupBootArtifacts } from "../js/core/data_loader.js";
import { terminateStartupWorker } from "../js/core/startup_worker_client.js";
import { decodeStartupPrimaryCollectionsIntoState } from "../js/core/state/content_state.js";

test("persistent topology hits are decoded by the worker, with main-thread fallback on failure", async () => {
  const prior = { indexedDB: globalThis.indexedDB, Worker: globalThis.Worker, fetch: globalThis.fetch };
  const topology = { type: "Topology", objects: { political: { geometries: [] } } };
  const decoded = { landData: { type: "FeatureCollection", features: [{ id: "cached" }] } };
  const messages = [];
  let failWorker = false;
  const request = (result) => {
    const value = { result };
    queueMicrotask(() => value.onsuccess?.());
    return value;
  };
  globalThis.indexedDB = { open: () => request({
    transaction: () => ({ objectStore: () => ({ get: (key) => request({ payload:
      key.startsWith("startup-base-topology") ? { topologyPrimary: topology }
        : { locales: { ui: {}, geo: {} }, geoAliases: { alias_to_stable_key: {} } },
    }) }) }),
  }) };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 1, generated_at: "fixture", outputs: {} }) });
  globalThis.Worker = class {
    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => this.onmessage?.({ data: failWorker
        ? { type: "ERROR", taskId: message.taskId, message: "fixture decode failure" }
        : { type: "BASE_STARTUP_READY", taskId: message.taskId, decodedCollections: decoded },
      }));
    }
    terminate() {}
  };
  try {
    const warm = await loadStartupBootArtifacts();
    assert.equal(warm.startupBootCacheState.baseTopology, "hit");
    assert.equal(warm.startupBootCacheState.localization, "hit");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].cachedTopologyPrimary, topology);
    assert.equal(messages[0].needTopologyPrimary, false);
    assert.equal(messages[0].needLocales, false);
    assert.equal(messages[0].needGeoAliases, false);
    assert.equal(warm.topologyPrimary, topology);
    assert.equal(warm.decodedCollections, decoded);
    let mainDecodeCount = 0;
    const topojsonClient = { feature: () => { mainDecodeCount += 1; return decoded.landData; } };
    decodeStartupPrimaryCollectionsIntoState({ topologyPrimary: topology }, {
      startupDecodedCollections: warm.decodedCollections, topojsonClient,
    });
    assert.equal(mainDecodeCount, 0);

    const disabled = await loadStartupBootArtifacts({ useWorker: false });
    assert.equal(disabled.topologyPrimary, topology);
    assert.equal(messages.length, 1);

    failWorker = true;
    const fallback = await loadStartupBootArtifacts();
    assert.equal(fallback.topologyPrimary, topology);
    assert.equal(fallback.decodedCollections, null);
    decodeStartupPrimaryCollectionsIntoState({ topologyPrimary: fallback.topologyPrimary }, {
      startupDecodedCollections: fallback.decodedCollections, topojsonClient,
    });
    assert.equal(mainDecodeCount, 1, "worker failure retains the existing synchronous recovery path");
  } finally {
    terminateStartupWorker();
    Object.assign(globalThis, prior);
  }
});

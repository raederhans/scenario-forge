import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { createScenarioChunkPayloadLoader } from "../js/core/scenario/chunk_payload_loader.js";
import { recordScenarioChunkPayloadSourceBytes, getScenarioChunkPayloadEvictionIds, getScenarioChunkPayloadRetentionStats } from "../js/core/scenario/bundle_cache_policy.js";
import { createGeometryRasterWorkerClient } from "../js/core/geometry_raster_worker_client.js";

const tick = () => new Promise(setImmediate);
const payload = (bytes) => {
  const entry = { layerKey: "political", payload: { type: "FeatureCollection", features: [] } };
  recordScenarioChunkPayloadSourceBytes(entry, { cacheByteSize: bytes });
  return entry;
};
function loaderFixture({ budget = 100 } = {}) {
  const resourceBudget = createRuntimeResourceBudget({ softLimitBytes: budget });
  const bundle = { id: "a", chunkPayloadCacheById: {}, chunkPayloadPromisesById: {}, chunkPayloadProtectedIds: [] };
  const runtimeState = { activeScenarioId: "a", activeScenarioChunks: { scenarioId: "a", payloadByChunkId: {} }, scenarioBundleCacheById: { a: bundle } };
  let loads = 0;
  const loader = createScenarioChunkPayloadLoader({ runtimeState, resourceBudget,
    normalizeScenarioId: (id) => String(id || ""), getScenarioBundleId: (b) => b.id,
    loadScenarioChunkFile: async () => { loads++; return { payload: { type: "FeatureCollection", features: [] } }; },
  });
  return { resourceBudget, bundle, runtimeState, loader, loads: () => loads };
}

test("cache reporting deduplicates shared entries and declares missing weights", () => {
  const shared = payload(40), unknown = {};
  const stats = getScenarioChunkPayloadRetentionStats([
    { chunkPayloadCacheById: { a: shared, b: unknown } }, { chunkPayloadCacheById: { a: shared } },
  ]);
  assert.equal(stats.payloadCount, 2);
  assert.equal(stats.knownSourceBytes, 40);
  assert.equal(stats.unknownPayloads, 1);
});

test("pressure eviction is opt-in and preserves active selected and in-flight entries", () => {
  const bundle = { chunkPayloadCacheById: { active: payload(1), selected: payload(1), inflight: payload(1), unused: payload(1) },
    chunkPayloadProtectedIds: ["selected"], chunkPayloadPromisesById: { inflight: Promise.resolve() } };
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, ["active"]), []);
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, ["active"], { pressure: true }), ["unused"]);
});

test("real loader reclaims only inactive cache references under shared pressure", async () => {
  const f = loaderFixture();
  const active = payload(30), unused = payload(80);
  f.bundle.chunkPayloadCacheById = { unused, active };
  f.runtimeState.activeScenarioChunks.payloadByChunkId = { active };
  const result = await f.loader.loadScenarioChunkPayload(f.bundle, { id: "active", cacheByteSize: 30 });
  assert.equal(result, active);
  assert.deepEqual(Object.keys(f.bundle.chunkPayloadCacheById), ["active"]);
  assert.equal(unused.payload.features.length, 0, "caller-owned snapshots are not destroyed");
  assert.equal(f.loads(), 0);
  assert.equal(f.loader.getLoadSchedulerStats().pressureEvictions, 1);
  assert.equal(f.resourceBudget.snapshot().categories.mainChunkPayload, 30);
});

test("real speculative loader becomes required on selection without duplicate fetch", async () => {
  const f = loaderFixture();
  const external = Symbol(); f.resourceBudget.update(external, { workerGeometry: 100 });
  const meta = { id: "county", layer: "political", url: "county.json", cacheByteSize: 10 };
  const pending = f.loader.loadScenarioChunkPayload(f.bundle, meta, { speculative: true });
  await tick(); assert.equal(f.loads(), 0);
  const selected = f.loader.loadScenarioChunkPayloadEntries(f.bundle, [meta]);
  const [first, entries] = await Promise.all([pending, selected]);
  assert.equal(first, entries[0].payload);
  assert.equal(f.loads(), 1);
  f.resourceBudget.release(external);
});

test("scene reset rejects a blocked old prewarm and does not fetch or publish it", async () => {
  const f = loaderFixture();
  const external = Symbol(); f.resourceBudget.update(external, { workerGeometry: 100 });
  const pending = f.loader.loadScenarioChunkPayload(f.bundle,
    { id: "old", layer: "political", url: "old.json", cacheByteSize: 10 }, { speculative: true });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await tick(); f.loader.resetScenarioChunkRequests("b"); await rejected; await tick();
  assert.equal(f.loads(), 0);
  assert.equal(f.bundle.chunkPayloadCacheById.old, undefined);
  assert.equal(f.loader.getLoadSchedulerStats().queued, 0);
  f.resourceBudget.release(external);
});

test("worker ACK accounts persistent bytes; disposal releases accounting without closing caller-owned bitmaps", async () => {
  const budget = createRuntimeResourceBudget({ softLimitBytes: 1000 });
  const sent = [];
  const worker = { postMessage: (message) => sent.push(message), terminate() {} };
  const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true, resourceBudget: budget });
  const input = { identity: "one", sceneKey: "a", kind: "political", projectionKey: 1, width: 10, height: 5,
    entries: [{ id: "a", feature: { geometry: { type: "Point", coordinates: [1, 2] } }, fillColor: "red" }] };
  const pending = client.request(input); await tick();
  let closes = 0;
  const bitmap = { close() { closes++; } };
  worker.onmessage({ data: { type: "GEOMETRY_RASTER_RESULT", taskId: sent[0].taskId,
    result: { bitmap, cacheBudget: { geometry: { estimatedBytes: 300 }, paths: { estimatedBytes: 100 } } } } });
  assert.equal((await pending).bitmap, bitmap);
  assert.equal(budget.snapshot().estimatedBytes, 600);
  assert.equal(budget.snapshot().categories.workerSurfaces, 200);
  assert.ok(budget.snapshot().unmeasuredCategories.includes("bitmaps"), "consumer bitmap retention is not falsely counted as zero");
  client.dispose(); assert.equal(budget.snapshot().ownerCount, 0);
  assert.equal(closes, 0); bitmap.close(); assert.equal(closes, 1);
});

test("failed worker releases its transfer reservation and rejects late orphan bitmaps", async () => {
  const budget = createRuntimeResourceBudget();
  const sent = [], worker = { postMessage: (message) => sent.push(message), terminate() {} };
  const client = createGeometryRasterWorkerClient({ createWorker: () => worker, isSupported: () => true, resourceBudget: budget });
  const pending = client.request({ identity: "large", sceneKey: "a", kind: "political", width: 10, height: 5,
    entries: [{ id: "large", feature: { geometry: { type: "LineString", coordinates: Array.from({ length: 10000 }, (_, i) => [i, -i]) } } }] });
  await tick(); assert.ok(budget.snapshot().categories.decodeTransient > 0);
  worker.onmessage({ data: { type: "ERROR", taskId: sent[0].taskId, message: "expected" } });
  assert.equal(await pending, null); assert.equal(budget.snapshot().ownerCount, 0);
  let closes = 0;
  worker.onmessage({ data: { type: "GEOMETRY_RASTER_RESULT", taskId: sent[0].taskId, result: { bitmap: { close() { closes++; } } } } });
  assert.equal(closes, 1);
});

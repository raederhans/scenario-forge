import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioChunkPayloadLoader } from "../js/core/scenario/chunk_payload_loader.js";
import { trimScenarioChunkPayloadCache, SCENARIO_CHUNK_PAYLOAD_CACHE_BYTE_LIMIT } from "../js/core/scenario/bundle_cache.js";
import { getScenarioChunkPayloadEvictionIds, recordScenarioChunkPayloadSourceBytes } from "../js/core/scenario/bundle_cache_policy.js";
import { trimScenarioBundleCacheState } from "../js/core/state/actions/scenario_activation_actions.js";

test("retention policy returns detached eviction IDs without mutating a published bundle", () => {
  const cache = Object.freeze(Object.fromEntries(Array.from({ length: 34 }, (_, id) => [String(id), Object.freeze({})])));
  const bundle = Object.freeze({ chunkPayloadCacheById: cache, chunkPayloadProtectedIds: Object.freeze(["0"]), chunkPayloadPromisesById: Object.freeze({}) });
  const ids = getScenarioChunkPayloadEvictionIds(bundle);
  assert.deepEqual(ids, ["1", "2"]);
  ids.push("unrelated");
  assert.equal(Object.keys(cache).length, 34);
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle), ["1", "2"]);
});

function fixture() {
  const bundle = { id: "a" };
  const runtimeState = { activeScenarioId: "a", scenarioBundleCacheById: { a: bundle } };
  let loads = 0;
  const loader = createScenarioChunkPayloadLoader({ runtimeState, normalizeScenarioId: String,
    getScenarioBundleId: (value) => value.id,
    loadScenarioChunkFile: async () => { loads += 1; return { payload: { get features() { throw Error("budget must not traverse payload"); } } }; },
  });
  const chunk = (id, byteSize = SCENARIO_CHUNK_PAYLOAD_CACHE_BYTE_LIMIT / 2) => ({ id, byteSize, url: id, layer: "political" });
  return { bundle, runtimeState, loader, chunk, loads: () => loads };
}

test("source-byte budget evicts LRU below the count limit without inspecting geometry", async () => {
  const { bundle, loader, chunk, loads } = fixture();
  await loader.loadScenarioChunkPayload(bundle, chunk("a"));
  await loader.loadScenarioChunkPayload(bundle, chunk("b"));
  await loader.loadScenarioChunkPayload(bundle, chunk("a"));
  await loader.loadScenarioChunkPayload(bundle, chunk("c"));
  assert.deepEqual(Object.keys(bundle.chunkPayloadCacheById), ["a", "c"]);
  assert.equal(loads(), 3);
  await loader.loadScenarioChunkPayload(bundle, chunk("b"));
  assert.equal(loads(), 4);
  assert.deepEqual(Object.keys(bundle.chunkPayloadCacheById), ["c", "b"]);
});

test("oversized required batch remains complete, then releases on scenario switch", async () => {
  const { bundle, loader, chunk } = fixture();
  const entries = await loader.loadScenarioChunkPayloadEntries(bundle, [chunk("a"), chunk("b"), chunk("c")]);
  assert.equal(entries.length, 3);
  assert.equal(Object.keys(bundle.chunkPayloadCacheById).length, 3);
  loader.resetScenarioChunkRequests("b");
  assert.deepEqual(Object.keys(bundle.chunkPayloadCacheById), ["b", "c"]);
  assert.ok(entries[0].payload.payload);
});

test("active payloads survive byte pressure and are evictable after release", async () => {
  const { bundle, runtimeState, loader, chunk } = fixture();
  const active = await loader.loadScenarioChunkPayload(bundle, chunk("active"));
  runtimeState.activeScenarioChunks = { scenarioId: "a", payloadByChunkId: { active } };
  await loader.loadScenarioChunkPayload(bundle, chunk("b"));
  await loader.loadScenarioChunkPayload(bundle, chunk("c"));
  assert.deepEqual(Object.keys(bundle.chunkPayloadCacheById), ["active", "c"]);
  assert.equal(runtimeState.activeScenarioChunks.payloadByChunkId.active, active);
});

test("legacy unknown byte sizes retain count-based eviction", async () => {
  const { bundle, loader, chunk } = fixture();
  for (let i = 0; i < 35; i += 1) await loader.loadScenarioChunkPayload(bundle, chunk(`c${i}`, NaN));
  trimScenarioChunkPayloadCache(bundle);
  assert.equal(Object.keys(bundle.chunkPayloadCacheById).length, 32);
  assert.equal(bundle.chunkPayloadCacheById.c0, undefined);
});

for (const release of ["request-reset", "bundle-trim"]) {
  test(`${release} keeps a fitting global political base for A-B-A within the unchanged byte budget`, async () => {
    const { bundle, runtimeState, loader, chunk } = fixture();
    const base = { ...chunk("base", 61 * 1024 * 1024), lod: "coarse", globalCoverage: true };
    const water = { ...chunk("water", 22 * 1024 * 1024), layer: "water" };
    bundle.chunkRegistry = { chunks: [base, water] };
    const first = await loader.loadScenarioChunkPayloadEntries(bundle, [base, water]);
    if (release === "request-reset") loader.resetScenarioChunkRequests("b");
    else {
      runtimeState.activeScenarioId = "b";
      runtimeState.scenarioBundleCacheById.b = { id: "b" };
      trimScenarioBundleCacheState(runtimeState, ["a", "b"], "b");
    }
    assert.deepEqual(Object.keys(bundle.chunkPayloadCacheById), ["base"]);
    assert.equal(bundle.chunkPayloadCacheById.base, first[0].payload);
    assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle), []);
    loader.resetScenarioChunkRequests("a");
    runtimeState.activeScenarioId = "a";
    const returned = await loader.loadScenarioChunkPayloadEntries(bundle, [base, water]);
    assert.equal(returned[0].payload, first[0].payload);
    assert.notEqual(returned[1].payload, first[1].payload);
    // A replaced bundle owns a fresh cache even if its scenario/chunk IDs match.
    const freshBundle = { id: "a", chunkRegistry: bundle.chunkRegistry };
    const fresh = await loader.loadScenarioChunkPayload(freshBundle, base);
    assert.notEqual(fresh, returned[0].payload);
  });
}

test("return preference does not pin oversized bases or displace protected payloads", () => {
  for (const baseBytes of [65, 61]) {
    const cache = { base: {}, water: {}, recent: {} };
    for (const [id, bytes] of [["base", baseBytes], ["water", 22], ["recent", 1]]) {
      recordScenarioChunkPayloadSourceBytes(cache[id], { byteSize: bytes * 1024 * 1024 });
    }
    const bundle = { chunkPayloadCacheById: cache, chunkRegistry: { chunks: [
      { id: "base", layer: "political", lod: "coarse", globalCoverage: true },
    ] } };
    assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, ["water"], { preferPoliticalBase: true }), ["base"]);
    if (baseBytes === 65) {
      assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, [], { preferPoliticalBase: true }), ["base"]);
    }
  }
});

test("inactive return preference leaves detail, unknown-size and ordinary LRU ordering unchanged", () => {
  const cache = { base: {}, recent: {} };
  recordScenarioChunkPayloadSourceBytes(cache.base, { byteSize: 61 * 1024 * 1024 });
  recordScenarioChunkPayloadSourceBytes(cache.recent, { byteSize: 22 * 1024 * 1024 });
  const bundle = { chunkPayloadCacheById: cache, chunkRegistry: { chunks: [
    { id: "base", layer: "political", lod: "detail", globalCoverage: true },
  ] } };
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, [], { preferPoliticalBase: true }), ["base"]);
  bundle.chunkRegistry.chunks[0].lod = "coarse";
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle), ["base"]);
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, [], { preferPoliticalBase: true }), ["recent"]);
  assert.deepEqual(Object.keys(bundle.chunkPayloadCacheById), ["base", "recent"]);
  bundle.chunkPayloadCacheById = { base: {}, ...Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`unknown-${i}`, {}])) };
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, [], { preferPoliticalBase: true }), ["base", "unknown-0"]);
});

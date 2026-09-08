import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as activation from "../js/core/state/actions/scenario_activation_actions.js";
import * as presentation from "../js/core/state/actions/scenario_presentation_actions.js";
import * as palette from "../js/core/state/actions/scenario_palette_actions.js";
import * as health from "../js/core/state/actions/scenario_health_actions.js";
import * as supplemental from "../js/core/state/actions/scenario_transaction_rollback_actions.js";
import { createScenarioBundleRuntimeController } from "../js/core/scenario/bundle_runtime.js";
import { createScenarioRollbackClone } from "../js/core/scenario/rollback_clone.js";
import { trimScenarioBundleCache, SCENARIO_BUNDLE_CACHE_LIMIT, SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT } from "../js/core/scenario/bundle_cache.js";
import { createScenarioChunkPayloadLoader } from "../js/core/scenario/chunk_payload_loader.js";
import { commitScenarioChunkPayloadEntriesState } from "../js/core/state/actions/scenario_chunk_runtime_actions.js";
import { ensureScenarioChunkRuntimeState, commitScenarioChunkSelectionState } from "../js/core/state/actions/scenario_chunk_runtime_actions.js";

for (const mode of ["refresh", "prewarm"]) {
  test(`${mode} actual load-to-commit path retains all 40 required chunks and drops outgoing selection pins`, async () => {
    const bundle = { id: "a", chunkPayloadCacheById: { old: { payload: {} } } };
    const runtimeState = { activeScenarioId: "a", scenarioBundleCacheById: { a: bundle } };
    ensureScenarioChunkRuntimeState(runtimeState, { scenarioId: "a" });
    const loader = createScenarioChunkPayloadLoader({ runtimeState, normalizeScenarioId: String,
      getScenarioBundleId: (value) => value.id,
      loadScenarioChunkFile: async (url) => ({ payload: { features: [{ id: url }] } }),
    });
    const requiredChunks = Array.from({ length: 40 }, (_, id) => ({ id: `required-${id}`, url: `required-${id}`, layer: "political" }));
    const source = readFileSync(new URL("../js/core/scenario/chunk_runtime.js", import.meta.url), "utf8");
    const start = mode === "refresh" ? source.indexOf("    const chunkLoadStartedAt =") : source.indexOf("    const coarsePayloadEntries =");
    const end = mode === "refresh" ? source.indexOf("    if (selection.evictableChunkIds.length)", start) : source.indexOf("      const layerSignatures =", start);
    assert.ok(start >= 0 && end > start);
    const dependencies = { bundle, runtimeState, d3Client: {},
      loadScenarioChunkPayloadEntries: loader.loadScenarioChunkPayloadEntries,
      selection: { requiredChunks }, coarseSelection: { requiredChunks },
      isScenarioChunkRefreshCurrent: () => true, loadState: runtimeState.runtimeChunkLoadState,
      scenarioId: "a", refreshContinuationState: {}, nextSelectionVersion: 1,
      nextRequiredChunkIds: requiredChunks.map((chunk) => chunk.id), nextCacheOnlyChunkIds: [], nextRetainedActiveChunkIds: [],
      selectionScenarioApplyRequestId: 1, recordScenarioChunkRuntimeMetric: () => {}, reason: "test",
      commitScenarioChunkPayloadEntriesState,
      isPrewarmContinuationCurrent: () => true, bundleScenarioId: "a", normalizeScenarioId: String,
      shouldCommitScenarioCoarsePrewarmImmediately: () => true, ensureScenarioChunkRuntimeState,
      ensureRuntimeChunkLoadState: () => runtimeState.runtimeChunkLoadState,
      hasDetailScenarioChunkIds: () => false, resolveScenarioChunkApplyEpoch: () => 1,
      prewarmScenarioApplyRequestId: 1, prewarmLoadStateGeneration: runtimeState.runtimeChunkLoadState.generation,
      commitScenarioChunkSelectionState,
    };
    const body = source.slice(start, end) + (mode === "prewarm" ? "}" : "");
    await new Function(...Object.keys(dependencies), `return (async () => { ${body} })();`)(...Object.values(dependencies));
    assert.equal(runtimeState.activeScenarioChunks.loadedChunkIds.length, 40);
    assert.equal(Object.keys(bundle.chunkPayloadCacheById).length, 40);
    assert.equal(bundle.chunkPayloadCacheById.old, undefined);
    for (const chunk of requiredChunks) assert.equal(runtimeState.activeScenarioChunks.payloadByChunkId[chunk.id].payload.features[0].id, chunk.id);
    loader.resetScenarioChunkRequests("b");
    assert.deepEqual(bundle.chunkPayloadProtectedIds, []);
    assert.equal(Object.keys(bundle.chunkPayloadCacheById).length, 32);
    assert.equal(runtimeState.activeScenarioChunks.loadedChunkIds.length, 40);
  });
}

test("overlapping selections keep caller-owned results even when the newest selection replaces cache pins", async () => {
  const runtimeState = { activeScenarioId: "a" };
  const bundle = { id: "a" };
  const resolvers = new Map();
  const loader = createScenarioChunkPayloadLoader({ runtimeState, normalizeScenarioId: String,
    getScenarioBundleId: (value) => value.id,
    loadScenarioChunkFile: (url) => new Promise((resolve) => resolvers.set(url, resolve)),
  });
  const chunks = (prefix) => Array.from({ length: 40 }, (_, id) => ({ id: `${prefix}-${id}`, url: `${prefix}-${id}`, layer: "political" }));
  const firstChunks = chunks("first"), nextChunks = chunks("next");
  const first = loader.loadScenarioChunkPayloadEntries(bundle, firstChunks);
  const next = loader.loadScenarioChunkPayloadEntries(bundle, nextChunks);
  for (const chunk of [...nextChunks, ...firstChunks]) resolvers.get(chunk.id)({ payload: { features: [chunk.id] } });
  const [firstEntries, nextEntries] = await Promise.all([first, next]);
  assert.equal(firstEntries.length, 40);
  assert.equal(nextEntries.length, 40);
  assert.ok(firstEntries.every((entry) => entry.payload.payload.features[0] === entry.chunkId));
  assert.ok(nextEntries.every((entry) => entry.payload.payload.features[0] === entry.chunkId));
  assert.ok(nextChunks.every((chunk) => bundle.chunkPayloadCacheById[chunk.id]));
  assert.equal(Object.keys(bundle.chunkPayloadCacheById).length, 40);
});

test("actual rollback capture deduplicates activation and chunk topology while every capture is isolated", () => {
  let copies = 0;
  const topology = { get arcs() { copies += 1; return [[1, 2]]; } };
  const runtimeState = {
    scenarioRuntimeTopologyData: topology, runtimePoliticalTopology: topology,
    defaultRuntimePoliticalTopology: topology,
    activeScenarioChunks: { payloadByChunkId: { a: { payload: topology } } },
    styleConfig: { ocean: { color: "blue" } },
  };
  const source = readFileSync(new URL("../js/core/scenario_rollback.js", import.meta.url), "utf8");
  const captureSource = source.slice(source.indexOf("function cloneScenarioRollbackCaptureValues("),
    source.indexOf("function buildScenarioTransactionRollbackStatePatch(")).replace("export function", "function");
  const dependencies = { ...activation, ...presentation, ...palette, ...health, ...supplemental,
    runtimeState, createScenarioRollbackClone,
    readRegisteredRuntimeHookSource: () => null, ensureScenarioAuditUiState: () => {},
    scheduleScenarioChunkRefresh: () => {}, awaitInitialScenarioChunkVisualPromotion: () => {},
  };
  const capture = new Function(...Object.keys(dependencies), `${captureSource}; return captureScenarioApplyRollbackSnapshot;`)(...Object.values(dependencies));
  const first = capture();
  assert.equal(copies, 1);
  assert.equal(first.scenarioRuntimeTopologyData, first.defaultRuntimePoliticalTopology);
  assert.equal(first.activeScenarioChunks.payloadByChunkId.a.payload, first.runtimePoliticalTopology);
  first.runtimePoliticalTopology.arcs[0][0] = 99;
  const next = capture();
  assert.equal(copies, 2);
  assert.deepEqual(next.runtimePoliticalTopology.arcs, [[1, 2]]);
  assert.notEqual(first.styleConfigOcean, runtimeState.styleConfig.ocean);
});

test("bundle controller trims on cache hit and after the apply lock is released", async () => {
  const state = { activeScenarioId: "a", scenarioApplyInFlight: true,
    scenarioBundleCacheById: Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, { bundleLevel: "full" }])) };
  const controller = createScenarioBundleRuntimeController({ state,
    normalizeScenarioId: String, normalizeScenarioBundleLevel: String, normalizeScenarioLanguage: String,
    scenarioBundleSatisfiesLevel: () => true, scenarioBundleUsesChunkedLayer: () => true,
    recordScenarioPerfMetric: () => {},
  });
  const d = state.scenarioBundleCacheById.d;
  assert.equal(await controller.loadScenarioBundle("d"), d);
  assert.equal(Object.keys(state.scenarioBundleCacheById).length, 4);
  state.scenarioApplyInFlight = false;
  state.activeScenarioId = "d";
  controller.trimScenarioBundleCaches();
  assert.equal(Object.keys(state.scenarioBundleCacheById).length, 3);
  assert.equal(state.scenarioBundleCacheById.d, d);
});

test("one batch commits each container once while preserving last-write and LRU order", () => {
  const target = {};
  commitScenarioChunkPayloadEntriesState(target, [{ chunkId: "old", payload: {} }]);
  const chunks = target.activeScenarioChunks;
  const original = chunks.payloadByChunkId;
  let assignments = 0;
  for (const key of ["payloadByChunkId", "loadedChunkIds", "lruChunkIds"]) {
    let value = chunks[key];
    Object.defineProperty(chunks, key, { configurable: true, enumerable: true,
      get: () => value, set: (next) => { assignments += 1; value = next; },
    });
  }
  const last = {};
  commitScenarioChunkPayloadEntriesState(target, [
    { chunkId: "a", payload: {} }, { chunkId: "b", payload: {} },
    { chunkId: "a", payload: last }, { chunkId: "__proto__", payload: last },
  ]);
  assert.equal(assignments, 3);
  assert.deepEqual(chunks.loadedChunkIds, ["old", "a", "b", "__proto__"]);
  assert.deepEqual(chunks.lruChunkIds, ["old", "b", "a", "__proto__"]);
  assert.equal(chunks.payloadByChunkId.a, last);
  assert.equal(Object.getPrototypeOf(chunks.payloadByChunkId), Object.prototype);
  assert.deepEqual(Object.keys(original), ["old"]);
});

test("rollback copies repeated topology once per capture and isolates subsequent captures", () => {
  let reads = 0;
  const topology = { get arcs() { reads += 1; return [[1, 2]]; } };
  const clone = createScenarioRollbackClone();
  const first = clone({ topology, chunks: { topology } });
  assert.equal(first.topology, first.chunks.topology);
  assert.equal(clone(topology), first.topology);
  assert.equal(reads, 1);
  first.topology.arcs[0][0] = 99;
  assert.deepEqual(topology.arcs, [[1, 2]]);
  const second = createScenarioRollbackClone()(topology);
  assert.notEqual(second, first.topology);
  assert.deepEqual(second.arcs, [[1, 2]]);
});

test("rollback coordinate arrays preserve holes and isolate point values", () => {
  const point = [1, 2];
  const input = [point, , point];
  const output = createScenarioRollbackClone()(input);
  assert.equal(output.length, 3);
  assert.equal(1 in output, false);
  assert.deepEqual(output[0], output[2]);
  assert.notEqual(output[0], output[2]);
  output[0][0] = 99;
  assert.equal(point[0], 1);
});

test("rollback graph preserves Map/Set/Date and aliases without retaining live objects", () => {
  const shared = { date: new Date(123) };
  shared.self = shared;
  const input = { shared, map: new Map([[shared, shared]]), set: new Set([shared]) };
  const output = createScenarioRollbackClone()(input);
  assert.equal(output.map.get(output.shared), output.shared);
  assert.equal(output.shared.self, output.shared);
  assert.ok(output.set.has(output.shared));
  assert.notEqual(output.shared.date, shared.date);
  assert.equal(output.shared.date.getTime(), 123);
});

test("bundle LRU includes preexisting cache entries and defers transaction/in-flight eviction", () => {
  const state = { activeScenarioId: "a", scenarioApplyInFlight: true,
    scenarioBundleCacheById: { a: {}, b: {}, c: {}, d: {}, e: {} } };
  const recency = new Map();
  trimScenarioBundleCache(state, recency, "e");
  assert.equal(Object.keys(state.scenarioBundleCacheById).length, 5);
  state.scenarioApplyInFlight = false;
  state.scenarioBundleCacheById.b.chunkPayloadPromisesById = { chunk: Promise.resolve() };
  trimScenarioBundleCache(state, recency, "e");
  assert.deepEqual(Object.keys(state.scenarioBundleCacheById), ["a", "b", "e"]);
  state.scenarioBundleCacheById.b.chunkPayloadPromisesById = {};
  state.scenarioBundleCacheById.f = {};
  trimScenarioBundleCache(state, recency, "f");
  assert.equal(Object.keys(state.scenarioBundleCacheById).length, SCENARIO_BUNDLE_CACHE_LIMIT);
  assert.equal(state.scenarioBundleCacheById.b, undefined);
});

test("real chunk loader bounds bundle payload retention, reuses hot chunks and safely reloads evicted chunks", async () => {
  let loads = 0;
  const state = { activeScenarioId: "a" };
  const bundle = { id: "a" };
  const loader = createScenarioChunkPayloadLoader({ runtimeState: state,
    normalizeScenarioId: String, getScenarioBundleId: (value) => value.id,
    loadScenarioChunkFile: async () => { loads += 1; return { payload: { features: [loads] } }; },
  });
  const load = (id) => loader.loadScenarioChunkPayload(bundle, { id, layer: "political", url: id });
  const retainedByCaller = await load("first");
  for (let index = 0; index < SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT; index += 1) await load(`chunk-${index}`);
  assert.equal(Object.keys(bundle.chunkPayloadCacheById).length, SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT);
  assert.equal(bundle.chunkPayloadCacheById.first, undefined);
  assert.deepEqual(retainedByCaller.payload.features, [1]);
  const before = loads;
  await load("chunk-31");
  assert.equal(loads, before);
  await load("first");
  assert.equal(loads, before + 1);
  assert.equal(Object.keys(bundle.chunkPayloadCacheById).length, SCENARIO_CHUNK_PAYLOAD_CACHE_LIMIT);
});

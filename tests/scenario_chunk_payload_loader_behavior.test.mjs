import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioChunkPayloadLoader } from "../js/core/scenario/chunk_payload_loader.js";
import { resetScenarioChunkRuntimeState } from "../js/core/state/actions/scenario_chunk_runtime_actions.js";

function fixture() {
  const state = { activeScenarioId: "a" };
  resetScenarioChunkRuntimeState(state, { scenarioId: "a" });
  let resolve, reject;
  let loadCount = 0;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const loader = createScenarioChunkPayloadLoader({
    runtimeState: state,
    normalizeScenarioId: (id) => String(id || "").trim(),
    getScenarioBundleId: (bundle) => bundle.id,
    loadScenarioChunkFile: () => { loadCount += 1; return pending; },
  });
  const bundle = { id: "a" };
  const meta = { id: "political.detail.a", layer: "political", url: "a.json" };
  return { state, loader, bundle, meta, resolve, reject, loadCount: () => loadCount };
}

for (const failed of [false, true]) {
  test(`reused request settles the current generation after the original ${failed ? "failure" : "success"} continuation`, async () => {
    const f = fixture();
    const original = f.loader.loadScenarioChunkPayload(f.bundle, f.meta);
    const originalResult = failed ? assert.rejects(original, /network/) : original;
    const cached = f.bundle.chunkPayloadPromisesById[f.meta.id];
    f.loader.resetScenarioChunkRequests("a");
    resetScenarioChunkRuntimeState(f.state, { scenarioId: "a" });
    const reused = f.loader.loadScenarioChunkPayload(f.bundle, f.meta);
    const reusedResult = failed ? assert.rejects(reused, /network/) : reused;
    assert.equal(f.loadCount(), 1);
    assert.equal(f.bundle.chunkPayloadPromisesById[f.meta.id], cached);
    if (failed) f.reject(new Error("network"));
    else f.resolve({ payload: { type: "FeatureCollection", features: [] } });
    await Promise.resolve();
    // The original generation must not complete/fail/finish the new observer.
    assert.equal(f.state.runtimeChunkLoadState.inFlightByChunkId[f.meta.id], true);
    assert.equal(f.state.runtimeChunkLoadState.errorByChunkId[f.meta.id], undefined);
    await Promise.all([originalResult, reusedResult]);
    assert.equal(f.state.runtimeChunkLoadState.inFlightByChunkId[f.meta.id], undefined);
    assert.equal(f.state.runtimeChunkLoadState.errorByChunkId[f.meta.id], failed ? "network" : undefined);
    assert.equal(f.bundle.chunkPayloadPromisesById[f.meta.id], undefined);
  });
}

test("new request completes its generation in the fetch continuation without an added await", async () => {
  const f = fixture();
  const result = f.loader.loadScenarioChunkPayload(f.bundle, f.meta);
  f.resolve({ payload: { type: "FeatureCollection", features: [] } });
  await Promise.resolve();
  assert.equal(f.state.runtimeChunkLoadState.inFlightByChunkId[f.meta.id], undefined);
  assert.ok(f.bundle.chunkPayloadCacheById[f.meta.id]);
  await result;
});

test("entry requests retain shared cached payload identity in caller-owned wrappers", async () => {
  const f = fixture();
  const first = f.loader.loadScenarioChunkPayloadEntries(f.bundle, [f.meta]);
  const second = f.loader.loadScenarioChunkPayloadEntries(f.bundle, [f.meta]);
  const geometry = { type: "FeatureCollection", features: [] };
  f.resolve({ payload: geometry });
  const [firstEntries, secondEntries] = await Promise.all([first, second]);
  const cachedEntries = await f.loader.loadScenarioChunkPayloadEntries(f.bundle, [f.meta]);
  assert.equal(f.loadCount(), 1);
  assert.notEqual(firstEntries, secondEntries);
  assert.notEqual(firstEntries[0], secondEntries[0]);
  assert.equal(firstEntries[0].payload, f.bundle.chunkPayloadCacheById[f.meta.id]);
  assert.equal(secondEntries[0].payload, firstEntries[0].payload);
  assert.equal(cachedEntries[0].payload, firstEntries[0].payload);
  assert.equal(firstEntries[0].payload.payload, geometry);
  firstEntries[0].chunkId = "caller-local";
  assert.equal(secondEntries[0].chunkId, f.meta.id);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createChunkLoadGenerationFixture, createDeferredPromise } from "./helpers/scenario_chunk_contract_support.mjs";
import { loadScenarioChunkFile } from "../js/core/scenario/bundle_loader.js";

const CHUNK_ID = "political.detail.tt";
const chunkResult = () => ({ payload: { type: "FeatureCollection", features: [] } });
const settleDispatch = async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); };

function cancellationFixture({ honorAbort = true } = {}) {
  const loads = [];
  const bundles = new Map();
  const fixture = createChunkLoadGenerationFixture({
    getCachedScenarioBundle: (id) => bundles.get(id) || null,
    loadScenarioChunkFile: (url, { signal }) => {
      const deferred = createDeferredPromise();
      const load = { url, signal, ...deferred };
      loads.push(load);
      if (honorAbort) signal.addEventListener("abort", () => deferred.reject(signal.reason), { once: true });
      return deferred.promise;
    },
  });
  return {
    ...fixture, loads, bundles,
    bundle(url, id = "tno_1962") {
      const bundle = fixture.createBundle(url, id);
      bundles.set(id, bundle);
      return bundle;
    },
  };
}

test("switch cancels the outgoing bundle even after active ID changes, preserving an incoming fetch", async () => {
  const { controller, targetState, loads, bundle } = cancellationFixture();
  const outgoing = bundle("a.json");
  const incoming = bundle("b.json", "scenario_b");
  const first = controller.preloadScenarioFocusCountryPoliticalDetailChunk(outgoing);
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  await settleDispatch();
  targetState.activeScenarioId = "scenario_b";
  const second = controller.preloadScenarioFocusCountryPoliticalDetailChunk(incoming);
  await settleDispatch();
  assert.equal(loads.length, 2);
  controller.resetScenarioChunkRuntimeState({ scenarioId: "scenario_b" });
  assert.equal(loads[0].signal.aborted, true);
  assert.equal(loads[1].signal.aborted, false);
  assert.equal(outgoing.chunkPayloadPromisesById[CHUNK_ID], undefined);
  const newLoadState = targetState.runtimeChunkLoadState;
  loads[1].resolve(chunkResult());
  await Promise.all([firstRejected, second]);
  assert.equal(outgoing.chunkPayloadCacheById[CHUNK_ID], undefined);
  assert.ok(incoming.chunkPayloadCacheById[CHUNK_ID]);
  assert.equal(targetState.runtimeChunkLoadState, newLoadState);
  assert.deepEqual(newLoadState.errorByChunkId, {});
});

test("clear discards a late aborted result and old cleanup cannot erase a retry promise", async () => {
  const { controller, targetState, loads, bundle } = cancellationFixture({ honorAbort: false });
  const current = bundle("retry.json");
  const first = controller.preloadScenarioFocusCountryPoliticalDetailChunk(current);
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  await settleDispatch();
  controller.resetScenarioChunkRuntimeState();
  assert.equal(loads[0].signal.aborted, true);
  assert.equal(current.chunkPayloadPromisesById[CHUNK_ID], undefined);
  targetState.activeScenarioId = "tno_1962";
  controller.resetScenarioChunkRuntimeState({ scenarioId: "tno_1962" });
  const retry = controller.preloadScenarioFocusCountryPoliticalDetailChunk(current);
  await settleDispatch();
  const retryCached = current.chunkPayloadPromisesById[CHUNK_ID];
  assert.equal(loads.length, 2);
  loads[0].resolve(chunkResult());
  await firstRejected;
  assert.equal(current.chunkPayloadCacheById[CHUNK_ID], undefined);
  assert.equal(current.chunkPayloadPromisesById[CHUNK_ID], retryCached);
  assert.equal(targetState.runtimeChunkLoadState.inFlightByChunkId[CHUNK_ID], true);
  loads[1].resolve(chunkResult());
  await retry;
  assert.ok(current.chunkPayloadCacheById[CHUNK_ID]);
});

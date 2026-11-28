import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioChunkPayloadLoader } from "../js/core/scenario/chunk_payload_loader.js";
import { resetScenarioChunkRuntimeState } from "../js/core/state/actions/scenario_chunk_runtime_actions.js";

function fixture() {
  const state = { activeScenarioId: "a" };
  resetScenarioChunkRuntimeState(state, { scenarioId: "a" });
  let reject, markStarted;
  const started = new Promise((yes) => { markStarted = yes; });
  let loadCount = 0;
  const pending = new Promise((_, no) => { reject = no; });
  const loader = createScenarioChunkPayloadLoader({
    runtimeState: state,
    normalizeScenarioId: (id) => String(id || "").trim(),
    getScenarioBundleId: (bundle) => bundle.id,
    loadScenarioChunkFile: () => { loadCount += 1; markStarted(); return pending; },
  });
  const bundle = { id: "a" };
  const meta = { id: "political.detail.a", layer: "political", url: "a.json" };
  return { state, loader, bundle, meta, reject, started, loadCount: () => loadCount };
}

test("reused request settles the current generation after the original failure continuation", async () => {
  const f = fixture();
  const original = f.loader.loadScenarioChunkPayload(f.bundle, f.meta);
  const originalResult = assert.rejects(original, /network/);
  // Admission is queued; the generation contract starts once fetch runs.
  await f.started;
  const cached = f.bundle.chunkPayloadPromisesById[f.meta.id];
  f.loader.resetScenarioChunkRequests("a");
  resetScenarioChunkRuntimeState(f.state, { scenarioId: "a" });
  const reused = f.loader.loadScenarioChunkPayload(f.bundle, f.meta);
  const reusedResult = assert.rejects(reused, /network/);
  assert.equal(f.loadCount(), 1);
  assert.equal(f.bundle.chunkPayloadPromisesById[f.meta.id], cached);
  f.reject(new Error("network"));

  await Promise.resolve();
  // The original generation must not complete/fail/finish the new observer.
  assert.equal(f.state.runtimeChunkLoadState.inFlightByChunkId[f.meta.id], true);
  assert.equal(f.state.runtimeChunkLoadState.errorByChunkId[f.meta.id], undefined);
  await Promise.all([originalResult, reusedResult]);
  assert.equal(f.state.runtimeChunkLoadState.inFlightByChunkId[f.meta.id], undefined);
  assert.equal(f.state.runtimeChunkLoadState.errorByChunkId[f.meta.id], "network");
  assert.equal(f.bundle.chunkPayloadPromisesById[f.meta.id], undefined);
});

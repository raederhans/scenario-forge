import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { ensureActiveScenarioOptionalLayerLoaded } from "../js/core/scenario/scenario_resources.js";

function installOptionalWaterScenario(t) {
  const fields = [
    "activeScenarioId", "scenarioBundleCacheById", "scenarioWaterRegionsData",
    "currentScenarioApplyRequestId", "renderTransactionDiagnostics", "scenarioPerfMetrics",
  ];
  const previous = Object.fromEntries(fields.map((key) => [key, state[key]]));
  const previousGlobalMetrics = globalThis.__scenarioPerfMetrics;
  t.after(() => {
    Object.assign(state, previous);
    globalThis.__scenarioPerfMetrics = previousGlobalMetrics;
  });
  state.scenarioPerfMetrics = {};
  const bundle = { manifest: { scenario_id: "optional_owner_test", water_regions_url: "water.json" } };
  state.activeScenarioId = "optional_owner_test";
  state.scenarioBundleCacheById = { optional_owner_test: bundle };
  state.scenarioWaterRegionsData = null;
  state.currentScenarioApplyRequestId = 1;
  state.renderTransactionDiagnostics = null;
  // Exercise the d3 acquisition path deterministically, without network access.
  const previousFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  t.after(() => { globalThis.fetch = previousFetch; });
  return bundle;
}

test("a failed old request leaves the successful water reload published", async t => {
  const bundle = installOptionalWaterScenario(t);
  t.mock.method(console, "warn", () => {});
  const requests = [];
  const json = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  const options = { d3Client: { json }, renderNow: false };
  const oldCaller = ensureActiveScenarioOptionalLayerLoaded("water", options);
  const newCaller = ensureActiveScenarioOptionalLayerLoaded("water", { ...options, forceReload: true });
  const newPayload = { type: "FeatureCollection", features: [{ type: "Feature", id: "new", properties: {}, geometry: null }] };
  requests[1].resolve(newPayload);
  await newCaller;
  requests[0].reject(new Error("old failed"));
  await oldCaller;
  assert.deepEqual(bundle.waterRegionsPayload, newPayload);
  assert.equal(state.scenarioWaterRegionsData, bundle.waterRegionsPayload);
});

test("optional completion caches its bundle without mutating a same-ID replacement", async (t) => {
  const oldBundle = installOptionalWaterScenario(t);
  let resolvePayload;
  const pending = ensureActiveScenarioOptionalLayerLoaded("water", {
    d3Client: { json: () => new Promise((resolve) => { resolvePayload = resolve; }) },
    renderNow: false,
  });
  const replacement = { manifest: { ...oldBundle.manifest } };
  state.scenarioBundleCacheById.optional_owner_test = replacement;
  const payload = { type: "FeatureCollection", features: [] };
  resolvePayload(payload);
  assert.deepEqual(await pending, payload);
  assert.deepEqual(oldBundle.waterRegionsPayload, payload);
  assert.equal(state.scenarioWaterRegionsData, null);
  assert.equal(replacement.waterRegionsPayload, undefined);
});

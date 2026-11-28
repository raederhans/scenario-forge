import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioStartupHydrationController } from "../js/core/scenario/startup_hydration.js";

function regionalFixture() {
  const features = ["AA-1", "AA-2"].map(id => ({ properties: { id } }));
  const full = { type: "FeatureCollection", features };
  const manifest = { scenario_id: "region", region: { bounds: [0, 0, 20, 10] } };
  const state = {
    activeScenarioId: "region", activeScenarioManifest: manifest,
    scenarioRuntimeTopologyData: { objects: { political: { geometries: features } } },
    sovereigntyByFeatureId: { "AA-1": "AA", "AA-2": "AA" },
    scenarioLandMaskData: { features: [] },
  };
  const controller = createScenarioStartupHydrationController({
    state, normalizeScenarioId: value => value,
    normalizeFeatureText: value => String(value || "").trim(),
    consumeScenarioTestHook: () => false,
    syncCountryUi() {}, syncScenarioUi() {},
  });
  const bundle = { manifest, bundleLevel: "full", source: { runtime_topology_sha256: "full-sha" } };
  const tag = controller.buildScenarioRuntimeVersionTag(bundle, state.scenarioRuntimeTopologyData);
  state.scenarioRuntimeTopologyVersionTag = state.scenarioLandMaskVersionTag = tag;
  const check = phase => controller.evaluateScenarioHydrationHealthGateState({ phase });
  return { state, full, check, controller };
}

test("startup rejects empty political coverage", () => {
  const { state, check } = regionalFixture();
  assert.equal(check("startup").ok, true);
  state.landDataFull = state.landData = { features: [] };
  assert.equal(check("startup").ok, false);
});

test("restoring full political coverage releases the startup gate", async () => {
  const { state, full, check, controller } = regionalFixture();
  state.landDataFull = state.landData = { features: [] };
  assert.equal(check("startup").ok, false);
  state.landDataFull = state.landData = full;
  const result = await controller.enforceScenarioHydrationHealthGate({ renderNow: false });
  assert.equal(result.ok, true);
  assert.equal(result.attemptedRetry, false);
});

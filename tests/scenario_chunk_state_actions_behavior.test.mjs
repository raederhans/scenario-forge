import assert from "node:assert/strict";
import test from "node:test";

const PROMOTION_ACTIONS_PATH =
  "../js/core/state/actions/scenario_chunk_promotion_actions.js";
const ACTIVATION_ACTIONS_PATH =
  "../js/core/state/actions/scenario_activation_actions.js";
const PRESENTATION_ACTIONS_PATH =
  "../js/core/state/actions/scenario_presentation_actions.js";

async function importExpectedModule(modulePath, label) {
  try {
    return await import(modulePath);
  } catch (error) {
    assert.fail(
      `${label} must exist and be importable at ${modulePath}: ${error?.message || error}`,
    );
  }
}

test("scenario chunk promotion snapshots restore exact values and absent properties", async () => {
  const {
    applyScenarioChunkOptionalLayerState,
    captureScenarioChunkPromotionState,
    restoreScenarioChunkPromotionState,
  } = await importExpectedModule(ACTIVATION_ACTIONS_PATH, "scenario activation actions");
  const { finalizeScenarioChunkCityExternalEffectState } = await importExpectedModule(
    PRESENTATION_ACTIONS_PATH,
    "scenario presentation actions",
  );
  const waterBefore = { features: [{ id: "water-before" }] };
  const target = {
    scenarioWaterRegionsData: waterBefore,
    scenarioReliefOverlayRevision: 8,
    scenarioCityOverridesData: { cities: [{ id: "before" }] },
    sentinel: "preserved",
  };

  const snapshot = captureScenarioChunkPromotionState(target, ["water", "relief", "cities"]);
  assert.equal(Object.isFrozen(snapshot), true);
  applyScenarioChunkOptionalLayerState(target, "water", { features: [] });
  applyScenarioChunkOptionalLayerState(target, "relief", { features: [{ id: "new" }] });
  const restoreResult = restoreScenarioChunkPromotionState(target, snapshot);

  assert.equal(target.scenarioWaterRegionsData, waterBefore);
  assert.equal(Object.hasOwn(target, "scenarioReliefOverlaysData"), false);
  assert.equal(target.scenarioReliefOverlayRevision, 8);
  assert.equal(restoreResult.externalEffects.length, 1);
  const [cityEffect] = restoreResult.externalEffects;
  assert.equal(cityEffect.type, "scenario-city-overrides");
  assert.deepEqual(cityEffect.payload, { cities: [{ id: "before" }] });
  target.scenarioCityOverridesData = cityEffect.payload;
  target.cityLayerRevision = 9;
  assert.equal(
    finalizeScenarioChunkCityExternalEffectState(target, cityEffect.finalizerToken),
    true,
  );
  assert.deepEqual(target.scenarioCityOverridesData, { cities: [{ id: "before" }] });
  assert.equal(Object.hasOwn(target, "cityLayerRevision"), false);
  assert.equal(target.sentinel, "preserved");
});

test("political payload commit publishes data and generation", async () => {
  const { commitScenarioPoliticalChunkPayloadState } = await import(PROMOTION_ACTIONS_PATH);
  const target = {
    scenarioDataGeneration: 4,
    scenarioDataGenerationReason: "before",
    sentinel: "preserved",
  };
  const payload = { type: "FeatureCollection", features: [{ id: "all" }] };
  const visiblePayload = { type: "FeatureCollection", features: [{ id: "visible" }] };

  assert.equal(
    commitScenarioPoliticalChunkPayloadState(target, {
      payload,
      visiblePayload,
      generationReason: "zoom-end",
    }),
    5,
  );
  assert.equal(target.scenarioPoliticalChunkData, payload);
  assert.equal(target.scenarioPoliticalVisibleChunkData, visiblePayload);
  assert.equal(target.scenarioDataGeneration, 5);
  assert.equal(target.scenarioDataGenerationReason, "zoom-end");
});

test("optional payload action preserves bundle identity and rejects non-payload fields", async () => {
  const { commitScenarioOptionalLayerPayloadState } = await import(ACTIVATION_ACTIONS_PATH);

  const bundle = { optionalLayerSettledByKey: {}, manifest: { id: "stable" } };
  const target = { scenarioBundleCacheById: { example: bundle } };

  const before = structuredClone(bundle);
  assert.equal(commitScenarioOptionalLayerPayloadState(target, "example", "water", "manifest", null), false);
  assert.equal(commitScenarioOptionalLayerPayloadState(target, "__proto__", "water", "waterRegionsPayload", null), false);
  assert.equal(commitScenarioOptionalLayerPayloadState(target, "missing", "water", "waterRegionsPayload", null), false);
  assert.deepEqual(bundle, before);
});

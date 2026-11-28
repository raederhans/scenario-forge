import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";
import { createPoliticalFeaturePolicy } from "../js/core/renderer/political_feature_policy.js";
import { analyzeScenarioPoliticalDerivedStateCoverage, createDrawSubsetIndex, isDrawSubsetIndexCurrent } from "../js/core/renderer/scenario_chunk_promotion_helpers.js";

test("full and interactive coverage follow existing shell and aggregate filtering without hiding missing data", () => {
  const leaf = { id: "GB_LEAF", properties: { country: "GB", detail_tier: "adm2", __source: "detail" } };
  const aggregate = { id: "GB_AGG", properties: { country: "GB", detail_tier: "nuts1_basic" } };
  const shell = { id: "RU_ARCTIC_FB_TEST", properties: { scenario_helper_kind: "shell_fallback", interactive: false } };
  const antarctic = { id: "AQ_TEST", properties: { country: "AQ", detail_tier: "antarctic_sector" } };
  const full = { features: [leaf, aggregate, shell, antarctic] };
  const state = { scenarioPoliticalChunkData: full, scenarioPoliticalVisibleChunkData: full,
    landDataFull: full, landData: { features: [leaf] },
    colors: { GB_LEAF: "#112233", GB_AGG: "#112233", RU_ARCTIC_FB_TEST: "#112233" } };
  const helpers = { getFeatureId: (feature) => feature.id,
    getFeatureCountryCodeNormalized: (feature) => feature.properties?.country || "",
    getDetailTier: (feature) => feature.properties?.detail_tier || "",
    isAtlantropaFieldDrivenFeature: () => false, isScenarioAtlantropaVisible: () => true,
    isInteractiveAtlantropaBooleanWeldIslandFeature: () => false, isBaseGeographyScenarioFeature: () => false };
  const policy = createPoliticalFeaturePolicy(state, helpers);
  const { buildInteractiveLandData } = createPoliticalCollectionOwner({ state,
    constants: { interactiveAggregateTierFilters: { GB: new Set(["nuts1_basic"]) } },
    helpers: { ...helpers, ...policy } });
  const check = () => analyzeScenarioPoliticalDerivedStateCoverage(state, {
    buildInteractiveLandData, shouldExcludePoliticalVisualFeature: policy.shouldExcludePoliticalVisualFeature,
  });
  let coverage = check();
  assert.equal(coverage.fullLandDataFeatureCount, 4);
  assert.equal(coverage.requiredColorFeatureCount, 3, "non-rendered Antarctic sectors need no political color");
  assert.equal(coverage.expectedInteractiveFeatureCount, 1);
  assert.equal(coverage.landDataCoverageMissing, false);
  assert.equal(coverage.colorCoverageMissing, false);
  state.landData = { features: [] };
  coverage = check();
  assert.equal(coverage.fullLandDataCoverageMissing, false);
  assert.equal(coverage.interactiveLandDataCoverageMissing, true);
  assert.deepEqual(coverage.missingInteractiveFeatureIdsSample, ["GB_LEAF"]);
  state.landData = { features: [leaf] };
  state.landDataFull = { features: [aggregate, shell, antarctic] };
  coverage = check();
  assert.equal(coverage.fullLandDataCoverageMissing, true);
  assert.deepEqual(coverage.missingFullLandFeatureIdsSample, ["GB_LEAF"]);
  state.landDataFull = full;
  delete state.colors.RU_ARCTIC_FB_TEST;
  coverage = check();
  assert.equal(coverage.landDataCoverageMissing, false);
  assert.equal(coverage.colorCoverageMissing, true, "noninteractive shell still needs its resolved color");
  assert.deepEqual(coverage.missingColorFeatureIdsSample, ["RU_ARCTIC_FB_TEST"]);
});

test("draw subset index currentness is bound to scenario and data generation", () => {
  const result = createDrawSubsetIndex({
    scenarioId: "demo",
    scenarioDataGeneration: 4,
    primaryDrawFeatureIds: ["a"],
  });

  assert.equal(isDrawSubsetIndexCurrent(result, { scenarioId: "demo", scenarioDataGeneration: 4 }), true);
  assert.equal(isDrawSubsetIndexCurrent(result, { scenarioId: "other", scenarioDataGeneration: 4 }), false);
  assert.equal(isDrawSubsetIndexCurrent(result, { scenarioId: "demo", scenarioDataGeneration: 5 }), false);
  assert.equal(isDrawSubsetIndexCurrent(null, { scenarioId: "demo", scenarioDataGeneration: 4 }), false);
});

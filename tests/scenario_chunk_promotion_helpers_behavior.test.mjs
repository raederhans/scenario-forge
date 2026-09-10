import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";
import { createPoliticalFeaturePolicy } from "../js/core/renderer/political_feature_policy.js";

import {
  analyzeScenarioPoliticalDerivedStateCoverage,
  assertPromotionDeltaPureValue,
  buildScenarioChunkPromotionVisualMetricDetails,
  createScenarioChunkPromotionDelta,
  createDrawSubsetIndex,
  isDrawSubsetIndexCurrent,
  resolveScenarioChunkPromotionChangeSet,
} from "../js/core/renderer/scenario_chunk_promotion_helpers.js";

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

test("color coverage counts canonical regions once across coarse and detail topology IDs", () => {
  const coarse = { id: 10, properties: { id: "REGION_A" } };
  const detail = { id: 900, properties: { id: "REGION_A" } };
  const other = { id: 11, properties: { id: "REGION_B" } };
  const full = { features: [coarse, detail, other] };
  const state = { scenarioPoliticalChunkData: full, scenarioPoliticalVisibleChunkData: full,
    landDataFull: { features: [detail, other] }, landData: { features: [detail, other] },
    colors: { REGION_A: "#112233", REGION_B: "#445566" } };
  let coverage = analyzeScenarioPoliticalDerivedStateCoverage(state);
  assert.equal(coverage.completePoliticalFeatureCount, 3, "raw diagnostic count remains truthful");
  assert.equal(coverage.colorsCount, 2);
  assert.equal(coverage.colorCoverageMissing, false);
  assert.deepEqual(coverage.missingColorFeatureIdsSample, []);
  state.colors = { REGION_A: "#112233", UNRELATED_REGION: "#445566" };
  coverage = analyzeScenarioPoliticalDerivedStateCoverage(state);
  assert.equal(coverage.colorCoverageMissing, true, "equal map size cannot hide a missing canonical region");
  assert.deepEqual(coverage.missingColorFeatureIdsSample, ["REGION_B"]);
});

test("political coverage borrows frozen scene collections and returns detached diagnostic samples", () => {
  const first = Object.freeze({ id: "A" });
  const second = Object.freeze({ id: "B" });
  const state = Object.freeze({
    scenarioPoliticalChunkData: Object.freeze({ features: Object.freeze([first, second]) }),
    scenarioPoliticalVisibleChunkData: Object.freeze({ features: Object.freeze([first]) }),
    landData: Object.freeze({ features: Object.freeze([first]) }),
    colors: Object.freeze({ A: "#112233" }),
  });
  const coverage = analyzeScenarioPoliticalDerivedStateCoverage(state);
  assert.equal(coverage.primaryVisibleFeatureSubsetActive, true);
  assert.equal(coverage.landDataCoverageMissing, true);
  assert.equal(coverage.colorCoverageMissing, true);
  assert.deepEqual(coverage.missingLandFeatureIdsSample, ["B"]);
  assert.deepEqual(coverage.missingColorFeatureIdsSample, ["B"]);
  coverage.missingLandFeatureIdsSample.push("external");
  coverage.missingColorFeatureIdsSample[0] = "external";
  const again = analyzeScenarioPoliticalDerivedStateCoverage(state);
  assert.deepEqual(again.missingLandFeatureIdsSample, ["B"]);
  assert.deepEqual(again.missingColorFeatureIdsSample, ["B"]);
  assert.equal(state.scenarioPoliticalChunkData.features[1], second);
});

test("scenario chunk promotion change set treats atlantropa as water and political change", () => {
  const result = resolveScenarioChunkPromotionChangeSet({
    changedLayerKeys: ["scenario_atlantropa"],
    politicalFeatureIds: [],
    hasPoliticalPayloadChange: false,
  });

  assert.deepEqual(result.normalizedChangedLayerKeys, ["scenario_atlantropa"]);
  assert.equal(result.hasAtlantropaLayerChange, true);
  assert.equal(result.hasPoliticalChange, true);
  assert.deepEqual(result.effectiveChangedLayerKeys, ["scenario_atlantropa", "water"]);
});
test("scenario chunk promotion visual metrics preserve feature and backlog counts", () => {
  const result = buildScenarioChunkPromotionVisualMetricDetails({
    activeScenarioId: "demo",
    reason: "promotion",
    runtimeChunkLoadState: { selectionVersion: 7, promotionRetryCount: 2 },
    pendingVisualPromotion: {
      selectionVersion: 8,
      requiredChunkIds: ["a", "b"],
      selectedVisibleFeatureCountSum: 3,
      selectedPoliticalFeatureCountSum: 4,
      selectedPoliticalVisibleFeatureCountSum: 5,
      primaryTotalFeatureCount: 16,
      primaryVisibleFeatureCount: 7,
      selectedByteCountSum: 8,
      selectedEstimatedPathCostSum: 9,
    },
    pendingPromotion: { requiredPoliticalChunkCount: 10 },
    promotionQueuedAt: 100,
    startedAt: 125,
    suppressRender: true,
    hasPoliticalChange: true,
    promotedTotalFeatureCount: 11,
    promotedPrimaryFeatureCount: 12,
    promotedVisibleFeatureCount: 13,
    effectiveChangedLayerKeys: ["political", "water"],
    promotionVersion: 14,
    synchronizedSecondaryRegionIndexes: true,
  });

  assert.equal(result.activeScenarioId, "demo");
  assert.equal(result.selectionVersion, 8);
  assert.equal(result.requiredChunkCount, 2);
  assert.equal(result.requiredPoliticalChunkCount, 10);
  assert.equal(result.queueMs, 25);
  assert.equal(result.promotionRetryCount, 2);
  assert.equal(result.renderNow, false);
  assert.equal(result.hasPoliticalGeometryChange, true);
  assert.equal(result.promotedTotalFeatureCount, 11);
  assert.equal(result.promotedPrimaryFeatureCount, 12);
  assert.equal(result.promotedVisibleFeatureCount, 13);
  assert.equal(result.fullPoliticalPayloadFeatureCount, 11);
  assert.equal(result.primaryTotalFeatureCount, 16);
  assert.equal(result.viewportVisibleSubsetFeatureCount, 7);
  assert.equal(result.primaryVisibleIsSubset, true);
  assert.equal(result.promotedVisibleIsSubset, false);
  assert.equal(result.selectedByteCountSum, 8);
  assert.equal(result.selectedEstimatedPathCostSum, 9);
  assert.equal(result.changedLayerCount, 2);
  assert.equal(result.promotionVersion, 14);
  assert.equal(result.synchronizedSecondaryRegionIndexes, true);
});

test("scenario chunk promotion visual metrics preserve zero visible subset counts", () => {
  const result = buildScenarioChunkPromotionVisualMetricDetails({
    pendingVisualPromotion: {
      primaryTotalFeatureCount: 12,
      primaryVisibleFeatureCount: 0,
      selectedPoliticalVisibleFeatureCountSum: 0,
    },
    promotedTotalFeatureCount: 42,
    promotedPrimaryFeatureCount: 12,
    promotedVisibleFeatureCount: 0,
  });

  assert.equal(result.primaryTotalFeatureCount, 12);
  assert.equal(result.primaryVisibleFeatureCount, 0);
  assert.equal(result.fullPoliticalPayloadFeatureCount, 42);
  assert.equal(result.viewportVisibleSubsetFeatureCount, 0);
  assert.equal(result.primaryVisibleIsSubset, true);
  assert.equal(result.promotedVisibleIsSubset, true);
});

test("scenario chunk promotion delta is a pure value contract", () => {
  const result = createScenarioChunkPromotionDelta({
    scenarioId: "tno_1962",
    selectionVersion: 4,
    reason: "zoom-end",
    runId: 9,
    changedLayerKeys: ["Political", "water", "political"],
    targetResources: ["politicalBaseBuffer", "hitIndex", "labelBuffer"],
    politicalPayloadRef: {
      kind: "political",
      id: "full",
      featureCount: 12,
      byteCount: 80,
      pathCost: 21,
    },
    primaryPoliticalPayloadRef: {
      kind: "primaryPolitical",
      id: "viewport",
      featureCount: 5,
    },
    optionalLayerPayloadRefs: [
      { kind: "strategicvalues", id: "sv", featureCount: 3 },
    ],
    infraTasks: ["scenario-chunk-promotion-infra"],
    visualTasks: ["invalidate-render-passes", "render"],
    metrics: {
      selectedByteCountSum: 80,
      primaryVisibleIsSubset: true,
      note: "contract",
    },
  });

  assert.deepEqual(result.identity, {
    kind: "scenario-chunk-promotion",
    scenarioId: "tno_1962",
    selectionVersion: 4,
    reason: "zoom-end",
    runId: 9,
  });
  assert.deepEqual(result.resources.targetResources, ["politicalBaseBuffer", "hitIndex", "labelBuffer"]);
  assert.equal(Object.hasOwn(result.resources, "legacyTargetPasses"), false);
  assert.deepEqual(result.domainLayers.dataRevisionLayers, ["political", "water"]);
  assert.equal(result.payloadRefs.politicalPayloadRef.featureCount, 12);
  assert.deepEqual(result.sideEffects.infraTasks, ["scenario-chunk-promotion-infra"]);
  assert.equal(result.metrics.primaryVisibleIsSubset, true);
  assert.equal(JSON.parse(JSON.stringify(result)).identity.scenarioId, "tno_1962");
});

test("scenario chunk promotion delta rejects non-value references", () => {
  assert.throws(
    () => assertPromotionDeltaPureValue({ nested: { fn: () => {} } }),
    /JSON-like value/,
  );
  assert.throws(
    () => assertPromotionDeltaPureValue({ nested: new Map([["a", 1]]) }),
    /plain objects/,
  );
  assert.throws(
    () => assertPromotionDeltaPureValue({ metric: Number.NaN }),
    /finite numbers/,
  );
  assert.throws(
    () => createScenarioChunkPromotionDelta({
      metrics: {
        canvasContext: {
          fillRect() {},
        },
      },
    }),
    /primitive metric/,
  );
});

test("draw subset index returns null for empty subset input", () => {
  assert.equal(createDrawSubsetIndex({
    scenarioId: "demo",
    scenarioDataGeneration: 2,
    primaryDrawFeatureIds: ["", null],
    visibleFeatureIndexesByChunkId: { a: [] },
  }), null);
});

test("draw subset index de-duplicates ids and reports rejected entries", () => {
  const result = createDrawSubsetIndex({
    scenarioId: "demo",
    scenarioDataGeneration: 3,
    subsetSignature: "viewport-a",
    primaryDrawFeatureIds: [" a ", "b", "a", "missing"],
    visibleFeatureIndexesByChunkId: {
      chunkA: [0, 2, 2, 9, -1, 1.5],
      chunkB: [1],
    },
    knownFeatureIds: ["a", "b"],
    chunkFeatureCounts: { chunkA: 3, chunkB: 2 },
  });

  assert.deepEqual(result.primaryDrawFeatureIds, ["a", "b"]);
  assert.deepEqual(result.visibleFeatureIndexesByChunkId, {
    chunkA: [0, 2],
    chunkB: [1],
  });
  assert.deepEqual(result.diagnostics, {
    duplicateFeatureIdCount: 1,
    unknownFeatureIdCount: 1,
    duplicateIndexCount: 1,
    outOfRangeIndexCount: 3,
  });
});

test("draw subset index rejects indexes for known empty chunks", () => {
  const result = createDrawSubsetIndex({
    scenarioId: "demo",
    scenarioDataGeneration: 3,
    visibleFeatureIndexesByChunkId: {
      emptyChunk: [0],
      unknownCountChunk: [0],
    },
    chunkFeatureCounts: { emptyChunk: 0 },
  });

  assert.deepEqual(result.visibleFeatureIndexesByChunkId, {
    unknownCountChunk: [0],
  });
  assert.equal(result.diagnostics.outOfRangeIndexCount, 1);
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

import {
  test,
  assert,
  mergeScenarioChunkPayloadsForViewport,
  normalizeScenarioChunkManifest,
  selectScenarioChunks,
  beginScenarioApplyRequestState,
  setLatestScenarioApplyRequestState,
  runOptionalChunkPromotionScenario,
  createCoarsePrewarmContinuationHarness,
} from "./helpers/scenario_chunk_contract_support.mjs";

const defaultRegister = (_order, ...args) => test(...args);

export function registerScenarioChunkContractQuickTests(register = defaultRegister) {
  register(19, "chunk selection requires only current viewport political chunks", () => {
    const makePoliticalChunk = (id, bounds, estimatedPathCost = 10) => ({
      id,
      url: `${id}.json`,
      layer: "political",
      lod: "detail",
      bounds,
      minZoom: 0,
      maxZoom: 99,
      priority: 0,
      countryCodes: [],
      featureCount: 1,
      byteSize: 1,
      estimatedPathCost,
    });
    const selection = selectScenarioChunks({
      scenarioId: "hoi4_1939",
      chunkRegistry: normalizeScenarioChunkManifest({
        chunks: [
          makePoliticalChunk("political.detail.visible", [-2, -2, 2, 2], 17),
          makePoliticalChunk("political.detail.outside", [80, 40, 90, 50], 19),
        ],
      }),
      zoom: 6,
      viewportBbox: [-5, -5, 5, 5],
      visibleLayers: ["political"],
      loadedChunkIds: [
        "political.detail.visible",
        "political.detail.previous",
        "political.detail.outside",
      ],
      renderBudgetHints: {
        max_required_chunks: 8,
        max_required_political_chunks: 8,
        min_required_political_chunks: 1,
        max_optional_chunks: 0,
      },
    });

    assert.deepEqual(selection.requiredChunks.map((chunk) => chunk.id), ["political.detail.visible"]);
    assert.deepEqual(selection.evictableChunkIds, [
      "political.detail.previous",
      "political.detail.outside",
    ]);
    assert.equal(selection.selectedEstimatedPathCostSum, 17);
  });

  register(23, "political chunk payload merge can clip to viewport feature bounds", () => {
    const chunk = normalizeScenarioChunkManifest({
      chunks: [
        {
          id: "political.detail.country.multi-owner",
          url: "multi-owner.json",
          layer: "political",
          lod: "detail",
          bounds: [-180, -60, 180, 80],
          feature_bounds: [
            [8, 32, 10, 34],
            [80, 40, 90, 50],
            [11, 35, 12, 36],
          ],
          feature_count: 3,
        },
      ],
    }).chunks[0];
    const result = mergeScenarioChunkPayloadsForViewport("political", [{
      chunk,
      payload: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", id: "visible-a", properties: {}, geometry: null },
          { type: "Feature", id: "outside-b", properties: {}, geometry: null },
          { type: "Feature", id: "visible-c", properties: {}, geometry: null },
        ],
      },
    }], [7, 31, 13, 37]);

    assert.deepEqual(result.payload.features.map((feature) => feature.id), ["visible-a", "visible-c"]);
    assert.equal(result.stats.visibleFeatureCount, 2);
    assert.equal(result.stats.totalFeatureCount, 3);
    assert.equal(result.stats.clippedChunkCount, 1);
  });

  register(53, "stale optional-only promotion restores payload and generation snapshot", async () => {
    const initialPayload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "atl-old", properties: {}, geometry: null },
      ],
    };
    const { runtimeState, refreshCalls } = await runOptionalChunkPromotionScenario({
      layerKey: "scenario_atlantropa",
      stateField: "scenarioAtlantropaData",
      revisionField: "scenarioAtlantropaRevision",
      reason: "atlantropa-stale",
      featureId: "atl-new",
      initialPayload,
      initialRevision: 4,
      staleBeforeVisualCommit: true,
    });

    assert.equal(Number(runtimeState.scenarioDataGeneration || 0), 0);
    assert.equal(runtimeState.scenarioDataGenerationReason, undefined);
    assert.equal(runtimeState.scenarioAtlantropaRevision, 4);
    assert.deepEqual(
      runtimeState.scenarioAtlantropaData.features.map((feature) => feature.id),
      ["atl-old"],
    );
    assert.equal(refreshCalls.length, 0);
    assert.equal(runtimeState.runtimeChunkLoadState.promotionCommitStatus, "promotion-skipped-stale");
  });

  register(63, "coarse prewarm cannot commit while a different scenario target is applying", async () => {
    const {
      bundle,
      controller,
      currentPayload,
      targetState,
      getPromotionRefreshCalls,
      resolveChunkLoad,
    } = createCoarsePrewarmContinuationHarness({
      currentScenarioApplyRequestId: 2,
      seedCurrentPoliticalChunkData: true,
      initialPoliticalVisibleChunkData: null,
      initialScenarioDataGeneration: 7,
      initialScenarioDataGenerationReason: "current-request",
    });
    setLatestScenarioApplyRequestState(targetState, {
      requestId: 2,
      targetId: "scenario_b",
    });
    beginScenarioApplyRequestState(targetState, {
      requestId: 2,
      targetId: "scenario_b",
    });

    const blockedPrewarm = controller.preloadScenarioCoarseChunks(bundle);
    resolveChunkLoad();
    const result = await blockedPrewarm;

    assert.equal(result, null);
    assert.equal(targetState.scenarioPoliticalChunkData, currentPayload);
    assert.equal(targetState.scenarioPoliticalVisibleChunkData, null);
    assert.equal(targetState.scenarioDataGeneration, 7);
    assert.equal(targetState.scenarioDataGenerationReason, "current-request");
    assert.equal(getPromotionRefreshCalls(), 0);
    assert.equal(bundle.chunkPreloaded, undefined);
  });
}

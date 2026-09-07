import {
  normalizeScenarioFeatureCollection,
  getScenarioFeatureCollectionIdentityList,
  areScenarioFeatureCollectionsEquivalent,
} from "../js/core/scenario/pure_helpers.js";
import {
  test,
  assert,
  createScenarioChunkRuntimeController,
  buildViewportGeoBounds,
  getVisibleScenarioChunkLayers,
  mergeScenarioChunkPayloadsForViewport,
  normalizeScenarioChunkManifest,
  resolveRequiredScenarioSemanticLayers,
  selectScenarioChunks,
  getSharedFeatureCountryCode,
  getSharedFeatureId,
  normalizeFeatureCountryCode,
  createRenderCacheOwner,
  createColorResolutionStrategyOwner,
  buildSpatialGridSnapshot,
  getSpatialBucketKey,
  isScenarioWaterLikeFeature,
  patchScenarioChunkLoadState,
  resetScenarioChunkRuntimeState,
  beginScenarioApplyRequestState,
  clearActiveScenarioApplyRequestState,
  setLatestScenarioApplyRequestState,
  createScenarioChunkRegistryEnsurer,
  createDeferredPromise,
  createInitialVisualRegistryContinuationHarness,
  createTimerGenerationController,
  createChunkLoadGenerationFixture,
  getFeatureId,
  runOptionalChunkPromotionScenario,
  createCoarsePrewarmContinuationHarness,
} from "./helpers/scenario_chunk_contract_support.mjs";

const defaultRegister = (_order, ...args) => test(...args);

export function registerScenarioChunkContractQuickTests(register = defaultRegister) {
  register(0, "late registry load cannot settle a reset runtime generation", async () => {
    const originalFetch = globalThis.fetch;
    const deferredRegistryResponse = createDeferredPromise();
    const targetState = {
      runtimeChunkLoadState: {
        generation: 1,
        registryStatus: "idle",
      },
    };
    const ensureScenarioChunkRegistryLoaded = createScenarioChunkRegistryEnsurer({
      patchRuntimeChunkLoadState: (patch, options) =>
        patchScenarioChunkLoadState(targetState, patch, options),
    });
    const bundle = {
      manifest: { scenario_id: "tno_1962" },
      runtimeShell: {
        scenarioId: "tno_1962",
        detailChunkManifestUrl: "detail-chunks.json",
      },
    };

    globalThis.fetch = () => deferredRegistryResponse.promise;
    try {
      const registryPromise = ensureScenarioChunkRegistryLoaded(bundle);
      await Promise.resolve();
      assert.equal(targetState.runtimeChunkLoadState.registryStatus, "loading");

      resetScenarioChunkRuntimeState(targetState, { scenarioId: "tno_1962" });
      const currentLoadState = targetState.runtimeChunkLoadState;
      currentLoadState.registryStatus = "current-generation-loading";

      deferredRegistryResponse.resolve({
        ok: true,
        text: async () => JSON.stringify({
          version: 1,
          chunks: [{ id: "political.detail.tt", layer: "political" }],
        }),
      });
      await registryPromise;

      assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
      assert.equal(currentLoadState.registryStatus, "current-generation-loading");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  register(1, "initial visual registry continuation cannot mutate a reset runtime generation", async () => {
    const {
      controller,
      targetState,
      resolveRegistry,
      getSelectionCalls,
    } = createInitialVisualRegistryContinuationHarness();

    const staleContinuation = controller.awaitInitialScenarioChunkVisualPromotion();
    await Promise.resolve();
    const staleLoadState = targetState.runtimeChunkLoadState;
    const staleGeneration = staleLoadState.generation;

    controller.resetScenarioChunkRuntimeState({ scenarioId: "scenario_a" });
    const currentLoadState = targetState.runtimeChunkLoadState;
    const currentActiveScenarioChunks = targetState.activeScenarioChunks;
    const currentActiveScenarioChunksSnapshot = structuredClone(currentActiveScenarioChunks);
    currentLoadState.pendingReason = "current-generation-pending";

    resolveRegistry();
    const result = await staleContinuation;

    assert.equal(result.status, "stale");
    assert.notEqual(currentLoadState, staleLoadState);
    assert.notEqual(currentLoadState.generation, staleGeneration);
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.equal(targetState.activeScenarioChunks, currentActiveScenarioChunks);
    assert.deepEqual(targetState.activeScenarioChunks, currentActiveScenarioChunksSnapshot);
    assert.equal(currentLoadState.pendingReason, "current-generation-pending");
    assert.equal(currentLoadState.shellStatus, "ready");
    assert.equal(currentLoadState.selectionVersion, 0);
    assert.equal(getSelectionCalls(), 0);
  });

  register(2, "initial visual registry continuation treats a newly started request as stale", async () => {
    const {
      controller,
      targetState,
      resolveRegistry,
      getSelectionCalls,
    } = createInitialVisualRegistryContinuationHarness();

    const staleContinuation = controller.awaitInitialScenarioChunkVisualPromotion();
    await Promise.resolve();
    const currentLoadState = targetState.runtimeChunkLoadState;
    targetState.currentScenarioApplyRequestId = 1;
    const currentLoadStateSnapshot = structuredClone(currentLoadState);

    resolveRegistry();
    const result = await staleContinuation;

    assert.equal(result.status, "stale");
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.deepEqual(currentLoadState, currentLoadStateSnapshot);
    assert.equal(currentLoadState.selectionVersion, 0);
    assert.equal(getSelectionCalls(), 0);
  });

  register(3, "initial visual registry continuation treats a superseding request as stale", async () => {
    const {
      controller,
      targetState,
      resolveRegistry,
      getSelectionCalls,
    } = createInitialVisualRegistryContinuationHarness({
      currentScenarioApplyRequestId: 12,
    });

    const staleContinuation = controller.awaitInitialScenarioChunkVisualPromotion();
    await Promise.resolve();
    const currentLoadState = targetState.runtimeChunkLoadState;
    targetState.currentScenarioApplyRequestId = 13;
    const currentLoadStateSnapshot = structuredClone(currentLoadState);

    resolveRegistry();
    const result = await staleContinuation;

    assert.equal(result.status, "stale");
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.deepEqual(currentLoadState, currentLoadStateSnapshot);
    assert.equal(currentLoadState.selectionVersion, 0);
    assert.equal(getSelectionCalls(), 0);
  });

  register(4, "political chunk payload write skips stale scenario apply request", () => {
    const previousPayload = {
      type: "FeatureCollection",
      features: [{ type: "Feature", id: "old-feature", properties: {}, geometry: null }],
    };
    const runtimeState = {
      activeScenarioId: "tno_1962",
      currentScenarioApplyRequestId: 2,
      scenarioPoliticalChunkData: previousPayload,
      scenarioPoliticalVisibleChunkData: null,
      renderTransactionDiagnostics: null,
    };
    let refreshCalled = false;
    const controller = createScenarioChunkRuntimeController({
      runtimeState,
      getSearchParams: () => new URLSearchParams(),
      normalizeScenarioId: (value) => String(value || "").trim(),
      normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
      normalizeScenarioPerformanceHints: (value) => value || {},
      normalizeScenarioFeatureCollection: (payload) => payload,
      getScenarioFeatureCollectionIdentityList,
      areScenarioFeatureCollectionsEquivalent: () => false,
      getScenarioDefaultCountryCode: () => "",
      getScenarioBundleId: (bundle) => String(bundle?.manifest?.scenario_id || ""),
      getCachedScenarioBundle: () => null,
      getVisibleScenarioChunkLayers: () => [],
      selectScenarioChunks: () => ({ requiredChunks: [], optionalChunks: [], evictableChunkIds: [] }),
      mergeScenarioChunkPayloads: () => null,
      normalizeScenarioRenderBudgetHints: (value) => value || {},
      loadScenarioChunkFile: async () => null,
      scenarioSupportsChunkedRuntime: () => false,
      scenarioBundleUsesChunkedLayer: () => false,
      getScenarioOptionalLayerConfig: () => null,
      syncScenarioLocalizationState: () => {},
      refreshMapDataForScenarioChunkPromotion: () => {
        refreshCalled = true;
      },
      flushRenderBoundary: () => {},
      recordScenarioPerfMetric: () => {},
      ensureScenarioChunkRegistryLoaded: async () => {},
    });

    const changed = controller.applyScenarioPoliticalChunkPayload({
      manifest: { scenario_id: "tno_1962" },
    }, {
      type: "FeatureCollection",
      features: [{ type: "Feature", id: "new-feature", properties: {}, geometry: null }],
    }, {
      reason: "unit-stale-request",
      scenarioApplyEpoch: 4,
      scenarioApplyRequestId: 1,
    });

    assert.equal(changed, false);
    assert.equal(runtimeState.scenarioPoliticalChunkData, previousPayload);
    assert.equal(refreshCalled, false);
    assert.ok(runtimeState.renderTransactionDiagnostics?.snapshots?.some((snapshot) => (
      snapshot.phase === "scenario-apply-stale-callback-skipped"
      && snapshot.extra?.callbackPhase === "political-chunk-payload-write"
      && snapshot.extra?.scenarioApplyRequestId === 1
      && snapshot.extra?.currentScenarioApplyRequestId === 2
    )));
  });

  register(5, "stale refresh timer cannot mutate a reset runtime generation", () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timerCallbacks = new Map();
    let nextTimerId = 0;
    const bundle = {
      manifest: { scenario_id: "tno_1962" },
      chunkRegistry: { byLayer: { political: [] } },
      runtimeShell: { renderBudgetHints: {} },
      countriesPayload: { countries: {} },
    };
    const targetState = {
      activeScenarioId: "tno_1962",
      renderPhase: "idle",
    };

    globalThis.setTimeout = (callback) => {
      nextTimerId += 1;
      timerCallbacks.set(nextTimerId, callback);
      return nextTimerId;
    };
    globalThis.clearTimeout = () => {};

    try {
      const controller = createTimerGenerationController(targetState, bundle);
      assert.equal(controller.scheduleScenarioChunkRefresh({ reason: "old-generation", delayMs: 0 }), "scheduled");
      const staleTimerCallback = timerCallbacks.get(1);

      controller.resetScenarioChunkRuntimeState({ scenarioId: "tno_1962" });
      assert.equal(controller.scheduleScenarioChunkRefresh({ reason: "new-generation", delayMs: 0 }), "scheduled");
      const currentLoadState = targetState.runtimeChunkLoadState;
      targetState.renderPhase = "drawing";
      currentLoadState.pendingReason = "new-generation-pending";

      staleTimerCallback();

      assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
      assert.equal(currentLoadState.refreshTimerId, 2);
      assert.equal(currentLoadState.refreshScheduled, true);
      assert.equal(currentLoadState.pendingReason, "new-generation-pending");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  register(6, "late successful chunk load cannot clear current-generation bookkeeping", async () => {
    const {
      controller,
      createBundle,
      createDeferredLoad,
      targetState,
    } = createChunkLoadGenerationFixture();
    const staleLoad = createDeferredLoad("stale-success.json");
    const currentLoad = createDeferredLoad("current-success.json");
    const stalePromise = controller.preloadScenarioFocusCountryPoliticalDetailChunk(
      createBundle("stale-success.json"),
    );
    await Promise.resolve();
    await Promise.resolve();
    const staleLoadState = targetState.runtimeChunkLoadState;
    assert.equal(staleLoadState.inFlightByChunkId["political.detail.tt"], true);

    controller.resetScenarioChunkRuntimeState({ scenarioId: "tno_1962" });
    const currentLoadState = targetState.runtimeChunkLoadState;
    const currentPromise = controller.preloadScenarioFocusCountryPoliticalDetailChunk(
      createBundle("current-success.json"),
    );
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(currentLoadState.inFlightByChunkId["political.detail.tt"], true);

    staleLoad.resolve({ payload: { type: "FeatureCollection", features: [] } });
    await stalePromise;
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.equal(currentLoadState.inFlightByChunkId["political.detail.tt"], true);
    assert.deepEqual(currentLoadState.errorByChunkId, {});

    currentLoad.resolve({ payload: { type: "FeatureCollection", features: [] } });
    await currentPromise;
    assert.deepEqual(currentLoadState.inFlightByChunkId, {});
    assert.deepEqual(currentLoadState.errorByChunkId, {});
  });

  register(7, "detail prewarm waiting for the registry cannot start after its continuation is superseded", async () => {
    const registryLoad = createDeferredPromise();
    const {
      controller,
      createBundle,
      createDeferredLoad,
      getLoadAttemptCount,
      targetState,
    } = createChunkLoadGenerationFixture({
      ensureScenarioChunkRegistryLoaded: () => registryLoad.promise,
    });
    const chunkLoad = createDeferredLoad("stale-after-registry.json");
    chunkLoad.resolve({ payload: { type: "FeatureCollection", features: [] } });
    targetState.currentScenarioApplyRequestId = 1;
    targetState.latestScenarioApplyTargetId = "tno_1962";
    const stalePromise = controller.preloadScenarioFocusCountryPoliticalDetailChunk(
      createBundle("stale-after-registry.json"),
    );
    await Promise.resolve();
    const staleLoadState = targetState.runtimeChunkLoadState;

    controller.resetScenarioChunkRuntimeState({ scenarioId: "tno_1962" });
    targetState.currentScenarioApplyRequestId = 2;
    const currentLoadState = targetState.runtimeChunkLoadState;
    registryLoad.resolve();

    assert.equal(await stalePromise, null);
    assert.equal(getLoadAttemptCount(), 0);
    assert.notEqual(currentLoadState, staleLoadState);
    assert.deepEqual(currentLoadState.inFlightByChunkId, {});
    assert.deepEqual(currentLoadState.errorByChunkId, {});
  });

  register(8, "detail prewarm cannot start while a different scenario target is applying", async () => {
    const {
      controller,
      createBundle,
      createDeferredLoad,
      getLoadAttemptCount,
      targetState,
    } = createChunkLoadGenerationFixture();
    const bundle = createBundle("different-target-in-flight.json");
    const chunkLoad = createDeferredLoad("different-target-in-flight.json");
    chunkLoad.resolve({ payload: { type: "FeatureCollection", features: [] } });
    setLatestScenarioApplyRequestState(targetState, {
      requestId: 2,
      targetId: "scenario_b",
    });
    beginScenarioApplyRequestState(targetState, {
      requestId: 2,
      targetId: "scenario_b",
    });

    assert.equal(
      await controller.preloadScenarioFocusCountryPoliticalDetailChunk(bundle),
      null,
    );
    assert.equal(getLoadAttemptCount(), 0);
    assert.deepEqual(targetState.runtimeChunkLoadState.inFlightByChunkId, {});
    assert.deepEqual(targetState.runtimeChunkLoadState.errorByChunkId, {});
  });

  register(9, "current generation observes a shared in-flight chunk fetch after reset", async () => {
    const {
      controller,
      createBundle,
      createDeferredLoad,
      targetState,
    } = createChunkLoadGenerationFixture();
    const sharedLoad = createDeferredLoad("shared-generation.json");
    const bundle = createBundle("shared-generation.json");
    const stalePromise = controller.preloadScenarioFocusCountryPoliticalDetailChunk(bundle);
    await Promise.resolve();
    await Promise.resolve();

    controller.resetScenarioChunkRuntimeState({ scenarioId: "tno_1962" });
    const currentLoadState = targetState.runtimeChunkLoadState;
    const currentPromise = controller.preloadScenarioFocusCountryPoliticalDetailChunk(bundle);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(currentLoadState.inFlightByChunkId["political.detail.tt"], true);

    sharedLoad.resolve({ payload: { type: "FeatureCollection", features: [] } });
    const [stalePayload, currentPayload] = await Promise.all([stalePromise, currentPromise]);
    assert.equal(stalePayload, currentPayload);
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.deepEqual(currentLoadState.inFlightByChunkId, {});
    assert.deepEqual(currentLoadState.errorByChunkId, {});
  });

  register(10, "late failed chunk load cannot write into current-generation bookkeeping", async () => {
    const {
      controller,
      createBundle,
      createDeferredLoad,
      targetState,
    } = createChunkLoadGenerationFixture();
    const staleLoad = createDeferredLoad("stale-failure.json");
    const currentLoad = createDeferredLoad("current-failure.json");
    const stalePromise = controller.preloadScenarioFocusCountryPoliticalDetailChunk(
      createBundle("stale-failure.json"),
    );
    await Promise.resolve();
    await Promise.resolve();

    controller.resetScenarioChunkRuntimeState({ scenarioId: "tno_1962" });
    const currentLoadState = targetState.runtimeChunkLoadState;
    const currentPromise = controller.preloadScenarioFocusCountryPoliticalDetailChunk(
      createBundle("current-failure.json"),
    );
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(currentLoadState.inFlightByChunkId["political.detail.tt"], true);

    staleLoad.reject(new Error("stale chunk failed"));
    await assert.rejects(stalePromise, /stale chunk failed/);
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.equal(currentLoadState.inFlightByChunkId["political.detail.tt"], true);
    assert.deepEqual(currentLoadState.errorByChunkId, {});

    currentLoad.resolve({ payload: { type: "FeatureCollection", features: [] } });
    await currentPromise;
    assert.deepEqual(currentLoadState.inFlightByChunkId, {});
    assert.deepEqual(currentLoadState.errorByChunkId, {});
  });

  register(11, "synchronous chunk loader failure preserves its error and clears cache state", async () => {
    const {
      controller,
      createBundle,
      createSynchronousLoadFailure,
      targetState,
    } = createChunkLoadGenerationFixture();
    const failure = new Error("synchronous chunk loader failed");
    const bundle = createBundle("synchronous-failure.json");
    createSynchronousLoadFailure("synchronous-failure.json", failure);

    await assert.rejects(
      controller.preloadScenarioFocusCountryPoliticalDetailChunk(bundle),
      (error) => error === failure,
    );
    assert.deepEqual(targetState.runtimeChunkLoadState.inFlightByChunkId, {});
    assert.deepEqual(targetState.runtimeChunkLoadState.errorByChunkId, {
      "political.detail.tt": "synchronous chunk loader failed",
    });
    assert.deepEqual(bundle.chunkPayloadPromisesById, {});
  });

  register(12, "stale promotion timer cannot clear the current generation timer", () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timerCallbacks = new Map();
    let nextTimerId = 0;
    const bundle = {
      manifest: { scenario_id: "tno_1962" },
      chunkRegistry: { byLayer: { political: [] } },
      runtimeShell: { renderBudgetHints: {} },
      countriesPayload: { countries: {} },
    };
    const targetState = {
      activeScenarioId: "tno_1962",
      renderPhase: "idle",
    };

    globalThis.setTimeout = (callback) => {
      nextTimerId += 1;
      timerCallbacks.set(nextTimerId, callback);
      return nextTimerId;
    };
    globalThis.clearTimeout = () => {};

    try {
      const controller = createTimerGenerationController(targetState, bundle);
      controller.ensureRuntimeChunkLoadState().pendingPromotion = { scenarioId: "tno_1962", reason: "old" };
      assert.equal(controller.scheduleScenarioChunkRefresh({ reason: "old-generation", delayMs: 0 }), "scheduled");
      timerCallbacks.get(1)();
      const stalePromotionTimerCallback = timerCallbacks.get(2);
      assert.equal(typeof stalePromotionTimerCallback, "function");

      controller.resetScenarioChunkRuntimeState({ scenarioId: "tno_1962" });
      controller.ensureRuntimeChunkLoadState().pendingPromotion = { scenarioId: "tno_1962", reason: "new" };
      assert.equal(controller.scheduleScenarioChunkRefresh({ reason: "new-generation", delayMs: 0 }), "scheduled");
      timerCallbacks.get(3)();
      const currentLoadState = targetState.runtimeChunkLoadState;
      assert.equal(currentLoadState.promotionTimerId, 4);
      assert.equal(currentLoadState.promotionScheduled, true);

      stalePromotionTimerCallback();

      assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
      assert.equal(currentLoadState.promotionTimerId, 4);
      assert.equal(currentLoadState.promotionScheduled, true);
      assert.equal(currentLoadState.promotionCommitStatus, "idle");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  register(13, "TNO required semantic layers enter chunk selection independent of UI visibility", () => {
    const requiredLayers = resolveRequiredScenarioSemanticLayers({
      scenarioId: "tno_1962",
      manifest: { scenario_id: "tno_1962" },
    });

    assert.deepEqual(requiredLayers, ["scenario_atlantropa", "water", "relief"]);
    assert.deepEqual(getVisibleScenarioChunkLayers({
      includePoliticalCore: true,
      showWaterRegions: false,
      showScenarioAtlantropa: false,
      requiredSemanticLayers: requiredLayers,
    }), ["political", "scenario_atlantropa", "water", "relief"]);
    assert.deepEqual(resolveRequiredScenarioSemanticLayers({
      scenarioId: "tno_1962",
      manifest: { required_semantic_layers: ["cities"] },
    }), ["cities"]);
  });

  register(14, "scheduled chunk refresh starts without seeded pending reason", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timerCallbacks = [];
    const chunk = {
      id: "political.detail.test",
      url: "political.detail.test.json",
      layer: "political",
      lod: "detail",
      bounds: [-1, -1, 1, 1],
      countryCodes: ["TT"],
    };
    const targetState = {
      activeScenarioId: "tno_1962",
      currentScenarioApplyRequestId: 21,
      activeScenarioChunks: {
        loadedChunkIds: [],
        payloadByChunkId: {},
        mergedLayerPayloads: {},
        lruChunkIds: [],
      },
      renderPerfMetrics: {},
      uiState: { developerMode: true },
      renderDiagnostics: { perfOverlayEnabled: true },
      zoomTransform: { k: 2 },
      getViewportGeoBoundsFn: () => [-2, -2, 2, 2],
    };
    let selectCalls = 0;

    globalThis.setTimeout = (callback) => {
      timerCallbacks.push(callback);
      return timerCallbacks.length;
    };
    globalThis.clearTimeout = () => {};

    try {
      const controller = createScenarioChunkRuntimeController({
        runtimeState: targetState,
        getSearchParams: () => new URLSearchParams(),
        normalizeScenarioId: (value) => String(value || "").trim(),
        normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
        normalizeScenarioFeatureCollection: (payload) => payload,
        getScenarioFeatureCollectionIdentityList,
        areScenarioFeatureCollectionsEquivalent: () => false,
        getScenarioDefaultCountryCode: () => "",
        getScenarioBundleId: () => "tno_1962",
        getCachedScenarioBundle: () => ({
          manifest: { scenario_id: "tno_1962" },
          chunkRegistry: { byLayer: { political: [chunk] } },
          runtimeShell: { renderBudgetHints: {} },
          countriesPayload: { countries: {} },
        }),
        getVisibleScenarioChunkLayers: () => ["political"],
        selectScenarioChunks: () => {
          selectCalls += 1;
          return {
            scenarioId: "tno_1962",
            requiredChunks: [chunk],
            optionalChunks: [],
            evictableChunkIds: [],
            selectedFeatureCountSum: 1,
          };
        },
        mergeScenarioChunkPayloads: (_layerKey, payloads) => ({
          type: "FeatureCollection",
          features: payloads.flatMap((payload) => payload?.features || []),
        }),
        normalizeScenarioRenderBudgetHints: (value) => value || {},
        loadScenarioChunkFile: async () => ({
          type: "FeatureCollection",
          features: [{ type: "Feature", id: "feature-a", properties: {}, geometry: null }],
        }),
        scenarioSupportsChunkedRuntime: () => true,
        scenarioBundleUsesChunkedLayer: () => true,
        getScenarioOptionalLayerConfig: () => null,
        syncScenarioLocalizationState: () => {},
        refreshMapDataForScenarioChunkPromotion: () => {},
        flushRenderBoundary: () => {},
        recordScenarioPerfMetric: () => {},
        ensureScenarioChunkRegistryLoaded: async () => {},
      });

      const status = controller.scheduleScenarioChunkRefresh({ reason: "visibility:political", delayMs: 0 });
      assert.equal(status, "scheduled");
      assert.equal(typeof status, "string");
      assert.equal(typeof status?.then, "undefined");
      assert.equal(selectCalls, 0);

      timerCallbacks.splice(0).forEach((callback) => callback());
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(selectCalls, 1);
      assert.equal(targetState.runtimeChunkLoadState.pendingScenarioApplyRequestId, 0);
      assert.equal(targetState.runtimeChunkLoadState.selectionVersion, 1);
      assert.equal(
        targetState.runtimeChunkLoadState.lastSelection.scenarioApplyRequestId,
        21,
      );
      assert.equal(
        targetState.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion[1],
        21,
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  register(15, "scenario tag focus stays tag-scoped when palette metadata maps to ISO2", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const chunk = {
      id: "political.detail.country.gco",
      url: "political.detail.country.gco.json",
      layer: "political",
      lod: "detail",
      bounds: [8, -14, 32, 14],
      countryCodes: ["GCO"],
    };
    const runtimeState = {
      activeScenarioId: "tno_1962",
      activeSovereignCode: "GCO",
      activeScenarioChunks: {
        loadedChunkIds: [],
        payloadByChunkId: {},
        mergedLayerPayloads: {},
        lruChunkIds: [],
      },
      renderPerfMetrics: {},
      uiState: { developerMode: true },
      renderDiagnostics: { perfOverlayEnabled: true },
      zoomTransform: { k: 3 },
      getViewportGeoBoundsFn: () => [12, -8, 28, 6],
    };
    let selectedFocusCountry = "";

    globalThis.setTimeout = (callback) => {
      callback();
      return 1;
    };
    globalThis.clearTimeout = () => {};

    try {
      const controller = createScenarioChunkRuntimeController({
        runtimeState,
        getSearchParams: () => new URLSearchParams(),
        normalizeScenarioId: (value) => String(value || "").trim(),
        normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
        normalizeScenarioFeatureCollection: (payload) => payload,
        getScenarioFeatureCollectionIdentityList,
        areScenarioFeatureCollectionsEquivalent: () => false,
        getScenarioDefaultCountryCode: () => "GCO",
        getScenarioBundleId: () => "tno_1962",
        getCachedScenarioBundle: () => ({
          manifest: { scenario_id: "tno_1962" },
          chunkRegistry: { byLayer: { political: [chunk] } },
          runtimeShell: { renderBudgetHints: { detail_zoom_threshold: 2 } },
          countriesPayload: { countries: { GCO: { lookup_iso2: "CD" } } },
        }),
        getVisibleScenarioChunkLayers: () => ["political"],
        selectScenarioChunks: ({ focusCountry }) => {
          selectedFocusCountry = focusCountry;
          return {
            scenarioId: "tno_1962",
            requiredChunks: [chunk],
            optionalChunks: [],
            evictableChunkIds: [],
            selectedFeatureCountSum: 1,
          };
        },
        mergeScenarioChunkPayloads: (_layerKey, payloads) => ({
          type: "FeatureCollection",
          features: payloads.flatMap((payload) => payload?.features || []),
        }),
        normalizeScenarioRenderBudgetHints: (value) => value || {},
        loadScenarioChunkFile: async () => ({
          payload: { type: "FeatureCollection", features: [] },
        }),
        scenarioSupportsChunkedRuntime: () => true,
        scenarioBundleUsesChunkedLayer: (_bundle, layerKey = "") => !layerKey || layerKey === "political",
        getScenarioOptionalLayerConfig: () => null,
        syncScenarioLocalizationState: () => {},
        refreshMapDataForScenarioChunkPromotion: () => {},
        flushRenderBoundary: () => {},
        recordScenarioPerfMetric: () => {},
        ensureScenarioChunkRegistryLoaded: async () => {},
      });

      assert.equal(controller.scheduleScenarioChunkRefresh({ reason: "zoom-end", delayMs: 0 }), "scheduled");
      for (let i = 0; i < 4; i += 1) {
        await Promise.resolve();
      }
      assert.equal(selectedFocusCountry, "GCO");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  register(16, "chunk cost tie-breaker preserves viewport center relevance", () => {
    const selection = selectScenarioChunks({
      scenarioId: "tno_1962",
      chunkRegistry: {
        byLayer: {
          political: [
            {
              id: "cheap-edge",
              url: "cheap-edge.json",
              layer: "political",
              lod: "detail",
              bounds: [-10, -10, -8, -8],
              minZoom: 0,
              maxZoom: 99,
              priority: 0,
              countryCodes: [],
              estimatedPathCost: 1,
              byteSize: 1,
              coordCount: 1,
              partCount: 1,
              featureCount: 1,
            },
            {
              id: "expensive-center",
              url: "expensive-center.json",
              layer: "political",
              lod: "detail",
              bounds: [-1, -1, 1, 1],
              minZoom: 0,
              maxZoom: 99,
              priority: 0,
              countryCodes: [],
              estimatedPathCost: 1000,
              byteSize: 1000,
              coordCount: 1000,
              partCount: 100,
              featureCount: 100,
            },
          ],
        },
      },
      zoom: 10,
      viewportBbox: [-10, -10, 10, 10],
      visibleLayers: ["political"],
      renderBudgetHints: {
        max_required_chunks: 1,
        max_optional_chunks: 0,
      },
    });
    assert.equal(selection.requiredChunks[0]?.id, "expensive-center");
  });

  register(17, "chunk cost budget limits high-cost required detail tail", () => {
    const selection = selectScenarioChunks({
      scenarioId: "tno_1962",
      chunkRegistry: {
        byLayer: {
          political: [
            {
              id: "center-a",
              url: "center-a.json",
              layer: "political",
              lod: "detail",
              bounds: [-1, -1, 1, 1],
              minZoom: 0,
              maxZoom: 99,
              priority: 0,
              countryCodes: [],
              estimatedPathCost: 10,
              byteSize: 10,
              coordCount: 10,
              partCount: 1,
              featureCount: 1,
            },
            {
              id: "center-b",
              url: "center-b.json",
              layer: "political",
              lod: "detail",
              bounds: [-1, -1, 1, 1],
              minZoom: 0,
              maxZoom: 99,
              priority: 0,
              countryCodes: [],
              estimatedPathCost: 10,
              byteSize: 10,
              coordCount: 10,
              partCount: 1,
              featureCount: 1,
            },
          ],
        },
      },
      zoom: 10,
      viewportBbox: [-10, -10, 10, 10],
      visibleLayers: ["political"],
      renderBudgetHints: {
        max_required_chunks: 1,
        min_required_chunks: 1,
        max_optional_chunks: 0,
        max_required_estimated_path_cost: 15,
      },
    });

    assert.deepEqual(selection.requiredChunks.map((chunk) => chunk.id), ["center-a"]);
    assert.equal(selection.selectedEstimatedPathCostSum, 10);
  });

  register(18, "political byte budget limits cold required detail tail", () => {
    const makePoliticalChunk = (id, byteSize) => ({
      id,
      url: `${id}.json`,
      layer: "political",
      lod: "detail",
      bounds: [-1, -1, 1, 1],
      minZoom: 0,
      maxZoom: 99,
      priority: 0,
      countryCodes: [],
      estimatedPathCost: 10,
      byteSize,
      coordCount: 10,
      partCount: 1,
      featureCount: 1,
    });
    const selection = selectScenarioChunks({
      scenarioId: "tno_1962",
      chunkRegistry: {
        byLayer: {
          political: [
            makePoliticalChunk("center-a", 5),
            makePoliticalChunk("center-b", 5),
            makePoliticalChunk("center-c", 5),
          ],
        },
      },
      zoom: 10,
      viewportBbox: [-10, -10, 10, 10],
      visibleLayers: ["political"],
      renderBudgetHints: {
        max_required_chunks: 6,
        max_required_political_chunks: 6,
        min_required_political_chunks: 2,
        max_optional_chunks: 0,
        max_required_political_byte_size: 11,
      },
    });

    assert.deepEqual(selection.requiredChunks.map((chunk) => chunk.id), ["center-a", "center-b"]);
    assert.equal(selection.selectedByteCountSum, 10);
  });

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

  register(20, "feature bounds keep broad owner chunks out of unrelated viewports", () => {
    const selection = selectScenarioChunks({
      scenarioId: "tno_1962",
      chunkRegistry: normalizeScenarioChunkManifest({
        chunks: [
          {
            id: "political.detail.country.global-owner",
            url: "global-owner.json",
            layer: "political",
            lod: "detail",
            bounds: [-180, -60, 180, 80],
            feature_bounds: [[120, 20, 130, 30]],
            min_zoom: 0,
            max_zoom: 99,
            country_codes: ["GO"],
            feature_count: 1,
            byte_size: 1,
            estimated_path_cost: 1,
          },
          {
            id: "political.detail.country.local-owner",
            url: "local-owner.json",
            layer: "political",
            lod: "detail",
            bounds: [-180, -60, 180, 80],
            feature_bounds: [[8, 32, 12, 36]],
            min_zoom: 0,
            max_zoom: 99,
            country_codes: ["LO"],
            feature_count: 1,
            byte_size: 1,
            estimated_path_cost: 1,
          },
        ],
      }),
      zoom: 2.5,
      viewportBbox: [7, 31, 13, 37],
      visibleLayers: ["political"],
      renderBudgetHints: {
        max_required_chunks: 6,
        max_required_political_chunks: 6,
        min_required_political_chunks: 1,
      },
    });

    assert.deepEqual(selection.requiredChunks.map((chunk) => chunk.id), ["political.detail.country.local-owner"]);
  });

  register(21, "edge-touching feature bounds stay eligible for political detail selection", () => {
    const selection = selectScenarioChunks({
      scenarioId: "tno_1962",
      chunkRegistry: normalizeScenarioChunkManifest({
        chunks: [
          {
            id: "political.detail.country.edge-owner",
            url: "edge-owner.json",
            layer: "political",
            lod: "detail",
            bounds: [-180, -60, 180, 80],
            feature_bounds: [[13, 33, 15, 36]],
            min_zoom: 0,
            max_zoom: 99,
            country_codes: ["EO"],
            feature_count: 1,
            byte_size: 1,
            estimated_path_cost: 1,
          },
        ],
      }),
      zoom: 2.5,
      viewportBbox: [7, 31, 13, 37],
      visibleLayers: ["political"],
      renderBudgetHints: {
        max_required_chunks: 6,
        max_required_political_chunks: 6,
        min_required_political_chunks: 1,
      },
    });

    assert.deepEqual(selection.requiredChunks.map((chunk) => chunk.id), ["political.detail.country.edge-owner"]);
  });

  register(22, "political detail selection reports viewport feature subset counts", () => {
    const selection = selectScenarioChunks({
      scenarioId: "tno_1962",
      chunkRegistry: normalizeScenarioChunkManifest({
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
            min_zoom: 0,
            max_zoom: 99,
            feature_count: 3,
            byte_size: 1,
            estimated_path_cost: 3,
          },
        ],
      }),
      zoom: 2.5,
      viewportBbox: [7, 31, 13, 37],
      visibleLayers: ["political"],
      renderBudgetHints: {
        max_required_chunks: 6,
        max_required_political_chunks: 6,
        min_required_political_chunks: 1,
      },
    });

    assert.equal(selection.selectedFeatureCountSum, 3);
    assert.equal(selection.selectedVisibleFeatureCountSum, 2);
    assert.equal(selection.selectedPoliticalFeatureCountSum, 3);
    assert.equal(selection.selectedPoliticalVisibleFeatureCountSum, 2);
    assert.equal(selection.politicalVisibleFeatureSubsetSignature, "political.detail.country.multi-owner:0.2");
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

  register(24, "political chunk feature bounds preserve zero-area positional alignment", () => {
    const selection = selectScenarioChunks({
      scenarioId: "zero_bounds",
      chunkRegistry: normalizeScenarioChunkManifest({
        chunks: [
          {
            id: "political.detail.country.zero-owner",
            url: "zero-owner.json",
            layer: "political",
            lod: "detail",
            bounds: [-180, -60, 180, 80],
            feature_bounds: [
              [0, 0, 0, 0],
              [80, 40, 90, 50],
            ],
            min_zoom: 0,
            max_zoom: 99,
            feature_count: 2,
            byte_size: 1,
            estimated_path_cost: 2,
          },
        ],
      }),
      zoom: 2.5,
      viewportBbox: [-1, -1, 1, 1],
      visibleLayers: ["political"],
      renderBudgetHints: {
        max_required_chunks: 6,
        max_required_political_chunks: 6,
        min_required_political_chunks: 1,
      },
    });

    assert.equal(selection.selectedPoliticalFeatureCountSum, 2);
    assert.equal(selection.selectedPoliticalVisibleFeatureCountSum, 1);
    assert.equal(selection.politicalVisibleFeatureSubsetSignature, "political.detail.country.zero-owner:0");

    const result = mergeScenarioChunkPayloadsForViewport("political", [{
      chunk: selection.requiredChunks[0],
      payload: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", id: "zero-a", properties: {}, geometry: null },
          { type: "Feature", id: "outside-b", properties: {}, geometry: null },
        ],
      },
    }], [-1, -1, 1, 1]);

    assert.deepEqual(result.payload.features.map((feature) => feature.id), ["zero-a"]);
    assert.equal(result.stats.visibleFeatureCount, 1);
    assert.equal(result.stats.totalFeatureCount, 2);
    assert.equal(result.stats.clippedChunkCount, 1);
  });

  register(32, "viewport geo bounds samples curved projection edges for chunk eligibility", () => {
    const bounds = buildViewportGeoBounds({
      width: 100,
      height: 100,
      transform: { x: 0, y: 0, k: 1 },
      projection: {
        invert: ([x, y]) => [
          x + 100 * Math.sin(Math.PI * (y / 100)),
          y,
        ],
      },
    });

    assert.ok(bounds[0] < 0);
    assert.ok(bounds[1] < 0);
    assert.equal(bounds[2], 180);
    assert.equal(bounds[3], 90);
  });

  register(36, "spatial grid builder returns stable bucket snapshots without renderer state writes", () => {
    const localItem = { id: "local", minX: 10, minY: 10, maxX: 80, maxY: 80 };
    const globalItem = { id: "global", minX: 0, minY: 0, maxX: 500, maxY: 500 };
    const snapshot = buildSpatialGridSnapshot({
      items: [localItem, globalItem],
      canvasWidth: 500,
      canvasHeight: 500,
      hitGridTargetCols: 5,
      hitGridMinCellPx: 100,
      hitGridMaxCellPx: 100,
      hitMaxCellsPerItem: 4,
    });

    assert.equal(snapshot.gridMeta.cellSize, 100);
    assert.equal(snapshot.gridMeta.cols, 5);
    assert.equal(snapshot.gridMeta.rows, 5);
    assert.deepEqual(snapshot.gridMeta.globals.map((item) => item.id), ["global"]);
    assert.equal(snapshot.itemsById.get("local"), localItem);
    assert.equal(snapshot.itemsById.get("global"), globalItem);
    assert.deepEqual(
      snapshot.grid.get(getSpatialBucketKey(0, 0)).map((item) => item.id),
      ["local"]
    );
    assert.equal(snapshot.grid.has(getSpatialBucketKey(4, 4)), false);
  });

  register(37, "color strategy resolves generic water-like political features to ocean fill while preserving owner land", () => {
    const state = {
      mapSemanticMode: "ownership",
      visualOverrides: {},
      featureOverrides: {},
      sovereigntyByFeatureId: {
        marine_red_sea: "SOV",
        RU_LAND: "SOV",
        ATL_OWNER: "ATL",
      },
      scenarioAutoShellOwnerByFeatureId: {},
      sovereignBaseColors: {
        SOV: "#c01010",
        ATL: "#123abc",
      },
      countryBaseColors: {},
    };
    const helpers = {
      canonicalCountryCode: (value) => String(value || "").trim().toUpperCase(),
      getFeatureCountryCodeNormalized: (feature) => String(feature?.properties?.cntr_code || "").trim().toUpperCase(),
      getFeatureId,
      getAtlantropaRuleColor: (rule) => (String(rule || "").trim() === "atlantropa_sea" ? "#2d4769" : ""),
      getOceanBaseFillColor: () => "#2d4769",
      getSafeCanvasColor: (value, fallback = "") => (/^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback),
      isAntarcticSectorFeature: () => false,
      isAtlantropaSeaFeature: (feature) => String(feature?.properties?.atl_color_rule || "").trim() === "atlantropa_sea",
      isScenarioShellFeature: () => false,
      normalizeMapSemanticMode: (value) => String(value || "ownership").trim().toLowerCase(),
    };
    const owner = createColorResolutionStrategyOwner({ state, helpers });
    const redSeaFeature = {
      type: "Feature",
      id: "marine_red_sea",
      properties: {
        id: "marine_red_sea",
        cntr_code: "RU",
        water_type: "sea",
        region_group: "marine_macro",
      },
    };
    const ruLandFeature = {
      type: "Feature",
      id: "RU_LAND",
      properties: { id: "RU_LAND", cntr_code: "RU" },
    };
    const atlantropaOwnerFeature = {
      type: "Feature",
      id: "ATL_OWNER",
      properties: {
        id: "ATL_OWNER",
        cntr_code: "ATL",
        atl_color_rule: "owner",
        region_group: "atlantropa_gulf_of_gabes_exposure_sea",
      },
    };

    assert.equal(isScenarioWaterLikeFeature(redSeaFeature, "marine_red_sea"), true);
    assert.equal(owner.getResolvedFeatureColor(redSeaFeature, "marine_red_sea"), "#2d4769");
    assert.equal(owner.getResolvedFeatureColor(ruLandFeature, "RU_LAND"), "#c01010");
    assert.equal(owner.getResolvedFeatureColor(atlantropaOwnerFeature, "ATL_OWNER"), "#123abc");
  });

  register(39, "owner/base diagnostics separate geometry country from display owner", () => {
    const feature = {
      id: "AL011",
      properties: {
        id: "AL011",
        name: "AL011",
      },
    };
    const state = {
      sovereigntyByFeatureId: {
        AL011: "ITA",
      },
    };
    const featureId = getSharedFeatureId(feature);
    const geometryCountryCode = getSharedFeatureCountryCode(feature);
    const displayOwnerCode = normalizeFeatureCountryCode(
      state.sovereigntyByFeatureId[featureId],
      { allowReserved: true }
    );

    assert.equal(featureId, "AL011");
    assert.equal(geometryCountryCode, "AL");
    assert.equal(displayOwnerCode, "ITA");
  });

  register(45, "frame scheduler continues after a failed task", async () => {
    const scheduler = await import("../js/core/frame_scheduler.js");
    const originalError = console.error;
    const calls = [];
    console.error = () => {};
    try {
      scheduler.enqueueFrameTask(() => {
        calls.push("first");
        throw new Error("scheduler test failure");
      }, { priority: "high", label: "throwing-test-task" });
      scheduler.enqueueFrameTask(() => {
        calls.push("second");
      }, { priority: "high", label: "following-test-task" });
      scheduler.runFrameTasks(8);
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(calls, ["first", "second"]);
  });

  register(46, "zoom-end evictable protection reuses unified validator across TTL, focusCountry, and selectionVersion", async () => {
    const {
      applyZoomEndChunkProtectionToSelection,
      protectZoomEndChunksForSelection,
    } = await import("../js/core/scenario/chunk_runtime.js");
    const baseLoadState = {
      zoomEndProtectedChunkIds: [],
      zoomEndProtectedUntil: 0,
      zoomEndProtectedSelectionVersion: 0,
      zoomEndProtectedScenarioId: "",
      zoomEndProtectedFocusCountry: "",
    };
    const baseRuntimeState = { runtimeChunkLoadState: baseLoadState };
    const nowMs = 1_000;
    const selection = {
      evictableChunkIds: ["political.detail.a", "political.detail.b"],
    };
    protectZoomEndChunksForSelection(baseRuntimeState, ["political.detail.a"], {
      scenarioId: "tno_1962",
      selectionVersion: 7,
      focusCountry: "de",
      nowMs,
    });
    assert.equal(
      applyZoomEndChunkProtectionToSelection(selection, baseRuntimeState, {
        scenarioId: "tno_1962",
        selectionVersion: 7,
        focusCountry: "DE",
        nowMs: nowMs + 4_000,
      }, baseLoadState),
      true,
    );
    assert.deepEqual(selection.evictableChunkIds, ["political.detail.b"]);
    assert.deepEqual(selection.retainedActiveChunkIds, ["political.detail.a"]);
    assert.deepEqual(selection.cacheOnlyChunkIds || [], []);

    const expiredLoadState = {
      ...baseLoadState,
      zoomEndProtectedChunkIds: ["political.detail.a"],
      zoomEndProtectedUntil: nowMs + 5_000,
      zoomEndProtectedSelectionVersion: 7,
      zoomEndProtectedScenarioId: "tno_1962",
      zoomEndProtectedFocusCountry: "DE",
    };
    const expiredSelection = { evictableChunkIds: ["political.detail.a"] };
    const expiredRuntimeState = { runtimeChunkLoadState: expiredLoadState };
    assert.equal(
      applyZoomEndChunkProtectionToSelection(expiredSelection, expiredRuntimeState, {
        scenarioId: "tno_1962",
        selectionVersion: 7,
        focusCountry: "DE",
        nowMs: nowMs + 5_001,
      }, expiredLoadState),
      false,
    );
    assert.deepEqual(expiredSelection.evictableChunkIds, ["political.detail.a"]);

    const previousSelection = {
      reason: "zoom-end",
      scenarioId: "tno_1962",
      selectionVersion: 8,
      focusCountry: "DE",
      recordedAt: nowMs,
      zoomEndProtectionUntil: nowMs + 5_000,
      requiredChunkIds: ["political.detail.a"],
    };
    const focusChangedSelection = { evictableChunkIds: ["political.detail.a"] };
    assert.equal(
      applyZoomEndChunkProtectionToSelection(focusChangedSelection, baseRuntimeState, {
        reason: "scenario-apply",
        previousSelection,
        scenarioId: "tno_1962",
        selectionVersion: 8,
        focusCountry: "FR",
        nowMs: nowMs + 3_000,
      }, baseLoadState),
      false,
    );
    const versionChangedSelection = { evictableChunkIds: ["political.detail.a"] };
    assert.equal(
      applyZoomEndChunkProtectionToSelection(versionChangedSelection, baseRuntimeState, {
        reason: "scenario-apply",
        previousSelection,
        scenarioId: "tno_1962",
        selectionVersion: 9,
        focusCountry: "DE",
        nowMs: nowMs + 3_000,
      }, baseLoadState),
      false,
    );
  });

  register(47, "zoom-end retained political detail chunks stay in active merge payload", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const previousChunk = {
      id: "political.detail.previous",
      url: "political.detail.previous.json",
      layer: "political",
      lod: "detail",
      bounds: [-1, -1, 1, 1],
      countryCodes: ["DE"],
    };
    const nextChunk = {
      id: "political.detail.next",
      url: "political.detail.next.json",
      layer: "political",
      lod: "detail",
      bounds: [1, 1, 2, 2],
      countryCodes: ["DE"],
    };
    const previousPayload = {
      type: "FeatureCollection",
      features: [{ type: "Feature", id: "feature-previous", properties: {}, geometry: null }],
    };
    const nextPayload = {
      type: "FeatureCollection",
      features: [{ type: "Feature", id: "feature-next", properties: {}, geometry: null }],
    };
    const bundle = {
      manifest: { scenario_id: "tno_1962" },
      chunkRegistry: { byLayer: { political: [previousChunk, nextChunk] } },
      runtimeShell: { renderBudgetHints: { detail_zoom_threshold: 2 } },
      countriesPayload: { countries: { DE: { lookup_iso2: "DE" } } },
      chunkPayloadCacheById: {},
    };
    const runtimeState = {
      activeScenarioId: "tno_1962",
      activeSovereignCode: "DE",
      activeScenarioChunks: {
        scenarioId: "tno_1962",
        loadedChunkIds: [previousChunk.id],
        payloadByChunkId: {
          [previousChunk.id]: {
            layerKey: "political",
            payload: previousPayload,
          },
        },
        mergedLayerPayloads: { political: previousPayload },
        lruChunkIds: [previousChunk.id],
      },
      runtimeChunkLoadState: {
        shellStatus: "ready",
        selectionVersion: 1,
        lastSelection: {
          reason: "zoom-end",
          scenarioId: "tno_1962",
          requiredChunkIds: [previousChunk.id],
          optionalChunkIds: [],
          cacheOnlyChunkIds: [],
          retainedActiveChunkIds: [],
          selectionVersion: 1,
          focusCountry: "DE",
          recordedAt: Date.now(),
          zoomEndProtectionUntil: Date.now() + 5000,
        },
        layerSelectionSignatures: { political: previousChunk.id },
        mergedLayerPayloadCache: { political: previousPayload },
      },
      renderPerfMetrics: {},
      uiState: { developerMode: true },
      renderDiagnostics: { perfOverlayEnabled: true },
      zoomTransform: { k: 3 },
      getViewportGeoBoundsFn: () => [-2, -2, 3, 3],
    };

    globalThis.setTimeout = (callback) => {
      callback();
      return 1;
    };
    globalThis.clearTimeout = () => {};

    try {
      const controller = createScenarioChunkRuntimeController({
        runtimeState,
        getSearchParams: () => new URLSearchParams(),
        normalizeScenarioId: (value) => String(value || "").trim(),
        normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
        normalizeScenarioFeatureCollection: (payload) => payload,
        getScenarioFeatureCollectionIdentityList,
        areScenarioFeatureCollectionsEquivalent: () => false,
        getScenarioDefaultCountryCode: () => "DE",
        getScenarioBundleId: () => "tno_1962",
        getCachedScenarioBundle: () => bundle,
        getVisibleScenarioChunkLayers: () => ["political"],
        selectScenarioChunks: () => ({
          scenarioId: "tno_1962",
          requiredChunks: [nextChunk],
          optionalChunks: [],
          evictableChunkIds: [previousChunk.id],
          selectedFeatureCountSum: 1,
        }),
        mergeScenarioChunkPayloads: (_layerKey, payloads) => ({
          type: "FeatureCollection",
          features: payloads.flatMap((payload) => payload?.features || []),
        }),
        normalizeScenarioRenderBudgetHints: (value) => value || {},
        loadScenarioChunkFile: async () => ({ payload: nextPayload }),
        scenarioSupportsChunkedRuntime: () => true,
        scenarioBundleUsesChunkedLayer: (_bundle, layerKey = "") => !layerKey || layerKey === "political",
        getScenarioOptionalLayerConfig: () => null,
        syncScenarioLocalizationState: () => {},
        refreshMapDataForScenarioChunkPromotion: () => {},
        flushRenderBoundary: () => {},
        recordScenarioPerfMetric: () => {},
        ensureScenarioChunkRegistryLoaded: async () => {},
      });

      assert.equal(controller.scheduleScenarioChunkRefresh({ reason: "scenario-apply", delayMs: 0 }), "scheduled");
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
      }

      assert.deepEqual(runtimeState.runtimeChunkLoadState.lastSelection.cacheOnlyChunkIds, []);
      assert.deepEqual(runtimeState.runtimeChunkLoadState.lastSelection.retainedActiveChunkIds, [previousChunk.id]);
      assert.deepEqual(
        runtimeState.activeScenarioChunks.mergedLayerPayloads.political.features.map((feature) => feature.id),
        ["feature-previous", "feature-next"],
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  register(48, "chunk promotion applies viewport-clipped political payload for primary recovery", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const politicalChunk = {
      id: "political.detail.viewport",
      layer: "political",
      lod: "detail",
      url: "viewport.json",
      bounds: [-180, -60, 180, 80],
      featureBounds: [
        [0, 0, 2, 2],
        [80, 40, 90, 50],
        [3, 3, 4, 4],
      ],
      featureCount: 3,
    };
    const fullPayload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "visible-a", properties: {}, geometry: null },
        { type: "Feature", id: "outside-b", properties: {}, geometry: null },
        { type: "Feature", id: "visible-c", properties: {}, geometry: null },
      ],
    };
    const bundle = {
      manifest: { scenario_id: "tno_1962" },
      chunkRegistry: { byLayer: { political: [politicalChunk] } },
      runtimeShell: { renderBudgetHints: {} },
      countriesPayload: { countries: {} },
      chunkPayloadCacheById: {},
    };
    const runtimeState = {
      activeScenarioId: "tno_1962",
      activeScenarioChunks: {
        scenarioId: "tno_1962",
        loadedChunkIds: [],
        payloadByChunkId: {},
        mergedLayerPayloads: {},
        lruChunkIds: [],
      },
      renderPerfMetrics: {},
      uiState: { developerMode: true },
      renderDiagnostics: { perfOverlayEnabled: true },
      zoomTransform: { k: 3 },
      getViewportGeoBoundsFn: () => [-1, -1, 5, 5],
      landData: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", id: "full-land-a", properties: {}, geometry: null },
          { type: "Feature", id: "full-land-b", properties: {}, geometry: null },
          { type: "Feature", id: "full-land-c", properties: {}, geometry: null },
        ],
      },
    };
    const capturedPrimaryFeatureIds = [];
    let capturedLandDataFeatureIds = [];
    let capturedPrimaryVisibleFeatureCount = 0;
    let capturedPrimaryTotalFeatureCount = 0;

    globalThis.setTimeout = (callback) => {
      callback();
      return 1;
    };
    globalThis.clearTimeout = () => {};

    try {
      const controller = createScenarioChunkRuntimeController({
        runtimeState,
        getSearchParams: () => new URLSearchParams(),
        normalizeScenarioId: (value) => String(value || "").trim(),
        normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
        normalizeScenarioFeatureCollection,
        getScenarioFeatureCollectionIdentityList,
        areScenarioFeatureCollectionsEquivalent,
        getScenarioDefaultCountryCode: () => "",
        getScenarioBundleId: () => "tno_1962",
        getCachedScenarioBundle: () => bundle,
        getVisibleScenarioChunkLayers: () => ["political"],
        selectScenarioChunks: () => ({
          scenarioId: "tno_1962",
          requiredChunks: [politicalChunk],
          optionalChunks: [],
          evictableChunkIds: [],
          viewportBbox: [-1, -1, 5, 5],
          selectedFeatureCountSum: 3,
          selectedVisibleFeatureCountSum: 2,
          selectedPoliticalFeatureCountSum: 3,
          selectedPoliticalVisibleFeatureCountSum: 2,
          politicalVisibleFeatureSubsetSignature: "political.detail.viewport:0.2",
        }),
        mergeScenarioChunkPayloads: (_layerKey, payloads) => ({
          type: "FeatureCollection",
          features: payloads.flatMap((payload) => payload?.features || []),
        }),
        mergeScenarioChunkPayloadsForViewport,
        normalizeScenarioRenderBudgetHints: (value) => value || {},
        loadScenarioChunkFile: async () => ({ payload: fullPayload }),
        scenarioSupportsChunkedRuntime: () => true,
        scenarioBundleUsesChunkedLayer: (_bundle, layerKey = "") => !layerKey || layerKey === "political",
        getScenarioOptionalLayerConfig: () => null,
        syncScenarioLocalizationState: () => {},
        refreshMapDataForScenarioChunkPromotion: () => {
          capturedLandDataFeatureIds = (runtimeState.landData?.features || [])
            .map((feature) => feature.id);
          capturedPrimaryFeatureIds.push(
            ...(runtimeState.scenarioPoliticalVisibleChunkData?.features || [])
              .map((feature) => feature.id),
          );
          capturedPrimaryVisibleFeatureCount = Number(
            runtimeState.runtimeChunkLoadState?.pendingVisualPromotion?.primaryVisibleFeatureCount || 0,
          );
          capturedPrimaryTotalFeatureCount = Number(
            runtimeState.runtimeChunkLoadState?.pendingVisualPromotion?.primaryTotalFeatureCount || 0,
          );
        },
        flushRenderBoundary: () => {},
        recordScenarioPerfMetric: () => {},
        ensureScenarioChunkRegistryLoaded: async () => {},
      });

      assert.equal(controller.scheduleScenarioChunkRefresh({ reason: "viewport-primary", delayMs: 0 }), "scheduled");
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
      }

      assert.deepEqual(
        runtimeState.scenarioPoliticalChunkData.features.map((feature) => feature.id),
        ["visible-a", "outside-b", "visible-c"],
      );
      assert.deepEqual(
        runtimeState.scenarioPoliticalVisibleChunkData.features.map((feature) => feature.id),
        ["visible-a", "visible-c"],
      );
      assert.deepEqual(capturedLandDataFeatureIds, ["full-land-a", "full-land-b", "full-land-c"]);
      assert.deepEqual(capturedPrimaryFeatureIds, ["visible-a", "visible-c"]);
      assert.equal(capturedPrimaryVisibleFeatureCount, 2);
      assert.equal(capturedPrimaryTotalFeatureCount, 3);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  register(49, "visible optional chunk promotion advances scenario data generation without political change", async () => {
    const { runtimeState, refreshCalls } = await runOptionalChunkPromotionScenario({
      layerKey: "scenario_atlantropa",
      stateField: "scenarioAtlantropaData",
      revisionField: "scenarioAtlantropaRevision",
      reason: "atlantropa-only",
      featureId: "atl-donor",
    });

    assert.equal(runtimeState.scenarioDataGeneration, 1);
    assert.equal(runtimeState.scenarioDataGenerationReason, "atlantropa-only");
    assert.equal(runtimeState.scenarioAtlantropaRevision, 1);
    assert.deepEqual(
      runtimeState.scenarioAtlantropaData.features.map((feature) => feature.id),
      ["atl-donor"],
    );
    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0].hasPoliticalPayloadChange, false);
    assert.deepEqual(refreshCalls[0].politicalFeatureIds, []);
    assert.ok(refreshCalls[0].changedLayerKeys.includes("scenario_atlantropa"));
  });

  register(50, "strategic values chunk promotion advances scenario data generation when visible", async () => {
    const { runtimeState, refreshCalls } = await runOptionalChunkPromotionScenario({
      layerKey: "strategicvalues",
      stateField: "scenarioStrategicValuesData",
      revisionField: "scenarioStrategicValuesRevision",
      visibilityState: { showStrategicResourceMarkers: true },
      reason: "strategicvalues-only",
      featureId: "strategic-donor",
    });

    assert.equal(runtimeState.scenarioDataGeneration, 1);
    assert.equal(runtimeState.scenarioDataGenerationReason, "strategicvalues-only");
    assert.equal(runtimeState.scenarioStrategicValuesRevision, 1);
    assert.deepEqual(
      runtimeState.scenarioStrategicValuesData.features.map((feature) => feature.id),
      ["strategic-donor"],
    );
    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0].hasPoliticalPayloadChange, false);
    assert.ok(refreshCalls[0].changedLayerKeys.includes("strategicvalues"));
  });

  register(51, "strategic values chunk promotion stays data-only when markers and choropleth are hidden", async () => {
    const { runtimeState, refreshCalls } = await runOptionalChunkPromotionScenario({
      layerKey: "strategicvalues",
      stateField: "scenarioStrategicValuesData",
      revisionField: "scenarioStrategicValuesRevision",
      visibilityState: { showStrategicResourceMarkers: false, strategicChoroplethMetric: "" },
      reason: "strategicvalues-hidden",
      featureId: "strategic-hidden",
    });

    assert.equal(Number(runtimeState.scenarioDataGeneration || 0), 0);
    assert.equal(runtimeState.scenarioDataGenerationReason, undefined);
    assert.equal(runtimeState.scenarioStrategicValuesRevision, 1);
    assert.deepEqual(
      runtimeState.scenarioStrategicValuesData.features.map((feature) => feature.id),
      ["strategic-hidden"],
    );
    assert.equal(refreshCalls.length, 0);
  });

  register(52, "hidden optional chunk promotion does not advance scenario data generation", async () => {
    const { runtimeState, refreshCalls } = await runOptionalChunkPromotionScenario({
      layerKey: "relief",
      stateField: "scenarioReliefOverlaysData",
      revisionField: "scenarioReliefOverlayRevision",
      visibilityState: { showScenarioReliefOverlays: false },
      reason: "hidden-relief-only",
      featureId: "relief-hidden",
    });

    assert.equal(Number(runtimeState.scenarioDataGeneration || 0), 0);
    assert.equal(runtimeState.scenarioDataGenerationReason, undefined);
    assert.equal(runtimeState.scenarioReliefOverlayRevision, 1);
    assert.deepEqual(
      runtimeState.scenarioReliefOverlaysData.features.map((feature) => feature.id),
      ["relief-hidden"],
    );
    assert.equal(refreshCalls.length, 0);
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

  register(54, "replacement promotion ownership prevents the stale continuation from restoring its snapshot", async () => {
    const initialPayload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "atl-old", properties: {}, geometry: null },
      ],
    };
    const { runtimeState: resultState } = await runOptionalChunkPromotionScenario({
      layerKey: "scenario_atlantropa",
      stateField: "scenarioAtlantropaData",
      revisionField: "scenarioAtlantropaRevision",
      reason: "atlantropa-replaced-owner",
      featureId: "atl-stale",
      initialPayload,
      initialRevision: 4,
      replacePromotionOwnerAtFrame: 2,
    });

    assert.equal(resultState.scenarioDataGeneration, 1);
    assert.equal(resultState.scenarioDataGenerationReason, "new-promotion-owner");
    assert.equal(resultState.scenarioAtlantropaRevision, 6);
    assert.deepEqual(
      resultState.scenarioAtlantropaData.features.map((feature) => feature.id),
      ["atl-new-owner"],
    );
  });

  register(55, "stale city promotion consumes its finalizer token and restores exact state", async () => {
    const initialPayload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "city-old", properties: {}, geometry: null },
      ],
    };
    const { runtimeState: targetState, refreshCalls, citySyncSnapshots } = await runOptionalChunkPromotionScenario({
      layerKey: "cities",
      stateField: "scenarioCityOverridesData",
      revisionField: "cityLayerRevision",
      reason: "cities-stale",
      featureId: "city-new",
      initialPayload,
      initialRevision: 4,
      staleBeforeVisualCommit: true,
    });

    assert.equal(Number(targetState.scenarioDataGeneration || 0), 0);
    assert.equal(targetState.scenarioDataGenerationReason, undefined);
    assert.equal(targetState.cityLayerRevision, 4);
    assert.equal(targetState.scenarioCityOverridesData, initialPayload);
    assert.equal(citySyncSnapshots.length, 2);
    assert.equal(citySyncSnapshots[0].payload.features[0].id, "city-new");
    assert.equal(citySyncSnapshots[0].revision, 5);
    assert.equal(citySyncSnapshots[1].payload, initialPayload);
    assert.equal(citySyncSnapshots[1].revision, 6);
    assert.equal(refreshCalls.length, 0);
    assert.equal(targetState.runtimeChunkLoadState.promotionCommitStatus, "promotion-skipped-stale");
  });

  register(56, "failed optional promotion restores payload revision generation and render lock", async () => {
    const initialPayload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "atl-old", properties: {}, geometry: null },
      ],
    };
    const {
      runtimeState: targetState,
      refreshCalls,
    } = await runOptionalChunkPromotionScenario({
      layerKey: "scenario_atlantropa",
      stateField: "scenarioAtlantropaData",
      revisionField: "scenarioAtlantropaRevision",
      reason: "atlantropa-error",
      featureId: "atl-new",
      initialPayload,
      initialRevision: 4,
      failOnRenderFlush: true,
    });

    assert.equal(Number(targetState.scenarioDataGeneration || 0), 0);
    assert.equal(targetState.scenarioDataGenerationReason, undefined);
    assert.equal(targetState.scenarioAtlantropaRevision, 4);
    assert.equal(targetState.scenarioAtlantropaData, initialPayload);
    assert.equal(targetState.scenarioChunkPromotionRenderLocked, false);
    assert.equal(targetState.runtimeChunkLoadState.promotionCommitStatus, "error");
    assert.equal(refreshCalls.length, 2);
    assert.equal(refreshCalls[1].reason, "scenario-chunk-promotion-error-rollback");
    assert.equal(refreshCalls[1].hasPoliticalPayloadChange, false);
  });

  register(57, "failed city promotion restores localization state and consumes its finalizer", async () => {
    const initialPayload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "city-old", properties: {}, geometry: null },
      ],
    };
    const {
      runtimeState: targetState,
      refreshCalls,
      citySyncSnapshots,
    } = await runOptionalChunkPromotionScenario({
      layerKey: "cities",
      stateField: "scenarioCityOverridesData",
      revisionField: "cityLayerRevision",
      reason: "cities-error",
      featureId: "city-new",
      initialPayload,
      initialRevision: 4,
      failOnRenderFlush: true,
    });

    assert.equal(targetState.scenarioDataGeneration, undefined);
    assert.equal(targetState.scenarioDataGenerationReason, undefined);
    assert.equal(targetState.cityLayerRevision, 4);
    assert.equal(targetState.scenarioCityOverridesData, initialPayload);
    assert.equal(targetState.scenarioChunkPromotionRenderLocked, false);
    assert.equal(targetState.runtimeChunkLoadState.promotionCommitStatus, "error");
    assert.equal(citySyncSnapshots.length, 2);
    assert.equal(citySyncSnapshots[0].payload.features[0].id, "city-new");
    assert.equal(citySyncSnapshots[1].payload, initialPayload);
    assert.equal(refreshCalls.length, 2);
    assert.equal(refreshCalls[1].reason, "scenario-chunk-promotion-error-rollback");
    assert.equal(refreshCalls[1].hasPoliticalPayloadChange, false);
  });

  register(58, "startup initial visual promotion rethrows the original commit error after rollback", async () => {
    const initialPayload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "atl-old", properties: {}, geometry: null },
      ],
    };
    const {
      runtimeState: targetState,
      promotionError,
      awaitedError,
    } = await runOptionalChunkPromotionScenario({
      layerKey: "scenario_atlantropa",
      stateField: "scenarioAtlantropaData",
      revisionField: "scenarioAtlantropaRevision",
      reason: "atlantropa-startup-error",
      featureId: "atl-new",
      initialPayload,
      initialRevision: 4,
      failOnRenderFlush: true,
      awaitInitialPromotion: true,
    });

    assert.equal(awaitedError, promotionError);
    assert.equal(targetState.scenarioDataGeneration, undefined);
    assert.equal(targetState.scenarioDataGenerationReason, undefined);
    assert.equal(targetState.scenarioAtlantropaRevision, 4);
    assert.equal(targetState.scenarioAtlantropaData, initialPayload);
    assert.equal(targetState.scenarioChunkPromotionRenderLocked, false);
    assert.equal(targetState.runtimeChunkLoadState.promotionCommitStatus, "error");
  });

  register(59, "coarse prewarm keeps complete political payload for initial promotion", async () => {
    const politicalChunk = {
      id: "political.coarse.world",
      layer: "political",
      lod: "coarse",
      url: "political.coarse.world.json",
      bounds: [-180, -90, 180, 90],
      featureBounds: [
        [0, 0, 2, 2],
        [80, 40, 90, 50],
        [3, 3, 4, 4],
      ],
      featureCount: 3,
    };
    const fullPayload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "visible-a", properties: {}, geometry: null },
        { type: "Feature", id: "outside-b", properties: {}, geometry: null },
        { type: "Feature", id: "visible-c", properties: {}, geometry: null },
      ],
    };
    const bundle = {
      manifest: {
        scenario_id: "hoi4_1939",
        summary: { feature_count: 22502 },
        render_budget_hints: {},
        performance_hints: {},
      },
      chunkRegistry: { byLayer: { political: [politicalChunk] } },
      contextLodManifest: {},
      runtimeShell: { renderBudgetHints: {} },
      countriesPayload: { countries: {} },
      chunkPayloadCacheById: {},
    };
    const targetState = {
      activeScenarioId: "hoi4_1939",
      activeScenarioChunks: {
        scenarioId: "hoi4_1939",
        loadedChunkIds: [],
        payloadByChunkId: {},
        mergedLayerPayloads: {},
        lruChunkIds: [],
      },
      renderPerfMetrics: {},
      uiState: { developerMode: true },
      renderDiagnostics: { perfOverlayEnabled: true },
      zoomTransform: { k: 1 },
      getViewportGeoBoundsFn: () => [-1, -1, 5, 5],
      landData: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", id: "full-land-a", properties: {}, geometry: null },
          { type: "Feature", id: "full-land-b", properties: {}, geometry: null },
          { type: "Feature", id: "full-land-c", properties: {}, geometry: null },
        ],
      },
    };
    let selectedViewportBbox = null;
    let capturedLandDataFeatureIds = [];

    const controller = createScenarioChunkRuntimeController({
      runtimeState: targetState,
      getSearchParams: () => new URLSearchParams(),
      normalizeScenarioId: (value) => String(value || "").trim(),
      normalizeCountryCodeAlias: (value) => String(value || "").trim().toUpperCase(),
      normalizeScenarioPerformanceHints: () => ({
        waterRegionsDefault: false,
        specialRegionsDefault: false,
        scenarioReliefOverlaysDefault: false,
        scenarioAtlantropaDefault: false,
      }),
      normalizeScenarioFeatureCollection,
      getScenarioFeatureCollectionIdentityList,
      areScenarioFeatureCollectionsEquivalent: () => false,
      getScenarioDefaultCountryCode: () => "",
      getScenarioBundleId: () => "hoi4_1939",
      getCachedScenarioBundle: () => bundle,
      getVisibleScenarioChunkLayers: () => ["political"],
      selectScenarioChunks: ({ viewportBbox }) => {
        selectedViewportBbox = viewportBbox;
        return {
          scenarioId: "hoi4_1939",
          requiredChunks: [politicalChunk],
          optionalChunks: [],
          evictableChunkIds: [],
          viewportBbox,
          selectedFeatureCountSum: 3,
          selectedVisibleFeatureCountSum: 2,
          selectedPoliticalFeatureCountSum: 3,
          selectedPoliticalVisibleFeatureCountSum: 2,
          politicalVisibleFeatureSubsetSignature: "political.coarse.world:0.2",
        };
      },
      mergeScenarioChunkPayloads: (_layerKey, payloads) => ({
        type: "FeatureCollection",
        features: payloads.flatMap((payload) => payload?.features || []),
      }),
      mergeScenarioChunkPayloadsForViewport,
      normalizeScenarioRenderBudgetHints: (value) => value || {},
      loadScenarioChunkFile: async () => ({ payload: fullPayload }),
      scenarioSupportsChunkedRuntime: () => true,
      scenarioBundleUsesChunkedLayer: (_bundle, layerKey = "") => !layerKey || layerKey === "political",
      getScenarioOptionalLayerConfig: () => null,
      syncScenarioLocalizationState: () => {},
      refreshMapDataForScenarioChunkPromotion: () => {
        capturedLandDataFeatureIds = (targetState.landData?.features || [])
          .map((feature) => feature.id);
      },
      flushRenderBoundary: () => {},
      recordScenarioPerfMetric: () => {},
      ensureScenarioChunkRegistryLoaded: async () => {},
    });

    await controller.preloadScenarioCoarseChunks(bundle);

    assert.deepEqual(selectedViewportBbox, [-180, -90, 180, 90]);
    assert.equal(targetState.scenarioDataGeneration, 1);
    assert.equal(targetState.scenarioDataGenerationReason, "coarse-prewarm");
    assert.deepEqual(
      targetState.scenarioPoliticalChunkData.features.map((feature) => feature.id),
      ["visible-a", "outside-b", "visible-c"],
    );
    assert.equal(targetState.scenarioPoliticalVisibleChunkData, null);
    assert.deepEqual(capturedLandDataFeatureIds, ["full-land-a", "full-land-b", "full-land-c"]);
  });

  register(60, "coarse prewarm cannot commit after same-scenario runtime reset supersedes its request", async () => {
    const {
      bundle,
      controller,
      currentPayload,
      targetState,
      awaitChunkLoadStarted,
      getPromotionRefreshCalls,
      resolveChunkLoad,
    } = createCoarsePrewarmContinuationHarness();

    const stalePrewarm = controller.preloadScenarioCoarseChunks(bundle);
    await awaitChunkLoadStarted();
    const staleLoadState = targetState.runtimeChunkLoadState;
    const staleGeneration = staleLoadState.generation;

    controller.resetScenarioChunkRuntimeState({ scenarioId: "scenario_a" });
    targetState.currentScenarioApplyRequestId = 2;
    targetState.scenarioPoliticalChunkData = currentPayload;
    targetState.scenarioPoliticalVisibleChunkData = null;
    targetState.scenarioDataGeneration = 7;
    targetState.scenarioDataGenerationReason = "current-request";
    const currentLoadState = targetState.runtimeChunkLoadState;
    const currentActiveScenarioChunks = targetState.activeScenarioChunks;
    const currentLoadStateSnapshot = structuredClone(currentLoadState);
    const currentActiveScenarioChunksSnapshot = structuredClone(currentActiveScenarioChunks);

    resolveChunkLoad();
    const result = await stalePrewarm;

    assert.equal(result, null);
    assert.notEqual(currentLoadState, staleLoadState);
    assert.notEqual(currentLoadState.generation, staleGeneration);
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.deepEqual(currentLoadState, currentLoadStateSnapshot);
    assert.equal(targetState.activeScenarioChunks, currentActiveScenarioChunks);
    assert.deepEqual(currentActiveScenarioChunks, currentActiveScenarioChunksSnapshot);
    assert.equal(targetState.currentScenarioApplyRequestId, 2);
    assert.equal(targetState.scenarioPoliticalChunkData, currentPayload);
    assert.equal(targetState.scenarioPoliticalVisibleChunkData, null);
    assert.equal(targetState.scenarioDataGeneration, 7);
    assert.equal(targetState.scenarioDataGenerationReason, "current-request");
    assert.equal(getPromotionRefreshCalls(), 0);
    assert.equal(bundle.chunkPreloaded, undefined);
  });

  register(61, "coarse prewarm cannot commit after its scenario apply request is superseded", async () => {
    const {
      bundle,
      controller,
      currentPayload,
      targetState,
      awaitChunkLoadStarted,
      getPromotionRefreshCalls,
      resolveChunkLoad,
    } = createCoarsePrewarmContinuationHarness();

    const stalePrewarm = controller.preloadScenarioCoarseChunks(bundle);
    await awaitChunkLoadStarted();
    const currentLoadState = targetState.runtimeChunkLoadState;
    const currentLoadStateGeneration = currentLoadState.generation;
    const currentActiveScenarioChunks = targetState.activeScenarioChunks;
    currentActiveScenarioChunks.scenarioApplyRequestId = 2;
    const currentActiveScenarioChunksSnapshot = structuredClone(currentActiveScenarioChunks);
    currentLoadState.pendingReason = "current-request";
    currentLoadState.layerSelectionSignatures = { current: "signature" };
    currentLoadState.mergedLayerPayloadCache = { current: currentPayload };
    targetState.currentScenarioApplyRequestId = 2;
    targetState.scenarioPoliticalChunkData = currentPayload;
    targetState.scenarioPoliticalVisibleChunkData = null;
    targetState.scenarioDataGeneration = 7;
    targetState.scenarioDataGenerationReason = "current-request";

    resolveChunkLoad();
    const result = await stalePrewarm;

    assert.equal(result, null);
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.equal(currentLoadState.generation, currentLoadStateGeneration);
    assert.equal(currentLoadState.pendingReason, "current-request");
    assert.deepEqual(currentLoadState.layerSelectionSignatures, { current: "signature" });
    assert.deepEqual(currentLoadState.mergedLayerPayloadCache, { current: currentPayload });
    assert.equal(targetState.activeScenarioChunks, currentActiveScenarioChunks);
    assert.deepEqual(currentActiveScenarioChunks, currentActiveScenarioChunksSnapshot);
    assert.equal(targetState.currentScenarioApplyRequestId, 2);
    assert.equal(targetState.scenarioPoliticalChunkData, currentPayload);
    assert.equal(targetState.scenarioPoliticalVisibleChunkData, null);
    assert.equal(targetState.scenarioDataGeneration, 7);
    assert.equal(targetState.scenarioDataGenerationReason, "current-request");
    assert.equal(getPromotionRefreshCalls(), 0);
    assert.equal(bundle.chunkPreloaded, undefined);
  });

  register(62, "coarse prewarm resumes after a failed apply rolls back without a newer queued request", async () => {
    const {
      bundle,
      controller,
      targetState,
      getPromotionRefreshCalls,
      resolveChunkLoad,
    } = createCoarsePrewarmContinuationHarness({
      currentScenarioApplyRequestId: 2,
    });
    setLatestScenarioApplyRequestState(targetState, {
      requestId: 2,
      targetId: "scenario_b",
    });
    beginScenarioApplyRequestState(targetState, {
      requestId: 2,
      targetId: "scenario_b",
    });
    clearActiveScenarioApplyRequestState(targetState);

    const recoveredPrewarm = controller.preloadScenarioCoarseChunks(bundle);
    resolveChunkLoad();
    const result = await recoveredPrewarm;

    assert.deepEqual(
      result?.political?.features.map((feature) => feature.id),
      ["old-prewarm"],
    );
    assert.equal(targetState.activeScenarioId, "scenario_a");
    assert.equal(targetState.currentScenarioApplyRequestId, 2);
    assert.equal(targetState.latestScenarioApplyRequestId, 2);
    assert.equal(targetState.latestScenarioApplyTargetId, "scenario_b");
    assert.equal(getPromotionRefreshCalls(), 1);
    assert.equal(bundle.chunkPreloaded, true);
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

  register(64, "coarse prewarm cannot commit after a different latest scenario target is queued", async () => {
    const {
      bundle,
      controller,
      currentPayload,
      targetState,
      awaitChunkLoadStarted,
      getPromotionRefreshCalls,
      resolveChunkLoad,
    } = createCoarsePrewarmContinuationHarness();

    const stalePrewarm = controller.preloadScenarioCoarseChunks(bundle);
    await awaitChunkLoadStarted();
    const currentLoadState = targetState.runtimeChunkLoadState;
    const currentLoadStateGeneration = currentLoadState.generation;
    const currentActiveScenarioChunks = targetState.activeScenarioChunks;
    const currentActiveScenarioChunksSnapshot = structuredClone(currentActiveScenarioChunks);
    currentLoadState.pendingReason = "current-request";
    currentLoadState.layerSelectionSignatures = { current: "signature" };
    currentLoadState.mergedLayerPayloadCache = { current: currentPayload };
    targetState.latestScenarioApplyRequestId = 2;
    targetState.latestScenarioApplyTargetId = "scenario_b";
    targetState.scenarioPoliticalChunkData = currentPayload;
    targetState.scenarioPoliticalVisibleChunkData = null;
    targetState.scenarioDataGeneration = 7;
    targetState.scenarioDataGenerationReason = "current-request";

    resolveChunkLoad();
    const result = await stalePrewarm;

    assert.equal(result, null);
    assert.equal(targetState.currentScenarioApplyRequestId, 1);
    assert.equal(targetState.latestScenarioApplyRequestId, 2);
    assert.equal(targetState.latestScenarioApplyTargetId, "scenario_b");
    assert.equal(targetState.runtimeChunkLoadState, currentLoadState);
    assert.equal(currentLoadState.generation, currentLoadStateGeneration);
    assert.equal(currentLoadState.pendingReason, "current-request");
    assert.deepEqual(currentLoadState.layerSelectionSignatures, { current: "signature" });
    assert.deepEqual(currentLoadState.mergedLayerPayloadCache, { current: currentPayload });
    assert.equal(targetState.activeScenarioChunks, currentActiveScenarioChunks);
    assert.deepEqual(currentActiveScenarioChunks, currentActiveScenarioChunksSnapshot);
    assert.equal(targetState.scenarioPoliticalChunkData, currentPayload);
    assert.equal(targetState.scenarioPoliticalVisibleChunkData, null);
    assert.equal(targetState.scenarioDataGeneration, 7);
    assert.equal(targetState.scenarioDataGenerationReason, "current-request");
    assert.equal(getPromotionRefreshCalls(), 0);
    assert.equal(bundle.chunkPreloaded, undefined);
  });

  register(65, "zoom-end retained political detail chunks persist through exact-after-settle within TTL", async () => {
    const {
      applyZoomEndChunkProtectionToSelection,
    } = await import("../js/core/scenario/chunk_runtime.js");
    const nowMs = 10_000;
    const previousSelection = {
      reason: "scenario-apply",
      scenarioId: "tno_1962",
      requiredChunkIds: ["political.detail.next"],
      retainedActiveChunkIds: ["political.detail.previous"],
      selectionVersion: 4,
      focusCountry: "DE",
      recordedAt: nowMs,
      zoomEndProtectionUntil: nowMs + 5_000,
    };
    const selection = {
      evictableChunkIds: ["political.detail.previous", "political.detail.other"],
    };

    assert.equal(
      applyZoomEndChunkProtectionToSelection(selection, { runtimeChunkLoadState: {} }, {
        reason: "exact-after-settle",
        previousSelection,
        scenarioId: "tno_1962",
        selectionVersion: 4,
        focusCountry: "DE",
        nowMs: nowMs + 3_000,
      }, {}),
      true,
    );
    assert.deepEqual(selection.evictableChunkIds, ["political.detail.other"]);
    assert.deepEqual(selection.retainedActiveChunkIds, ["political.detail.previous"]);
  });

  register(66, "political raster worker result currentness includes viewport", async () => {
    const {
      createPoliticalRasterWorkerIdentity,
      isPoliticalRasterWorkerResultCurrent,
    } = await import("../js/core/political_raster_worker_client.js");
    const base = {
      sceneGeneration: 3,
      scenarioDataGeneration: 5,
      scenarioId: "tno_1962",
      selectionVersion: 7,
      topologyRevision: 11,
      colorRevision: 13,
      transformBucket: "100:0:0",
      dpr: 1,
      viewport: { x: 0, y: 0, width: 800, height: 600 },
    };
    const requestIdentity = createPoliticalRasterWorkerIdentity(base);
    assert.equal(
      isPoliticalRasterWorkerResultCurrent(requestIdentity, createPoliticalRasterWorkerIdentity(base)),
      true,
    );
    assert.equal(
      isPoliticalRasterWorkerResultCurrent(
        requestIdentity,
        createPoliticalRasterWorkerIdentity({ ...base, sceneGeneration: 4 }),
      ),
      false,
    );
    assert.equal(
      isPoliticalRasterWorkerResultCurrent(
        requestIdentity,
        createPoliticalRasterWorkerIdentity({ ...base, scenarioDataGeneration: 6 }),
      ),
      false,
    );
    assert.equal(
      isPoliticalRasterWorkerResultCurrent(
        requestIdentity,
        createPoliticalRasterWorkerIdentity({ ...base, viewport: { x: 80, y: 0, width: 800, height: 600 } }),
      ),
      false,
    );
  });

  register(72, "frame scheduler keeps high-priority exact slices draining under continuous input pressure", async () => {
    const scheduler = await import("../js/core/frame_scheduler.js");
    const originalNavigator = globalThis.navigator;
    let inputPending = true;
    const pendingHighQueueLengths = [];
    const calls = [];
    const totalHighTasks = 6;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        scheduling: {
          isInputPending: ({ includeContinuous } = {}) => includeContinuous ? inputPending : false,
        },
      },
    });
    try {
      for (let index = 0; index < totalHighTasks; index += 1) {
        scheduler.enqueueFrameTask(() => {
          calls.push(`high-${index}`);
        }, { priority: "high", label: `exact-slice-high-${index}` });
      }
      scheduler.enqueueFrameTask(() => {
        calls.push("normal");
      }, { priority: "normal", label: "exact-slice-normal" });
      for (let frame = 0; frame < totalHighTasks; frame += 1) {
        const queueBefore = scheduler.getFrameSchedulerQueueLength({ byPriority: true });
        pendingHighQueueLengths.push(queueBefore.high);
        scheduler.runFrameTasks(1);
      }
      const queueAfterPressure = scheduler.getFrameSchedulerQueueLength({ byPriority: true });
      assert.equal(calls.includes("normal"), false);
      assert.equal(queueAfterPressure.high < pendingHighQueueLengths[0], true);
      assert.equal(queueAfterPressure.high, 0);
      for (let index = 1; index < pendingHighQueueLengths.length; index += 1) {
        assert.equal(
          pendingHighQueueLengths[index] <= pendingHighQueueLengths[index - 1],
          true,
          `high queue should keep converging by frame ${index}`,
        );
      }
      assert.equal(queueAfterPressure.normal, 1);

      inputPending = false;
      scheduler.runFrameTasks(8);
      const queueAfterRelease = scheduler.getFrameSchedulerQueueLength({ byPriority: true });
      assert.equal(queueAfterRelease.total, 0);
      assert.equal(calls[calls.length - 1], "normal");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  register(73, "frame scheduler defers high tasks for discrete input and dedupes label generation", async () => {
    const scheduler = await import("../js/core/frame_scheduler.js");
    const originalNavigator = globalThis.navigator;
    const calls = [];
    let discreteInputPending = true;
    let continuousInputPending = true;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        scheduling: {
          isInputPending: ({ includeContinuous } = {}) => includeContinuous ? continuousInputPending : discreteInputPending,
        },
      },
    });
    try {
      scheduler.enqueueFrameTask(() => {
        calls.push("deduped");
      }, { priority: "high", label: "exact-after-settle-Apply", generation: 42, dedupe: true });
      scheduler.enqueueFrameTask(() => {
        calls.push("deduped-again");
      }, { priority: "high", label: "exact-after-settle-Apply", generation: 42, dedupe: true });
      scheduler.enqueueFrameTask(() => {
        calls.push("deferred-context");
      }, { priority: "high", label: "deferred-exact-context-pass-contextScenario", generation: 43, dedupe: true });
      const queued = scheduler.getFrameSchedulerQueueLength({ byPriority: true, byLabelGeneration: true });
      assert.equal(queued.high, 2);
      assert.equal(queued.byLabelGeneration["exact-after-settle-Apply:42"], 1);
      assert.equal(queued.byLabelGeneration["deferred-exact-context-pass-contextScenario:43"], 1);

      scheduler.runFrameTasks(8);
      assert.deepEqual(calls, []);
      assert.equal(scheduler.getFrameSchedulerQueueLength({ byPriority: true }).high, 2);

      discreteInputPending = false;
      scheduler.runFrameTasks(8);
      assert.deepEqual(calls, ["deduped", "deferred-context"]);
      assert.equal(scheduler.getFrameSchedulerQueueLength({ byPriority: true }).total, 0);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  register(74, "political raster worker flag-on metadata path records accepted and stale counters", async () => {
    const workerClient = await import("../js/core/political_raster_worker_client.js");
    const originalWorker = globalThis.Worker;
    const originalLocation = globalThis.location;
    const originalMetrics = globalThis.__mc_politicalRasterWorkerMetrics;
    const postedMessages = [];
    class FakeWorker {
      constructor() {
        FakeWorker.instance = this;
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage(message) {
        postedMessages.push(message);
        this.lastMessage = message;
      }
      terminate() {
        this.terminated = true;
      }
    }
    try {
      workerClient.terminatePoliticalRasterWorker();
      delete globalThis.__mc_politicalRasterWorkerMetrics;
      Object.defineProperty(globalThis, "Worker", {
        configurable: true,
        value: FakeWorker,
      });
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: { search: "?political_raster_worker=1" },
      });
      workerClient.refreshPoliticalRasterWorkerFlag("?political_raster_worker=1");
      const baseIdentity = workerClient.createPoliticalRasterWorkerIdentity({
        scenarioId: "tno_1962",
        selectionVersion: 1,
        topologyRevision: 2,
        colorRevision: 3,
        transformBucket: "100:0:0",
        dpr: 1,
        viewport: { x: 0, y: 0, width: 800, height: 600 },
        passSignature: "political-a",
      });
      const queuedA = workerClient.requestPoliticalRasterWorkerPass({ identity: baseIdentity });
      assert.equal(queuedA.ok, true);
      assert.equal(postedMessages[0].type, "RASTER_POLITICAL_PASS");
      assert.equal(postedMessages[0].protocolVersion, 4);
      assert.equal(postedMessages[0].identity.passSignature, "political-a");
      assert.equal(postedMessages[0].renderHint.bitmapMode, false);
      assert.equal(postedMessages[0].rasterPacket, null);

      const freshIdentity = workerClient.createPoliticalRasterWorkerIdentity({
        ...baseIdentity,
        colorRevision: 4,
        passSignature: "political-b",
      });
      const queuedB = workerClient.requestPoliticalRasterWorkerPass({ identity: freshIdentity });
      assert.equal(queuedB.ok, true);
      let metrics = workerClient.ensurePoliticalRasterWorkerMetrics(globalThis);
      assert.equal(metrics.staleResponseCount, 1);
      assert.equal(metrics.rejectedStaleCount, 1);
      assert.equal(metrics.fallbackCount, 0);

      FakeWorker.instance.onmessage({
        data: {
          protocolVersion: 4,
          type: "RASTER_RESULT",
          taskId: queuedB.taskId,
          accepted: true,
          identity: freshIdentity,
          reason: "metadata-only",
          rasterMs: 2,
          encodeMs: 0,
          decodeMs: 0,
          blitMs: 0,
        },
      });
      metrics = workerClient.ensurePoliticalRasterWorkerMetrics(globalThis);
      assert.equal(metrics.acceptedCount, 1);
      assert.equal(metrics.lastReason, "metadata-only");
      assert.equal(metrics.fallbackCount, 0);
    } finally {
      workerClient.terminatePoliticalRasterWorker();
      if (originalWorker === undefined) {
        delete globalThis.Worker;
      } else {
        Object.defineProperty(globalThis, "Worker", { configurable: true, value: originalWorker });
      }
      if (originalLocation === undefined) {
        delete globalThis.location;
      } else {
        Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
      }
      if (originalMetrics === undefined) {
        delete globalThis.__mc_politicalRasterWorkerMetrics;
      } else {
        globalThis.__mc_politicalRasterWorkerMetrics = originalMetrics;
      }
      workerClient.refreshPoliticalRasterWorkerFlag("");
    }
  });

  register(75, "political raster worker flag parser accepts both explicit keys", async () => {
    const workerClient = await import("../js/core/political_raster_worker_client.js");
    assert.equal(workerClient.refreshPoliticalRasterWorkerFlag("?political_raster_worker=1"), true);
    assert.equal(workerClient.refreshPoliticalRasterWorkerFlag("?ENABLE_POLITICAL_RASTER_WORKER=yes"), true);
    assert.equal(workerClient.refreshPoliticalRasterWorkerFlag("?political_raster_worker=0"), false);
    assert.equal(workerClient.refreshPoliticalRasterWorkerFlag("?political_raster_worker_bitmap=1"), false);
    assert.equal(workerClient.isPoliticalRasterWorkerBitmapEnabled("?political_raster_worker_bitmap=1"), false);
    assert.equal(workerClient.refreshPoliticalRasterWorkerFlag("?political_raster_worker=1&political_raster_worker_bitmap=1"), true);
    assert.equal(workerClient.isPoliticalRasterWorkerBitmapEnabled("?political_raster_worker=1&political_raster_worker_bitmap=1"), true);
    assert.equal(workerClient.refreshPoliticalRasterWorkerFlag("?ENABLE_POLITICAL_RASTER_WORKER=yes&ENABLE_POLITICAL_RASTER_WORKER_BITMAP=on"), true);
    assert.equal(workerClient.isPoliticalRasterWorkerBitmapEnabled("?ENABLE_POLITICAL_RASTER_WORKER=yes&ENABLE_POLITICAL_RASTER_WORKER_BITMAP=on"), true);
    assert.equal(workerClient.refreshPoliticalRasterWorkerFlag(""), false);
  });

  register(76, "political raster worker bitmap path sends packet and consumes current result", async () => {
    const workerClient = await import("../js/core/political_raster_worker_client.js");
    const originalWorker = globalThis.Worker;
    const originalLocation = globalThis.location;
    const originalMetrics = globalThis.__mc_politicalRasterWorkerMetrics;
    const postedMessages = [];
    let bitmapAcceptedCallbacks = 0;
    let bitmapClosed = false;
    class FakeWorker {
      constructor() {
        FakeWorker.instance = this;
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage(message) {
        postedMessages.push(message);
        this.lastMessage = message;
      }
      terminate() {
        this.terminated = true;
      }
    }
    try {
      workerClient.terminatePoliticalRasterWorker();
      delete globalThis.__mc_politicalRasterWorkerMetrics;
      Object.defineProperty(globalThis, "Worker", {
        configurable: true,
        value: FakeWorker,
      });
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: { search: "?political_raster_worker=1&political_raster_worker_bitmap=1" },
      });
      workerClient.refreshPoliticalRasterWorkerFlag("?political_raster_worker=1&political_raster_worker_bitmap=1");
      const identity = workerClient.createPoliticalRasterWorkerIdentity({
        scenarioId: "tno_1962",
        selectionVersion: 1,
        topologyRevision: 2,
        colorRevision: 3,
        transformBucket: "100:0:0",
        dpr: 2,
        viewport: { x: 0, y: 0, width: 800, height: 600, right: 800, bottom: 600 },
        passSignature: "political-bitmap",
      });
      const rasterPacket = {
        canvasPxWidth: 1600,
        canvasPxHeight: 1200,
        entries: [
          {
            id: "DE",
            fillColor: "#123456",
            strokeColor: "#123456",
            strokeWidthPx: 0.5,
            rings: [[[0, 0], [10, 0], [10, 10], [0, 0]]],
          },
        ],
      };
      const queued = workerClient.requestPoliticalRasterWorkerPass({
        identity,
        rasterPacket,
        packetBuildMs: 4.5,
        renderHint: { packetFeatureCount: 1 },
        onAcceptedBitmapResult: () => {
          bitmapAcceptedCallbacks += 1;
        },
      });

      assert.equal(queued.ok, true);
      assert.equal(postedMessages[0].protocolVersion, 4);
      assert.equal(postedMessages[0].renderHint.bitmapMode, true);
      assert.equal(postedMessages[0].renderHint.packetFeatureCount, 1);
      assert.equal(postedMessages[0].packetBuildMs, 4.5);
      assert.deepEqual(postedMessages[0].rasterPacket, rasterPacket);

      const bitmap = { close: () => { bitmapClosed = true; } };
      FakeWorker.instance.onmessage({
        data: {
          protocolVersion: 4,
          type: "RASTER_RESULT",
          taskId: queued.taskId,
          accepted: true,
          identity,
          reason: "bitmap",
          bitmap,
          canvasPxWidth: 1600,
          canvasPxHeight: 1200,
          rasterMs: 3,
          encodeMs: 1,
          decodeMs: 0,
          blitMs: 0,
        },
      });

      const metrics = workerClient.ensurePoliticalRasterWorkerMetrics(globalThis);
      assert.equal(metrics.acceptedCount, 1);
      assert.equal(metrics.bitmapAcceptedCount, 1);
      assert.equal(metrics.packetBuildMs, 4.5);
      assert.equal(metrics.lastReason, "bitmap");
      assert.equal(bitmapAcceptedCallbacks, 1);

      const consumed = workerClient.consumePoliticalRasterWorkerBitmapResult(identity);
      assert.equal(consumed.bitmap, bitmap);
      assert.equal(consumed.reason, "bitmap");
      assert.equal(workerClient.consumePoliticalRasterWorkerBitmapResult(identity), null);
      assert.equal(bitmapClosed, false);
    } finally {
      workerClient.terminatePoliticalRasterWorker();
      if (originalWorker === undefined) {
        delete globalThis.Worker;
      } else {
        Object.defineProperty(globalThis, "Worker", { configurable: true, value: originalWorker });
      }
      if (originalLocation === undefined) {
        delete globalThis.location;
      } else {
        Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
      }
      if (originalMetrics === undefined) {
        delete globalThis.__mc_politicalRasterWorkerMetrics;
      } else {
        globalThis.__mc_politicalRasterWorkerMetrics = originalMetrics;
      }
      workerClient.refreshPoliticalRasterWorkerFlag("");
    }
  });

  register(77, "political raster worker bitmap rejects failure and late bitmap responses", async () => {
    const workerClient = await import("../js/core/political_raster_worker_client.js");
    const originalWorker = globalThis.Worker;
    const originalLocation = globalThis.location;
    const originalMetrics = globalThis.__mc_politicalRasterWorkerMetrics;
    let closedLateBitmap = false;
    const postedMessages = [];
    class FakeWorker {
      constructor() {
        FakeWorker.instance = this;
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage(message) {
        postedMessages.push(message);
        this.lastMessage = message;
      }
      terminate() {
        this.terminated = true;
      }
    }
    try {
      workerClient.terminatePoliticalRasterWorker();
      delete globalThis.__mc_politicalRasterWorkerMetrics;
      Object.defineProperty(globalThis, "Worker", {
        configurable: true,
        value: FakeWorker,
      });
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: { search: "?political_raster_worker=1&political_raster_worker_bitmap=1" },
      });
      workerClient.refreshPoliticalRasterWorkerFlag("?political_raster_worker=1&political_raster_worker_bitmap=1");
      const identity = workerClient.createPoliticalRasterWorkerIdentity({
        scenarioId: "tno_1962",
        selectionVersion: 1,
        topologyRevision: 2,
        colorRevision: 3,
        transformBucket: "100:0:0",
        dpr: 1,
        viewport: { x: 0, y: 0, width: 800, height: 600 },
        passSignature: "political-bitmap-failure",
      });

      const rejected = workerClient.requestPoliticalRasterWorkerPass({
        identity,
        rasterPacket: { canvasPxWidth: 800, canvasPxHeight: 600, entries: [] },
        packetBuildMs: 1,
      });
      assert.equal(rejected.ok, true);
      FakeWorker.instance.onmessage({
        data: {
          protocolVersion: 4,
          type: "ERROR",
          taskId: rejected.taskId,
          errorCode: "empty-raster-packet",
          packetBuildMs: 1,
        },
      });
      let metrics = workerClient.ensurePoliticalRasterWorkerMetrics(globalThis);
      assert.equal(metrics.acceptedCount, 0);
      assert.equal(metrics.fallbackCount, 1);
      assert.equal(metrics.lastReason, "empty-raster-packet");
      assert.equal(workerClient.consumePoliticalRasterWorkerBitmapResult(identity), null);

      const pending = workerClient.requestPoliticalRasterWorkerPass({
        identity,
        rasterPacket: { canvasPxWidth: 800, canvasPxHeight: 600, entries: [{ id: "DE", rings: [[[0, 0], [1, 0], [0, 1]]] }] },
        packetBuildMs: 2,
      });
      assert.equal(pending.ok, true);
      FakeWorker.instance.onmessage({
        data: {
          protocolVersion: 4,
          type: "RASTER_RESULT",
          taskId: "political-raster-expired",
          accepted: true,
          identity,
          reason: "bitmap",
          bitmap: { close: () => { closedLateBitmap = true; } },
        },
      });
      metrics = workerClient.ensurePoliticalRasterWorkerMetrics(globalThis);
      assert.equal(metrics.acceptedCount, 0);
      assert.equal(metrics.bitmapRejectedCount, 1);
      assert.equal(metrics.rejectedStaleCount, 1);
      assert.equal(metrics.lastReason, "late-bitmap-response");
      assert.equal(closedLateBitmap, true);
      assert.equal(workerClient.consumePoliticalRasterWorkerBitmapResult(identity), null);
    } finally {
      workerClient.terminatePoliticalRasterWorker();
      if (originalWorker === undefined) {
        delete globalThis.Worker;
      } else {
        Object.defineProperty(globalThis, "Worker", { configurable: true, value: originalWorker });
      }
      if (originalLocation === undefined) {
        delete globalThis.location;
      } else {
        Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
      }
      if (originalMetrics === undefined) {
        delete globalThis.__mc_politicalRasterWorkerMetrics;
      } else {
        globalThis.__mc_politicalRasterWorkerMetrics = originalMetrics;
      }
      workerClient.refreshPoliticalRasterWorkerFlag("");
    }
  });

  register(78, "interaction composite continuity only tolerates selection and topology drift", () => {
    const identity = {
      scenarioId: "tno_1962",
      selectionVersion: 2,
      contextFlagSignature: "water:on|context:on",
      topologyRevision: 7,
      dpr: 2,
      pixelWidth: 1600,
      pixelHeight: 900,
      colorRevision: 4,
    };
    const referenceTransform = { x: 0, y: 0, k: 1 };
    const createHarness = (compositeOverrides = {}, signatureOverrides = {}) => {
      const cache = {
        signatures: {
          political: "political-v1",
          contextScenario: "context-v1",
          ...signatureOverrides,
        },
        referenceTransform,
        referenceTransforms: {
          political: referenceTransform,
          contextScenario: referenceTransform,
        },
        interactionComposite: {
          valid: true,
          canvas: {},
          referenceTransform,
          signature: "political@political-v1@ref|contextScenario@context-v1@ref",
          ...identity,
          ...compositeOverrides,
        },
      };
      const owner = createRenderCacheOwner({
        constants: {
          interactionCompositePassNames: ["political", "contextScenario"],
          renderPassNames: [],
        },
        helpers: {
          cloneZoomTransform: (transform) => ({ ...(transform || {}) }),
          ensureRenderPassCacheState: () => cache,
          getTransformSignature: () => "ref",
          getVisibleFrameIdentity: () => identity,
        },
      });
      return owner;
    };

    const continuity = createHarness({
      selectionVersion: 1,
      topologyRevision: 6,
    }).getInteractionCompositeReuseDecision(referenceTransform, undefined, {
      allowSelectionTopologyContinuity: true,
    });
    assert.equal(continuity.ok, true);
    assert.equal(continuity.mode, "continuity");
    assert.deepEqual(continuity.reasons, ["selection-version-mismatch", "topology-revision-mismatch"]);

    [
      ["scenario mismatch", { scenarioId: "hoi4_1939" }, {}],
      ["context mismatch", { contextFlagSignature: "water:off" }, {}],
      ["dpr mismatch", { dpr: 1 }, {}],
      ["canvas size mismatch", { pixelWidth: 1599 }, {}],
      ["color mismatch", { colorRevision: 3 }, {}],
      ["signature mismatch", {}, { political: "political-v2" }],
    ].forEach(([label, compositeOverrides, signatureOverrides]) => {
      const decision = createHarness(compositeOverrides, signatureOverrides)
        .getInteractionCompositeReuseDecision(referenceTransform, undefined, {
          allowSelectionTopologyContinuity: true,
        });
      assert.equal(decision.ok, false, label);
      assert.equal(decision.mode, "reject", label);
    });
  });
}

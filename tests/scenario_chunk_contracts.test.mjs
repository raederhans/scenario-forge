import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createScenarioChunkRuntimeController } from "../js/core/scenario/chunk_runtime.js";
import { selectScenarioChunks } from "../js/core/scenario_chunk_manager.js";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

test("scheduled chunk refresh starts without seeded pending reason", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const chunk = {
    id: "political.detail.test",
    url: "political.detail.test.json",
    layer: "political",
    lod: "detail",
    bounds: [-1, -1, 1, 1],
    countryCodes: ["TT"],
  };
  const runtimeState = {
    activeScenarioId: "tno_1962",
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
      getScenarioFeatureCollectionIdentityList: (payload) => (
        Array.isArray(payload?.features) ? payload.features.map((feature) => String(feature?.id || "")) : []
      ),
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
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(status, "scheduled");
    assert.equal(selectCalls, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("chunk cost tie-breaker preserves viewport center relevance", () => {
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

test("chunk cost budget limits high-cost required detail tail", () => {
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

test("exact-after-settle keeps scenario overlays on the contextScenario reuse path", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const rendererRuntimeStateSource = readRepoFile("js", "core", "state", "renderer_runtime_state.js");
  const frameSchedulerSource = readRepoFile("js", "core", "frame_scheduler.js");
  const scenarioOwnershipEditorSource = readRepoFile("js", "core", "scenario_ownership_editor.js");
  const politicalRasterWorkerClientSource = readRepoFile("js", "core", "political_raster_worker_client.js");
  const politicalRasterWorkerSource = readRepoFile("js", "workers", "political_raster.worker.js");
  const chunkRuntimeSource = readRepoFile("js", "core", "scenario", "chunk_runtime.js");
  const chunkManagerSource = readRepoFile("js", "core", "scenario_chunk_manager.js");
  const postApplyEffectsSource = readRepoFile("js", "core", "scenario_post_apply_effects.js");
  const interactionRecoveryBlockedBody =
    rendererSource.match(/function isInteractionRecoveryBlocked\(\) \{(?<body>[\s\S]*?)\n\}/)?.groups?.body || "";

  const contract = {
    drawContextScenarioPassKeepsScenarioOverlayBoundary:
      /function drawContextScenarioPass\(k, \{ interactive = false \} = \{\}\) \{[\s\S]*?drawScenarioRegionOverlaysPass\(k\);[\s\S]*?drawScenarioReliefOverlaysLayer\(k\);[\s\S]*?recordRenderPerfMetric\("drawContextScenarioPass"/.test(rendererSource),
    signatureOnlyContextScenarioInvalidationUsesTransformReuse:
      /passName === "contextScenario"[\s\S]*?shouldEnableContextScenarioTransformReuse\(\)[\s\S]*?cache\.dirty\[passName\] = false;[\s\S]*?recordRenderPerfMetric\("contextScenarioReuseSkipped", 0, \{/.test(rendererSource),
    contextScenarioKeepsLayerMetrics:
      rendererSource.includes('"contextScenarioLayerWater"')
      && rendererSource.includes('"contextScenarioLayerSpecial"')
      && rendererSource.includes('"contextScenarioLayerRelief"')
      && rendererSource.includes('recordRenderPerfMetric("contextScenarioSignatureChanged"'),
    interactionMetricsKeepDirectActionAndHitRankDurations:
      rendererSource.includes('recordInteractionDurationMetric("interactionActionDuration"')
      && /function rankCandidates\(candidates, lonLat, \{ eventType = "unknown", targetType = "unknown" \} = \{\}\) \{[\s\S]*?recordInteractionDurationMetric\("interactionHitRankDuration"[\s\S]*?candidateCount: candidates\.length,[\s\S]*?geoContainsCount,[\s\S]*?containsGeoCount:[\s\S]*?eventType,[\s\S]*?targetType,/.test(rendererSource),
    hoverMetricsUseSamplingAndSlowSampleThreshold:
      rendererSource.includes("const HOVER_INTERACTION_METRIC_SAMPLE_RATE = 10;")
      && rendererSource.includes("const HOVER_INTERACTION_SLOW_SAMPLE_MS = 8;")
      && /function recordInteractionDurationMetric\(name, durationMs, details = \{\}\) \{[\s\S]*?incrementPerfCounter\(counterName\);[\s\S]*?callCount % HOVER_INTERACTION_METRIC_SAMPLE_RATE === 0/.test(rendererSource),
    hoverOverlayKeepsDirtySignatureGateAndRafQueue:
      /function renderHoverOverlayIfNeeded\(\{ force = false, eventType = "hover" \} = \{\}\) \{[\s\S]*?!force && !runtimeState\.hoverOverlayDirty && nextSignature === lastHoverOverlaySignature[\s\S]*?recordInteractionDurationMetric\("interactionHoverOverlayDuration"/.test(rendererSource)
      && /function scheduleHoverOverlayRender\(\) \{[\s\S]*?hoverOverlayRenderRafHandle !== null && hoverOverlayRenderRafHandle !== undefined[\s\S]*?requestAnimationFrame\(callback\)/.test(rendererSource),
    hoverOverlayDirectPathsCarryExplicitEventTypes:
      rendererSource.includes('renderHoverOverlayIfNeeded({ eventType: "facility-card-visibility" });')
      && rendererSource.includes('renderHoverOverlayIfNeeded({ eventType: "facility-card-open" });')
      && rendererSource.includes('renderHoverOverlayIfNeeded({ eventType: "facility-card-clear" });')
      && rendererSource.includes('renderHoverOverlayIfNeeded({ force: true, eventType: "zoom-start" });')
      && rendererSource.includes('renderHoverOverlayIfNeeded({ eventType: "mouseleave" });')
      && rendererSource.includes('renderHoverOverlayIfNeeded({ eventType: "facility-card-close" });'),
    hoverFacilityAndCityProbeMetricsRemainNamed:
      rendererSource.includes('recordInteractionDurationMetric("interactionHoverFacilityProbeDuration"')
      && rendererSource.includes('recordInteractionDurationMetric("interactionHoverCityProbeDuration"'),
    interactionCompositeUsesSingleMainPassCache:
      rendererSource.includes("const INTERACTION_COMPOSITE_PASS_NAMES = [")
      && rendererSource.includes('recordRenderPerfMetric("interactionCompositeBuild"')
      && /function composeTransformedFrameToBuffer\(currentTransform, transformedPasses,[\s\S]*?drawInteractionComposite\(currentTransform\)[\s\S]*?drawInteractionBorderSnapshot\(currentTransform\)/.test(rendererSource),
    continuityFrameSkipsBaseFillDuringInteraction:
      rendererSource.includes("const CONTINUITY_FRAME_MAX_STALE_AGE_MS = 1500;")
      && /function invalidateLastGoodFrame\(reason = "visual-invalidation"\) \{[\s\S]*?cache\.lastGoodFrame\.stale = true;[\s\S]*?recordRenderPerfMetric\("continuityFrameMarkedStale"/.test(rendererSource)
      && /if \(runtimeState\.renderPhase === RENDER_PHASE_INTERACTING && runtimeState\.firstVisibleFramePainted\) \{[\s\S]*?noteMissingVisibleFrameSkippedDuringInteraction\("missing-fast-frame-no-continuity"\);[\s\S]*?keptPreviousPixels = true;[\s\S]*?\} else \{[\s\S]*?drewFrame = drawBaseVisibleFrameFallback\("missing-fast-frame-no-continuity"\);/.test(rendererSource)
      && rendererSource.includes('recordRenderPerfMetric("continuityFrameStaleAgeMs"')
      && rendererSource.includes('recordRenderPerfMetric("missingVisibleFrameCount"')
      && rendererSource.includes('recordRenderPerfMetric("missingVisibleFrameSkippedDuringInteraction"')
      && /const staleSince = frame\.stale && Number\(frame\.invalidatedAt \|\| 0\) > 0[\s\S]*?Number\(frame\.invalidatedAt \|\| 0\)[\s\S]*?Number\(frame\.capturedAt \|\| 0\);[\s\S]*?const staleAgeMs = Math\.max\(0, Date\.now\(\) - staleSince\);/.test(rendererSource)
      && rendererSource.includes('return reject("topology-revision-mismatch")')
      && rendererSource.includes('return reject("stale-age-limit")')
      && rendererSource.includes('continuityFrameRelaxedReuse'),
    exactAfterSettleReschedulesWhenPhaseStillBusy:
      /function scheduleExactAfterSettleRefresh\(profile = runtimeState\.adaptiveSettleProfile \|\| getAdaptiveSettleProfile\(\)\) \{[\s\S]*?beginExactAfterSettleControllerSchedule\(scheduleStartedAt\);[\s\S]*?isExactAfterSettleGenerationCurrent\(generation, "scheduled"\)[\s\S]*?if \(!runtimeState\.deferExactAfterSettle\) \{[\s\S]*?resetExactAfterSettleController\("defer-cleared", generation\);[\s\S]*?if \(runtimeState\.renderPhase !== RENDER_PHASE_IDLE\) \{[\s\S]*?scheduleExactAfterSettleRefresh\(resolvedProfile\);[\s\S]*?return;[\s\S]*?\}/.test(rendererSource),
    exactAfterSettleUsesLocalController:
      rendererRuntimeStateSource.includes("exactAfterSettleController")
      && rendererRuntimeStateSource.includes("function createDefaultExactAfterSettleControllerState()")
      && rendererRuntimeStateSource.includes("function resetExactAfterSettleControllerState(")
      && rendererRuntimeStateSource.includes("function isExactAfterSettleGenerationCurrentState(")
      && /function getExactAfterSettleControllerState\(\) \{[\s\S]*?ensureExactAfterSettleControllerState\(runtimeState\);/.test(rendererSource)
      && /function applyScheduledExactAfterSettleRefreshPlan\(generation, plan\) \{[\s\S]*?phase: "applying"[\s\S]*?recordRenderPerfMetric\("settleExactRefreshApply"[\s\S]*?prepareExactAfterSettlePassesInSlices\(generation, plan\);/.test(rendererSource)
      && /function completeScheduledExactAfterSettleRefreshPlan\(generation, plan, passStartedAt\) \{[\s\S]*?phase: "awaiting-paint"[\s\S]*?recordRenderPerfMetric\("settleExactRefreshPasses"[\s\S]*?requestRendererRender\("exact-after-settle"/.test(rendererSource),
    exactAfterSettleFinalizesAfterExactCompose:
      /function drawCanvas\(\) \{[\s\S]*?drewExactFrame = composeCachedPasses\(RENDER_PASS_NAMES\);[\s\S]*?if \(drewExactFrame\) \{[\s\S]*?finalizePendingExactAfterSettleRefreshAfterPaint\(\);/.test(rendererSource)
      && /function finalizePendingExactAfterSettleRefreshAfterPaint\(\) \{[\s\S]*?isExactAfterSettleIdentityCurrent\(controller\)[\s\S]*?recordRenderPerfMetric\("settleExactRefreshWaitForPaint"[\s\S]*?finalizeExactAfterSettleRefreshPlan\(plan\);[\s\S]*?recordRenderPerfMetric\("settleExactRefreshFinalize"/.test(rendererSource)
      && !/applyScheduledExactAfterSettleRefreshPlan\(generation, plan\);[\s\S]{0,160}?finalizeExactAfterSettleRefreshPlan\(plan\);/.test(rendererSource),
    exactAfterSettleAbortsAwaitingPaintAfterExactComposeFailure:
      /function abortPendingExactAfterSettleRefreshAfterPaint\(reason = "exact-compose-failed"\) \{[\s\S]*?String\(controller\.phase \|\| ""\) !== "awaiting-paint"[\s\S]*?recordRenderPerfMetric\("settleExactRefreshAbortAfterPaintFailure"[\s\S]*?resetExactAfterSettleController\(`abort-\$\{reason\}`, generation\);/.test(rendererSource)
      && /if \(!useTransformedFrame \|\| !drewFrame\) \{[\s\S]*?drewExactFrame = composeCachedPasses\(RENDER_PASS_NAMES\);[\s\S]*?if \(!drewExactFrame\) \{[\s\S]*?abortPendingExactAfterSettleRefreshAfterPaint\("compose-cached-passes-failed"\);[\s\S]*?\}/.test(rendererSource)
      && /function isInteractionRecoveryBlocked\(\) \{[\s\S]*?isExactAfterSettleControllerActive\(\)/.test(rendererSource),
    exactComposeFailureReportsControllerAndMissingPassContext:
      /function composeCachedPasses\(passNames, currentTransform = runtimeState\.zoomTransform \|\| globalThis\.d3\.zoomIdentity\) \{[\s\S]*?recordRenderPerfMetric\("compositeBufferMissingPass", 0, \{[\s\S]*?missingPassNames:[\s\S]*?controllerPhase:[\s\S]*?deferExactAfterSettle:[\s\S]*?\}\);/.test(rendererSource)
      && /function composeRenderPassesToTarget\([\s\S]*?const missingCanvasPassNames = \[\];[\s\S]*?const missingReferenceTransformPassNames = \[\];[\s\S]*?reason: "missing-pass-canvas"[\s\S]*?missingPassNames: missingCanvasPassNames[\s\S]*?reason: "missing-reference-transform"[\s\S]*?missingPassNames: missingReferenceTransformPassNames/.test(rendererSource),
    interactionRecoveryDoesNotSelfBlockPostReadyTask:
      interactionRecoveryBlockedBody.includes("runtimeState.renderPhase !== RENDER_PHASE_IDLE")
      && interactionRecoveryBlockedBody.includes("runtimeState.isInteracting")
      && interactionRecoveryBlockedBody.includes("isExactAfterSettleControllerActive()")
      && interactionRecoveryBlockedBody.includes("activeInteractionRecoveryTaskKey")
      && !interactionRecoveryBlockedBody.includes("activePostReadyTaskKey"),
    interactionRecoveryMetricsNameTaskAndWindow:
      /function recordInteractionRecoveryTaskMetric\(taskKey, durationMs, details = \{\}, \{ benchmarkInteraction = true \} = \{\}\) \{[\s\S]*?taskMetricName = benchmarkInteraction \? "interactionRecoveryTaskMs"[\s\S]*?windowMetricName = benchmarkInteraction \? "interactionRecoveryWindowMs"/.test(rendererSource)
      && /const taskKey = "scenario-chunk-promotion-infra";[\s\S]*?recordInteractionRecoveryTaskMetric\(taskKey,/.test(rendererSource)
      && /const taskKey = "secondary-spatial-index";[\s\S]*?recordInteractionRecoveryTaskMetric\(taskKey,/.test(rendererSource)
      && /const taskKey = "deferred-heavy-border-meshes";[\s\S]*?recordInteractionRecoveryTaskMetric\(taskKey,/.test(rendererSource),
    hoverStrictHitUsesFirstContainingFastPath:
      /function findFirstContainingCandidate\(candidates, lonLat, \{ eventType = "hover", targetType = "unknown" \} = \{\}\) \{[\s\S]*?fastPath: "hover-first-containing"/.test(rendererSource)
      && /eventType === "hover" && !enableSnap[\s\S]*?findFirstContainingCandidate\(strictCandidates, pointer\.lonLat, \{ eventType, targetType: "land" \}\)/.test(rendererSource),
    exactAfterSettleRefreshLeavesContextScenarioOutsidePhysicalRefreshPasses:
      /function getPhysicalExactRefreshPasses\(\) \{[\s\S]*?\["physicalBase", "political", "contextBase", "borders"\][\s\S]*?\["political", "contextBase", "borders"\][\s\S]*?return passes;[\s\S]*?\}/.test(rendererSource)
      && /function applyExactAfterSettleRefreshPlan[\s\S]*?invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);[\s\S]*?invalidateRenderPasses\(getPhysicalExactRefreshPasses\(\), reuseDecision\.reason \|\| "context-base-exact"\);/.test(rendererSource),
    colorRefreshUsesPartialPoliticalInvalidation:
      /function refreshResolvedColorsForFeatures[\s\S]*?cache\.partialPoliticalDirtyIds\.add\(id\);[\s\S]*?invalidateRenderPasses\("political", "refresh-colors"\);/.test(rendererSource)
      && rendererSource.includes('invalidateRenderPasses(["contextMarkers", "labels"], "refresh-colors-collateral");')
      && rendererSource.includes('invalidateRenderPasses("contextBase", "refresh-colors-context-base");')
      && /function shouldRefreshContextBaseContoursForColorChanges\(\) \{[\s\S]*?runtimeState\.showPhysical[\s\S]*?physicalContourMajorData/.test(rendererSource)
      && /if \(passName === "contextBase"\) \{[\s\S]*?`context-colors:\$\{shouldRefreshContextBaseForColorChanges\(\) \? Number\(runtimeState\.colorRevision \|\| 0\) : 0\}`/.test(rendererSource)
      && /if \(passName === "labels"\) \{[\s\S]*?`colors:\$\{Number\(runtimeState\.colorRevision \|\| 0\)\}`/.test(rendererSource),
    firstBatchInteractionWritesUseRafRenderBoundary:
      /function requestInteractionRender\(reason = "interaction"\) \{[\s\S]*?requestRendererRender\(reason,[\s\S]*?flush: false/.test(rendererSource)
      && !scenarioOwnershipEditorSource.includes("flushRenderBoundary")
      && /function requestScenarioOwnershipRender\(reason = "scenario-ownership"\) \{[\s\S]*?requestInteractionRender\(reason\);/.test(scenarioOwnershipEditorSource)
      && scenarioOwnershipEditorSource.includes('requestScenarioOwnershipRender("scenario-ownership-apply-owner");')
      && scenarioOwnershipEditorSource.includes('requestScenarioOwnershipRender("scenario-ownership-reset-baseline");')
      && scenarioOwnershipEditorSource.includes('requestScenarioOwnershipRender("scenario-ownership-apply-owner-controller");')
      && /function handleBrushPointerMove[\s\S]*?requestInteractionRender\("brush-preview"\);/.test(rendererSource)
      && /function addFeatureToDevSelection[\s\S]*?requestInteractionRender\("dev-selection-add"\);/.test(rendererSource)
      && /function toggleFeatureInDevSelection[\s\S]*?requestInteractionRender\("dev-selection-toggle"\);/.test(rendererSource)
      && /function removeLastDevSelection[\s\S]*?requestInteractionRender\("dev-selection-remove-last"\);/.test(rendererSource)
      && /function clearDevSelection[\s\S]*?requestInteractionRender\("dev-selection-clear"\);/.test(rendererSource)
      && /function applyVisualSubdivisionFill[\s\S]*?requestInteractionRender\(kind\);[\s\S]*?refreshSidebarAfterPaint\(\{ featureIds: resolvedIds \}\);/.test(rendererSource)
      && /function applyWaterRegionFill[\s\S]*?requestInteractionRender\(kind\);[\s\S]*?refreshSidebarAfterPaint\(\{ waterRegionIds: \[resolvedId\] \}\);/.test(rendererSource)
      && !rendererSource.includes('flushInteractionRender("dev-selection-add")')
      && !rendererSource.includes('flushInteractionRender("dev-selection-toggle")')
      && !rendererSource.includes('flushInteractionRender("dev-selection-remove-last")')
      && !rendererSource.includes('flushInteractionRender("dev-selection-clear")')
      && !rendererSource.includes('flushInteractionRender("click-fill")')
      && !rendererSource.includes('flushInteractionRender("click-erase")')
      && !rendererSource.includes('flushInteractionRender(kind);'),
    exactAfterSettleUsesFrameScheduler:
      frameSchedulerSource.includes("export function enqueueFrameTask")
      && /import \{ enqueueFrameTask(?:, getFrameSchedulerQueueLength)? \} from "\.\/frame_scheduler\.js";/.test(rendererSource)
      && /function enqueueExactAfterSettleSegment\(generation, label, task\) \{[\s\S]*?enqueueFrameTask/.test(rendererSource)
      && /scheduleExactAfterSettleRefresh[\s\S]*?enqueueExactAfterSettleSegment\(generation, "Prepare"[\s\S]*?enqueueExactAfterSettleSegment\(generation, "Apply"/.test(rendererSource),
    frameSchedulerQueueMetricsReportedPerPriority:
      frameSchedulerSource.includes("HIGH_PRIORITY_MIN_PER_DRAIN = 1")
      && frameSchedulerSource.includes("byLabelGeneration = false")
      && frameSchedulerSource.includes("labelGenerationKey")
      && /export function getFrameSchedulerQueueLength\(\{ byPriority = false, byLabelGeneration = false \} = \{\}\) \{[\s\S]*?high:[\s\S]*?normal:[\s\S]*?low:[\s\S]*?total:/.test(frameSchedulerSource)
      && /function render\(\) \{[\s\S]*?getFrameSchedulerQueueLength\(\{ byPriority: true, byLabelGeneration: true \}\);[\s\S]*?recordRenderPerfMetric\("frameSchedulerQueueDepth", 0, frameSchedulerQueue\);/.test(rendererSource),
    exactAfterSettleDedupesByGeneration:
      /function enqueueExactAfterSettleSegment\(generation, label, task\) \{[\s\S]*?generation,[\s\S]*?dedupe: true,[\s\S]*?deferOnContinuousInput: true/.test(rendererSource)
      && /label: `exact-after-settle-pass-\$\{passName\}`,[\s\S]*?generation,[\s\S]*?dedupe: true,[\s\S]*?deferOnContinuousInput: true/.test(rendererSource),
    buildHitCanvasReportsVisibleAndGridCandidateCounts:
      rendererSource.includes("lastHitCanvasBuildStats")
      && rendererSource.includes("visibleItemCount")
      && rendererSource.includes("cellCandidateCount")
      && rendererSource.includes("globalCandidateCount")
      && rendererSource.includes("globalCount")
      && rendererSource.includes("cellSpan"),
    exactAfterSettleDefersPoliticalFastExact:
      /function drawTransformedFrameFromCaches[\s\S]*?settlePoliticalFastExactSkipped[\s\S]*?defer-to-sliced-exact-refresh/.test(rendererSource)
      && !/function drawTransformedFrameFromCaches[\s\S]*?renderPassToCache\("political", \(k\) => drawPoliticalPass\(k\)/.test(rendererSource),
    politicalRasterWorkerProtocolDefaultsOff:
      politicalRasterWorkerClientSource.includes("POLITICAL_RASTER_WORKER_PROTOCOL_VERSION = 2")
      && politicalRasterWorkerClientSource.includes("political_raster_worker")
      && politicalRasterWorkerClientSource.includes('return { ok: false, reason: "flag-disabled" };')
      && politicalRasterWorkerClientSource.includes('type: "RASTER_POLITICAL_PASS"')
      && politicalRasterWorkerClientSource.includes("isPoliticalRasterWorkerResultCurrent(request, current)")
      && politicalRasterWorkerClientSource.includes("acceptedCount")
      && politicalRasterWorkerClientSource.includes("rejectedStaleCount")
      && politicalRasterWorkerClientSource.includes("fallbackCount")
      && politicalRasterWorkerClientSource.includes("passSignature")
      && politicalRasterWorkerSource.includes('type: "RASTER_RESULT"')
      && politicalRasterWorkerSource.includes('reason: "metadata-only"')
      && politicalRasterWorkerSource.includes('type: "ERROR"')
      && politicalRasterWorkerSource.includes("taskId"),
    exactComposeUsesCompositeBuffer:
      /function ensureCompositeBufferCanvas\(\) \{[\s\S]*?cache\.compositeBuffer\.canvas = canvas;/.test(rendererSource)
      && /function composeCachedPasses[\s\S]*?const bufferCanvas = ensureCompositeBufferCanvas\(\);[\s\S]*?composeRenderPassesToTarget\(bufferContext, passNames, currentTransform,[\s\S]*?requireAllPasses: true[\s\S]*?blitCompositeBufferToMain\(bufferCanvas\);/.test(rendererSource)
      && /function blitCompositeBufferToMain\(bufferCanvas\) \{[\s\S]*?context\.globalCompositeOperation = "copy";[\s\S]*?context\.drawImage\(bufferCanvas, 0, 0\);[\s\S]*?context\.globalCompositeOperation = "source-over";/.test(rendererSource),
    coarsePrewarmDoesNotOverwriteActiveDetailChunks:
      /function hasDetailScenarioChunkIds\(chunkIds = \[\]\) \{[\s\S]*?String\(chunkId \|\| ""\)\.includes\("\.detail\."\)/.test(chunkRuntimeSource)
      && /function preloadScenarioCoarseChunks[\s\S]*?hasDetailScenarioChunkIds\(chunkState\.loadedChunkIds\)[\s\S]*?loadState\.promotionCommitInFlight[\s\S]*?return null;/.test(chunkRuntimeSource),
    zoomEndSettleRetainsPreviousRequiredPoliticalDetailChunks:
      chunkRuntimeSource.includes('function applyZoomEndChunkProtectionToSelection(selection, loadState, {')
      && chunkRuntimeSource.includes('reason = "",')
      && chunkRuntimeSource.includes('previousSelection = null,')
      && chunkRuntimeSource.includes('"render-phase-idle", "exact-after-settle", "scenario-apply", "scenario-apply-detail-prewarm"')
      && chunkRuntimeSource.includes('previousSelection?.requiredChunkIds')
      && chunkRuntimeSource.includes('chunkId.startsWith("political.detail.")')
      && chunkRuntimeSource.includes("selection.cacheOnlyChunkIds")
      && chunkRuntimeSource.includes("getScenarioChunkActiveMergeIds")
      && /const previousSelection = loadState\.lastSelection;[\s\S]*?applyZoomEndChunkProtection\(selection, loadState, \{[\s\S]*?reason: normalizedReason,[\s\S]*?previousSelection,/.test(chunkRuntimeSource),
    stalePostApplyRefreshDoesNotEvictRecentZoomEndDetail:
      /function shouldSkipStalePostApplyRefreshAfterZoomEnd\(loadState, reason = "", \{[\s\S]*?scenarioId = "",[\s\S]*?selectionVersion = 0,[\s\S]*?refreshSourceStartedAtMs = 0,[\s\S]*?lastSelection\?\.reason[\s\S]*?lastZoomEndToChunkVisibleMetric[\s\S]*?metric\?\.scenarioId[\s\S]*?metric\?\.selectionVersion[\s\S]*?sourceStartedAt > 0 && sourceStartedAt <= recordedAt/.test(chunkRuntimeSource)
      && /if \(shouldSkipStalePostApplyRefreshAfterZoomEnd\(loadState, nextReason, \{[\s\S]*?scenarioId,[\s\S]*?selectionVersion: loadState\.selectionVersion,[\s\S]*?refreshSourceStartedAtMs,[\s\S]*?normalizeScenarioIdFn: normalizeScenarioId,[\s\S]*?\}\)\) \{[\s\S]*?return "stale-post-apply-after-zoom-end";/.test(chunkRuntimeSource)
      && /pendingPostCommitRefresh = \{[\s\S]*?refreshSourceStartedAtMs,[\s\S]*?requestedAt: Date\.now\(\),[\s\S]*?\};/.test(chunkRuntimeSource)
      && /scheduleScenarioChunkRefresh\(\{[\s\S]*?reason: replayReason,[\s\S]*?refreshSourceStartedAtMs: Number\(pendingPostCommitRefresh\.refreshSourceStartedAtMs \|\| 0\),[\s\S]*?\}\);/.test(chunkRuntimeSource)
      && /scheduleScenarioChunkRefresh\(\{[\s\S]*?reason: "scenario-apply-detail-prewarm",[\s\S]*?refreshSourceStartedAtMs: prewarmStartedAt,[\s\S]*?\}\);/.test(postApplyEffectsSource)
      && /scheduleScenarioChunkRefresh\(\{[\s\S]*?reason: "scenario-apply",[\s\S]*?refreshSourceStartedAtMs: prewarmStartedAt,[\s\S]*?\}\);/.test(postApplyEffectsSource),
    chunkSelectionCarriesCostFieldsAndSums:
      chunkManagerSource.includes("byteSize")
      && chunkManagerSource.includes("coordCount")
      && chunkManagerSource.includes("partCount")
      && chunkManagerSource.includes("estimatedPathCost")
      && chunkManagerSource.includes("selectedFeatureCountSum")
      && chunkManagerSource.includes("selectedEstimatedPathCostSum")
      && chunkManagerSource.includes("max_required_estimated_path_cost")
      && chunkManagerSource.includes("takeRequiredChunksWithinCostBudget"),
    focusCountryOverrideHasTtlAndIsConsumed:
      chunkRuntimeSource.includes("FOCUS_COUNTRY_OVERRIDE_TTL_MS")
      && chunkRuntimeSource.includes("focusCountryOverrideExpiresAt")
      && chunkRuntimeSource.includes("consumeScenarioChunkFocusCountryOverride(loadState)")
      && chunkRuntimeSource.includes("clearScenarioChunkFocusCountryOverride(loadState)"),
  };

  Object.entries(contract).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("perf contracts keep coarse first frame and benchmark app-path fallback boundaries", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const scenarioManagerSource = readRepoFile("js", "core", "scenario_manager.js");
  const scenarioApplyPipelineSource = readRepoFile("js", "core", "scenario_apply_pipeline.js");
  const benchmarkSource = readRepoFile("ops", "browser-mcp", "editor-performance-benchmark.py");
  const playwrightAppPathsSource = readRepoFile("tests", "e2e", "support", "playwright-app-paths.js");

  const checks = {
    politicalPassStartsWithBackgroundFills:
      /function drawPoliticalPass\(k\) \{[\s\S]*?const visibleItemsResult = debugMode === "PROD" \? collectVisibleLandSpatialItemsWithStats\(\) : null;[\s\S]*?const visibleItems = visibleItemsResult \? visibleItemsResult\.items : null;[\s\S]*?drawPoliticalBackgroundFills\(\{[\s\S]*?returnSummary: true,[\s\S]*?\}\);[\s\S]*?if \(!(?:runtimeState|state)\.landData\?\.features\?\.length\) return;/.test(rendererSource),
    backgroundFillHelperKeepsScenarioMergeSplit:
      /function drawPoliticalBackgroundFills\(options = \{\}\) \{[\s\S]*?if \(shouldUseScenarioPoliticalBackgroundMerge\(\)\) \{[\s\S]*?return drawScenarioPoliticalBackgroundFills\(options\);[\s\S]*?\}[\s\S]*?drawAdmin0BackgroundFills\(options\);/.test(rendererSource),
    backgroundFullPassCacheBuildsAndReplays:
      /function getScenarioPoliticalBackgroundFullPassGroups\([\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundCacheReplay"[\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundCacheBuild"/.test(rendererSource),
    chunkedRuntimeSkipsBlockingDetailPromotion:
      /const supportsChunkedPoliticalRuntime = scenarioSupportsChunkedRuntime\(bundle\)[\s\S]*?const detailPromoted = \(startupReadonly \|\| supportsChunkedPoliticalRuntime\)\s*\?\s*false\s*:\s*await ensureScenarioDetailTopologyLoaded\(\{ applyMapData: false \}\);/.test(scenarioApplyPipelineSource),
    unconfirmedDetailPromotionStillWarnsBeforeHealthGate:
      /if \(!detailReady && (?:runtimeState|state)\.topologyBundleMode !== "composite"\) \{[\s\S]*?console\.warn\("\[scenario\] Applying bundle without confirmed detail promotion; health gate will validate runtime topology\."\);/.test(scenarioApplyPipelineSource),
    coarseInteractiveMetricRecordedAfterPostApplyEffects:
      /const \{ dataHealth, scenarioMapRefreshMode, hasChunkedRuntime \} = await runPostScenarioApplyEffects\([\s\S]*?recordScenarioPerfMetric\(\s*"timeToInteractiveCoarseFrame",[\s\S]*?hasChunkedRuntime,[\s\S]*?mapRefreshMode: scenarioMapRefreshMode,/.test(scenarioManagerSource),
    ensureAppPathUrlRewritesRootAndNestedPaths:
      /def ensure_app_path_url\(url: str\) -> str:[\s\S]*?if path\.startswith\("\/app\/"\) or path == "\/app":[\s\S]*?elif path == "\/":[\s\S]*?normalized_path = "\/app\/"[\s\S]*?else:[\s\S]*?normalized_path = f"\/app\{path\}" if path\.startswith\("\/"\) else f"\/app\/\{path\}"/.test(benchmarkSource),
    buildScenarioOpenUrlsAddsPerfOverlayAndScenarioCandidate:
      /def build_scenario_open_urls\([\s\S]*?perf_url = with_query_overrides\(ensure_app_path_url\(base_url\), perf_overlay="1", runtime_chunk_perf="1"\)[\s\S]*?if normalized_scenario_id and normalized_scenario_id != "none":[\s\S]*?scenario_perf_url = with_query_overrides\(perf_url, default_scenario=normalized_scenario_id\)[\s\S]*?urls\.append\(scenario_perf_url\)[\s\S]*?urls\.append\(perf_url\)/.test(benchmarkSource),
    openPageKeepsWrapperThenLocalFallbackAcrossCandidates:
      /def open_page\(urls: list\[str\] \| tuple\[str, \.\.\.\] \| str\) -> dict:[\s\S]*?if PWCLI\.exists\(\):[\s\S]*?for browser_name in OPEN_BROWSER_CANDIDATES:[\s\S]*?for candidate_url in candidate_urls:[\s\S]*?run_wrapper_pw\("open", candidate_url, "--browser", browser_name,[\s\S]*?for browser_name in OPEN_BROWSER_CANDIDATES:[\s\S]*?for candidate_url in candidate_urls:[\s\S]*?run_local_pw\(\s*"open",\s*candidate_url,\s*"--browser",\s*browser_name,/.test(benchmarkSource),
    suiteBaseUrlsKeepOriginalAndAppVariants:
      /suite_base_urls = unique_strings\(\[[\s\S]*?effective_url,[\s\S]*?ensure_app_path_url\(effective_url\),[\s\S]*?args\.url,[\s\S]*?ensure_app_path_url\(args\.url\),/.test(benchmarkSource),
    sameScenarioFreshMetricSelectionIsExplicit:
      /def is_same_scenario_fresh_metric_entry\([\s\S]*?def summarize_freshest_same_scenario_metric_entry\(/.test(benchmarkSource),
    benchmarkWheelTraceTracksLastWheelAndBlackRatio:
      benchmarkSource.includes("firstIdleAfterLastWheelMs")
      && benchmarkSource.includes("sample_canvas_black_pixel_ratio_js")
      && benchmarkSource.includes("maxBlackPixelRatio")
      && benchmarkSource.includes("lastWheelAt = await page.evaluate(() => performance.now())")
      && benchmarkSource.includes('"rapidWheel": rapid_wheel_screenshot_path')
      && benchmarkSource.includes('"interactivePan": interactive_pan_screenshot_path'),
    zoomEndVisualMetricRequiresCurrentZoomEndSelection:
      benchmarkSource.includes("String(entry?.reason || '').toLowerCase() === 'zoom-end'")
      && benchmarkSource.includes("expectedSelectionVersion")
      && benchmarkSource.includes("Number(entry?.selectionVersion || 0) >= Number(expectedSelectionVersion || 0)"),
    directProbeScenarioContextDoesNotLookLikeStaleMetric:
      benchmarkSource.includes("direct_probe_without_scenario_fields")
      && benchmarkSource.includes('"requestedScenarioId"')
      && benchmarkSource.includes('"sameScenario": details_match_scenario or probe_matches_scenario or direct_probe_without_scenario_fields'),
    e2eHarnessDefaultsToAppPath:
      playwrightAppPathsSource.includes("const DEFAULT_OPEN_PATH = DEFAULT_FAST_APP_OPEN_PATH;")
      && playwrightAppPathsSource.includes("const DEFAULT_APP_ORIGIN = `http://127.0.0.1:${DEFAULT_TEST_SERVER_PORT}`;"),
    normalizeAppPathKeepsRootQueryAndHashOnAppRoute:
      playwrightAppPathsSource.includes('if (normalizedTarget === "/") {')
      && playwrightAppPathsSource.includes('if (normalizedTarget.startsWith("/app/")) {')
      && playwrightAppPathsSource.includes('if (normalizedTarget === "/app") {')
      && playwrightAppPathsSource.includes('if (normalizedTarget.startsWith("/?") || normalizedTarget.startsWith("/#")) {')
      && playwrightAppPathsSource.includes('return `/app${normalizedTarget}`;'),
  };

  Object.entries(checks).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("TNO water topology contracts keep exclusive scenario water and shared surface version signal", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const spatialBuilderSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_builders.js");
  const spatialOwnerSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_owner.js");
  const scenarioApplyPipelineSource = readRepoFile("js", "core", "scenario_apply_pipeline.js");

  const checks = {
    tnoWaterUsesScenarioCollectionOnly:
      /function getEffectiveWaterRegionFeatures\(\) \{[\s\S]*?if \(isScenarioWaterTopologyExclusiveMode\(\)\) \{[\s\S]*?return sanitizeWaterRegionFeatures\(scenarioFeatures\.filter\(\(feature\) => !isWaterRegionExcludedByScenario\(feature\)\)\);/.test(rendererSource),
    waterSphericalDiagnosticsBacksSanitization:
      /function getSphericalGeometryDiagnostics\(geoObject\) \{[\s\S]*?globalThis\.d3\.geoArea[\s\S]*?globalThis\.d3\.geoBounds[\s\S]*?isWorldBounds\(bounds\)[\s\S]*?SPHERICAL_GEOMETRY_MAX_AREA/.test(rendererSource)
      && /function collectSafeWaterRegionGeometryPartsInfo\(feature\) \{[\s\S]*?isSphericalGeometryUnsafe\(part\)[\s\S]*?removedCount \+= 1;/.test(rendererSource)
      && /function sanitizeWaterRegionFeatures\(features = \[\]\) \{[\s\S]*?recordRenderPerfMetric\("waterSphericalSanitization"/.test(rendererSource),
    waterDrawAndHighlightUseSafeParts:
      /function drawScenarioWaterFillLayer\(k, \{ waterFeatures = \[\] \} = \{\}\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?pathCanvas\(part\)/.test(rendererSource)
      && /function drawScenarioWaterHighlightLayer\(k\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?pathCanvas\(part\)/.test(rendererSource),
    waterFillUsesProjectionPathCacheBeforeCanvasFallback:
      /let scenarioWaterPartPathCache = new WeakMap\(\);[\s\S]*?let scenarioWaterFeaturePathCache = new WeakMap\(\);/.test(rendererSource)
      && /function getScenarioWaterFeaturePath\(feature, parts\) \{[\s\S]*?scenarioWaterFeaturePathCache\.has\(feature\)[\s\S]*?combinedPath\.addPath\(partPath\)[\s\S]*?scenarioWaterFeaturePathCache\.set\(feature, path\);/.test(rendererSource)
      && /function drawScenarioWaterFillLayer\(k, \{ waterFeatures = \[\] \} = \{\}\) \{[\s\S]*?const waterPath = visibleParts\.length === parts\.length[\s\S]*?getScenarioWaterFeaturePath\(feature, parts\)[\s\S]*?context\.fill\(waterPath\);[\s\S]*?getScenarioWaterPartPath\(part\)[\s\S]*?context\.fill\(partPath\)[\s\S]*?pathCanvas\(part\);/.test(rendererSource),
    waterCoverageUsesSafeParts:
      /function getScenarioWaterVisibleCoverageRatioLegacy\(waterFeatures = \[\]\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?computeProjectedGeoBounds\(part\)/.test(rendererSource)
      && /function getScenarioWaterVisibleCoverageRatioGrid\(waterFeatures = \[\]\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?computeProjectedGeoBounds\(part\)/.test(rendererSource),
    waterSpatialIndexSkipsUnsafeParts:
      /function buildWaterSpatialItems\(\{[\s\S]*?shouldExcludeWaterHitGeometry = \(\) => false,[\s\S]*?if \(shouldExcludeWaterHitGeometry\(hitGeometry, feature, id\)\) return;/.test(spatialBuilderSource)
      && /shouldExcludeWaterHitGeometry = \(\) => false/.test(spatialOwnerSource)
      && /shouldExcludeWaterHitGeometry,/.test(spatialOwnerSource)
      && /collectFeatureHitGeometries: collectSafeWaterRegionGeometryParts/.test(rendererSource),
    physicalLandMasksRequireD3Quality:
      /function getPhysicalLandMaskCandidateQuality\(collection, maskSource\) \{[\s\S]*?getSphericalGeometryDiagnostics\(collection\)[\s\S]*?recordRenderPerfMetric\("physicalLandMaskRejected"/.test(rendererSource)
      && /function getFirstUsablePhysicalLandMaskInfo\(candidates = \[\]\) \{[\s\S]*?getPhysicalLandMaskCandidateQuality\(candidate\.collection, candidate\.maskSource\)/.test(rendererSource),
    waterMaskAndCoastlineShareScenarioSurfaceSignal:
      /function getScenarioSurfaceVersionSignal\(\) \{/.test(rendererSource)
      && /`water-ref:\$\{getObjectIdentityToken\(runtimeState\.scenarioWaterRegionsData, "scenario-water"\)\}`/.test(rendererSource)
      && /maskInfo\.maskQualityToken \|\| "unchecked"/.test(rendererSource)
      && /function getScenarioWaterVisualRevisionToken\(\) \{[\s\S]*?getScenarioSurfaceVersionSignal\(\)/.test(rendererSource)
      && /function getPhysicalLandClipCacheKey\(maskInfo\) \{[\s\S]*?scenario-surface:\$\{getScenarioSurfaceVersionSignal\(\)\}/.test(rendererSource)
      && /function getCoastlineDecisionSignature\(decision = null\) \{[\s\S]*?String\(decision\.scenarioSurfaceVersionSignal \|\| ""\)/.test(rendererSource),
    chunkPromotionSkipsDeferredInfraWhenSecondaryIndexesAlreadySynced:
      /const synchronizedSecondaryRegionIndexes = syncScenarioSecondaryRegionIndexes\(\{[\s\S]*?const shouldSkipDeferredInfraRefresh = synchronizedSecondaryRegionIndexes && !hasPoliticalChange;[\s\S]*?if \(shouldSkipDeferredInfraRefresh\) \{[\s\S]*?scheduleHitCanvasBuildIfNeeded\(\{[\s\S]*?\}\);[\s\S]*?\} else \{[\s\S]*?scheduleDeferredScenarioChunkPromotionInfraRefresh\(\{/.test(rendererSource),
    scenarioApplyCommitsPreparedScenarioWaterPayloadOnly:
      /runtimeState\.scenarioWaterRegionsData = staged\.scenarioWaterRegionsFromTopology \|\| null;/.test(scenarioApplyPipelineSource),
  };

  Object.entries(checks).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("Atlantropa land interaction contracts use owner-aware targets with runtime country preserved", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const spatialBuilderSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_builders.js");
  const spatialOwnerSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_owner.js");
  const visualRenderableBody = rendererSource.match(/function isPoliticalVisualRenderableFeature\(feature, featureId = null\) \{[\s\S]*?\n\}/)?.[0] || "";

  const checks = {
    hitResultShapeCarriesRuntimeCountry:
      /function createHitResult\(overrides = \{\}\) \{[\s\S]*?countryCode: null,[\s\S]*?runtimeCountryCode: null,/.test(rendererSource),
    interactionCountryCodeFallsBackFromDisplayOwnerToRuntimeCountry:
      /function getFeatureInteractionCountryCodeNormalized\(feature, featureId = null\) \{[\s\S]*?getDisplayOwnerCode\(feature, resolvedId\)[\s\S]*?getFeatureCountryCodeNormalized\(feature\)/.test(rendererSource),
    canvasHitPreservesRuntimeCountryAndReturnsInteractionCountry:
      /function getHitResultFromCanvas\(event\) \{[\s\S]*?countryCode: getFeatureInteractionCountryCodeNormalized\(feature, id\),[\s\S]*?runtimeCountryCode: getFeatureCountryCodeNormalized\(feature\),/.test(rendererSource),
    spatialHitPreservesRuntimeCountryAndReturnsInteractionCountry:
      /function toHitResult\(candidate[\s\S]*?const runtimeCountryCode = canonicalCountryCode\([\s\S]*?candidate\.item\.countryCode[\s\S]*?const interactionCountryCode = feature[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, resolvedId\)[\s\S]*?countryCode: interactionCountryCode \|\| runtimeCountryCode,[\s\S]*?runtimeCountryCode,/.test(rendererSource),
    targetResolutionUsesOwnerAwareFeatureIds:
      /function getInteractionCountryFeatureIds\(feature, featureId\) \{[\s\S]*?getScenarioOwnerFeatureIds\(interactionCountryCode\)[\s\S]*?getCountryFeatureIds\(runtimeCountryCode\)/.test(rendererSource)
      && /function resolveInteractionTargetIds\(feature, id\) \{[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, id\)[\s\S]*?getInteractionCountryFeatureIds\(feature, id\)/.test(rendererSource)
      && /function resolveCountryFillTargetIds\(feature, featureId[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, featureId\)[\s\S]*?getInteractionCountryFeatureIds\(feature, featureId\)/.test(rendererSource),
    parentGroupsUseOwnerAwareScope:
      /function resolveParentGroupKey\(feature, featureId\) \{[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, featureId\)/.test(rendererSource)
      && /function resolveParentGroupTargetIds\(feature, featureId\) \{[\s\S]*?getInteractionCountryFeatureIds\(feature, featureId\)/.test(rendererSource),
    booleanWeldIslandCanRenderWithoutBecomingInteractive:
      /function isAtlantropaVisualSupportHelperFeature\(feature, featureId = null\) \{[\s\S]*?joinMode === "gap_fill"[\s\S]*?\}/.test(rendererSource)
      && /function isPoliticalInteractionRenderableFeature\(feature, featureId = null\) \{[\s\S]*?feature\?\.properties\?\.interactive === false[\s\S]*?isAtlantropaSupportHelperFeature\(feature, featureId\)/.test(rendererSource),
    arcticShellCanRenderWithoutBecomingInteractive:
      !/isScenarioShellFeature/.test(visualRenderableBody)
      && /function isPoliticalInteractionRenderableFeature\(feature, featureId = null\) \{[\s\S]*?isScenarioShellFeature\(feature, featureId\)[\s\S]*?feature\?\.properties\?\.interactive === false/.test(rendererSource),
    arcticShellOwnerHintsCanColorCoalescedShells:
      /scenario_shell_owner_hint/.test(rendererSource)
      && /scenario_shell_controller_hint/.test(rendererSource),
    backgroundMergeFiltersVisualHelpersButKeepsVisibleNonInteractiveLand:
      /function buildScenarioPoliticalBackgroundEntries\(\) \{[\s\S]*?shouldExcludePoliticalVisualFeature\(feature, id\)/.test(rendererSource)
      && /function buildScenarioPoliticalBackgroundEntriesFromSpatialItems\(items = \[\]\) \{[\s\S]*?shouldExcludePoliticalVisualFeature\(entry\.feature, entry\.id\)/.test(rendererSource),
    spatialItemsCanCarryVisibleNonInteractiveLand:
      /function appendLandSpatialItemsRange\([\s\S]*?shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature[\s\S]*?if \(shouldExcludePoliticalVisualFeature\(feature, id\)\) continue;[\s\S]*?interactive: !shouldExcludePoliticalInteractionFeature\(feature, id\)/.test(spatialBuilderSource)
      && /shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature/.test(spatialOwnerSource)
      && /shouldExcludePoliticalVisualFeature,/.test(spatialOwnerSource),
    hitCanvasStillFiltersNonInteractiveSpatialItems:
      /const visibleSpatialItemsResult = collectVisibleLandSpatialItemsWithStats\(\);[\s\S]*?const visibleSpatialItems = visibleSpatialItemsResult\.items;[\s\S]*?visibleSpatialItems\.forEach\(\(item\) => \{[\s\S]*?shouldExcludePoliticalInteractionFeature\(item\.feature, item\.id\)/.test(rendererSource),
  };

  Object.entries(checks).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("frame scheduler continues after a failed task", async () => {
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

test("zoom-end evictable protection reuses unified validator across TTL, focusCountry, and selectionVersion", async () => {
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
  const nowMs = 1_000;
  const selection = {
    evictableChunkIds: ["political.detail.a", "political.detail.b"],
  };
  protectZoomEndChunksForSelection(baseLoadState, ["political.detail.a"], {
    scenarioId: "tno_1962",
    selectionVersion: 7,
    focusCountry: "de",
    nowMs,
  });
  assert.equal(
    applyZoomEndChunkProtectionToSelection(selection, baseLoadState, {
      scenarioId: "tno_1962",
      selectionVersion: 7,
      focusCountry: "DE",
      nowMs: nowMs + 4_000,
    }),
    true,
  );
  assert.deepEqual(selection.evictableChunkIds, ["political.detail.b"]);

  const expiredLoadState = {
    ...baseLoadState,
    zoomEndProtectedChunkIds: ["political.detail.a"],
    zoomEndProtectedUntil: nowMs + 5_000,
    zoomEndProtectedSelectionVersion: 7,
    zoomEndProtectedScenarioId: "tno_1962",
    zoomEndProtectedFocusCountry: "DE",
  };
  const expiredSelection = { evictableChunkIds: ["political.detail.a"] };
  assert.equal(
    applyZoomEndChunkProtectionToSelection(expiredSelection, expiredLoadState, {
      scenarioId: "tno_1962",
      selectionVersion: 7,
      focusCountry: "DE",
      nowMs: nowMs + 5_001,
    }),
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
    applyZoomEndChunkProtectionToSelection(focusChangedSelection, baseLoadState, {
      reason: "scenario-apply",
      previousSelection,
      scenarioId: "tno_1962",
      selectionVersion: 8,
      focusCountry: "FR",
      nowMs: nowMs + 3_000,
    }),
    false,
  );
  const versionChangedSelection = { evictableChunkIds: ["political.detail.a"] };
  assert.equal(
    applyZoomEndChunkProtectionToSelection(versionChangedSelection, baseLoadState, {
      reason: "scenario-apply",
      previousSelection,
      scenarioId: "tno_1962",
      selectionVersion: 9,
      focusCountry: "DE",
      nowMs: nowMs + 3_000,
    }),
    false,
  );
});

test("political raster worker result currentness includes viewport", async () => {
  const {
    createPoliticalRasterWorkerIdentity,
    isPoliticalRasterWorkerResultCurrent,
  } = await import("../js/core/political_raster_worker_client.js");
  const base = {
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
      createPoliticalRasterWorkerIdentity({ ...base, viewport: { x: 80, y: 0, width: 800, height: 600 } }),
    ),
    false,
  );
});

test("frame scheduler keeps high-priority exact slices draining under continuous input pressure", async () => {
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

test("frame scheduler defers high tasks for discrete input and dedupes label generation", async () => {
  const scheduler = await import("../js/core/frame_scheduler.js");
  const originalNavigator = globalThis.navigator;
  const calls = [];
  let discreteInputPending = true;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      scheduling: {
        isInputPending: ({ includeContinuous } = {}) => includeContinuous ? true : discreteInputPending,
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
    const queued = scheduler.getFrameSchedulerQueueLength({ byPriority: true, byLabelGeneration: true });
    assert.equal(queued.high, 1);
    assert.equal(queued.byLabelGeneration["exact-after-settle-Apply:42"], 1);

    scheduler.runFrameTasks(8);
    assert.deepEqual(calls, []);
    assert.equal(scheduler.getFrameSchedulerQueueLength({ byPriority: true }).high, 1);

    discreteInputPending = false;
    scheduler.runFrameTasks(8);
    assert.deepEqual(calls, ["deduped"]);
    assert.equal(scheduler.getFrameSchedulerQueueLength({ byPriority: true }).total, 0);
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
});

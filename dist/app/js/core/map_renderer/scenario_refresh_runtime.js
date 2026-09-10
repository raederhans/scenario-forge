import { normalizeRendererRefreshPlan, resolveScenarioChunkPromotionRendererRefreshDescriptor } from "./scenario_refresh_plans.js";
import { createScenarioVisualInvalidationExecutor } from "./scenario_visual_invalidation_executor.js";
import { recordScenarioPoliticalDerivedStateCoverage, analyzeScenarioPoliticalDerivedStateCoverage, buildScenarioChunkPromotionVisualMetricDetails, createScenarioChunkPromotionDelta, readFirstNonNegativeCount, resolveScenarioChunkPromotionChangeSet } from "../renderer/scenario_chunk_promotion_helpers.js";
import { patchScenarioChunkLoadState, queueScenarioChunkPromotionState } from "../state/actions/scenario_chunk_runtime_actions.js";
import { setScenarioPoliticalChunkPayloadState } from "../state/actions/scenario_chunk_promotion_actions.js";

function createScenarioRefreshRuntime(deps = {}) {
  const {
    runtimeState,
    buildIndex, buildSpatialIndexChunked,
    rebuildPoliticalLandCollections, rebuildRuntimeDerivedState, rebuildPrimaryPoliticalDerivedState,
    buildInteractiveLandData,
    shouldExcludePoliticalVisualFeature,
    setInteractionInfrastructureState, scheduleSecondarySpatialIndexBuild, scheduleHitCanvasBuildIfNeeded,
    ensureSovereigntyState, refreshScenarioOpeningOwnerBorders, invalidateBorderCache,
    updateDynamicBorderStatusUI, updateSpecialZonesPaths, renderSpecialZoneEditorOverlay, render,
    recordRenderPerfMetric, recordInteractionRecoveryTaskMetric,
    beginInteractionRecoveryTask, endInteractionRecoveryTask, isInteractionRecoverySettled,
    scheduleDeferredWork, cancelDeferredWork, yieldToMain, nowMs,
    markRendererTopologyChanged, clearDeferredInternalBorderMeshCaches,
    scheduleDeferredHeavyBorderMeshes, resetScenarioWaterCacheAdaptiveState,
    syncScenarioSecondaryRegionIndexes, invalidateRenderPasses,
    markAllOverlaysDirty, updateZoomTranslateExtent, isUsableMesh,
    resetRendererTransactionState, clearLastGoodFrame, invalidateInteractionComposite,
    resetFirstVisibleFramePainted, clearRenderPassReferenceTransforms,
    rebuildStaticMeshes, getEffectiveAtlantropaFeatures,
    rebuildAuxiliaryRegionIndexes, getSpatialIndexRuntimeOwner, queueIndexUiRefresh,
  } = deps;

  let deferredScenarioChunkPromotionInfraHandle = null;
  let scenarioChunkPromotionVersion = 0;
  let deferredInfraEpoch = 0;
  let activeInfraExecution = null;
  let activeInfraLoadStateIsCurrent = () => false;
  const scenarioVisualInvalidationExecutor = createScenarioVisualInvalidationExecutor({
    clearLastGoodFrame, clearRenderPassReferenceTransforms, invalidateInteractionComposite,
    invalidateBorderCache, resetScenarioWaterCacheAdaptiveState, invalidateRenderPasses,
    markAllOverlaysDirty, updateZoomTranslateExtent, render,
  });

  function clearDeferredInfraHandle() {
    cancelDeferredWork(deferredScenarioChunkPromotionInfraHandle);
    deferredScenarioChunkPromotionInfraHandle = null;
    deferredInfraEpoch += 1;
  }

  function cancelDeferredScenarioChunkPromotionInfraRefresh() {
    clearDeferredInfraHandle();
    if (activeInfraExecution) {
      if (activeInfraLoadStateIsCurrent()) {
        if (activeInfraExecution.mutationStarted) {
          setInteractionInfrastructureState(String(activeInfraExecution.stage || "basic-ready"), { ready: false, inFlight: false });
        }
      }
      endInteractionRecoveryTask("scenario-chunk-promotion-infra");
      activeInfraExecution = null;
      activeInfraLoadStateIsCurrent = () => false;
    }
    if (runtimeState.runtimeChunkLoadState?.pendingInfraPromotion) {
      patchScenarioChunkLoadState(runtimeState, { pendingInfraPromotion: null });
    }
  }

  function resetDeferredScenarioChunkPromotionState() {
    cancelDeferredScenarioChunkPromotionInfraRefresh();
    activeInfraExecution = null;
    scenarioChunkPromotionVersion = 0;
  }

  function scheduleDeferredScenarioChunkPromotionInfraRefresh({
    reason = "scenario-chunk-promotion",
    suppressRender = false,
    promotionVersion = scenarioChunkPromotionVersion,
    hasPoliticalGeometryChange = false,
    primaryVisibleDerivedStateReady = false,
    completePoliticalDerivedStateReady = false,
    primaryDerivedStateReady = false,
    refreshOpeningOwnerBorders = true,
  } = {}) {
    clearDeferredInfraHandle();
    const scheduledEpoch = deferredInfraEpoch;
    deferredScenarioChunkPromotionInfraHandle = scheduleDeferredWork(() => {
      if (scheduledEpoch !== deferredInfraEpoch) return false;
      deferredScenarioChunkPromotionInfraHandle = null;
      return runDeferredScenarioChunkPromotionInfraRefresh({
        reason,
        suppressRender,
        promotionVersion,
        hasPoliticalGeometryChange,
        primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady,
        primaryDerivedStateReady,
        refreshOpeningOwnerBorders,
      }).catch((error) => {
        console.warn("[renderer] Deferred scenario chunk infrastructure failed.", error);
        return false;
      });
    }, {
      timeout: 120,
    });
  }

  async function runDeferredScenarioChunkPromotionInfraRefresh({
    reason = "scenario-chunk-promotion",
    suppressRender = false,
    promotionVersion = scenarioChunkPromotionVersion,
    hasPoliticalGeometryChange = false,
    primaryVisibleDerivedStateReady = false,
    completePoliticalDerivedStateReady = false,
    primaryDerivedStateReady = false,
    refreshOpeningOwnerBorders = true,
  } = {}) {
    const executionEpoch = deferredInfraEpoch;
    const loadState = runtimeState.runtimeChunkLoadState;
    const scenarioId = runtimeState.activeScenarioId;
    const isCurrent = () => executionEpoch === deferredInfraEpoch
      && promotionVersion === scenarioChunkPromotionVersion
      && runtimeState.runtimeChunkLoadState === loadState
      && runtimeState.activeScenarioId === scenarioId;
    if (promotionVersion !== scenarioChunkPromotionVersion) {
      return false;
    }
    if (!isInteractionRecoverySettled({ quietMs: 600 })) {
      scheduleDeferredScenarioChunkPromotionInfraRefresh({
        reason,
        suppressRender,
        promotionVersion,
        hasPoliticalGeometryChange,
        primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady,
        primaryDerivedStateReady,
        refreshOpeningOwnerBorders,
      });
      return false;
    }
    const taskKey = "scenario-chunk-promotion-infra";
    if (!beginInteractionRecoveryTask(taskKey)) {
      scheduleDeferredScenarioChunkPromotionInfraRefresh({
        reason,
        suppressRender,
        promotionVersion,
        hasPoliticalGeometryChange,
        primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady,
        primaryDerivedStateReady,
        refreshOpeningOwnerBorders,
      });
      return false;
    }
    const startedAt = nowMs();
    const execution = {
      stage: String(runtimeState.interactionInfrastructureStage || ""),
      mutationStarted: false,
    };
    activeInfraLoadStateIsCurrent = () => runtimeState.runtimeChunkLoadState === loadState;
    activeInfraExecution = execution;
    const previousInteractionInfrastructureStage = String(runtimeState.interactionInfrastructureStage || "");
    const previousInteractionInfrastructureReady = !!runtimeState.interactionInfrastructureReady;
    let restoredInteractionInfrastructureState = false;
    let fullRestoreMutationStarted = false;
    let yieldCount = 0;
    let fullPoliticalRestoreMs = 0;
    let restoredFullPoliticalChunkData = false;
    let preliminaryIndexBuildMs = null;
    let preliminarySpatialBuildMs = null;
    let infrastructureMutationStarted = false;
    try {
      let politicalCoverageBeforeRestore = hasPoliticalGeometryChange
        ? analyzeScenarioPoliticalDerivedStateCoverage(runtimeState, { buildInteractiveLandData, shouldExcludePoliticalVisualFeature })
        : null;
      let resolvedCompletePoliticalDerivedStateReady = !!completePoliticalDerivedStateReady
        || (!!primaryDerivedStateReady && !politicalCoverageBeforeRestore?.primaryVisibleFeatureSubsetActive);
      const shouldRestoreFullPoliticalDerivedState = (
        hasPoliticalGeometryChange
        && politicalCoverageBeforeRestore.completePoliticalFeatureCount > 0
        && (
          !resolvedCompletePoliticalDerivedStateReady
          || !!primaryVisibleDerivedStateReady
          || politicalCoverageBeforeRestore.primaryVisibleFeatureSubsetActive
          || politicalCoverageBeforeRestore.landDataCoverageMissing
          || politicalCoverageBeforeRestore.colorCoverageMissing
        )
      );
      if (shouldRestoreFullPoliticalDerivedState) {
        // The visual stage already prepared the primary subset. Full restoration
        // below replaces its index and spatial data, so do not build them twice.
        await yieldToMain();
        yieldCount += 1;
        if (!isCurrent()) return false;
      } else if (!resolvedCompletePoliticalDerivedStateReady) {
        const indexStartedAt = nowMs();
        infrastructureMutationStarted = true;
        execution.mutationStarted = true;
        buildIndex();
        preliminaryIndexBuildMs = nowMs() - indexStartedAt;
        await yieldToMain();
        yieldCount += 1;
        if (!isCurrent()) {
          return false;
        }
        const spatialStartedAt = nowMs();
        await buildSpatialIndexChunked({
          includeSecondary: false,
          keepReady: true,
          isCurrent,
        });
        if (!isCurrent()) return false;
        preliminarySpatialBuildMs = nowMs() - spatialStartedAt;
      }
      if (hasPoliticalGeometryChange) {
        const fullRestoreStartedAt = nowMs();
        const hasPrimaryVisiblePoliticalSubset = Array.isArray(runtimeState.scenarioPoliticalVisibleChunkData?.features);
        recordScenarioPoliticalDerivedStateCoverage({
          runtimeState,
          recordRenderPerfMetric,
          reason,
          stage: "before-deferred-restore",
          coverage: politicalCoverageBeforeRestore,
        });
        if (hasPrimaryVisiblePoliticalSubset || shouldRestoreFullPoliticalDerivedState) {
          fullRestoreMutationStarted = true;
          execution.mutationStarted = true;
          setScenarioPoliticalChunkPayloadState(runtimeState, { visiblePayload: null });
        }
        if (shouldRestoreFullPoliticalDerivedState) {
          rebuildPoliticalLandCollections();
          rebuildRuntimeDerivedState({
            includeRuntimePoliticalMeta: true,
            scheduleUiMode: "deferred",
            buildSpatial: true,
            includeSecondarySpatial: false,
          });
          runtimeState.hitCanvasDirty = true;
          runtimeState.hitCanvasTopologyRevision = 0;
          invalidateRenderPasses(
            ["physicalBase", "political", "contextBase", "contextScenario", "borders"],
            "scenario-political-full-derived-state-restore"
          );
          await yieldToMain();
          yieldCount += 1;
          if (!isCurrent()) return false;
        }
        fullPoliticalRestoreMs = nowMs() - fullRestoreStartedAt;
        restoredFullPoliticalChunkData = shouldRestoreFullPoliticalDerivedState;
        politicalCoverageBeforeRestore = analyzeScenarioPoliticalDerivedStateCoverage(runtimeState, { buildInteractiveLandData, shouldExcludePoliticalVisualFeature });
        if (
          restoredFullPoliticalChunkData
          && !politicalCoverageBeforeRestore.landDataCoverageMissing
          && !politicalCoverageBeforeRestore.colorCoverageMissing
        ) {
          resolvedCompletePoliticalDerivedStateReady = true;
        }
        recordScenarioPoliticalDerivedStateCoverage({
          runtimeState,
          recordRenderPerfMetric,
          reason,
          stage: "after-deferred-restore",
          coverage: politicalCoverageBeforeRestore,
          restoredFullPoliticalChunkData,
        });
        if (!isCurrent()) {
          return false;
        }
      }
      setInteractionInfrastructureState(previousInteractionInfrastructureStage || "basic-ready", {
        ready: true,
        inFlight: false,
      });
      restoredInteractionInfrastructureState = true;
      if (!isCurrent()) {
        return false;
      }
      scheduleSecondarySpatialIndexBuild({
        reason: `${reason}-secondary-spatial`,
      });
      if (runtimeState.hitCanvasDirty) {
        scheduleHitCanvasBuildIfNeeded({
          reason: `${reason}-hit-canvas`,
        });
      }
      if (hasPoliticalGeometryChange) {
        ensureSovereigntyState();
        if (refreshOpeningOwnerBorders !== false) {
          refreshScenarioOpeningOwnerBorders({
            renderNow: false,
            reason: `${reason}-opening`,
          });
        }
        invalidateBorderCache();
        updateDynamicBorderStatusUI();
        updateSpecialZonesPaths();
        renderSpecialZoneEditorOverlay();
      }
      if (!isCurrent()) {
        return false;
      }
      if (runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object") {
        patchScenarioChunkLoadState(runtimeState, { pendingInfraPromotion: null });
      }
      // The caller's synchronous render boundary may have already completed before
      // this deferred geometry work dirties passes. Consume those invalidations here.
      if (!suppressRender || hasPoliticalGeometryChange) {
        render();
      }
      const infraDurationMs = nowMs() - startedAt;
      recordRenderPerfMetric("scenarioChunkPromotionInfraStage", infraDurationMs, {
        preliminaryIndexBuildMs,
        preliminarySpatialBuildMs,
        preliminaryIndexBuildCount: preliminaryIndexBuildMs === null ? 0 : 1,
        preliminarySpatialBuildCount: preliminarySpatialBuildMs === null ? 0 : 1,
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
        suppressRender: !!suppressRender,
        promotionVersion,
        hasPoliticalGeometryChange: !!hasPoliticalGeometryChange,
        primaryVisibleDerivedStateReady: !!primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady: !!resolvedCompletePoliticalDerivedStateReady,
        primaryDerivedStateReady: !!primaryDerivedStateReady,
        restoredFullPoliticalChunkData,
        fullPoliticalRestoreMs: Math.max(0, fullPoliticalRestoreMs),
      });
      recordRenderPerfMetric("chunkPromotionInfraMs", infraDurationMs, {
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
        suppressRender: !!suppressRender,
        promotionVersion,
        hasPoliticalGeometryChange: !!hasPoliticalGeometryChange,
        primaryVisibleDerivedStateReady: !!primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady: !!resolvedCompletePoliticalDerivedStateReady,
        primaryDerivedStateReady: !!primaryDerivedStateReady,
        restoredFullPoliticalChunkData,
        fullPoliticalRestoreMs: Math.max(0, fullPoliticalRestoreMs),
      });
      recordRenderPerfMetric("chunkPromotionDeferredInfraMs", infraDurationMs, {
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
        suppressRender: !!suppressRender,
        promotionVersion,
        hasPoliticalGeometryChange: !!hasPoliticalGeometryChange,
        primaryVisibleDerivedStateReady: !!primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady: !!resolvedCompletePoliticalDerivedStateReady,
        primaryDerivedStateReady: !!primaryDerivedStateReady,
        restoredFullPoliticalChunkData,
        fullPoliticalRestoreMs: Math.max(0, fullPoliticalRestoreMs),
      });
      recordInteractionRecoveryTaskMetric(taskKey, infraDurationMs, {
        reason: String(reason || "scenario-chunk-promotion"),
        suppressRender: !!suppressRender,
        promotionVersion,
        hasPoliticalGeometryChange: !!hasPoliticalGeometryChange,
        primaryVisibleDerivedStateReady: !!primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady: !!resolvedCompletePoliticalDerivedStateReady,
        primaryDerivedStateReady: !!primaryDerivedStateReady,
        refreshOpeningOwnerBorders: refreshOpeningOwnerBorders !== false,
        restoredFullPoliticalChunkData,
        fullPoliticalRestoreMs: Math.max(0, fullPoliticalRestoreMs),
        yieldCount,
      });
      return true;
    } catch (error) {
      if (isCurrent()) {
        if (loadState?.pendingInfraPromotion) {
          patchScenarioChunkLoadState(runtimeState, { pendingInfraPromotion: null });
        }
        restoredInteractionInfrastructureState = false;
        recordRenderPerfMetric("scenarioChunkPromotionInfraFailure", nowMs() - startedAt, {
          activeScenarioId: String(scenarioId || ""),
          reason: String(reason || "scenario-chunk-promotion"),
          promotionVersion,
          error: error?.message || String(error),
        });
      }
      throw error;
    } finally {
      if (!restoredInteractionInfrastructureState && isCurrent()) {
        setInteractionInfrastructureState(previousInteractionInfrastructureStage || "basic-ready", {
          ready: previousInteractionInfrastructureReady && !fullRestoreMutationStarted && !infrastructureMutationStarted,
          inFlight: false,
        });
      }
      if (activeInfraExecution === execution) {
        activeInfraExecution = null;
        activeInfraLoadStateIsCurrent = () => false;
        endInteractionRecoveryTask(taskKey);
      }
    }
  }

  function refreshMapDataForScenarioChunkPromotion({
    suppressRender = false,
    reason = "scenario-chunk-promotion",
    changedLayerKeys = [],
    politicalFeatureIds = [],
    hasPoliticalPayloadChange = false,
    refreshPlan = null,
  } = {}) {
    const startedAt = nowMs();
    const runtimeChunkLoadState = runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object"
      ? runtimeState.runtimeChunkLoadState
      : null;
    const pendingVisualPromotion = runtimeChunkLoadState?.pendingVisualPromotion || null;
    const pendingPromotion = runtimeChunkLoadState?.pendingPromotion || null;
    const promotionQueuedAt = Number(pendingVisualPromotion?.queuedAt || pendingPromotion?.queuedAt || 0);
    const {
      hasPoliticalChange,
      effectiveChangedLayerKeys,
    } = resolveScenarioChunkPromotionChangeSet({
      changedLayerKeys,
      politicalFeatureIds,
      hasPoliticalPayloadChange,
    });
    if (hasPoliticalChange) {
      rebuildPrimaryPoliticalDerivedState({
        scheduleUiMode: "deferred",
        buildSpatial: true,
        includeSecondarySpatial: false,
      });
    }
    scenarioChunkPromotionVersion = Number(scenarioChunkPromotionVersion || 0) + 1;
    markRendererTopologyChanged({ hitCanvasDirty: true });
    if (runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object") {
      queueScenarioChunkPromotionState(runtimeState, {
        visualPromotion: null,
        infraPromotion: null,
        promotion: runtimeState.runtimeChunkLoadState.pendingPromotion || null,
      });
    }
    if (hasPoliticalChange) {
      clearDeferredInternalBorderMeshCaches();
      scheduleDeferredHeavyBorderMeshes();
    }
    if ((Array.isArray(effectiveChangedLayerKeys) ? effectiveChangedLayerKeys : []).some((layerKey) => String(layerKey || "").trim().toLowerCase() === "water")) {
      resetScenarioWaterCacheAdaptiveState("scenario-water-regions-data-replaced");
    }
    const synchronizedSecondaryRegionIndexes = syncScenarioSecondaryRegionIndexes({
      changedLayerKeys: effectiveChangedLayerKeys,
      reason: `${reason}-secondary-sync`,
    });
    const shouldSkipDeferredInfraRefresh = synchronizedSecondaryRegionIndexes && !hasPoliticalChange;
    if (shouldSkipDeferredInfraRefresh && runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object") {
      patchScenarioChunkLoadState(runtimeState, { pendingInfraPromotion: null });
    }
    const {
      rendererRefreshPlan,
      frameGraphInvalidation,
      hasExplicitTargetResources,
      targetResources,
      invalidationTargetPasses,
    } = resolveScenarioChunkPromotionRendererRefreshDescriptor({
      refreshPlan,
      changedLayerKeys: effectiveChangedLayerKeys,
      hasPoliticalChange,
    });
    const selectionVersion = Math.max(0, Number(runtimeState.runtimeChunkLoadState?.selectionVersion || 0));
    const promotedTotalFeatureCount = Array.isArray(runtimeState.scenarioPoliticalChunkData?.features)
      ? runtimeState.scenarioPoliticalChunkData.features.length
      : 0;
    const promotedPrimaryFeatureCount = Array.isArray(runtimeState.scenarioPoliticalVisibleChunkData?.features)
      ? runtimeState.scenarioPoliticalVisibleChunkData.features.length
      : promotedTotalFeatureCount;
    const currentPoliticalCoverage = analyzeScenarioPoliticalDerivedStateCoverage(runtimeState, { buildInteractiveLandData, shouldExcludePoliticalVisualFeature });
    const primaryVisibleDerivedStateReady = hasPoliticalChange
      && !!currentPoliticalCoverage.primaryVisibleFeatureSubsetActive;
    const completePoliticalDerivedStateReady = hasPoliticalChange
      && !currentPoliticalCoverage.primaryVisibleFeatureSubsetActive
      && !currentPoliticalCoverage.landDataCoverageMissing
      && !currentPoliticalCoverage.colorCoverageMissing;
    const promotedVisibleFeatureCount = readFirstNonNegativeCount(
      pendingVisualPromotion?.primaryVisibleFeatureCount,
      pendingPromotion?.primaryVisibleFeatureCount,
      pendingVisualPromotion?.selectedPoliticalVisibleFeatureCountSum,
      pendingPromotion?.selectedPoliticalVisibleFeatureCountSum,
      promotedPrimaryFeatureCount,
      pendingVisualPromotion?.selectedFeatureCountSum,
      pendingPromotion?.selectedFeatureCountSum,
      promotedTotalFeatureCount,
    );
    if (!shouldSkipDeferredInfraRefresh && runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object") {
      const promotionDelta = createScenarioChunkPromotionDelta({
        scenarioId: runtimeState.activeScenarioId,
        selectionVersion,
        reason,
        runId: scenarioChunkPromotionVersion,
        changedLayerKeys: effectiveChangedLayerKeys,
        targetResources,
        resourceDescriptors: frameGraphInvalidation?.resourceDescriptors,
        dataRevisionLayers: frameGraphInvalidation?.dataRevisionLayers || effectiveChangedLayerKeys,
        renderVisibleLayers: frameGraphInvalidation?.renderVisibleLayers || effectiveChangedLayerKeys,
        interactionAuthorityLayers: frameGraphInvalidation?.interactionAuthorityLayers || effectiveChangedLayerKeys,
        politicalPayloadRef: {
          kind: "political",
          id: "scenarioPoliticalChunkData",
          featureCount: promotedTotalFeatureCount,
        },
        primaryPoliticalPayloadRef: {
          kind: "primaryPolitical",
          id: "scenarioPoliticalVisibleChunkData",
          featureCount: promotedPrimaryFeatureCount,
        },
        infraTasks: ["scenario-chunk-promotion-infra"],
        visualTasks: suppressRender ? ["invalidate-render-passes"] : ["invalidate-render-passes", "render"],
        metrics: {
          changedLayerCount: Array.isArray(effectiveChangedLayerKeys) ? effectiveChangedLayerKeys.length : 0,
          targetResourceCount: targetResources.length,
          targetPassCount: invalidationTargetPasses.length,
          promotionVersion: scenarioChunkPromotionVersion,
          hasPoliticalGeometryChange: hasPoliticalChange,
        },
      });
      patchScenarioChunkLoadState(runtimeState, { pendingInfraPromotion: {
        reason: String(reason || "scenario-chunk-promotion"),
        selectionVersion,
        promotionVersion: scenarioChunkPromotionVersion,
        hasPoliticalGeometryChange: hasPoliticalChange,
        primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady,
        primaryDerivedStateReady: completePoliticalDerivedStateReady,
        promotionDelta,
      } });
    }
    scenarioVisualInvalidationExecutor.executeScenarioVisualInvalidation({
      reason,
      suppressRender,
      frameGraphInvalidation,
      executionPlan: { targetResources, invalidationTargetPasses, hasExplicitTargetResources },
    });
    const shouldRefreshOpeningOwnerBordersInVisual =
      hasPoliticalChange
      && rendererRefreshPlan.refreshOpeningOwnerBorders !== false
      && isUsableMesh(runtimeState.activeScenarioMeshPack?.meshes?.opening_owner_borders);
    if (shouldSkipDeferredInfraRefresh) {
      if (runtimeState.hitCanvasDirty) {
        scheduleHitCanvasBuildIfNeeded({
          reason: `${reason}-secondary-hit-canvas`,
        });
      }
    } else {
      scheduleDeferredScenarioChunkPromotionInfraRefresh({
        reason,
        suppressRender,
        promotionVersion: scenarioChunkPromotionVersion,
        hasPoliticalGeometryChange: hasPoliticalChange,
        primaryVisibleDerivedStateReady,
        completePoliticalDerivedStateReady,
        primaryDerivedStateReady: completePoliticalDerivedStateReady,
        refreshOpeningOwnerBorders: !shouldRefreshOpeningOwnerBordersInVisual,
      });
    }
    const visualDurationMs = nowMs() - startedAt;
    const promotionMetricDetails = buildScenarioChunkPromotionVisualMetricDetails({
      activeScenarioId: runtimeState.activeScenarioId,
      reason,
      runtimeChunkLoadState,
      pendingVisualPromotion,
      pendingPromotion,
      promotionQueuedAt,
      startedAt,
      suppressRender,
      hasPoliticalChange,
      promotedTotalFeatureCount,
      promotedPrimaryFeatureCount,
      promotedVisibleFeatureCount,
      effectiveChangedLayerKeys,
      promotionVersion: scenarioChunkPromotionVersion,
      synchronizedSecondaryRegionIndexes,
    });
    recordRenderPerfMetric("scenarioChunkPromotionVisualStage", visualDurationMs, {
      ...promotionMetricDetails,
    });
    recordRenderPerfMetric("chunkPromotionPrimaryRefreshMs", visualDurationMs, {
      ...promotionMetricDetails,
    });
    recordRenderPerfMetric("chunkPromotionVisualMs", visualDurationMs, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      suppressRender: !!suppressRender,
      promotedFeatureCount: promotedTotalFeatureCount,
      promotedPrimaryFeatureCount,
      promotedVisibleFeatureCount,
      promotedTotalFeatureCount,
      changedLayerCount: Array.isArray(effectiveChangedLayerKeys) ? effectiveChangedLayerKeys.length : 0,
      promotionVersion: scenarioChunkPromotionVersion,
      hasPoliticalGeometryChange: hasPoliticalChange,
      synchronizedSecondaryRegionIndexes,
    });
    recordRenderPerfMetric("scenarioChunkPoliticalPromotion", visualDurationMs, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      suppressRender: !!suppressRender,
      promotedFeatureCount: promotedTotalFeatureCount,
      promotedPrimaryFeatureCount,
      promotedVisibleFeatureCount,
      promotedTotalFeatureCount,
      changedLayerCount: Array.isArray(effectiveChangedLayerKeys) ? effectiveChangedLayerKeys.length : 0,
      promotionVersion: scenarioChunkPromotionVersion,
      synchronizedSecondaryRegionIndexes,
      stage: "visual",
    });
    if (shouldRefreshOpeningOwnerBordersInVisual) {
      refreshScenarioOpeningOwnerBorders({
        renderNow: false,
        reason: `${reason}-opening-sync`,
      });
    }
  }

  function refreshMapDataForScenarioApply({
    suppressRender = false,
    refreshPlan = null,
  } = {}) {
    const startedAt = nowMs();
    const rendererRefreshPlan = normalizeRendererRefreshPlan(refreshPlan, {
      source: "scenario-apply",
      targetPasses: ["background", "physicalBase", "political", "contextBase", "contextScenario", "dayNight", "borders", "labels"],
      refreshOpeningOwnerBorders: true,
      resetWaterCacheReason: "scenario-switch-complete",
    });
    resetRendererTransactionState({ hitCanvasDirty: true });
    rebuildPrimaryPoliticalDerivedState({
      scheduleUiMode: "deferred",
      buildSpatial: true,
      includeSecondarySpatial: false,
    });
    clearLastGoodFrame("scenario-apply-refresh");
    invalidateInteractionComposite("scenario-apply-refresh");
    resetFirstVisibleFramePainted("scenario-apply-refresh");
    const targetPasses = rendererRefreshPlan.targetPasses;
    invalidateRenderPasses(targetPasses, "scenario-apply-refresh");
    clearRenderPassReferenceTransforms(targetPasses);
    markAllOverlaysDirty();
    rebuildStaticMeshes({
      refreshOpeningOwnerBorders: rendererRefreshPlan.refreshOpeningOwnerBorders,
    });
    invalidateBorderCache();
    updateDynamicBorderStatusUI();
    updateSpecialZonesPaths();
    renderSpecialZoneEditorOverlay();
    updateZoomTranslateExtent();
    const atlantropaWaterFeatureCount = getEffectiveAtlantropaFeatures().water.length;
    resetScenarioWaterCacheAdaptiveState(rendererRefreshPlan.resetWaterCacheReason || "scenario-switch-complete");
    let atlantropaWaterIndexCount = 0;
    let atlantropaWaterSpatialCount = 0;
    if (atlantropaWaterFeatureCount > 0) {
      rebuildAuxiliaryRegionIndexes();
      atlantropaWaterIndexCount = Array.from(runtimeState.waterRegionsById?.keys?.() || [])
        .filter((featureId) => String(featureId || "").startsWith("ATLSEA_")).length;
      getSpatialIndexRuntimeOwner().resetSecondarySpatialIndexState({
        preserveCurrent: true,
        reason: "scenario-apply-atlantropa-water",
      });
      getSpatialIndexRuntimeOwner().buildSecondarySpatialIndexes({
        allowComputeMissingBounds: true,
      });
      atlantropaWaterSpatialCount = (Array.isArray(runtimeState.waterSpatialItems) ? runtimeState.waterSpatialItems : [])
        .filter((item) => String(item?.featureId || item?.id || "").startsWith("ATLSEA_")).length;
      queueIndexUiRefresh({
        renderWaterRegionList: true,
        renderSpecialRegionList: true,
      });
    } else {
      scheduleSecondarySpatialIndexBuild({
        reason: "scenario-apply-secondary-spatial",
      });
    }
    if (!suppressRender) {
      render();
    }
    recordRenderPerfMetric("scenarioApplyMapRefresh", nowMs() - startedAt, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      suppressRender: !!suppressRender,
      landCount: Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features.length : 0,
      atlantropaWaterFeatureCount,
      atlantropaWaterIndexCount,
      atlantropaWaterSpatialCount,
    });
  }

  return {
    cancelDeferredScenarioChunkPromotionInfraRefresh,
    resetDeferredScenarioChunkPromotionState,
    runDeferredScenarioChunkPromotionInfraRefresh,
    scheduleDeferredScenarioChunkPromotionInfraRefresh,
    refreshMapDataForScenarioApply,
    refreshMapDataForScenarioChunkPromotion,
  };
}

export {
  createScenarioRefreshRuntime,
};

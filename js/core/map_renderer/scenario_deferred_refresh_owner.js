import { captureScenarioRefreshState, resolveScenarioRefreshScope } from "./scenario_refresh_scope.js";

// Same-scene deferred data refresh is separate from scenario/chunk transaction
// orchestration. All mutations use existing injected owners and actions.
export function createScenarioDeferredRefreshOwner({
    runtimeState, nowMs, rebuildPrimaryPoliticalDerivedState, markRendererTopologyChanged,
    clearDeferredInternalBorderMeshCaches, scheduleDeferredHeavyBorderMeshes,
    invalidateInteractionComposite, rebuildStaticMeshes, invalidateBorderCache,
    updateDynamicBorderStatusUI, syncScenarioSecondaryRegionIndexes,
    scheduleSecondarySpatialIndexBuild, resetScenarioWaterCacheAdaptiveState,
    updateSpecialZonesPaths, renderSpecialZoneEditorOverlay, recordScopedTopologyChange,
    invalidateRenderPasses, clearRenderPassReferenceTransforms, markAllOverlaysDirty,
    updateZoomTranslateExtent, requestScopedRender, recordRenderPerfMetric,
    ensureLayerDataFromTopology, getProjectionIdentity,
}) {
  function captureRefreshState() {
    return captureScenarioRefreshState(runtimeState, getProjectionIdentity());
  }

  function refreshDeferredDetail({ previousRefreshState, suppressRender }) {
    const startedAt = nowMs();
    let scope = resolveScenarioRefreshScope(previousRefreshState, captureRefreshState());
    if (scope.mode === "full") return null;
    // Refresh context bindings first, then compare the actual water/special
    // sources. An unrelated detail/urban arrival must not reset water caches.
    ensureLayerDataFromTopology();
    scope = resolveScenarioRefreshScope(previousRefreshState, captureRefreshState());
    if (scope.mode === "full") return null;
    if (scope.mode === "none") {
      recordRenderPerfMetric("scenarioScopedMapRefresh", nowMs() - startedAt, scope);
      return scope;
    }
    const targetPasses = new Set();
    let derived = null;
    let previousRevision = null;
    if (scope.politicalChanged) {
      // The existing derived cache validates scene/semantic identity, metadata,
      // and skipped generations. Invalid deltas still take its full fallback.
      derived = rebuildPrimaryPoliticalDerivedState({
        scheduleUiMode: "deferred", buildSpatial: true,
        includeSecondarySpatial: false, incremental: true,
      });
      previousRevision = Number(runtimeState.topologyRevision || 0);
      markRendererTopologyChanged({ hitCanvasDirty: true });
      ["physicalBase", "political", "contextBase", "contextMarkers", "borders", "labels"].forEach((pass) => targetPasses.add(pass));
      clearDeferredInternalBorderMeshCaches();
      scheduleDeferredHeavyBorderMeshes();
      invalidateInteractionComposite("detail-geometry-refresh");
    }
    if (scope.contextChanged) {
      ["background", "physicalBase", "contextBase", "dayNight", "labels"].forEach((pass) => targetPasses.add(pass));
    }
    if (scope.styleChanged) {
      ["physicalBase", "political", "contextBase", "contextMarkers", "labels"].forEach((pass) => targetPasses.add(pass));
    }
    if (scope.bordersChanged) {
      rebuildStaticMeshes({ refreshOpeningOwnerBorders: !!scope.politicalChanged });
      targetPasses.add("borders");
    }
    if (scope.politicalChanged) invalidateBorderCache();
    if (scope.bordersChanged || scope.politicalChanged) updateDynamicBorderStatusUI();
    const secondaryLayers = [
      ...(scope.waterChanged ? ["water"] : []), ...(scope.specialChanged ? ["special"] : []),
    ];
    if (secondaryLayers.length) {
      const synced = syncScenarioSecondaryRegionIndexes({ changedLayerKeys: secondaryLayers, reason: "detail-secondary-refresh" });
      if (synced === false) scheduleSecondarySpatialIndexBuild({ reason: "detail-secondary-refresh" });
      if (scope.waterChanged) resetScenarioWaterCacheAdaptiveState("detail-water-source-changed");
      targetPasses.add("contextScenario");
      targetPasses.add("borders");
      invalidateInteractionComposite("detail-secondary-refresh");
      updateSpecialZonesPaths();
      renderSpecialZoneEditorOverlay();
    }
    // Do not reset first-visible-frame, pending color transactions or all
    // renderer infrastructure for a same-scene data arrival.
    const passes = [...targetPasses];
    if (previousRevision !== null) recordScopedTopologyChange({ previousRevision, targetPasses: passes });
    invalidateRenderPasses(passes, "deferred-detail-scoped-refresh");
    clearRenderPassReferenceTransforms(passes);
    markAllOverlaysDirty();
    if (scope.politicalChanged || scope.contextChanged) updateZoomTranslateExtent();
    if (!suppressRender) requestScopedRender("deferred-detail-scoped-refresh");
    const result = { ...scope, targetPasses: passes, incremental: derived?.incremental === true,
      changedFeatureCount: derived?.changedFeatureCount || 0, removedFeatureCount: derived?.removedFeatureCount || 0 };
    recordRenderPerfMetric("scenarioScopedMapRefresh", nowMs() - startedAt, result);
    return result;
  }

  return Object.freeze({ captureRefreshState, refreshDeferredDetail });
}

const SET_MAP_DATA_REASON = "set-map-data";

const REQUIRED_EFFECT_NAMES = Object.freeze([
  "resetRendererTransactionState",
  "clearPendingPoliticalColorEdit",
  "clearRenderPassReferenceTransforms",
  "clearLastGoodFrame",
  "invalidateInteractionComposite",
  "resetFirstVisibleFramePainted",
  "invalidateAllRenderPasses",
  "markAllOverlaysDirty",
  "queueTooltipUpdate",
  "rebuildPrimaryPoliticalCollections",
  "recordCompositeCoverageDiagnostics",
  "sanitizeSetMapDataColorState",

  "setCanvasSize",
  "buildRuntimePoliticalMeta",
  "resetSovereigntyInitialized",
  "resetIslandNeighborsCache",
  "clearSphericalFeatureDiagnosticsCache",
  "buildIndex",
  "ensureSovereigntyState",
  "setDeferHitCanvasBuild",
  "setInteractionInfrastructureState",
  "rebuildProjectedBoundsCache",
  "rebuildStaticMeshes",
  "invalidateBorderCache",
  "updateDynamicBorderStatusUI",
  "rebuildResolvedColors",
  "fitProjection",
  "buildSpatialIndex",
  "updateSpecialZonesPaths",
  "renderSpecialZoneEditorOverlay",
  "updateZoomTranslateExtent",
  "resetZoomToFit",
  "enforceZoomConstraints",
  "setHitCanvasDirty",
  "beginStagedMapDataWarmup",
  "render",
  "recordRenderPerfMetric",
]);

const REQUIRED_GETTER_NAMES = Object.freeze([
  "nowMs",
  "getActiveScenarioId",
  "getLandFeatureCount",
  "getRenderProfile",
]);

function requireFunction(owner, name, ownerName) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`setMapData transaction owner requires ${ownerName}.${name}`);
  }
  return owner[name].bind(owner);
}

function normalizeSetMapDataOptions({
  refitProjection = true,
  resetZoom = true,
  suppressRender = false,
  interactionLevel = "full",
  deferInteractionInfrastructure = false,
} = {}) {
  return Object.freeze({
    refitProjection: Boolean(refitProjection),
    resetZoom: Boolean(resetZoom),
    suppressRender: Boolean(suppressRender),
    interactionLevel: String(interactionLevel),
    deferInteractionInfrastructure: Boolean(deferInteractionInfrastructure),
  });
}

export function createSetMapDataTransactionOwner({
  state = {},
  getters = {},
  effects = {},
} = {}) {
  void state;

  const requiredEffects = Object.fromEntries(
    REQUIRED_EFFECT_NAMES.map((name) => [name, requireFunction(effects, name, "effects")]),
  );
  const requiredGetters = Object.fromEntries(
    REQUIRED_GETTER_NAMES.map((name) => [name, requireFunction(getters, name, "getters")]),
  );

  function runSetMapDataTransaction(options = {}) {
    const normalizedOptions = normalizeSetMapDataOptions(options);
    const {
      refitProjection,
      resetZoom,
      suppressRender,
      interactionLevel,
      deferInteractionInfrastructure,
    } = normalizedOptions;
    const startedAt = requiredGetters.nowMs();
    const summary = {
      reason: SET_MAP_DATA_REASON,
      options: normalizedOptions,
      shouldDeferInteractionInfrastructure:
        deferInteractionInfrastructure || interactionLevel === "readonly-startup",
      staged: false,
      effects: [],
    };
    const runEffect = (name, ...args) => {
      summary.effects.push(name);
      return requiredEffects[name](...args);
    };

    runEffect("resetRendererTransactionState", {
      cancelHoverOverlayRender: true,
      cancelSecondarySpatialBuild: true,
    });
    runEffect("clearPendingPoliticalColorEdit", {
      force: true,
      resetReason: SET_MAP_DATA_REASON,
      paintSource: SET_MAP_DATA_REASON,
    });
    runEffect("clearRenderPassReferenceTransforms");
    runEffect("clearLastGoodFrame", SET_MAP_DATA_REASON);
    runEffect("invalidateInteractionComposite", SET_MAP_DATA_REASON);
    runEffect("resetFirstVisibleFramePainted", SET_MAP_DATA_REASON);
    runEffect("invalidateAllRenderPasses", SET_MAP_DATA_REASON);
    runEffect("markAllOverlaysDirty");
    runEffect("queueTooltipUpdate", { visible: false });
    const politicalCollections = runEffect("rebuildPrimaryPoliticalCollections");
    runEffect("recordCompositeCoverageDiagnostics", politicalCollections);
    runEffect("sanitizeSetMapDataColorState");

    runEffect("setCanvasSize");
    runEffect("buildRuntimePoliticalMeta");
    runEffect("resetSovereigntyInitialized");
    runEffect("resetIslandNeighborsCache");
    runEffect("clearSphericalFeatureDiagnosticsCache");

    if (!summary.shouldDeferInteractionInfrastructure) {
      runEffect("buildIndex");
      runEffect("ensureSovereigntyState");
    } else {
      runEffect("setDeferHitCanvasBuild", true);
      runEffect("setInteractionInfrastructureState", "deferred-startup", {
        ready: false,
        inFlight: false,
      });
    }
    if (!refitProjection) {
      runEffect("rebuildProjectedBoundsCache");
    }
    runEffect("rebuildStaticMeshes");
    runEffect("invalidateBorderCache");
    runEffect("updateDynamicBorderStatusUI");
    runEffect("rebuildResolvedColors");
    if (refitProjection) {
      runEffect("fitProjection", { skipSpatialIndex: summary.shouldDeferInteractionInfrastructure });
    } else {
      if (!summary.shouldDeferInteractionInfrastructure) {
        runEffect("buildSpatialIndex");
      }
      runEffect("updateSpecialZonesPaths");
      runEffect("renderSpecialZoneEditorOverlay");
      runEffect("updateZoomTranslateExtent");
    }
    if (resetZoom) {
      runEffect("resetZoomToFit");
      runEffect("enforceZoomConstraints", { suppressRender });
    } else {
      runEffect("setHitCanvasDirty", true);
    }

    let stagedApply = false;
    if (!suppressRender) {
      stagedApply = runEffect("beginStagedMapDataWarmup", startedAt);
      summary.staged = stagedApply;
      runEffect("render");
      runEffect("recordRenderPerfMetric", "setMapDataFirstPaint", requiredGetters.nowMs() - startedAt, {
        staged: stagedApply,
        activeScenarioId: String(requiredGetters.getActiveScenarioId() || ""),
      });
    }
    runEffect("recordRenderPerfMetric", "setMapData", requiredGetters.nowMs() - startedAt, {
      refitProjection: !!refitProjection,
      resetZoom: !!resetZoom,
      suppressRender: !!suppressRender,
      landCount: requiredGetters.getLandFeatureCount(),
      renderProfile: String(requiredGetters.getRenderProfile() || "auto"),
      staged: stagedApply,
    });
    if (!summary.shouldDeferInteractionInfrastructure) {
      runEffect("setInteractionInfrastructureState", "ready", {
        ready: true,
        inFlight: false,
      });
    }

    return Object.freeze({
      ...summary,
      effects: Object.freeze([...summary.effects]),
    });
  }

  return Object.freeze({
    runSetMapDataTransaction,
  });
}

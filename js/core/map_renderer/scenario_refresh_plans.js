import {
  DEFAULT_RENDER_INVALIDATION_PASSES,
  UNSUPPORTED_RENDER_PASS_INPUT_KEYS,
  getFirstFrameTargetResources,
  getTargetPassesForResources,
  getTargetResourcesForPasses,
  hasAnyTargetResource,
  resolveFirstFrameTargetResources,
} from "./render_invalidation_catalog.js";

function normalizeLayerKeyList(layerKeys = []) {
  return Array.from(
    new Set(
      (Array.isArray(layerKeys) ? layerKeys : [])
        .map((layerKey) => String(layerKey || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function normalizeStringList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function createRendererRefreshPlan({
  source,
  targetPasses = [],
  frameGraphInvalidation = null,
  refreshOpeningOwnerBorders = true,
  resetWaterCacheReason = "",
} = {}) {
  return {
    kind: "RendererRefreshPlan",
    source: String(source || "scenario-refresh"),
    targetPasses: normalizeStringList(targetPasses),
    ...(frameGraphInvalidation && typeof frameGraphInvalidation === "object"
      ? { frameGraphInvalidation }
      : {}),
    refreshOpeningOwnerBorders: refreshOpeningOwnerBorders !== false,
    resetWaterCacheReason: String(resetWaterCacheReason || ""),
  };
}

function createScenarioRefreshPlan({
  source,
  changedLayerKeys = [],
  renderer = {},
} = {}) {
  return {
    kind: "ScenarioRefreshPlan",
    source: String(source || "scenario-refresh"),
    changedLayerKeys: normalizeLayerKeyList(changedLayerKeys),
    renderer: createRendererRefreshPlan({
      source,
      ...renderer,
    }),
  };
}

function createFrameGraphInvalidation(options = {}) {
  const {
    reason = "scenario-refresh",
    changedLayerKeys = [],
    dataRevisionLayers = changedLayerKeys,
    renderVisibleLayers = changedLayerKeys,
    interactionAuthorityLayers = changedLayerKeys,
    targetResources = [],
    clearLastGoodFrame = false,
    clearReferenceTransforms = false,
    clearPartialPoliticalDirtyIds = false,
    resetWaterCacheReason = "",
    clearOpeningOwnerBorderCache = false,
    clearInteractionComposite = false,
    ...unsupportedInputs
  } = options && typeof options === "object" ? options : {};
  const unsupportedInputKey = UNSUPPORTED_RENDER_PASS_INPUT_KEYS.find((key) => (
    Object.prototype.hasOwnProperty.call(unsupportedInputs, key)
  ));
  if (unsupportedInputKey) {
    throw new Error(
      `FrameGraph invalidation descriptors accept targetResources only; remove ${unsupportedInputKey}.`
    );
  }
  return {
    kind: "FrameGraphInvalidation",
    reason: String(reason || "scenario-refresh"),
    dataRevisionLayers: normalizeLayerKeyList(dataRevisionLayers),
    renderVisibleLayers: normalizeLayerKeyList(renderVisibleLayers),
    interactionAuthorityLayers: normalizeLayerKeyList(interactionAuthorityLayers),
    targetResources: normalizeStringList(targetResources),
    clearLastGoodFrame: !!clearLastGoodFrame,
    clearReferenceTransforms: !!clearReferenceTransforms,
    clearPartialPoliticalDirtyIds: !!clearPartialPoliticalDirtyIds,
    resetWaterCacheReason: String(resetWaterCacheReason || ""),
    clearOpeningOwnerBorderCache: !!clearOpeningOwnerBorderCache,
    clearInteractionComposite: !!clearInteractionComposite,
  };
}

function getFrameGraphInvalidationTargetPasses(frameGraphInvalidation, fallbackTargetPasses = []) {
  if (frameGraphInvalidation && typeof frameGraphInvalidation === "object") {
    if (Array.isArray(frameGraphInvalidation.targetResources)) {
      return getTargetPassesForResources(frameGraphInvalidation.targetResources);
    }
  }
  return normalizeStringList(fallbackTargetPasses);
}

function resolveFrameGraphInvalidationExecutionPlan(frameGraphInvalidation, fallbackTargetPasses = []) {
  const hasExplicitTargetResources = Array.isArray(frameGraphInvalidation?.targetResources);
  const resolvedInvalidationPasses = getFrameGraphInvalidationTargetPasses(frameGraphInvalidation, fallbackTargetPasses);
  const targetResources = hasExplicitTargetResources
    ? normalizeStringList(frameGraphInvalidation.targetResources)
    : getTargetResourcesForPasses(resolvedInvalidationPasses);
  const invalidationTargetPasses = resolvedInvalidationPasses.length
    ? resolvedInvalidationPasses
    : (hasExplicitTargetResources ? [] : [...DEFAULT_RENDER_INVALIDATION_PASSES]);
  return {
    targetResources,
    invalidationTargetPasses,
    hasExplicitTargetResources,
  };
}

function createScenarioApplyRefreshPlan({
  refreshOpeningOwnerBorders = true,
} = {}) {
  return createScenarioRefreshPlan({
    source: "scenario-apply",
    renderer: {
      targetPasses: [
        "background",
        "physicalBase",
        "political",
        "contextBase",
        "contextScenario",
        "dayNight",
        "borders",
        "labels",
      ],
      refreshOpeningOwnerBorders,
      resetWaterCacheReason: "scenario-switch-complete",
    },
  });
}

function createScenarioChunkPromotionRefreshPlan({
  changedLayerKeys = [],
  hasPoliticalChange = false,
  firstFrameOnly = false,
  hgoPreviewDirty = false,
} = {}) {
  const normalizedChangedLayerKeys = normalizeLayerKeyList(changedLayerKeys);
  const promotionTargetResources = getScenarioChunkPromotionTargetResources({
    changedLayerKeys: normalizedChangedLayerKeys,
    hasPoliticalChange,
  });
  const targetResources = firstFrameOnly
    ? resolveFirstFrameTargetResources(promotionTargetResources, { hgoPreviewDirty })
    : promotionTargetResources;
  return createScenarioRefreshPlan({
    source: "scenario-chunk-promotion",
    changedLayerKeys: normalizedChangedLayerKeys,
    renderer: {
      targetPasses: [],
      frameGraphInvalidation: createFrameGraphInvalidation({
        reason: "scenario-chunk-promotion",
        changedLayerKeys: normalizedChangedLayerKeys,
        targetResources,
        clearLastGoodFrame: hasAnyTargetResource(targetResources, [
          "politicalBaseBuffer",
          "hitIndex",
          "contextBaseBuffer",
          "contextScenarioBuffer",
        ]),
        clearReferenceTransforms: targetResources.length > 0,
        clearPartialPoliticalDirtyIds: hasAnyTargetResource(targetResources, [
          "politicalBaseBuffer",
          "hitIndex",
        ]),
        clearOpeningOwnerBorderCache: !!hasPoliticalChange,
        clearInteractionComposite: hasAnyTargetResource(targetResources, [
          "politicalBaseBuffer",
          "hitIndex",
          "contextBaseBuffer",
          "contextScenarioBuffer",
          "borderBuffer",
          "interactionOverlay",
        ]),
      }),
      refreshOpeningOwnerBorders: !!hasPoliticalChange,
    },
  });
}

function createStartupHydrationRefreshPlan({
  changedLayerKeys = [],
  hasPoliticalChange = true,
} = {}) {
  return createScenarioRefreshPlan({
    source: "startup-hydration",
    changedLayerKeys,
    renderer: {
      targetPasses: [],
      refreshOpeningOwnerBorders: !!hasPoliticalChange,
    },
  });
}

function getRendererRefreshPlan(refreshPlan) {
  if (!refreshPlan || typeof refreshPlan !== "object") return null;
  if (refreshPlan.kind === "RendererRefreshPlan") return refreshPlan;
  if (refreshPlan.renderer && typeof refreshPlan.renderer === "object") {
    return refreshPlan.renderer;
  }
  return null;
}

function getScenarioChunkPromotionTargetPasses({
  changedLayerKeys = [],
  hasPoliticalChange = false,
} = {}) {
  return getTargetPassesForResources(getScenarioChunkPromotionTargetResources({
    changedLayerKeys,
    hasPoliticalChange,
  }));
}

function getScenarioChunkPromotionTargetResources({
  changedLayerKeys = [],
  hasPoliticalChange = false,
} = {}) {
  const targetResources = new Set();
  const addResources = (resourceNames) => {
    (Array.isArray(resourceNames) ? resourceNames : []).forEach((resourceName) => {
      const normalized = String(resourceName || "").trim();
      if (normalized) targetResources.add(normalized);
    });
  };
  if (hasPoliticalChange) {
    addResources([
      "physicalBaseBuffer",
      "politicalBaseBuffer",
      "hitIndex",
      "contextBaseBuffer",
      "contextMarkersBuffer",
      "borderBuffer",
      "interactionOverlay",
      "labelBuffer",
    ]);
  }
  (Array.isArray(changedLayerKeys) ? changedLayerKeys : []).forEach((layerKey) => {
    const normalized = String(layerKey || "").trim().toLowerCase();
    if (normalized === "cities") {
      addResources(["contextBaseBuffer", "contextMarkersBuffer", "labelBuffer", "dayNightBuffer"]);
      return;
    }
    if (normalized === "water" || normalized === "special" || normalized === "relief") {
      addResources(["contextScenarioBuffer", "borderBuffer"]);
      return;
    }
    if (normalized === "scenario_atlantropa") {
      addResources([
        "physicalBaseBuffer",
        "contextBaseBuffer",
        "politicalBaseBuffer",
        "hitIndex",
        "contextScenarioBuffer",
        "borderBuffer",
        "interactionOverlay",
        "labelBuffer",
      ]);
      return;
    }
    if (normalized === "strategicvalues") {
      addResources(["politicalBaseBuffer", "hitIndex", "contextMarkersBuffer", "labelBuffer"]);
    }
  });
  return Array.from(targetResources);
}

function normalizeRendererRefreshPlan(refreshPlan, defaults = {}) {
  const plan = refreshPlan && typeof refreshPlan === "object" ? refreshPlan : {};
  const defaultTargetPasses = Array.isArray(defaults.targetPasses) ? defaults.targetPasses : [];
  const targetPasses = Array.isArray(plan.targetPasses) && plan.targetPasses.length
    ? plan.targetPasses
    : defaultTargetPasses;
  const frameGraphInvalidation = plan.frameGraphInvalidation && typeof plan.frameGraphInvalidation === "object"
    ? plan.frameGraphInvalidation
    : (defaults.frameGraphInvalidation && typeof defaults.frameGraphInvalidation === "object" ? defaults.frameGraphInvalidation : null);
  return {
    source: String(plan.source || defaults.source || "renderer-refresh"),
    targetPasses: normalizeStringList(targetPasses),
    ...(frameGraphInvalidation ? { frameGraphInvalidation } : {}),
    refreshOpeningOwnerBorders: plan.refreshOpeningOwnerBorders !== undefined
      ? plan.refreshOpeningOwnerBorders !== false
      : defaults.refreshOpeningOwnerBorders !== false,
    resetWaterCacheReason: String(plan.resetWaterCacheReason || defaults.resetWaterCacheReason || ""),
  };
}

function resolveScenarioChunkPromotionRendererRefreshDescriptor({
  refreshPlan = null,
  changedLayerKeys = [],
  hasPoliticalChange = false,
} = {}) {
  const defaultTargetPasses = getScenarioChunkPromotionTargetPasses({
    changedLayerKeys,
    hasPoliticalChange,
  });
  const rendererRefreshPlan = normalizeRendererRefreshPlan(refreshPlan, {
    source: "scenario-chunk-promotion",
    targetPasses: defaultTargetPasses,
    refreshOpeningOwnerBorders: hasPoliticalChange,
  });
  const frameGraphInvalidation = rendererRefreshPlan.frameGraphInvalidation && typeof rendererRefreshPlan.frameGraphInvalidation === "object"
    ? rendererRefreshPlan.frameGraphInvalidation
    : null;
  const executionPlan = resolveFrameGraphInvalidationExecutionPlan(
    frameGraphInvalidation,
    rendererRefreshPlan.targetPasses,
  );
  return {
    rendererRefreshPlan,
    frameGraphInvalidation,
    ...executionPlan,
  };
}

export {
  createFrameGraphInvalidation,
  createScenarioApplyRefreshPlan,
  createScenarioChunkPromotionRefreshPlan,
  createStartupHydrationRefreshPlan,
  getFirstFrameTargetResources,
  getTargetPassesForResources,
  getTargetResourcesForPasses,
  getRendererRefreshPlan,
  getScenarioChunkPromotionTargetPasses,
  getScenarioChunkPromotionTargetResources,
  normalizeRendererRefreshPlan,
  resolveFrameGraphInvalidationExecutionPlan,
  resolveFirstFrameTargetResources,
  resolveScenarioChunkPromotionRendererRefreshDescriptor,
};

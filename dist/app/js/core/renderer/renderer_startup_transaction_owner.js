const INIT_MAP_RESET_REASON = "init-map";

const REQUIRED_EFFECT_NAMES = Object.freeze([
  "resetLayerResolverCache",
  "resetPhysicalLandClipPathCache",
  "resetExactRefreshOptimizationState",
  "bumpTopologyRevision",
  "resetHitCanvasTopologyRevision",
  "clearPendingPoliticalColorEdit",
  "clearRenderPassReferenceTransforms",
  "clearLastGoodFrame",
  "invalidateInteractionComposite",
  "resetFirstVisibleFramePainted",
  "setRenderPassPerfOverlayEnabled",
  "ensureLayerDataFromTopology",
  "rebuildPoliticalLandCollections",
  "applyRendererSurfaceBridgeState",

  "ensureSovereigntyState",
  "normalizeColorStateForRender",
  "setDebugMode",
  "resetRenderDiagnostics",
  "clearRenderPhaseTimer",
  "resetRenderPhaseState",
  "resetTooltipState",
  "cancelScheduledHoverOverlayRender",
  "markAllOverlaysDirty",
  "clearStagedMapDataTasks",
  "cancelExactAfterSettleRefresh",
  "cancelPendingIndexUiRefresh",
  "resetDeferredRenderFlags",
  "resetProjectedBoundsCacheState",
  "invalidateAllRenderPasses",
  "syncDayNightClockTimerBridge",
]);

const REQUIRED_GETTER_NAMES = Object.freeze([
  "isPerfOverlayEnabled",
]);

function requireFunction(owner, name, ownerName) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`renderer startup transaction owner requires ${ownerName}.${name}`);
  }
  return owner[name].bind(owner);
}

export function createRendererStartupTransactionOwner({
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

  function runInitMapResetTransaction({ debugMode } = {}) {
    const reason = INIT_MAP_RESET_REASON;
    const runEffect = (name, ...args) => requiredEffects[name](...args);

    runEffect("resetLayerResolverCache");
    runEffect("resetPhysicalLandClipPathCache");
    runEffect("resetExactRefreshOptimizationState");
    runEffect("bumpTopologyRevision");
    runEffect("resetHitCanvasTopologyRevision");
    runEffect("clearPendingPoliticalColorEdit", {
      force: true,
      resetReason: reason,
      paintSource: reason,
    });
    runEffect("clearRenderPassReferenceTransforms");
    runEffect("clearLastGoodFrame", reason);
    runEffect("invalidateInteractionComposite", reason);
    runEffect("resetFirstVisibleFramePainted", reason);
    runEffect("setRenderPassPerfOverlayEnabled", requiredGetters.isPerfOverlayEnabled());
    runEffect("ensureLayerDataFromTopology");
    runEffect("rebuildPoliticalLandCollections");
    runEffect("applyRendererSurfaceBridgeState");

    runEffect("ensureSovereigntyState");
    runEffect("normalizeColorStateForRender");
    runEffect("setDebugMode", debugMode);
    runEffect("resetRenderDiagnostics");
    runEffect("clearRenderPhaseTimer");
    runEffect("resetRenderPhaseState");
    runEffect("resetTooltipState");
    runEffect("cancelScheduledHoverOverlayRender");
    runEffect("markAllOverlaysDirty");
    runEffect("clearStagedMapDataTasks");
    runEffect("cancelExactAfterSettleRefresh");
    runEffect("cancelPendingIndexUiRefresh");
    runEffect("resetDeferredRenderFlags");
    runEffect("resetProjectedBoundsCacheState");
    runEffect("invalidateAllRenderPasses", reason);
    runEffect("syncDayNightClockTimerBridge");
  }

  return Object.freeze({
    runInitMapResetTransaction,
  });
}

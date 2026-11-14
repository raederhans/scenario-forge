import { requireFunction } from "../renderer/require_named_function.js";
const DEFAULT_REASON = "renderer-transaction-reset";
const REFRESH_RESET_REASON = "renderer-refresh-reset";
const TOPOLOGY_CHANGED_REASON = "renderer-topology-changed";

const REQUIRED_EFFECT_NAMES = Object.freeze([
  "clearPendingDynamicBorderTimer",
  "clearRenderPhaseTimer",
  "cancelPendingIndexUiRefresh",
  "cancelPendingSidebarRefresh",
  "cancelScheduledHoverOverlayRender",
  "setRenderPhaseIdle",
  "resetRenderDiagnostics",
  "clearStagedMapDataTasks",
  "cancelExactAfterSettleRefresh",
  "cancelScheduledHitCanvasBuild",
  "cancelSecondarySpatialBuild",
  "setDeferContextBasePass",
  "setDeferHitCanvasBuild",
  "setDeferExactAfterSettle",
  "resetLayerResolverCache",
  "resetDevInteractionState",
  "resetDevClipboardState",
  "resetPhysicalLandClipPathCache",
  "resetExactRefreshOptimizationState",
  "resetVisibleInternalBorderMeshSignature",
  "bumpTopologyRevision",
  "setHitCanvasDirty",
  "resetHitCanvasTopologyRevision",
]);

function normalizeReason(reason, defaultReason) {
  const normalized = String(reason || "").trim();
  return normalized || defaultReason;
}

function createTrace() {
  return {
    effectOrder: [],
    getterOrder: [],
  };
}

function createSummary({
  reason,
  hitCanvasDirty = false,
  canceledSecondarySpatial = false,
  canceledHitCanvasSchedule = false,
  topologyChanged = false,
  trace,
}) {
  return Object.freeze({
    reason,
    hitCanvasDirty: Boolean(hitCanvasDirty),
    canceledSecondarySpatial: Boolean(canceledSecondarySpatial),
    canceledHitCanvasSchedule: Boolean(canceledHitCanvasSchedule),
    topologyChanged: Boolean(topologyChanged),
    effectOrder: Object.freeze([...(trace?.effectOrder || [])]),
    getterOrder: Object.freeze([...(trace?.getterOrder || [])]),
  });
}

export function createRendererTransactionResetOwner({ state = {}, effects = {}, getters = {} } = {}) {
  void state;
  void getters;
  const effectApi = Object.fromEntries(
    REQUIRED_EFFECT_NAMES.map((name) => [name, requireFunction(effects, name, "effects")]),
  );

  function runEffect(trace, name, ...args) {
    trace.effectOrder.push(name);
    return effectApi[name](...args);
  }

  function resetRendererRefreshTransactionState({
    cancelHoverOverlay = false,
    cancelSecondarySpatialBuild = false,
    reason = REFRESH_RESET_REASON,
  } = {}) {
    const trace = createTrace();
    const normalizedReason = normalizeReason(reason, REFRESH_RESET_REASON);

    runEffect(trace, "clearPendingDynamicBorderTimer");
    runEffect(trace, "clearRenderPhaseTimer");
    runEffect(trace, "cancelPendingIndexUiRefresh");
    runEffect(trace, "cancelPendingSidebarRefresh");
    if (cancelHoverOverlay) {
      runEffect(trace, "cancelScheduledHoverOverlayRender");
    }
    runEffect(trace, "setRenderPhaseIdle");
    runEffect(trace, "resetRenderDiagnostics");
    runEffect(trace, "clearStagedMapDataTasks");
    runEffect(trace, "cancelExactAfterSettleRefresh");
    const hitCanvasSummary = runEffect(trace, "cancelScheduledHitCanvasBuild", {
      reason: REFRESH_RESET_REASON,
    });
    const canceledHitCanvasSchedule = Boolean(hitCanvasSummary?.canceled);
    const canceledSecondarySpatial = cancelSecondarySpatialBuild
      ? runEffect(trace, "cancelSecondarySpatialBuild") !== false
      : false;
    runEffect(trace, "setDeferContextBasePass", false);
    runEffect(trace, "setDeferHitCanvasBuild", false);
    runEffect(trace, "setDeferExactAfterSettle", false);
    runEffect(trace, "resetLayerResolverCache");
    runEffect(trace, "resetDevInteractionState");
    runEffect(trace, "resetDevClipboardState");
    runEffect(trace, "resetPhysicalLandClipPathCache");

    return createSummary({
      reason: normalizedReason,
      canceledSecondarySpatial,
      canceledHitCanvasSchedule,
      trace,
    });
  }

  function markRendererTopologyChanged({
    hitCanvasDirty = false,
    reason = TOPOLOGY_CHANGED_REASON,
  } = {}) {
    const trace = createTrace();
    const normalizedReason = normalizeReason(reason, TOPOLOGY_CHANGED_REASON);

    runEffect(trace, "resetExactRefreshOptimizationState");
    runEffect(trace, "resetVisibleInternalBorderMeshSignature");
    runEffect(trace, "bumpTopologyRevision");
    if (hitCanvasDirty) {
      runEffect(trace, "setHitCanvasDirty", true);
    }
    runEffect(trace, "resetHitCanvasTopologyRevision");

    return createSummary({
      reason: normalizedReason,
      hitCanvasDirty,
      topologyChanged: true,
      trace,
    });
  }

  function resetRendererTransactionState({
    cancelSecondarySpatialBuild = false,
    cancelHoverOverlayRender = false,
    hitCanvasDirty = false,
    reason = DEFAULT_REASON,
  } = {}) {
    const normalizedReason = normalizeReason(reason, DEFAULT_REASON);
    const refreshSummary = resetRendererRefreshTransactionState({
      cancelHoverOverlay: cancelHoverOverlayRender,
      cancelSecondarySpatialBuild,
      reason: REFRESH_RESET_REASON,
    });
    const topologySummary = markRendererTopologyChanged({
      hitCanvasDirty,
      reason: TOPOLOGY_CHANGED_REASON,
    });
    const trace = createTrace();
    trace.effectOrder.push(...refreshSummary.effectOrder, ...topologySummary.effectOrder);
    trace.getterOrder.push(...refreshSummary.getterOrder, ...topologySummary.getterOrder);

    return createSummary({
      reason: normalizedReason,
      hitCanvasDirty,
      canceledSecondarySpatial: refreshSummary.canceledSecondarySpatial,
      canceledHitCanvasSchedule: refreshSummary.canceledHitCanvasSchedule,
      topologyChanged: topologySummary.topologyChanged,
      trace,
    });
  }

  return Object.freeze({
    resetRendererTransactionState,
    resetRendererRefreshTransactionState,
    markRendererTopologyChanged,
  });
}

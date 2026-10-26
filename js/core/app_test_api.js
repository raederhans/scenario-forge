// Stable, read-only test surface for end-to-end tests (tests/e2e/golden/).
//
// Golden flows talk to the app only through the DOM and this object, never through
// internal state fields. When the state model or renderer is rewritten, re-implement
// these few functions and the golden tests keep proving the same user behavior.
// Keep it small: add a query only when a golden flow needs it.

import { state } from "./state.js";
import { getPoliticalIdRasterDiagnostics } from "./map_renderer/public.js";

const API_VERSION = 2;

function chunkIdle(loadState) {
  return !loadState.pendingPromotion
    && !loadState.promotionScheduled
    && !loadState.refreshScheduled
    && !loadState.promotionCommitInFlight
    && !loadState.pendingVisualPromotion
    && !loadState.pendingInfraPromotion;
}

function renderIdle() {
  return String(state.renderPhase || "idle") === "idle"
    && !state.deferExactAfterSettle
    && !state.exactAfterSettleHandle
    && !state.zoomRenderScheduled
    && !state.pendingZoomTransform
    && !state.renderPhaseTimerId;
}

let rendererModule = null;

// The GPU raster path presents frames asynchronously after the render phase reports idle.
// Pixels are stable only once no raster work is pending and the presented view matches the zoom.
function rasterPresented() {
  const raster = getPoliticalIdRasterDiagnostics();
  if (!raster?.selected) return true;
  if (raster.displayState === "preparing" || raster.pending || raster.stagedPending || raster.refinementPending) return false;
  if (raster.gpu?.pendingFrameReady || raster.gpuPreparation?.pending) return false;
  if (raster.actualBackend !== "raster") return true;
  const view = raster.scene?.view;
  const zoom = state.zoomTransform || {};
  return !!view
    && Math.abs(view.k - (zoom.k ?? 1)) < 1e-6
    && Math.abs(view.x - (zoom.x ?? 0)) < 0.5
    && Math.abs(view.y - (zoom.y ?? 0)) < 0.5;
}

function status() {
  const loadState = state.runtimeChunkLoadState || {};
  const interactive = state.bootBlocking === false
    && !state.scenarioApplyInFlight
    && !state.startupReadonlyUnlockInFlight;
  // A blank base map has land but no assigned colors, so colors are not required.
  const mapReady = (state.landData?.features?.length || 0) > 0;
  const pipelineIdle = interactive && mapReady && chunkIdle(loadState) && renderIdle();
  return {
    bootError: String(state.bootError || ""),
    scenarioId: String(state.activeScenarioId || ""),
    phase: String(state.bootPhase || ""),
    blocking: state.bootBlocking !== false,
    startupReadonly: !!state.startupReadonly,
    viewable: !!state.firstVisibleFramePainted && state.bootBlocking === false,
    // Editing is allowed (startup may open read-only until full data arrives).
    editable: interactive && !state.startupReadonly,
    interactive,
    viewport: {
      x: Number(state.zoomTransform?.x || 0),
      y: Number(state.zoomTransform?.y || 0),
      k: Number(state.zoomTransform?.k || 1),
      bounds: state.getViewportGeoBoundsFn?.() || null,
    },
    chunks: {
      idle: chunkIdle(loadState),
      pendingReason: String(loadState.pendingReason || ""),
      requiredChunkIds: [...(loadState.lastSelection?.requiredChunkIds || [])],
      loadedChunkIds: [...(state.activeScenarioChunks?.loadedChunkIds || [])],
      viewportBounds: loadState.lastSelection?.viewportBbox || null,
    },
    // Everything that affects pixels has settled: data, chunks, render passes and GPU presentation.
    settled: pipelineIdle && rasterPresented(),
  };
}

async function screenPointForLonLat(lon, lat) {
  rendererModule ||= await import("./map_renderer.js");
  const xy = rendererModule.projectGeoToScreen(lon, lat);
  const container = document.querySelector("#mapContainer");
  if (!Array.isArray(xy) || !container) return null;
  const rect = container.getBoundingClientRect();
  return { x: rect.left + xy[0], y: rect.top + xy[1] };
}

function editedFeatureColors() {
  return { ...(state.visualOverrides || {}) };
}

function history() {
  return {
    undo: Array.isArray(state.historyPast) ? state.historyPast.length : 0,
    redo: Array.isArray(state.historyFuture) ? state.historyFuture.length : 0,
  };
}

function isDirty() {
  return !!state.isDirty;
}

function selection() {
  return {
    currentTool: state.currentTool,
    selectedInspectorCountryCode: state.selectedInspectorCountryCode,
    selectedWaterRegionId: state.selectedWaterRegionId,
    selectedSpecialRegionId: state.selectedSpecialRegionId,
  };
}

// NOT part of the stable contract above. Release and raster diagnostics still inspect
// internals; on a bundled build, importing ./js/core/*.js by URL would load a second,
// unused copy of each module, so they get the live instances from here instead.
async function internals() {
  const [renderer, rasterTrial, interactionFunnel, scenarioDispatcher, scenarioManager] = await Promise.all([
    import("./map_renderer.js"),
    import("./renderer/political_id_raster_trial.js"),
    import("./interaction_funnel.js"),
    import("./scenario_dispatcher.js"),
    import("./scenario_manager.js"),
  ]);
  return { state, renderer, rasterTrial, interactionFunnel, scenarioDispatcher, scenarioManager };
}

export function installAppTestApi(target = globalThis) {
  target.__scenarioForgeTestApi = Object.freeze({
    version: API_VERSION,
    status,
    screenPointForLonLat,
    editedFeatureColors,
    history,
    isDirty,
    selection,
    internals,
  });
}

installAppTestApi();

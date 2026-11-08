// Stable, read-only test surface for end-to-end tests (tests/e2e/golden/).
//
// Golden flows talk to the app only through the DOM and this object, never through
// internal state fields. When the state model or renderer is rewritten, re-implement
// these few functions and the golden tests keep proving the same user behavior.
// Keep it small: add a query only when a golden flow needs it.

import { state } from "./state.js";
import { getCountryLabelReadiness, getPoliticalIdRasterDiagnostics, getVisibleMapLabels } from "./map_renderer/public.js";
import { hasPendingPanelRefresh } from "./state/changes.js";

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

// Country names are fitted asynchronously and their source is rebuilt when late data
// (full bundle, localization) arrives after the map settles. Names are pixels too.
// A failed source or layout worker never becomes ready, so it does not hold settled.
function labelsSettled() {
  const readiness = getCountryLabelReadiness();
  if (!readiness.expected || readiness.ready) return true;
  if (readiness.sourceStatus === "error" || readiness.sourceStatus === "disposed") return true;
  return (Number(readiness.workerErrors) || 0) > 0;
}

// The GPU raster path presents frames asynchronously after the render phase reports idle.
// Pixels are stable only once no raster work is pending and the presented view matches the zoom.
function rasterPresented() {
  const raster = getPoliticalIdRasterDiagnostics();
  if (!raster?.selected) return true;
  if (raster.displayState === "preparing" || raster.pending || raster.stagedPending || raster.refinementPending) return false;
  if (raster.gpu?.pendingFrameReady || raster.gpuPreparation?.pending) return false;
  if (raster.actualBackend !== "raster") return true;
  // The direct GPU scene prepares borders, physical relief and water privately and
  // publishes them later; the render loop is already idle while they are pending.
  if (raster.scene?.active) {
    if (raster.scene.publicationPending || raster.scene.physicalCanvas?.pending) return false;
    // A moving-view frame may leave pass edges empty until the exact frame refills them.
    if (raster.scene.partialPasses) return false;
    if (raster.borderPreparation?.pending || raster.asyncWork?.borderScheduled) return false;
    if (raster.waterPreparation?.pending) return false;
    if (state.renderPassCache?.dirty?.borders) return false;
  }
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
    // The first map frame is on screen (startup may still be blocking input).
    firstFramePainted: !!state.firstVisibleFramePainted,
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
    // Work that may still land after `settled`: full bundle hydration and its health gate,
    // and the deferred detail-topology promotion.
    background: {
      detailPending: !!state.detailPromotionInFlight || !!state.detailDeferred,
      healthGate: String(state.scenarioHydrationHealthGate?.status || "idle"),
      fatalRecovery: !!state.scenarioFatalRecovery,
    },
    // Everything that affects pixels has settled: data, chunks, render passes and GPU presentation.
    // Panels refresh after paint; they are part of the settled UI too.
    settled: pipelineIdle && rasterPresented() && labelsSettled() && !hasPendingPanelRefresh(),
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

// City IDs and country codes whose names are drawn in the visible map area.
function labels() {
  return getVisibleMapLabels();
}

// "raster" when political regions are drawn from GPU ID tiles, otherwise "vector".
function politicalBackend() {
  const raster = getPoliticalIdRasterDiagnostics();
  return raster?.selected && raster.actualBackend === "raster" ? "raster" : "vector";
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
    labels,
    politicalBackend,
    internals,
  });
}

installAppTestApi();

// Strategic overlay render scheduler owner.
import { setStrategicOverlayDirtyState } from "../state/actions/strategic_overlay_actions.js";
import { setSpecialZonesOverlayDirtyState } from "../state/actions/special_zone_actions.js";

export function createStrategicOverlayRenderOwner({
  state,
  constants = {},
  helpers = {},
  renderers = {},
} = {}) {
  const {
    defaultUnitCounterRenderer = "game",
    renderPhaseIdle = "idle",
  } = constants;
  const {
    getProjectionRenderSignature = () => "",
  } = helpers;
  const {
    renderOperationGraphicsOverlay = () => {},
    renderOperationalLinesOverlay = () => {},
    renderSpecialZones = () => {},
    renderUnitCountersOverlay = () => {},
    syncUnitCounterScalesDuringZoom: syncUnitCounterScalesDuringZoomRaw = () => {},
  } = renderers;

  let lastSpecialZonesOverlaySignature = "";
  let lastOperationalLinesOverlaySignature = "";
  let lastOperationGraphicsOverlaySignature = "";
  let lastUnitCountersOverlaySignature = "";

  function markOverlaysDirty({
    operationalLines = false,
    operationGraphics = false,
    unitCounters = false,
    specialZones = false,
  } = {}) {
    if (operationalLines) setStrategicOverlayDirtyState(state, "operationalLinesDirty", true);
    if (operationGraphics) setStrategicOverlayDirtyState(state, "operationGraphicsDirty", true);
    if (unitCounters) setStrategicOverlayDirtyState(state, "unitCountersDirty", true);
    if (specialZones) setSpecialZonesOverlayDirtyState(state, true);
  }

  function markAllOverlaysDirty() {
    markOverlaysDirty({
      operationalLines: true,
      operationGraphics: true,
      unitCounters: true,
      specialZones: true,
    });
  }

  function getOverlayProjectionSignature() {
    return [
      Number(state.topologyRevision || 0),
      getProjectionRenderSignature(),
    ].join("::");
  }

  function getOperationalLinesOverlaySignature() {
    return [
      getOverlayProjectionSignature(),
      Number(state.dirtyRevision || 0),
      Number(state.zoomTransform?.k || 1).toFixed(3),
      Array.isArray(state.operationalLines) ? state.operationalLines.length : 0,
      !!state.operationalLineEditor?.active ? "1" : "0",
      Array.isArray(state.operationalLineEditor?.points) ? state.operationalLineEditor.points.length : 0,
      String(state.operationalLineEditor?.selectedId || ""),
    ].join("::");
  }

  function getSpecialZonesOverlaySignature() {
    return [
      getOverlayProjectionSignature(),
      Number(state.dirtyRevision || 0),
      state.showSpecialZones ? "1" : "0",
      Array.isArray(state.scenarioSpecialRegionsData?.features) ? state.scenarioSpecialRegionsData.features.length : 0,
      Array.isArray(state.manualSpecialZones?.features) ? state.manualSpecialZones.features.length : 0,
      !!state.specialZoneEditor?.active ? "1" : "0",
      String(state.specialZoneEditor?.selectedId || ""),
      String(state.specialZoneEditor?.zoneType || ""),
      String(state.specialZoneEditor?.label || ""),
      Array.isArray(state.specialZoneEditor?.vertices) ? state.specialZoneEditor.vertices.length : 0,
    ].join("::");
  }

  function getOperationGraphicsOverlaySignature() {
    return [
      getOverlayProjectionSignature(),
      Number(state.dirtyRevision || 0),
      Number(state.zoomTransform?.k || 1).toFixed(3),
      Array.isArray(state.operationGraphics) ? state.operationGraphics.length : 0,
      !!state.operationGraphicsEditor?.active ? "1" : "0",
      Array.isArray(state.operationGraphicsEditor?.points) ? state.operationGraphicsEditor.points.length : 0,
      String(state.operationGraphicsEditor?.selectedId || ""),
    ].join("::");
  }

  function getUnitCountersOverlaySignature() {
    return [
      getOverlayProjectionSignature(),
      Number(state.dirtyRevision || 0),
      Number(state.zoomTransform?.k || 1).toFixed(3),
      Array.isArray(state.unitCounters) ? state.unitCounters.length : 0,
      String(state.annotationView?.unitRendererDefault || defaultUnitCounterRenderer),
      state.annotationView?.showUnitLabels ? "1" : "0",
      !!state.unitCounterEditor?.active ? "1" : "0",
      String(state.unitCounterEditor?.selectedId || ""),
    ].join("::");
  }

  function renderSpecialZonesIfNeeded({ force = false } = {}) {
    const nextSignature = getSpecialZonesOverlaySignature();
    if (!force && !state.specialZonesOverlayDirty && nextSignature === lastSpecialZonesOverlaySignature) {
      return false;
    }
    renderSpecialZones();
    setSpecialZonesOverlayDirtyState(state, false);
    lastSpecialZonesOverlaySignature = nextSignature;
    return true;
  }

  function renderOperationGraphicsIfNeeded({ force = false } = {}) {
    if (!force && !state.operationGraphicsDirty && state.renderPhase !== renderPhaseIdle) {
      return false;
    }
    const nextSignature = getOperationGraphicsOverlaySignature();
    if (!force && !state.operationGraphicsDirty && nextSignature === lastOperationGraphicsOverlaySignature) {
      return false;
    }
    renderOperationGraphicsOverlay();
    setStrategicOverlayDirtyState(state, "operationGraphicsDirty", false);
    lastOperationGraphicsOverlaySignature = nextSignature;
    return true;
  }

  function renderOperationalLinesIfNeeded({ force = false } = {}) {
    if (!force && !state.operationalLinesDirty && state.renderPhase !== renderPhaseIdle) {
      return false;
    }
    const nextSignature = getOperationalLinesOverlaySignature();
    if (!force && !state.operationalLinesDirty && nextSignature === lastOperationalLinesOverlaySignature) {
      return false;
    }
    renderOperationalLinesOverlay();
    setStrategicOverlayDirtyState(state, "operationalLinesDirty", false);
    lastOperationalLinesOverlaySignature = nextSignature;
    return true;
  }

  function renderUnitCountersIfNeeded({ force = false } = {}) {
    if (!force && !state.unitCountersDirty && state.renderPhase !== renderPhaseIdle) {
      return false;
    }
    const nextSignature = getUnitCountersOverlaySignature();
    if (!force && !state.unitCountersDirty && nextSignature === lastUnitCountersOverlaySignature) {
      return false;
    }
    renderUnitCountersOverlay();
    setStrategicOverlayDirtyState(state, "unitCountersDirty", false);
    lastUnitCountersOverlaySignature = nextSignature;
    return true;
  }

  function syncUnitCounterScalesDuringZoom() {
    const needsMaterialization = syncUnitCounterScalesDuringZoomRaw() === true;
    if (!needsMaterialization) return false;
    return renderUnitCountersIfNeeded({ force: true });
  }

  return {
    markAllOverlaysDirty,
    markOverlaysDirty,
    renderOperationGraphicsIfNeeded,
    renderOperationalLinesIfNeeded,
    renderSpecialZonesIfNeeded,
    renderUnitCountersIfNeeded,
    syncUnitCounterScalesDuringZoom,
  };
}

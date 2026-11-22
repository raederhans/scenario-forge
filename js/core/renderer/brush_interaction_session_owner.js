import { isMapPointPickActive } from "../map_point_picker.js";
import { applyFeaturePaintState } from "../state/color_state.js";
import { restoreRiverPaintOverridesState } from "../state/actions/river_paint_actions.js";

export function isBrushPanGesture(state, event) {
  return !!(state.brushModeEnabled && (isMapPointPickActive(state) || event?.shiftKey || state.brushPanModifierActive));
}

export function createBrushInteractionSessionOwner(runtimeState, {
  getBrushSession,
  setBrushSession,
  suppressNextClick,
  getContext,
  nowMs,
  captureHistoryState,
  pushHistoryEntry,
  addRecentColor,
  markDirty,
  refreshSidebarAfterPaint,
  requestRendererRender,
  flushBrushPatchPreview,
  cancelBrushPatchPreview,
  refreshColorState,
  noteRenderAction,
  getHitFromEvent,
  getStrategicOverlayRuntimeOwner,
  getSpecialZoneMembershipTool,
  getSpecialZoneMembershipBrushMode,
  blockStartupReadonlyInteraction,
  handlePhysicalIntensityPointerDown,
  handlePhysicalIntensityPointerMove,
  isBrushNavigationModifier,
  applyBrushHit,
  requestInteractionRender,
}) {
  function ensureBrushSession(event) {
    let brushSession = getBrushSession();
    if (brushSession) return brushSession;
    brushSession = {
      active: true,
      pointerId: event.pointerId,
      dragging: false,
      startX: Number(event?.clientX || 0),
      startY: Number(event?.clientY || 0),
      lastX: Number(event.clientX || 0),
      lastY: Number(event.clientY || 0),
      visitedFeatureIds: new Set(),
      visitedRiverCellIds: new Set(),
      affectedRiverCellIds: new Set(),
      riverParentIds: new Set(),
      visitedWaterRegionIds: new Set(),
      visitedSpecialRegionIds: new Set(),
      affectedFeatureIds: new Set(),
      affectedWaterRegionIds: new Set(),
      affectedSpecialRegionIds: new Set(),
      before: {},
      changed: false,
    };
    setBrushSession(brushSession);
    return brushSession;
  }

  function cancelBrushSession() {
    const current = getBrushSession();
    if (!current) return;
    cancelBrushPatchPreview();
    setBrushSession(null);
    suppressNextClick();
    if (!current.changed) return;
    for (const [id, color] of Object.entries(current.before.visualOverrides || {})) {
      applyFeaturePaintState(runtimeState, [id], color, { remove: color === null });
    }
    restoreRiverPaintOverridesState(runtimeState, current.before.riverPaintOverrides);
    for (const [id, color] of Object.entries(current.before.waterRegionOverrides || {})) {
      if (color === null) delete runtimeState.waterRegionOverrides[id];
      else runtimeState.waterRegionOverrides[id] = color;
    }
    refreshColorState({ renderNow: false });
    requestRendererRender("brush-cancel", { flush: true });
  }

  function handleBrushPointerEnd(event) {
    const current = getBrushSession();
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.type === "pointercancel" || event.type === "lostpointercapture") cancelBrushSession();
    else flushBrushSession();
  }

  function flushBrushSession() {
    const actionStart = nowMs();
    const current = getBrushSession();
    if (!current) return;
    flushBrushPatchPreview?.(current);
    setBrushSession(null);
    if (current.dragging) {
      suppressNextClick();
    }
    if (!current.dragging || !current.changed) return;
    const featureIds = Array.from(current.affectedFeatureIds);
    const waterRegionIds = Array.from(current.affectedWaterRegionIds);
    const specialRegionIds = Array.from(current.affectedSpecialRegionIds);
    const riverCellIds = Array.from(current.affectedRiverCellIds || []);
    const after = captureHistoryState({ featureIds, waterRegionIds, specialRegionIds, ...(riverCellIds.length ? { riverCellIds } : {}) });
    pushHistoryEntry({
      kind: runtimeState.currentTool === "eraser" ? "brush-erase" : "brush-fill",
      before: current.before,
      after,
      meta: {
        affectsSovereignty: false,
      },
    });
    if (runtimeState.currentTool !== "eyedropper") {
      addRecentColor(runtimeState.selectedColor);
    }
    markDirty("brush-stroke");
    refreshSidebarAfterPaint({
      featureIds: [...new Set([...featureIds, ...(current.riverParentIds || [])])],
      waterRegionIds,
      specialRegionIds,
    });
    requestRendererRender("brush-stroke", { flush: true });
    noteRenderAction("brush-stroke", actionStart);
  }

  function applySpecialZoneMembershipDragHit(event) {
    const hit = getHitFromEvent(event, {
      enableSnap: false,
      snapPx: 0,
      eventType: "special-zone-membership-drag",
    });
    const featureId = hit?.targetType === "land" ? String(hit.id || "").trim() : "";
    if (!featureId || !runtimeState.landIndex?.has(featureId)) return false;
    return getStrategicOverlayRuntimeOwner().applySpecialZoneMembershipDragFeature(featureId);
  }

  function flushSpecialZoneMembershipDragSession() {
    const result = getStrategicOverlayRuntimeOwner().finishSpecialZoneMembershipDrag();
    if (result?.active) suppressNextClick();
  }

  function handleSpecialZoneMembershipPointerDown(event) {
    if (runtimeState.currentTool !== "special-zone-membership") return false;
    const membershipTool = getSpecialZoneMembershipTool();
    if (membershipTool !== "brush" && !event?.shiftKey && !event?.altKey) return false;
    if ((event.buttons & 1) !== 1) return true;
    const started = getStrategicOverlayRuntimeOwner().beginSpecialZoneMembershipDrag({
      membershipTool,
      brushMode: getSpecialZoneMembershipBrushMode(),
      altKey: !!event?.altKey,
    });
    if (!started) return true;
    if (event?.preventDefault) event.preventDefault();
    applySpecialZoneMembershipDragHit(event);
    return true;
  }

  function handleBrushPointerDown(event) {
    if (isMapPointPickActive(runtimeState)) return;
    if (runtimeState.startupReadonly) {
      if (event?.preventDefault) event.preventDefault();
      blockStartupReadonlyInteraction();
      return;
    }
    if (handlePhysicalIntensityPointerDown(event)) return;
    if (handleSpecialZoneMembershipPointerDown(event)) return;
    if (event.altKey && (runtimeState.currentTool === "fill" || runtimeState.currentTool === "eraser")) return;
    if (runtimeState.mapLabelEditor?.active || !runtimeState.brushModeEnabled || runtimeState.currentTool === "eyedropper" || runtimeState.currentTool === "select" || runtimeState.specialZoneEditor?.active) return;
    if (isBrushNavigationModifier(event)) return;
    if ((event.buttons & 1) !== 1) return;
    if (event?.preventDefault) event.preventDefault();
    const current = ensureBrushSession(event);
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      current.dragging = true;
      handleBrushPointerMove(event);
    }
  }

  function handleBrushPointerMove(event) {
    if (isMapPointPickActive(runtimeState) || runtimeState.startupReadonly) {
      return;
    }
    const current = getBrushSession();
    if (current && current.pointerId !== event.pointerId && !(current.pointerId == null && event.pointerType === "mouse")) return;
    if (handlePhysicalIntensityPointerMove(event)) return;
    if (getStrategicOverlayRuntimeOwner().hasSpecialZoneMembershipDragSession()) {
      if ((event.buttons & 1) !== 1) {
        flushSpecialZoneMembershipDragSession();
        return;
      }
      if (applySpecialZoneMembershipDragHit(event)) {
        requestInteractionRender("special-zone-membership-drag");
      }
      return;
    }
    const brushSession = getBrushSession();
    if (!brushSession || runtimeState.mapLabelEditor?.active || !runtimeState.brushModeEnabled || runtimeState.currentTool === "eyedropper" || runtimeState.currentTool === "select" || runtimeState.specialZoneEditor?.active) {
      return;
    }
    if ((event.buttons & 1) !== 1) {
      flushBrushSession();
      return;
    }
    if (isBrushNavigationModifier(event)) {
      brushSession.lastX = event.clientX;
      brushSession.lastY = event.clientY;
      return;
    }
    const samples = event.getCoalescedEvents?.() || [];
    if (!brushSession.dragging) {
      const beyondThreshold = point => Math.hypot(point.clientX - brushSession.startX, point.clientY - brushSession.startY) > 3;
      if (!beyondThreshold(event) && !samples.some(beyondThreshold)) return;
    }
    let remaining = 64;
    let changed = false;
    function paint(point) {
      const hit = getHitFromEvent(point, { enableSnap: false, snapPx: 0, eventType: "brush" });
      if (hit?.id && applyBrushHit(hit)) changed = true;
      remaining--;
    }
    if (!brushSession.dragging) paint({ clientX: brushSession.lastX, clientY: brushSession.lastY });
    brushSession.dragging = true;
    const count = Math.min(samples.length + 1, remaining);
    for (let i = 1; i <= count; i++) {
      const point = i === count ? event : samples[Math.floor((i - 1) * samples.length / (count - 1))];
      const x = point.clientX - brushSession.lastX;
      const y = point.clientY - brushSession.lastY;
      const steps = Math.min(remaining - (count - i), Math.max(1, Math.ceil(Math.hypot(x, y) / 4)));
      for (let step = 1; step < steps; step++) {
        paint({ clientX: brushSession.lastX + x * step / steps, clientY: brushSession.lastY + y * step / steps });
      }
      paint(point);
      brushSession.lastX = point.clientX;
      brushSession.lastY = point.clientY;
    }
    if (changed && getContext()) requestInteractionRender("brush-preview");
  }

  return Object.freeze({
    cancelBrushSession,
    handleBrushPointerEnd,
    flushBrushSession,
    flushSpecialZoneMembershipDragSession,
    handleBrushPointerDown,
    handleBrushPointerMove,
  });
}

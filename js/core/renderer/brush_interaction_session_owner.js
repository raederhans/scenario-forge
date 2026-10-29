import { applyFeaturePaintState } from "../state/color_state.js";
import { restoreRiverPaintOverridesState } from "../state/actions/river_paint_actions.js";

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
    if (runtimeState.startupReadonly) {
      if (event?.preventDefault) event.preventDefault();
      blockStartupReadonlyInteraction();
      return;
    }
    if (handlePhysicalIntensityPointerDown(event)) return;
    if (handleSpecialZoneMembershipPointerDown(event)) return;
    if (!runtimeState.brushModeEnabled || runtimeState.currentTool === "eyedropper" || runtimeState.currentTool === "select" || runtimeState.specialZoneEditor?.active) return;
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
    if (runtimeState.startupReadonly) {
      return;
    }
    const current = getBrushSession();
    if (current && current.pointerId !== event.pointerId) return;
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
    if (!brushSession || !runtimeState.brushModeEnabled || runtimeState.currentTool === "eyedropper" || runtimeState.currentTool === "select" || runtimeState.specialZoneEditor?.active) {
      return;
    }
    if ((event.buttons & 1) !== 1) {
      flushBrushSession();
      return;
    }
    const dx = Number(event.clientX || 0) - brushSession.startX;
    const dy = Number(event.clientY || 0) - brushSession.startY;
    if (!brushSession.dragging && Math.hypot(dx, dy) <= 3) return;
    brushSession.dragging = true;
    const hit = getHitFromEvent(event, {
      enableSnap: false,
      snapPx: 0,
      eventType: "brush",
    });
    if (!hit?.id) return;
    if (applyBrushHit(hit) && getContext()) {
      requestInteractionRender("brush-preview");
    }
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

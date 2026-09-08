export function createBrushInteractionSessionOwner(runtimeState, {
  getBrushSession,
  setBrushSession,
  suppressNextClick,
  getContext,
  nowMs,
  captureHistoryState,
  pushHistoryEntry,
  isSovereigntyModeActive,
  addRecentColor,
  markDirty,
  refreshSidebarAfterPaint,
  requestRendererRender,
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
      dragging: false,
      startX: Number(event?.clientX || 0),
      startY: Number(event?.clientY || 0),
      visitedFeatureIds: new Set(),
      visitedWaterRegionIds: new Set(),
      visitedSpecialRegionIds: new Set(),
      visitedOwnerCodes: new Set(),
      affectedFeatureIds: new Set(),
      affectedWaterRegionIds: new Set(),
      affectedSpecialRegionIds: new Set(),
      affectedOwnerCodes: new Set(),
      affectedSovereigntyIds: new Set(),
      before: {},
      changed: false,
    };
    setBrushSession(brushSession);
    return brushSession;
  }

  function flushBrushSession() {
    const actionStart = nowMs();
    const current = getBrushSession();
    if (!current) return;
    setBrushSession(null);
    if (current.dragging) {
      suppressNextClick();
    }
    if (!current.dragging || !current.changed) return;
    const featureIds = Array.from(current.affectedFeatureIds);
    const waterRegionIds = Array.from(current.affectedWaterRegionIds);
    const specialRegionIds = Array.from(current.affectedSpecialRegionIds);
    const ownerCodes = Array.from(current.affectedOwnerCodes);
    const sovereigntyFeatureIds = Array.from(current.affectedSovereigntyIds);
    const after = captureHistoryState({ featureIds, waterRegionIds, specialRegionIds, ownerCodes, sovereigntyFeatureIds });
    pushHistoryEntry({
      kind: runtimeState.currentTool === "eraser" ? "brush-erase" : "brush-fill",
      before: current.before,
      after,
      meta: {
        affectsSovereignty: isSovereigntyModeActive(),
      },
    });
    if (runtimeState.currentTool !== "eyedropper") {
      addRecentColor(runtimeState.selectedColor);
    }
    markDirty("brush-stroke");
    refreshSidebarAfterPaint({
      featureIds,
      waterRegionIds,
      specialRegionIds,
      ownerCodes,
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
    if (!runtimeState.brushModeEnabled || runtimeState.currentTool === "eyedropper" || runtimeState.specialZoneEditor?.active) return;
    if (isBrushNavigationModifier(event)) return;
    if ((event.buttons & 1) !== 1) return;
    if (event?.preventDefault) event.preventDefault();
    ensureBrushSession(event);
  }

  function handleBrushPointerMove(event) {
    if (runtimeState.startupReadonly) {
      return;
    }
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
    if (!brushSession || !runtimeState.brushModeEnabled || runtimeState.currentTool === "eyedropper" || runtimeState.specialZoneEditor?.active) {
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
    flushBrushSession,
    flushSpecialZoneMembershipDragSession,
    handleBrushPointerDown,
    handleBrushPointerMove,
  });
}

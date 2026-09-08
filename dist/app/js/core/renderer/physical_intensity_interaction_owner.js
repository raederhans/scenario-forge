import { appendIntensityFieldPointState } from "../state/actions/intensity_field_actions.js";

// Channels returned by getPhysicalIntensityChannel are live: brush/point edits mutate them.
// Pointer cancel and lost capture use the same commit route as pointerup.
export function createPhysicalIntensityInteractionOwner({
  runtimeState,
  rendererSurfaceHost,
  getPhysicalIntensityChannel,
  getIntensityFieldTargetPasses,
  invalidateRenderPasses,
  requestInteractionRender,
  refreshPhysicalIntensityUi,
  clamp,
  INTENSITY_FIELD_GRID,
  bakeIntensityComposite,
  captureHistoryState,
  pushHistoryEntry,
  suppressNextClick,
  getMapLonLatFromEvent,
  stampIntensityBrush,
  getIntensityFieldTool,
  blockStartupReadonlyInteraction,
  renderPhysicalIntensityBrushPreview,
  getPhysicalIntensityPointHit,
  setIntensityFieldTool,
  updatePhysicalIntensityBrushPreviewFromEvent,
  requestAnimationFrame = (callback) => globalThis.requestAnimationFrame(callback),
}) {
  let physicalIntensityDragSession = null;
  let physicalIntensityRenderFrame = null;

  function getIntensityFieldPassNames(channelId) {
    const targetPasses = getIntensityFieldTargetPasses(channelId);
    return targetPasses.length ? targetPasses : ["physicalBase"];
  }

  function schedulePhysicalIntensityRender(channelId, reason) {
    invalidateRenderPasses(getIntensityFieldPassNames(channelId), reason);
    if (physicalIntensityRenderFrame !== null) return;
    physicalIntensityRenderFrame = requestAnimationFrame(() => {
      physicalIntensityRenderFrame = null;
      requestInteractionRender(reason);
    });
  }

  function createIntensityPoint(channel, lonLat, tool) {
    const nextIndex = channel.points.length + 1;
    return {
      id: `point-${Date.now().toString(36)}-${nextIndex}`,
      lon: clamp(Number(lonLat[0]) || 0, -180, 180),
      lat: clamp(Number(lonLat[1]) || 0, -90, 90),
      strength: clamp(Number(tool.brushStrength || 1), INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max),
      radiusDeg: clamp(Number(tool.brushRadiusDeg || 3), 0.25, 30),
      falloff: "smooth",
    };
  }

  function commitPhysicalIntensitySession(reason = "physical-intensity-field") {
    const current = physicalIntensityDragSession;
    physicalIntensityDragSession = null;
    if (!current) return false;
    if (rendererSurfaceHost.getInteractionRect()?.node && current.pointerId !== undefined) {
      try {
        rendererSurfaceHost.getInteractionRect().node().releasePointerCapture(current.pointerId);
      } catch (_error) {
        // Pointer capture may already be released by the browser.
      }
    }
    if (!current.changed) return false;
    const channel = getPhysicalIntensityChannel(current.channelId);
    if (current.subMode === "points") {
      bakeIntensityComposite(channel);
    }
    channel.revision = Math.max(0, Math.round(Number(channel.revision) || 0)) + 1;
    const after = captureHistoryState({ intensityFieldChannels: [current.channelId] });
    pushHistoryEntry({
      kind: current.subMode === "points" ? "physical-intensity-point" : "physical-intensity-brush",
      before: current.before,
      after,
      meta: {
        reason,
        affectsIntensityField: true,
      },
    });
    suppressNextClick();
    schedulePhysicalIntensityRender(current.channelId, reason);
    refreshPhysicalIntensityUi();
    return true;
  }

  function applyPhysicalIntensityBrushAt(event) {
    const current = physicalIntensityDragSession;
    if (!current || current.subMode === "points") return false;
    const lonLat = getMapLonLatFromEvent(event);
    if (!lonLat) return false;
    const channel = getPhysicalIntensityChannel(current.channelId);
    channel.enabled = true;
    const dirtyRect = stampIntensityBrush(channel, {
      lon: lonLat[0],
      lat: lonLat[1],
      radiusDeg: current.brushRadiusDeg,
      strength: current.brushStrength,
      mode: current.subMode,
    });
    if (!dirtyRect) return false;
    current.changed = true;
    schedulePhysicalIntensityRender(current.channelId, "physical-intensity-field-drag");
    return true;
  }

  function applyPhysicalIntensityPointDrag(event) {
    const current = physicalIntensityDragSession;
    if (!current || current.subMode !== "points" || !current.pointId) return false;
    const lonLat = getMapLonLatFromEvent(event);
    if (!lonLat) return false;
    const channel = getPhysicalIntensityChannel(current.channelId);
    const point = channel.points.find((entry) => entry.id === current.pointId);
    if (!point) return false;
    if (current.pointDragMode === "radius") {
      const deltaLon = Math.abs(point.lon - lonLat[0]);
      const deltaLat = Math.abs(point.lat - lonLat[1]);
      point.radiusDeg = clamp(Math.hypot(Math.min(deltaLon, 360 - deltaLon), deltaLat), 0.25, 30);
    } else {
      point.lon = clamp(lonLat[0], -180, 180);
      point.lat = clamp(lonLat[1], -90, 90);
    }
    channel.enabled = true;
    current.changed = true;
    schedulePhysicalIntensityRender(current.channelId, "physical-intensity-point-drag");
    refreshPhysicalIntensityUi();
    return true;
  }

  function handlePhysicalIntensityPointerDown(event) {
    const tool = getIntensityFieldTool();
    if (!tool.active) return false;
    if (physicalIntensityDragSession) return true;
    if (runtimeState.startupReadonly) {
      if (event?.preventDefault) event.preventDefault();
      blockStartupReadonlyInteraction();
      return true;
    }
    if ((event.buttons & 1) !== 1) return true;
    const lonLat = getMapLonLatFromEvent(event);
    if (!lonLat) return true;
    renderPhysicalIntensityBrushPreview(lonLat);
    if (event?.preventDefault) event.preventDefault();
    if (rendererSurfaceHost.getInteractionRect()?.node && event.pointerId !== undefined) {
      try {
        rendererSurfaceHost.getInteractionRect().node().setPointerCapture(event.pointerId);
      } catch (_error) {
        // Pointer capture is best-effort across browser targets.
      }
    }
    const channel = getPhysicalIntensityChannel(tool.channelId);
    physicalIntensityDragSession = {
      pointerId: event.pointerId,
      channelId: tool.channelId,
      subMode: tool.subMode,
      brushRadiusDeg: tool.brushRadiusDeg,
      brushStrength: tool.brushStrength,
      before: captureHistoryState({ intensityFieldChannels: [tool.channelId] }),
      changed: false,
      pointId: "",
      pointDragMode: "move",
    };
    if (tool.subMode === "points") {
      const hit = getPhysicalIntensityPointHit(channel, lonLat);
      if (hit?.point) {
        setIntensityFieldTool({ selectedPointId: hit.point.id });
        physicalIntensityDragSession.pointId = hit.point.id;
        physicalIntensityDragSession.pointDragMode = hit.mode;
      } else {
        const point = createIntensityPoint(channel, lonLat, tool);
        appendIntensityFieldPointState(runtimeState, tool.channelId, point);
        setIntensityFieldTool({ selectedPointId: point.id });
        physicalIntensityDragSession.pointId = point.id;
        physicalIntensityDragSession.changed = true;
        schedulePhysicalIntensityRender(tool.channelId, "physical-intensity-point-add");
        refreshPhysicalIntensityUi();
      }
      return true;
    }
    applyPhysicalIntensityBrushAt(event);
    return true;
  }

  function handlePhysicalIntensityPointerMove(event) {
    updatePhysicalIntensityBrushPreviewFromEvent(event);
    if (!physicalIntensityDragSession) return false;
    if ((event.buttons & 1) !== 1) {
      commitPhysicalIntensitySession("physical-intensity-pointer-lost-buttons");
      return true;
    }
    if (event?.preventDefault) event.preventDefault();
    if (physicalIntensityDragSession.subMode === "points") {
      return applyPhysicalIntensityPointDrag(event);
    }
    return applyPhysicalIntensityBrushAt(event);
  }

  function handlePhysicalIntensityPointerEnd(event) {
    if (!physicalIntensityDragSession) return false;
    if (event?.preventDefault) event.preventDefault();
    updatePhysicalIntensityBrushPreviewFromEvent(event);
    commitPhysicalIntensitySession("physical-intensity-field-commit");
    return true;
  }

  return Object.freeze({
    handlePhysicalIntensityPointerDown,
    handlePhysicalIntensityPointerMove,
    handlePhysicalIntensityPointerEnd,
  });
}

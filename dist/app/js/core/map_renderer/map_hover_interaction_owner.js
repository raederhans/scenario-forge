import {
  setClickHoverOverlayDirtyState,
  setHoveredFeatureIdsState,
  setLastMouseMoveTimeState,
  setTooltipPendingState,
  setTooltipRafHandleState,
} from "../state/actions/renderer_interaction_actions.js";

const TOOLTIP_OFFSET_PX = 12;

const REQUIRED_GETTER_NAMES = Object.freeze([
  "nowMs",
  "inspectHgoRuntimePreviewFromEvent",
  "getHitFromEvent",
  "getFeatureForHit",
  "getHoveredFacilityEntryFromEvent",
  "isFacilityDetailsSurfaceActive",
  "getHoveredCityTooltipEntry",
  "getTooltipTextForFeature",
  "getOverlayProjectionSignature",
  "getSelectedFacilityEntry",
  "shouldBlockUnderlyingSelectionForFacility"
]);

const REQUIRED_EFFECT_NAMES = Object.freeze([
  "updateDevHoverHit",
  "renderHoverOverlay",
  "recordInteractionDurationMetric",
  "hidePhysicalIntensityBrushPreview"
]);

const REQUIRED_HELPER_NAMES = Object.freeze(["getFacilityKey"]);

function requireFunction(source, name, label) {
  const candidate = source?.[name];
  if (typeof candidate !== "function") {
    throw new TypeError(`${label}.${name} must be a function.`);
  }
  return candidate;
}

function createApi(source, names, label) {
  return Object.fromEntries(names.map((name) => [name, requireFunction(source, name, label)]));
}

function createSummary({ branch, skipped = false, hit = null, cursor = "", tooltipVisible = false }) {
  return Object.freeze({
    branch,
    skipped: Boolean(skipped),
    hitId: String(hit?.id || ""),
    targetType: String(hit?.targetType || ""),
    cursor: String(cursor || ""),
    tooltipVisible: Boolean(tooltipVisible),
  });
}

function getTooltipPayload(event, text) {
  return { visible: true, text, x: Number(event?.clientX || 0) + TOOLTIP_OFFSET_PX, y: Number(event?.clientY || 0) + TOOLTIP_OFFSET_PX };
}

function normalizeHoverIds(ids = {}) {
  return {
    landId: ids.landId || null,
    waterId: ids.waterId || null,
    specialId: ids.specialId || null,
  };
}

function getNextHoverIds(hit = {}) {
  const id = hit.id || null;
  return normalizeHoverIds({
    landId: hit.targetType === "land" ? id : null,
    waterId: hit.targetType === "water" ? id : null,
    specialId: hit.targetType === "special" ? id : null,
  });
}

export function createMapHoverInteractionOwner({ state = {}, surfaceHost, constants = {}, getters = {}, effects = {}, helpers = {} } = {}) {
  const hoverSnapPx = Number(constants.hoverSnapPx || 0);
  const renderPhaseIdle = constants.renderPhaseIdle || "idle";
  const getterApi = createApi(getters, REQUIRED_GETTER_NAMES, "getters");
  const effectApi = createApi(effects, REQUIRED_EFFECT_NAMES, "effects");
  const helperApi = createApi(helpers, REQUIRED_HELPER_NAMES, "helpers");

  let hoveredFacilityEntry = null;
  let lastHoverOverlaySignature = "";
  let overlayFrame = null;
  let tooltipFrame = null;
  let hoverHitFrame = null;
  let pendingPointer = null;
  const getGlobal = getters.getGlobal || (() => globalThis);

  function scheduleFrame(callback) {
    const host = getGlobal();
    const useRaf = typeof host.requestAnimationFrame === "function" && typeof host.cancelAnimationFrame === "function";
    const request = useRaf ? host.requestAnimationFrame.bind(host) : (fn) => host.setTimeout(fn, 0);
    const cancel = (useRaf ? host.cancelAnimationFrame : host.clearTimeout).bind(host);
    const frame = { handle: null, active: true, cancel() { this.active = false; cancel(this.handle); } };
    frame.handle = request(() => {
      if (!frame.active) return;
      frame.active = false;
      callback();
    });
    return frame;
  }

  function isReducedHoverPhase() {
    return Boolean(state.renderPhase !== renderPhaseIdle || state.isInteracting || state.scenarioApplyInFlight
      || state.startupReadonly || state.startupReadonlyUnlockInFlight);
  }
  function hasHoverIds() {
    return Boolean(state.hoveredId || state.hoveredWaterRegionId || state.hoveredSpecialRegionId);
  }
  function setHoverIds({ landId = null, waterId = null, specialId = null } = {}) {
    setHoveredFeatureIdsState(state, { landId, waterId, specialId });
  }
  function getHoveredFacilityEntry() { return hoveredFacilityEntry; }
  function setHoveredFacilityEntry(entry) { hoveredFacilityEntry = entry || null; }
  function setHoverOverlayDirty(dirty = true) { setClickHoverOverlayDirtyState(state, dirty); }
  function getHoverOverlaySignature() {
    const entry = hoveredFacilityEntry || getterApi.getSelectedFacilityEntry();
    return [
      getterApi.getOverlayProjectionSignature(), String(state.renderPhase || renderPhaseIdle),
      String(state.hoveredId || ""), String(state.hoveredWaterRegionId || ""), String(state.hoveredSpecialRegionId || ""),
      helperApi.getFacilityKey(entry), Number(entry?.projectedPoint?.[0] || 0).toFixed(1), Number(entry?.projectedPoint?.[1] || 0).toFixed(1),
    ].join("::");
  }
  function renderHoverOverlayIfNeeded({ force = false, eventType = "hover" } = {}) {
    const nextSignature = getHoverOverlaySignature();
    if (!force && !state.hoverOverlayDirty && nextSignature === lastHoverOverlaySignature) return;
    const startedAt = getterApi.nowMs();
    effectApi.renderHoverOverlay();
    setHoverOverlayDirty(false);
    lastHoverOverlaySignature = nextSignature;
    effectApi.recordInteractionDurationMetric("interactionHoverOverlayDuration", getterApi.nowMs() - startedAt, { eventType, force: !!force });
  }
  function cancelScheduledHoverOverlayRender() {
    overlayFrame?.cancel();
    overlayFrame = null;
  }
  function scheduleHoverOverlayRender() {
    if (overlayFrame) return;
    overlayFrame = scheduleFrame(() => {
      overlayFrame = null;
      renderHoverOverlayIfNeeded({ eventType: "hover" });
    });
  }
  function applyTooltipState(visible = false, text = "", x = 0, y = 0) {
    const tooltip = surfaceHost.getTooltip();
    if (!tooltip) return;
    tooltip.textContent = visible ? text : "";
    tooltip.style.opacity = visible ? "1" : "0";
    tooltip.style.transform = visible
      ? `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      : "translate3d(-9999px, -9999px, 0)";
  }
  function queueTooltipUpdate(nextState = null) {
    setTooltipPendingState(
      state,
      nextState && typeof nextState === "object" ? { ...nextState } : { visible: false },
    );
    if (tooltipFrame) return;
    tooltipFrame = scheduleFrame(() => {
      tooltipFrame = null;
      setTooltipRafHandleState(state, null);
      const pending = state.tooltipPendingState;
      setTooltipPendingState(state, null);
      if (pending?.visible) {
        applyTooltipState(true, String(pending.text || ""), Number(pending.x || 0), Number(pending.y || 0));
      } else {
        applyTooltipState();
      }
    });
    setTooltipRafHandleState(state, tooltipFrame.handle);
  }
  function resetTooltipState() {
    tooltipFrame?.cancel();
    tooltipFrame = null;
    setTooltipRafHandleState(state, null);
    setTooltipPendingState(state, null);
    applyTooltipState();
  }
  function cancelPendingHoverWork() {
    hoverHitFrame?.cancel();
    hoverHitFrame = null;
    pendingPointer = null;
    cancelScheduledHoverOverlayRender();
    resetTooltipState();
  }

  function scheduleMouseMove(event) {
    // DOM currentTarget is cleared after dispatch. The hit path supplies its
    // own SVG target to d3.pointer, so retain only stable event coordinates.
    pendingPointer = { clientX: event.clientX, clientY: event.clientY,
      pageX: event.pageX, pageY: event.pageY };
    if (hoverHitFrame) return;
    hoverHitFrame = scheduleFrame(() => {
      hoverHitFrame = null;
      const pointer = pendingPointer;
      pendingPointer = null;
      if (pointer) handleMouseMove(pointer, { frameCoalesced: true });
    });
  }
  function setMapInteractionCursor(nextCursor = "") {
    surfaceHost.getInteractionRect()?.style("cursor", nextCursor || null);
  }
  function clearUnderlyingHoverForFacilityEntry(entry) {
    if (!getterApi.shouldBlockUnderlyingSelectionForFacility(entry)) return false;
    const hadUnderlyingHover = hasHoverIds() || Boolean(state.devHoverHit?.id);
    setHoverIds();
    effectApi.updateDevHoverHit(null);
    if (hadUnderlyingHover) markAndSchedule();
    return true;
  }
  function handleMapMouseLeave() {
    cancelPendingHoverWork();
    setHoverIds();
    setHoveredFacilityEntry(null);
    effectApi.updateDevHoverHit(null);
    setHoverOverlayDirty();
    renderHoverOverlayIfNeeded({ eventType: "mouseleave" });
    setMapInteractionCursor("");
    effectApi.hidePhysicalIntensityBrushPreview();
  }

  function markAndSchedule() {
    setHoverOverlayDirty();
    scheduleHoverOverlayRender();
  }

  function hideTooltipAndCursor() {
    queueTooltipUpdate({ visible: false });
    setMapInteractionCursor("");
  }

  function clearFacilityIfPresent() {
    if (getHoveredFacilityEntry()) {
      setHoveredFacilityEntry(null);
    }
  }

  function clearHoverForExclusiveMode(branch, devHit = null, cursor = "") {
    setHoverIds(normalizeHoverIds());
    clearFacilityIfPresent();
    effectApi.updateDevHoverHit(devHit);
    markAndSchedule();
    queueTooltipUpdate({ visible: false });
    setMapInteractionCursor(cursor);
    return createSummary({ branch, hit: devHit, cursor });
  }

  function clearReducedHover() {
    if (hasHoverIds()) {
      setHoverIds(normalizeHoverIds());
      markAndSchedule();
    }
    if (getHoveredFacilityEntry()) {
      setHoveredFacilityEntry(null);
      markAndSchedule();
    }
    effectApi.updateDevHoverHit(null);
    hideTooltipAndCursor();
    return createSummary({ branch: "reduced-hover", skipped: true });
  }

  function updateHoverIds(hit) {
    const nextHoverIds = getNextHoverIds(hit);
    if (nextHoverIds.landId !== (state.hoveredId || null)
      || nextHoverIds.waterId !== (state.hoveredWaterRegionId || null)
      || nextHoverIds.specialId !== (state.hoveredSpecialRegionId || null)) {
      setHoverIds(nextHoverIds);
      markAndSchedule();
    }
  }

  function queueVisibleTooltip(event, text, branch, hit = null, cursor = "") {
    queueTooltipUpdate(getTooltipPayload(event, text));
    return createSummary({ branch, hit, cursor, tooltipVisible: true });
  }

  function handleMouseMove(event, { frameCoalesced = false } = {}) {
    const now = getterApi.nowMs();
    const throttleMs = Number(state.MOUSE_THROTTLE_MS || 0);
    const lastMouseMoveTime = Number(state.lastMouseMoveTime || 0);
    if (!frameCoalesced && now - lastMouseMoveTime < throttleMs) {
      return createSummary({ branch: "throttled", skipped: true });
    }
    setLastMouseMoveTimeState(state, now);
    if (!(state.landData || state.waterRegionsData || state.scenarioSpecialRegionsData)) {
      return createSummary({ branch: "no-hover-data", skipped: true });
    }
    if (state.specialZoneEditor?.active) {
      return clearHoverForExclusiveMode("special-zone-editor");
    }

    const hgoRuntimeHover = getterApi.inspectHgoRuntimePreviewFromEvent(event, { eventType: "hover" });
    if (hgoRuntimeHover?.active) {
      const hgoHit = hgoRuntimeHover.hit?.id ? hgoRuntimeHover.hit : null;
      return clearHoverForExclusiveMode("hgo-runtime-hover", hgoHit, hgoHit ? "pointer" : "");
    }

    if (isReducedHoverPhase()) {
      return clearReducedHover();
    }

    const hit = getterApi.getHitFromEvent(event, {
      enableSnap: false,
      snapPx: hoverSnapPx,
      eventType: "hover",
    }) || {};
    updateHoverIds(hit);
    effectApi.updateDevHoverHit(hit.id ? hit : null);

    if (!surfaceHost.getTooltip()) {
      return createSummary({ branch: "no-tooltip", hit, skipped: true });
    }

    const hoveredFacility = getterApi.getHoveredFacilityEntryFromEvent(event);
    const facilityDetailsActive = hoveredFacility
      ? getterApi.isFacilityDetailsSurfaceActive(hoveredFacility.familyId)
      : false;
    const nextFacilityKey = helperApi.getFacilityKey(hoveredFacility);
    const previousFacilityKey = helperApi.getFacilityKey(getHoveredFacilityEntry());
    if (nextFacilityKey !== previousFacilityKey) {
      setHoveredFacilityEntry(hoveredFacility || null);
      markAndSchedule();
    }
    const blockedUnderlyingHover = hoveredFacility
      ? clearUnderlyingHoverForFacilityEntry(hoveredFacility)
      : false;
    const cursor = facilityDetailsActive ? "pointer" : "";
    setMapInteractionCursor(cursor);
    if (hoveredFacility?.tooltipText) {
      return queueVisibleTooltip(event, hoveredFacility.tooltipText, "facility-tooltip", hit, cursor);
    }
    if (blockedUnderlyingHover) {
      queueTooltipUpdate({ visible: false });
      return createSummary({ branch: "facility-blocked-underlying", hit, cursor });
    }

    const hoveredCityEntry = getterApi.getHoveredCityTooltipEntry(event, hit);
    if (hoveredCityEntry?.tooltipText) {
      return queueVisibleTooltip(event, hoveredCityEntry.tooltipText, "city-tooltip", hit, cursor);
    }

    const feature = hit.id ? getterApi.getFeatureForHit(hit) : null;
    if (feature) {
      return queueVisibleTooltip(
        event,
        getterApi.getTooltipTextForFeature(feature),
        "feature-tooltip",
        hit,
        cursor,
      );
    }
    queueTooltipUpdate({ visible: false });
    return createSummary({ branch: "empty-hover", hit, cursor });
  }

  return Object.freeze({
    handleMouseMove,
    scheduleMouseMove,
    handleMapMouseLeave,
    getHoveredFacilityEntry,
    setHoveredFacilityEntry,
    setHoverOverlayDirty,
    renderHoverOverlayIfNeeded,
    cancelScheduledHoverOverlayRender,
    cancelPendingHoverWork,
    queueTooltipUpdate,
    resetTooltipState,
    setMapInteractionCursor,
  });
}

export function createFacilityInteractionRuntime({
  runtimeState,
  rendererSurfaceHost,
  getScenarioProjectMarkerEntries,
  getMapHoverInteractionOwner,
  getFacilitySurfaceOwner,
  nowMs,
  recordInteractionDurationMetric,
  queueTooltipUpdate,
  renderHoverOverlayIfNeeded,
  MIN_ZOOM_SCALE,
  MAX_ZOOM_SCALE,
}) {
  const visibleFacilityHoverEntriesByFamily = {
    airport: [],
    port: [],
    rail: [],
  };
  let selectedFacilityEntry = null;
  let facilityInfoCard = null;
  let facilityInfoCardTitle = null;
  let facilityInfoCardBody = null;
  let facilityInfoCardZoomBtn = null;
  let facilityInfoCardCloseBtn = null;
  let facilityInfoCardMoreBtn = null;
  let facilityInfoCardExpanded = false;
  let facilityInfoCardAnchor = null;
  function listVisibleFacilityHoverEntries() {
    return [
      ...(Array.isArray(visibleFacilityHoverEntriesByFamily.airport) ? visibleFacilityHoverEntriesByFamily.airport : []),
      ...(Array.isArray(visibleFacilityHoverEntriesByFamily.port) ? visibleFacilityHoverEntriesByFamily.port : []),
      ...getScenarioProjectMarkerEntries(),
      ...(Array.isArray(visibleFacilityHoverEntriesByFamily.rail) ? visibleFacilityHoverEntriesByFamily.rail : []),
    ];
  }

  function normalizeFacilityEntryPackId(value) {
    return String(value || "global").trim().toLowerCase() || "global";
  }

  function getFacilityEntryHitPriority(entry) {
    return normalizeFacilityEntryPackId(entry?.packId) === "global" ? 0 : 1;
  }

  function buildFacilityEntryKey(entry) {
    const familyId = String(entry?.familyId || "").trim().toLowerCase();
    const packId = normalizeFacilityEntryPackId(entry?.packId);
    const stableId = String(entry?.stableId || "").trim();
    if (!familyId || !stableId) return "";
    return `${familyId}:${packId}:${stableId}`;
  }

  function buildFacilityEntrySemanticKey(entry) {
    const familyId = String(entry?.familyId || "").trim().toLowerCase();
    if (!familyId) return "";
    const stableId = String(entry?.stableId || entry?.properties?.stable_key || "").trim();
    if (stableId) return `${familyId}:stable:${stableId}`;
    const id = String(entry?.id || entry?.properties?.id || entry?.properties?.facility_id || "").trim();
    if (id) return `${familyId}:id:${id}`;
    const coordinates = Array.isArray(entry?.coordinates)
      ? entry.coordinates
      : Array.isArray(entry?.properties?.__coordinates)
        ? entry.properties.__coordinates
        : Array.isArray(entry?.projectedPoint)
          ? entry.projectedPoint
          : [];
    const [x, y] = coordinates;
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      return `${familyId}:coord:${Number(x).toFixed(5)}:${Number(y).toFixed(5)}`;
    }
    return "";
  }

  function dedupeFacilityHoverEntriesBySemanticKey(entries = []) {
    const dedupedByKey = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
      const semanticKey = buildFacilityEntrySemanticKey(entry) || `entry:${index}`;
      const existing = dedupedByKey.get(semanticKey);
      if (!existing || getFacilityEntryHitPriority(entry) >= getFacilityEntryHitPriority(existing)) {
        dedupedByKey.set(semanticKey, entry);
      }
    });
    return Array.from(dedupedByKey.values());
  }

  function clearFacilityHoverEntries(familyId = "") {
    const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
    if (normalizedFamilyId && Object.prototype.hasOwnProperty.call(visibleFacilityHoverEntriesByFamily, normalizedFamilyId)) {
      visibleFacilityHoverEntriesByFamily[normalizedFamilyId] = [];
    }
    if (normalizedFamilyId && getMapHoverInteractionOwner().getHoveredFacilityEntry()?.familyId === normalizedFamilyId) {
      getMapHoverInteractionOwner().setHoveredFacilityEntry(null);
      getMapHoverInteractionOwner().setHoverOverlayDirty(true);
    }
    if (normalizedFamilyId && selectedFacilityEntry?.familyId === normalizedFamilyId) {
      selectedFacilityEntry = null;
      applyFacilityInfoCardState(null);
      getMapHoverInteractionOwner().setHoverOverlayDirty(true);
    }
  }

  function setVisibleFacilityHoverEntries(familyId = "", entries = [], { append = false, packId = "" } = {}) {
    const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
    if (!normalizedFamilyId || !Object.prototype.hasOwnProperty.call(visibleFacilityHoverEntriesByFamily, normalizedFamilyId)) {
      return;
    }
    const normalizedPackId = normalizeFacilityEntryPackId(packId || entries?.[0]?.packId);
    const nextEntries = (Array.isArray(entries) ? entries : []).map((entry) => ({
      ...entry,
      packId: normalizeFacilityEntryPackId(entry?.packId || normalizedPackId),
    }));
    if (append) {
      visibleFacilityHoverEntriesByFamily[normalizedFamilyId] = [
        ...visibleFacilityHoverEntriesByFamily[normalizedFamilyId].filter((entry) => normalizeFacilityEntryPackId(entry?.packId) !== normalizedPackId),
        ...nextEntries,
      ];
    } else {
      visibleFacilityHoverEntriesByFamily[normalizedFamilyId] = nextEntries;
    }
    visibleFacilityHoverEntriesByFamily[normalizedFamilyId] = dedupeFacilityHoverEntriesBySemanticKey(
      visibleFacilityHoverEntriesByFamily[normalizedFamilyId],
    );
    const nextEntriesByKey = new Map(
      listVisibleFacilityHoverEntries()
        .map((entry) => [buildFacilityEntryKey(entry), entry])
        .filter(([key]) => !!key)
    );
    const hoveredKey = buildFacilityEntryKey(getMapHoverInteractionOwner().getHoveredFacilityEntry());
    const selectedKey = buildFacilityEntryKey(selectedFacilityEntry);
    if (hoveredKey) {
      const nextHoveredEntry = nextEntriesByKey.get(hoveredKey) || null;
      if (nextHoveredEntry) {
        getMapHoverInteractionOwner().setHoveredFacilityEntry(nextHoveredEntry);
        getMapHoverInteractionOwner().setHoverOverlayDirty(true);
      } else {
        getMapHoverInteractionOwner().setHoveredFacilityEntry(null);
        getMapHoverInteractionOwner().setHoverOverlayDirty(true);
      }
    }
    if (selectedKey) {
      const nextSelectedEntry = nextEntriesByKey.get(selectedKey) || null;
      if (nextSelectedEntry) {
        selectedFacilityEntry = nextSelectedEntry;
        applyFacilityInfoCardState(nextSelectedEntry);
        getMapHoverInteractionOwner().setHoverOverlayDirty(true);
      } else {
        selectedFacilityEntry = null;
        applyFacilityInfoCardState(null);
        getMapHoverInteractionOwner().setHoverOverlayDirty(true);
      }
    }
  }

  function getFacilityHoverRadiusPx(entry) {
    return Math.max(9, Math.min(18, Number(entry?.markerRadiusPx || 0) + 5));
  }

  function getHoveredFacilityEntryFromEvent(event) {
    const startedAt = nowMs();
    const eventType = String(event?.type || "hover").toLowerCase() === "mousemove" ? "hover" : String(event?.type || "unknown").toLowerCase();
    if (!rendererSurfaceHost.getMapSvg() || !globalThis.d3?.pointer) {
      recordInteractionDurationMetric("interactionHoverFacilityProbeDuration", nowMs() - startedAt, {
        eventType,
        entryCount: 0,
        hit: false,
        skipped: true,
      });
      return null;
    }
    const entries = listVisibleFacilityHoverEntries();
    if (!entries.length) {
      recordInteractionDurationMetric("interactionHoverFacilityProbeDuration", nowMs() - startedAt, {
        eventType,
        entryCount: 0,
        hit: false,
        skipped: true,
      });
      return null;
    }
    const [sx, sy] = globalThis.d3.pointer(event, rendererSurfaceHost.getMapSvg());
    if (![sx, sy].every(Number.isFinite)) {
      recordInteractionDurationMetric("interactionHoverFacilityProbeDuration", nowMs() - startedAt, {
        eventType,
        entryCount: entries.length,
        hit: false,
        skipped: true,
      });
      return null;
    }
    let bestEntry = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPriority = -1;
    entries.forEach((entry) => {
      if (entry.familyId === "project" && runtimeState.currentTool !== "select") return;
      const [entryX, entryY] = entry?.screenPoint || [];
      if (![entryX, entryY].every(Number.isFinite)) {
        return;
      }
      const threshold = Math.max(6, Number(entry?.hoverRadiusPx || 0));
      const distance = Math.hypot(sx - entryX, sy - entryY);
      const hitPriority = getFacilityEntryHitPriority(entry);
      if (distance <= threshold && (hitPriority > bestPriority || (hitPriority === bestPriority && distance < bestDistance))) {
        bestDistance = distance;
        bestPriority = hitPriority;
        bestEntry = entry;
      }
    });
    recordInteractionDurationMetric("interactionHoverFacilityProbeDuration", nowMs() - startedAt, {
      eventType,
      entryCount: entries.length,
      hit: !!bestEntry,
    });
    return bestEntry;
  }

  function applyFacilityInfoCardState(entry, anchor = null) {
    if (!facilityInfoCard || !facilityInfoCardTitle || !facilityInfoCardBody || !facilityInfoCardZoomBtn || !facilityInfoCardMoreBtn) {
      return;
    }
    if (!entry) {
      selectedFacilityEntry = null;
      facilityInfoCardExpanded = false;
      facilityInfoCardAnchor = null;
      getFacilitySurfaceOwner().applyFacilityInfoCardState(null, {
        expanded: false,
        previousAnchor: null,
        dom: {
          facilityInfoCard,
          facilityInfoCardBody,
          facilityInfoCardMoreBtn,
          facilityInfoCardTitle,
          facilityInfoCardZoomBtn,
        },
        entryKey: "",
      });
      return;
    }
    selectedFacilityEntry = entry;
    facilityInfoCardAnchor = anchor && Number.isFinite(Number(anchor?.x)) && Number.isFinite(Number(anchor?.y))
      ? { x: Number(anchor.x), y: Number(anchor.y) }
      : (facilityInfoCardAnchor || { x: 24, y: 24 });
    const cardState = getFacilitySurfaceOwner().applyFacilityInfoCardState(entry, {
      anchor,
      expanded: facilityInfoCardExpanded,
      previousAnchor: facilityInfoCardAnchor,
      dom: {
        facilityInfoCard,
        facilityInfoCardBody,
        facilityInfoCardMoreBtn,
        facilityInfoCardTitle,
        facilityInfoCardZoomBtn,
      },
      entryKey: buildFacilityEntryKey(entry),
    });
    facilityInfoCardAnchor = cardState.anchor;
  }

  function getActiveFacilityHighlightEntry() {
    const hoveredFacilityEntry = getMapHoverInteractionOwner().getHoveredFacilityEntry();
    return hoveredFacilityEntry || selectedFacilityEntry || null;
  }

  function zoomToFacilityEntry(entry, { targetScale = 4.8, durationMs = 420 } = {}) {
    if (!entry?.coordinates || !rendererSurfaceHost.getProjection() || !rendererSurfaceHost.getInteractionRect() || !rendererSurfaceHost.getZoomBehavior() || !globalThis.d3) {
      return;
    }
    const projected = rendererSurfaceHost.getProjection()(entry.coordinates);
    if (!Array.isArray(projected) || !projected.every(Number.isFinite)) {
      return;
    }
    const nextScale = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, Number(targetScale) || 4.8));
    const nextTransform = globalThis.d3.zoomIdentity
      .translate(runtimeState.width / 2, runtimeState.height / 2)
      .scale(nextScale)
      .translate(-projected[0], -projected[1]);
    globalThis.d3
      .select(rendererSurfaceHost.getInteractionRect().node())
      .transition()
      .duration(durationMs)
      .call(rendererSurfaceHost.getZoomBehavior().transform, nextTransform);
  }

  function syncFacilityInfoCardVisibility() {
    if (!isFacilityDetailsSurfaceActive("project")
      && getMapHoverInteractionOwner().getHoveredFacilityEntry()?.familyId === "project") {
      getMapHoverInteractionOwner().setHoveredFacilityEntry(null);
      getMapHoverInteractionOwner().setHoverOverlayDirty(true);
      queueTooltipUpdate({ visible: false });
      getMapHoverInteractionOwner().setMapInteractionCursor("");
    }
    if (!selectedFacilityEntry) {
      return;
    }
    if (isFacilityDetailsSurfaceActive(selectedFacilityEntry.familyId)) {
      return;
    }
    getMapHoverInteractionOwner().setHoveredFacilityEntry(null);
    applyFacilityInfoCardState(null);
    getMapHoverInteractionOwner().setHoverOverlayDirty(true);
    renderHoverOverlayIfNeeded({ eventType: "facility-card-visibility" });
    queueTooltipUpdate({ visible: false });
    getMapHoverInteractionOwner().setMapInteractionCursor("");
  }

  function isFacilityDetailsSurfaceActive(familyId = "") {
    if (familyId === "project") return runtimeState.activeScenarioId === "tno_1962" && !!runtimeState.showScenarioAtlantropa;
    const transportPanel = document.getElementById("appearancePanelTransport");
    if (
      transportPanel instanceof HTMLElement
      && transportPanel.hidden !== true
      && !transportPanel.classList.contains("hidden")
    ) {
      const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
      if (normalizedFamilyId === "airport") {
        const airportCard = document.getElementById("transportAirportCard");
        if (airportCard instanceof HTMLDetailsElement && airportCard.open) {
          return true;
        }
      }
      if (normalizedFamilyId === "port") {
        const portCard = document.getElementById("transportPortCard");
        if (portCard instanceof HTMLDetailsElement && portCard.open) {
          return true;
        }
      }
    }
    const workbenchOverlay = document.getElementById("transportWorkbenchOverlay");
    return workbenchOverlay instanceof HTMLElement && !workbenchOverlay.classList.contains("hidden");
  }

  function resolveDomHandles() {
    facilityInfoCard = document.getElementById("facilityInfoCard");
    facilityInfoCardTitle = document.getElementById("facilityInfoCardTitle");
    facilityInfoCardBody = document.getElementById("facilityInfoCardBody");
    facilityInfoCardZoomBtn = document.getElementById("facilityInfoCardZoomBtn");
    facilityInfoCardCloseBtn = document.getElementById("facilityInfoCardCloseBtn");
    facilityInfoCardMoreBtn = document.getElementById("facilityInfoCardMoreBtn");
  }

  function bindInfoCard() {
    if (facilityInfoCardCloseBtn && !facilityInfoCardCloseBtn.dataset.bound) {
      facilityInfoCardCloseBtn.addEventListener("click", () => {
        applyFacilityInfoCardState(null);
        getMapHoverInteractionOwner().setHoverOverlayDirty(true);
        renderHoverOverlayIfNeeded({ eventType: "facility-card-close" });
      });
      facilityInfoCardCloseBtn.dataset.bound = "true";
    }
    if (facilityInfoCardZoomBtn && !facilityInfoCardZoomBtn.dataset.bound) {
      facilityInfoCardZoomBtn.addEventListener("click", () => {
        const activeEntry = selectedFacilityEntry;
        if (!activeEntry) return;
        zoomToFacilityEntry(activeEntry);
      });
      facilityInfoCardZoomBtn.dataset.bound = "true";
    }
    if (facilityInfoCardMoreBtn && !facilityInfoCardMoreBtn.dataset.bound) {
      facilityInfoCardMoreBtn.addEventListener("click", () => {
        if (!selectedFacilityEntry) return;
        facilityInfoCardExpanded = !facilityInfoCardExpanded;
        applyFacilityInfoCardState(selectedFacilityEntry);
      });
      facilityInfoCardMoreBtn.dataset.bound = "true";
    }
    runtimeState.syncFacilityInfoCardVisibilityFn = syncFacilityInfoCardVisibility;
    runtimeState.updateFacilityInfoCardUiFn = () => {
      if (selectedFacilityEntry) {
        applyFacilityInfoCardState(selectedFacilityEntry);
      }
    };
    applyFacilityInfoCardState(null);

  }

  return {
    listVisibleFacilityHoverEntries,
    buildFacilityEntryKey,
    getFacilityEntryHitPriority,
    clearFacilityHoverEntries,
    setVisibleFacilityHoverEntries,
    getFacilityHoverRadiusPx,
    getHoveredFacilityEntryFromEvent,
    applyFacilityInfoCardState,
    getActiveFacilityHighlightEntry,
    syncFacilityInfoCardVisibility,
    isFacilityDetailsSurfaceActive,
    resolveDomHandles,
    bindInfoCard,
    getSelectedFacilityEntry: () => selectedFacilityEntry,
    setSelectedFacilityEntry: (entry) => { selectedFacilityEntry = entry; },
    setFacilityInfoCardExpanded: (expanded) => { facilityInfoCardExpanded = Boolean(expanded); },
  };
}

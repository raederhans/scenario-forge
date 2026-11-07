export function createSelectionOverlayOwner({
  getOverlayProjectionSignature,
  getTopologyRevision,
  getDevSelectionIds,
  getInspectorSelection,
  getLandFeatures,
  getLandIndex,
  getRuntimeTopology,
  getTopojson,
  getFeatureId,
  getEntityFeatureId,
  getCountryFeatureIds,
  getSelectionBoundary = () => null,
  getSelectionBoundaryRevision = () => 0,
  getZoomScale = () => 1,
  getDevGroup,
  getInspectorGroup,
  getPath,
  isDevDirty,
  isInspectorDirty,
  markDevClean,
  markInspectorClean,
}) {
  let lastDevSignature = null;
  let lastInspectorSignature = null;
  let lastDevGroup = null;
  let lastInspectorGroup = null;
  let lastDevPath = null;
  let lastInspectorPath = null;
  let lastInspectorWidth = null;
  let inspectorFallback = false;

  function normalizeIds(ids) {
    return Array.isArray(ids) ? ids.map((id) => String(id || "").trim()).filter(Boolean) : [];
  }

  function getInspectorOverlaySignature() {
    const selection = getInspectorSelection();
    return JSON.stringify([
      getOverlayProjectionSignature(),
      String(selection.countryCode || "").trim().toUpperCase(),
      normalizeIds(selection.featureIds),
      !!selection.groupMode,
      String(selection.label || ""),
      getLandFeatures()?.length || 0,
      getSelectionBoundaryRevision(),
      getTopologyRevision(),
    ]);
  }

  function getDevSelectionOverlaySignature() {
    return JSON.stringify([
      getOverlayProjectionSignature(),
      normalizeIds(getDevSelectionIds()),
      Number(getTopologyRevision() || 0),
      getLandFeatures()?.length || 0,
    ]);
  }

  function buildDevSelectionOverlayData(orderedIds, fallbackFeatures, requireAllMembers = false) {
    const topojson = getTopojson();
    const topology = getRuntimeTopology();
    if ((!requireAllMembers && fallbackFeatures.length <= 1) || !orderedIds.length
      || typeof topojson?.merge !== "function" || !topology?.objects) {
      return fallbackFeatures;
    }
    const requestedIds = new Set(orderedIds);
    const featureIds = requireAllMembers ? orderedIds : fallbackFeatures.map((feature) => getFeatureId(feature));
    const selectedIds = new Set(featureIds);
    if (requestedIds.size !== orderedIds.length || selectedIds.size !== featureIds.length
      || featureIds.some((id) => !id || !requestedIds.has(id))) {
      return fallbackFeatures;
    }
    const geometriesById = new Map();
    for (const objectName of ["political", "scenario_atlantropa"]) {
      const geometries = topology.objects[objectName]?.geometries;
      if (!Array.isArray(geometries)) continue;
      for (const geometry of geometries) {
        const id = getEntityFeatureId(geometry);
        if (!selectedIds.has(id)) continue;
        if (geometriesById.has(id)) return fallbackFeatures;
        geometriesById.set(id, geometry);
      }
    }
    if (geometriesById.size !== selectedIds.size) return fallbackFeatures;
    try {
      const mergedShape = topojson.merge(topology, featureIds.map((id) => geometriesById.get(id)));
      if (!mergedShape) return fallbackFeatures;
      return [{
        type: "Feature",
        devSelectionKey: `merged:${JSON.stringify(featureIds)}`,
        properties: { id: "dev-selection-merged-overlay", selectionGeometry: "topology-boolean-merge" },
        geometry: mergedShape,
      }];
    } catch {
      return fallbackFeatures;
    }
  }

  function renderDevSelectionOverlay() {
    if (!getDevGroup() || !getPath()) return;
    const orderedIds = normalizeIds(getDevSelectionIds());
    const data = orderedIds
      .map((featureId) => getLandIndex()?.get(featureId) || null)
      .filter(Boolean);
    const overlayData = buildDevSelectionOverlayData(orderedIds, data);

    const selection = getDevGroup()
      .selectAll("path.dev-selected-feature")
      .data(overlayData, (feature, index) => feature?.devSelectionKey || getFeatureId(feature) || `dev-selection-${index}`);

    selection
      .enter()
      .append("path")
      .attr("class", "dev-selected-feature")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .attr("vector-effect", "non-scaling-stroke")
      .merge(selection)
      .attr("d", getPath())
      .attr("fill", "rgba(14, 165, 233, 0.14)")
      .attr("stroke", "rgba(14, 165, 233, 0.94)")
      .attr("stroke-width", 1.35);

    selection.exit().remove();
    getDevGroup()
      .attr("aria-hidden", data.length ? "false" : "true")
      .attr("aria-label", data.length ? `Development selection overlay (${data.length})` : "Development selection overlay");
  }

  function renderInspectorHighlightOverlay() {
    if (!getInspectorGroup() || !getPath()) return;
    const selectionState = getInspectorSelection();
    const featureIds = Array.isArray(selectionState.featureIds)
      ? Array.from(new Set(selectionState.featureIds.map((id) => String(id || "").trim()).filter(Boolean)))
      : [];
    const code = String(selectionState.countryCode || "").trim().toUpperCase();
    if (!featureIds.length && !code) {
      getInspectorGroup().selectAll("path.inspector-highlight").remove();
      getInspectorGroup().attr("aria-hidden", "true");
      return;
    }
    const landFeatures = getLandFeatures() || [];
    const featureLookup = getLandIndex() instanceof Map && getLandIndex().size
      ? getLandIndex()
      : new Map(landFeatures.map((feature) => [getFeatureId(feature), feature]).filter(([featureId]) => featureId));
    const memberIds = featureIds.length ? featureIds : normalizeIds(Array.from(getCountryFeatureIds(code) || []));
    const data = memberIds
      .map((featureId) => featureLookup.get(featureId))
      .filter(Boolean);
    const renderAsGroup = featureIds.length !== 1 || selectionState.groupMode === true;
    let geometry = renderAsGroup ? getSelectionBoundary(new Set(memberIds)) : null;
    if (renderAsGroup && !geometry) {
      const merged = buildDevSelectionOverlayData(memberIds, data, true);
      if (merged !== data) geometry = merged[0].geometry;
    }
    inspectorFallback = renderAsGroup && !geometry;
    const overlayData = geometry
      ? [true, false].map(halo => ({ type: "Feature", geometry, halo,
        inspectorHighlightKey: halo ? "boundary-halo" : "boundary" }))
      : data;
    const selection = getInspectorGroup()
      .selectAll("path.inspector-highlight")
      .data(overlayData, (d, index) => d?.inspectorHighlightKey || getFeatureId(d) || `${code}-${index}`);

    selection
      .enter()
      .append("path")
      .attr("class", "inspector-highlight")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .attr("vector-effect", "non-scaling-stroke")
      .merge(selection)
      .attr("d", getPath())
      .attr("fill", "none")
      .attr("stroke", d => d.halo ? "#ffffff" : "#1d64f2")
      .attr("stroke-opacity", d => d.halo ? 0.55 : 1);

    selection.exit().remove();
    updateInspectorWidth();
    getInspectorGroup()
      .attr("aria-hidden", overlayData.length ? "false" : "true")
      .attr("aria-label", overlayData.length
        ? `Inspector highlight overlay for ${selectionState.label || code || "feature group"}`
        : "Inspector highlight overlay");
  }

  function updateInspectorWidth() {
    const width = inspectorFallback ? 1 : 1.25 + Math.max(0, Math.min(6, getZoomScale() - 2)) * 0.125;
    getInspectorGroup().selectAll("path.inspector-highlight")
      .attr("stroke-width", d => d.halo ? width + 2.5 : width);
    lastInspectorWidth = width;
  }

  function renderDevSelectionOverlayIfNeeded({ force = false } = {}) {
    const group = getDevGroup();
    const path = getPath();
    if (!group || !path) return;
    const signature = getDevSelectionOverlaySignature();
    if (!force && !isDevDirty() && signature === lastDevSignature && group === lastDevGroup && path === lastDevPath) return;
    renderDevSelectionOverlay();
    markDevClean();
    lastDevSignature = signature;
    lastDevGroup = group;
    lastDevPath = path;
  }

  function renderInspectorHighlightOverlayIfNeeded({ force = false } = {}) {
    const group = getInspectorGroup();
    const path = getPath();
    if (!group || !path) return;
    const signature = getInspectorOverlaySignature();
    if (!force && !isInspectorDirty() && signature === lastInspectorSignature && group === lastInspectorGroup && path === lastInspectorPath) {
      const width = inspectorFallback ? 1 : 1.25 + Math.max(0, Math.min(6, getZoomScale() - 2)) * 0.125;
      if (width !== lastInspectorWidth) updateInspectorWidth();
      return;
    }
    renderInspectorHighlightOverlay();
    markInspectorClean();
    lastInspectorSignature = signature;
    lastInspectorGroup = group;
    lastInspectorPath = path;
  }

  return Object.freeze({
    renderDevSelectionOverlay,
    renderDevSelectionOverlayIfNeeded,
    renderInspectorHighlightOverlay,
    renderInspectorHighlightOverlayIfNeeded,
  });
}

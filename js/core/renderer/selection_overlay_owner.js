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

  function buildDevSelectionOverlayData(orderedIds, fallbackFeatures) {
    const topojson = getTopojson();
    const topology = getRuntimeTopology();
    if (fallbackFeatures.length <= 1 || typeof topojson?.merge !== "function" || !topology?.objects) {
      return fallbackFeatures;
    }
    const requestedIds = new Set(orderedIds);
    const featureIds = fallbackFeatures.map((feature) => getFeatureId(feature));
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
    const data = featureIds.length
      ? featureIds
        .map((featureId) => featureLookup.get(featureId))
        .filter(Boolean)
      // 国家高亮按当前剧本归属取成员，地块的几何原始国家码只在无剧本时等价。
      : Array.from(getCountryFeatureIds(code) || [])
        .map((featureId) => featureLookup.get(String(featureId || "").trim()))
        .filter(Boolean);
    const renderAsGroup = featureIds.length > 0 && selectionState.groupMode === true;
    const overlayData = renderAsGroup && data.length
      ? [{
        type: "FeatureCollection",
        features: data,
        inspectorHighlightKey: `group:${JSON.stringify(featureIds)}`,
      }]
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
      .attr("stroke", "rgba(0, 47, 167, 0.6)")
      .attr("stroke-width", 2.4);

    selection.exit().remove();
    getInspectorGroup()
      .attr("aria-hidden", data.length ? "false" : "true")
      .attr("aria-label", data.length
        ? `Inspector highlight overlay for ${selectionState.label || code || "feature group"}`
        : "Inspector highlight overlay");
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
    if (!force && !isInspectorDirty() && signature === lastInspectorSignature && group === lastInspectorGroup && path === lastInspectorPath) return;
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

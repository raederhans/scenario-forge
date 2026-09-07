// Transient SVG overlays: special-zone editing and feature/facility hover.
export function createTransientOverlayRenderOwner({
  runtimeState,
  rendererSurfaceHost,
  ensureSpecialZoneEditorState,
  getSpecialZoneStyle,
  DEFAULT_SPECIAL_ZONE_TYPE,
  RENDER_PHASE_IDLE,
  isSpecialRegionEnabled,
  isWaterRegionEnabled,
  getFeatureId,
  getActiveFacilityHighlightEntry,
  buildFacilityEntryKey,
}) {
  function renderSpecialZoneEditorOverlay() {
    if (!rendererSurfaceHost.getSpecialZoneEditorGroup() || !rendererSurfaceHost.getPathSvg()) return;
    ensureSpecialZoneEditorState();

    const vertices = runtimeState.specialZoneEditor.vertices || [];
    const isActive = !!runtimeState.specialZoneEditor.active;

    if (!isActive || vertices.length === 0) {
      rendererSurfaceHost.getSpecialZoneEditorGroup().selectAll("*").remove();
      return;
    }

    const lineFeature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: vertices,
      },
      properties: {},
    };
    const polygonFeature = vertices.length >= 3
      ? {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[...vertices, vertices[0]]],
        },
        properties: {},
      }
      : null;

    const style = getSpecialZoneStyle({
      properties: { type: runtimeState.specialZoneEditor.zoneType || DEFAULT_SPECIAL_ZONE_TYPE },
    });

    const paths = [];
    if (polygonFeature) paths.push({ id: "draw-poly", feature: polygonFeature, fill: true });
    paths.push({ id: "draw-line", feature: lineFeature, fill: false });

    const pathSelection = rendererSurfaceHost.getSpecialZoneEditorGroup()
      .selectAll("path.special-zone-editor-path")
      .data(paths, (d) => d.id);

    pathSelection
      .enter()
      .append("path")
      .attr("class", "special-zone-editor-path")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .attr("vector-effect", "non-scaling-stroke")
      .merge(pathSelection)
      .attr("d", (d) => rendererSurfaceHost.getPathSvg()(d.feature))
      .attr("fill", (d) => (d.fill ? style.fill : "none"))
      .attr("fill-opacity", (d) => (d.fill ? Math.min(style.fillOpacity * 0.85, 0.6) : 0))
      .attr("stroke", style.stroke)
      .attr("stroke-width", Math.max(1.2, style.strokeWidth + 0.5))
      .attr("stroke-dasharray", style.dash.join(" "));

    pathSelection.exit().remove();

    const points = vertices.map((coord, index) => ({ coord, key: `v-${index}` }));
    const pointSelection = rendererSurfaceHost.getSpecialZoneEditorGroup()
      .selectAll("circle.special-zone-editor-point")
      .data(points, (d) => d.key);

    pointSelection
      .enter()
      .append("circle")
      .attr("class", "special-zone-editor-point")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .merge(pointSelection)
      .attr("r", 3.4)
      .attr("cx", (d) => rendererSurfaceHost.getProjection()(d.coord)?.[0] ?? -9999)
      .attr("cy", (d) => rendererSurfaceHost.getProjection()(d.coord)?.[1] ?? -9999)
      .attr("fill", "#ffffff")
      .attr("stroke", style.stroke)
      .attr("stroke-width", 1.3);

    pointSelection.exit().remove();
  }

  function renderHoverOverlay() {
    if (!rendererSurfaceHost.getHoverGroup() || !rendererSurfaceHost.getPathSvg()) return;

    if (runtimeState.renderPhase !== RENDER_PHASE_IDLE) {
      rendererSurfaceHost.getHoverGroup().selectAll("path.hovered-feature").remove();
      rendererSurfaceHost.getHoverGroup().selectAll("path.hovered-facility-marker").remove();
      rendererSurfaceHost.getHoverGroup().attr("aria-hidden", "true");
      return;
    }

    const feature = runtimeState.hoveredSpecialRegionId
      ? runtimeState.specialRegionsById.get(runtimeState.hoveredSpecialRegionId)
      : runtimeState.hoveredWaterRegionId
        ? runtimeState.waterRegionsById.get(runtimeState.hoveredWaterRegionId)
        : (runtimeState.hoveredId ? runtimeState.landIndex.get(runtimeState.hoveredId) : null);
    const data = feature && (
      (!runtimeState.hoveredSpecialRegionId || isSpecialRegionEnabled(feature))
      && (!runtimeState.hoveredWaterRegionId || isWaterRegionEnabled(feature))
    ) ? [feature] : [];

    const selection = rendererSurfaceHost.getHoverGroup()
      .selectAll("path.hovered-feature")
      .data(data, (d) => getFeatureId(d) || "hover");

    selection
      .enter()
      .append("path")
      .attr("class", "hovered-feature")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .attr("vector-effect", "non-scaling-stroke")
      .merge(selection)
      .attr("d", rendererSurfaceHost.getPathSvg())
      .attr("fill", "none")
      .attr("stroke", "#f1c40f")
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("stroke-width", () => (runtimeState.hoveredWaterRegionId ? 1.25 : 1.45));

    selection.exit().remove();

    const activeFacilityEntry = getActiveFacilityHighlightEntry();
    const facilityMarkerData = activeFacilityEntry?.projectedPoint?.length >= 2 ? [activeFacilityEntry] : [];
    const facilitySelection = rendererSurfaceHost.getHoverGroup()
      .selectAll("path.hovered-facility-marker")
      .data(facilityMarkerData, (datum) => buildFacilityEntryKey(datum) || "hovered-facility");

    facilitySelection
      .enter()
      .append("path")
      .attr("class", "hovered-facility-marker")
      .attr("role", "presentation")
      .attr("aria-hidden", "true")
      .attr("vector-effect", "non-scaling-stroke")
      .merge(facilitySelection)
      .attr("d", (datum) => {
        const [x, y] = datum.projectedPoint || [];
        const zoomScale = Math.max(0.0001, Number(runtimeState.zoomTransform?.k || datum.screenScale || 1));
        const radius = Math.max(6.8, Number(datum.markerRadiusPx || 0) + 2.8) / zoomScale;
        if (datum.shape === "icon") {
          return `M ${x - radius} ${y} A ${radius} ${radius} 0 1 0 ${x + radius} ${y} A ${radius} ${radius} 0 1 0 ${x - radius} ${y} Z`;
        }
        if (datum.shape === "square") {
          return `M ${x - radius} ${y - radius} L ${x + radius} ${y - radius} L ${x + radius} ${y + radius} L ${x - radius} ${y + radius} Z`;
        }
        return `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`;
      })
      .attr("fill", "rgba(255,255,255,0.12)")
      .attr("stroke", (datum) => String(datum.highlightStroke || "#ffffff"))
      .attr("stroke-width", 2.1);

    facilitySelection.exit().remove();
    rendererSurfaceHost.getHoverGroup().attr("aria-hidden", data.length || facilityMarkerData.length ? "false" : "true");
  }

  return { renderSpecialZoneEditorOverlay, renderHoverOverlay };
}

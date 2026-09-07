// Physical intensity preview and point picking share the live projection surface.
export function createPhysicalIntensityPreviewOwner({
  runtimeState, rendererSurfaceHost, getIntensityFieldTool, getProjectedDegreeRadiusPx, clamp,
}) {
  let physicalIntensityPreviewLonLat = null;

  function getMapLonLatFromEvent(event) {
    if (!rendererSurfaceHost.getProjection() || !rendererSurfaceHost.getInteractionRect()?.node || !globalThis.d3?.pointer) return null;
    const [sx, sy] = globalThis.d3.pointer(event, rendererSurfaceHost.getInteractionRect().node());
    if (![sx, sy].every(Number.isFinite)) return null;
    const t = runtimeState.zoomTransform || globalThis.d3.zoomIdentity;
    const k = Math.max(0.0001, t.k || 1);
    const mapX = (sx - t.x) / k;
    const mapY = (sy - t.y) / k;
    const lonLat = rendererSurfaceHost.getProjection().invert([mapX, mapY]);
    if (!Array.isArray(lonLat) || lonLat.length < 2) return null;
    const lon = Number(lonLat[0]);
    const lat = Number(lonLat[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, clamp(lat, -90, 90)];
  }

  function projectGeoToScreen(lon, lat) {
    if (!rendererSurfaceHost.getProjection()) return null;
    const projected = rendererSurfaceHost.getProjection()([lon, lat]);
    if (!Array.isArray(projected) || projected.length < 2) return null;
    const t = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
    return [
      (projected[0] * Number(t.k || 1)) + Number(t.x || 0),
      (projected[1] * Number(t.k || 1)) + Number(t.y || 0),
    ];
  }

  function hidePhysicalIntensityBrushPreview() {
    physicalIntensityPreviewLonLat = null;
    if (rendererSurfaceHost.getIntensityFieldPreviewGroup()) {
      rendererSurfaceHost.getIntensityFieldPreviewGroup().style("display", "none");
    }
  }

  function renderPhysicalIntensityBrushPreview(lonLat = physicalIntensityPreviewLonLat) {
    if (!rendererSurfaceHost.getIntensityFieldPreviewGroup() || !globalThis.d3) return false;
    const tool = getIntensityFieldTool();
    if (!tool.active || !Array.isArray(lonLat) || lonLat.length < 2) {
      hidePhysicalIntensityBrushPreview();
      return false;
    }
    const screenPoint = projectGeoToScreen(lonLat[0], lonLat[1]);
    if (!screenPoint) {
      hidePhysicalIntensityBrushPreview();
      return false;
    }
    const radiusPx = getProjectedDegreeRadiusPx(lonLat[0], lonLat[1], tool.brushRadiusDeg);
    if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
      hidePhysicalIntensityBrushPreview();
      return false;
    }
    physicalIntensityPreviewLonLat = [lonLat[0], lonLat[1]];
    rendererSurfaceHost.getIntensityFieldPreviewGroup().style("display", null);
    const preview = rendererSurfaceHost.getIntensityFieldPreviewGroup()
      .selectAll("circle.intensity-field-brush-preview")
      .data([{
        x: screenPoint[0],
        y: screenPoint[1],
        r: radiusPx,
        mode: tool.subMode,
      }]);
    preview.join("circle")
      .attr("class", "intensity-field-brush-preview")
      .attr("cx", (entry) => entry.x)
      .attr("cy", (entry) => entry.y)
      .attr("r", (entry) => entry.r)
      .attr("fill", (entry) => (entry.mode === "erase" ? "rgba(251, 191, 36, 0.08)" : "rgba(56, 189, 248, 0.08)"))
      .attr("stroke", (entry) => (entry.mode === "erase" ? "rgba(251, 191, 36, 0.92)" : "rgba(56, 189, 248, 0.92)"))
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", (entry) => (entry.mode === "points" ? "3 4" : "6 4"));
    return true;
  }

  function updatePhysicalIntensityBrushPreviewFromEvent(event) {
    const tool = getIntensityFieldTool();
    if (!tool.active) {
      hidePhysicalIntensityBrushPreview();
      return false;
    }
    const lonLat = getMapLonLatFromEvent(event);
    return renderPhysicalIntensityBrushPreview(lonLat);
  }

  function getPhysicalIntensityPointHit(channel, lonLat) {
    if (!channel || !Array.isArray(channel.points) || !lonLat) return null;
    const pointerScreen = projectGeoToScreen(lonLat[0], lonLat[1]);
    if (!pointerScreen) return null;
    let best = null;
    channel.points.forEach((point) => {
      const pointScreen = projectGeoToScreen(point.lon, point.lat);
      if (!pointScreen) return;
      const centerDistance = Math.hypot(pointerScreen[0] - pointScreen[0], pointerScreen[1] - pointScreen[1]);
      const radiusPx = getProjectedDegreeRadiusPx(point.lon, point.lat, point.radiusDeg);
      const radiusDistance = Math.abs(centerDistance - radiusPx);
      if (centerDistance <= 12 && (!best || centerDistance < best.distance)) {
        best = { point, mode: "move", distance: centerDistance };
      } else if (radiusDistance <= 10 && (!best || radiusDistance < best.distance)) {
        best = { point, mode: "radius", distance: radiusDistance };
      }
    });
    return best;
  }

  return {
    getMapLonLatFromEvent,
    projectGeoToScreen,
    hidePhysicalIntensityBrushPreview,
    renderPhysicalIntensityBrushPreview,
    updatePhysicalIntensityBrushPreviewFromEvent,
    getPhysicalIntensityPointHit,
  };
}

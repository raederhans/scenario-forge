function requireFunction(owner, name, ownerName) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`renderer viewport update owner requires ${ownerName}.${name}`);
  }
  return owner[name].bind(owner);
}

export function createRendererViewportUpdateOwner({
  effects = {},
  getters = {},
} = {}) {
  const getViewportGroup = requireFunction(getters, "getViewportGroup", "getters");
  const getPresentedTransform = typeof getters.getPresentedTransform === "function"
    ? getters.getPresentedTransform.bind(getters)
    : null;
  const setZoomTransform = requireFunction(effects, "setZoomTransform", "effects");
  const setHitCanvasDirty = requireFunction(effects, "setHitCanvasDirty", "effects");
  const updateZoomUi = requireFunction(effects, "updateZoomUi", "effects");
  const renderPhysicalIntensityBrushPreview = requireFunction(
    effects,
    "renderPhysicalIntensityBrushPreview",
    "effects",
  );
  const syncUnitCounterScalesDuringZoom = requireFunction(
    effects,
    "syncUnitCounterScalesDuringZoom",
    "effects",
  );
  const syncSpecialZonePatternTransformDuringZoom = requireFunction(
    effects,
    "syncSpecialZonePatternTransformDuringZoom",
    "effects",
  );
  const drawFrame = requireFunction(effects, "drawFrame", "effects");

  function applyViewportTransform(transform) {
    if (!transform) return;
    const viewportGroup = getViewportGroup();
    if (viewportGroup) {
      viewportGroup.attr("transform", `translate(${transform.x},${transform.y}) scale(${transform.k})`);
    }
  }

  function updateMap(transform) {
    setZoomTransform(transform);
    setHitCanvasDirty();
    updateZoomUi();
    if (getPresentedTransform) {
      drawFrame();
      applyViewportTransform(getPresentedTransform() || transform);
      renderPhysicalIntensityBrushPreview();
      syncUnitCounterScalesDuringZoom();
      syncSpecialZonePatternTransformDuringZoom();
      return;
    }
    applyViewportTransform(transform);
    renderPhysicalIntensityBrushPreview();
    syncUnitCounterScalesDuringZoom();
    syncSpecialZonePatternTransformDuringZoom();
    drawFrame();
  }

  return Object.freeze({
    updateMap,
    applyViewportTransform,
  });
}

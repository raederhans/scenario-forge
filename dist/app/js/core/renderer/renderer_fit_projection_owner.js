import { markProjectionGeometryChanged } from "./projection_geometry_identity.js";

function getLandFeatures(state) {
  const features = state?.landData?.features;
  return Array.isArray(features) ? features : [];
}

function getViewportSize(state) {
  return {
    width: Number(state?.width || 0),
    height: Number(state?.height || 0),
  };
}

function getProjection(surfaceHost) {
  return typeof surfaceHost?.getProjection === "function"
    ? surfaceHost.getProjection()
    : null;
}

function requireFunction(owner, name, ownerName) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`renderer fit projection owner requires ${ownerName}.${name}`);
  }
  return owner[name].bind(owner);
}

function requireFiniteNumber(owner, name, ownerName) {
  if (!Object.hasOwn(owner ?? {}, name)) {
    throw new TypeError(`renderer fit projection owner requires ${ownerName}.${name}`);
  }
  const value = Number(owner[name]);
  if (!Number.isFinite(value)) {
    throw new TypeError(`renderer fit projection owner requires finite ${ownerName}.${name}`);
  }
  return value;
}

function getRenderableFeatures(getRenderableLandFeatures, canvasWidth, canvasHeight) {
  const features = getRenderableLandFeatures(canvasWidth, canvasHeight, {
    forceProd: true,
  });
  return Array.isArray(features) ? features : [];
}

export function createRendererFitProjectionOwner({
  surfaceHost,
  state = {},
  constants = {},
  getters = {},
  effects = {},
} = {}) {
  const projectionFitPaddingRatio = requireFiniteNumber(
    constants,
    "projectionFitPaddingRatio",
    "constants",
  );
  const getLogicalCanvasDimensions = requireFunction(
    getters,
    "getLogicalCanvasDimensions",
    "getters",
  );
  const getRenderableLandFeatures = requireFunction(
    getters,
    "getRenderableLandFeatures",
    "getters",
  );
  const resetCityAnchorCache = requireFunction(effects, "resetCityAnchorCache", "effects");
  const rebuildProjectedBoundsCache = requireFunction(
    effects,
    "rebuildProjectedBoundsCache",
    "effects",
  );
  const buildSpatialIndex = requireFunction(effects, "buildSpatialIndex", "effects");
  const setHitCanvasDirty = requireFunction(effects, "setHitCanvasDirty", "effects");
  const updateSpecialZonesPaths = requireFunction(effects, "updateSpecialZonesPaths", "effects");
  const renderSpecialZoneEditorOverlay = requireFunction(
    effects,
    "renderSpecialZoneEditorOverlay",
    "effects",
  );
  const updateZoomTranslateExtent = requireFunction(
    effects,
    "updateZoomTranslateExtent",
    "effects",
  );
  const markAllOverlaysDirty = requireFunction(effects, "markAllOverlaysDirty", "effects");

  function fitProjection({ skipSpatialIndex = false } = {}) {
    const landFeatures = getLandFeatures(state);
    const { width, height } = getViewportSize(state);
    if (!landFeatures.length || width <= 0 || height <= 0) {
      return false;
    }

    const projection = getProjection(surfaceHost);
    const fitExtent = requireFunction(projection, "fitExtent", "surfaceHost.getProjection()");
    const padding = Math.max(16, Math.round(Math.min(width, height) * projectionFitPaddingRatio));
    const x1 = Math.max(padding + 1, width - padding);
    const y1 = Math.max(padding + 1, height - padding);
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    const renderableFeatures = getRenderableFeatures(
      getRenderableLandFeatures,
      canvasWidth,
      canvasHeight,
    );
    const fitTarget = renderableFeatures.length
      ? { type: "FeatureCollection", features: renderableFeatures }
      : state.landData;

    fitExtent([[padding, padding], [x1, y1]], fitTarget);
    markProjectionGeometryChanged(projection);
    resetCityAnchorCache();
    rebuildProjectedBoundsCache();
    if (!skipSpatialIndex) {
      buildSpatialIndex();
    }
    setHitCanvasDirty();
    updateSpecialZonesPaths();
    renderSpecialZoneEditorOverlay();
    updateZoomTranslateExtent();
    markAllOverlaysDirty();
    return true;
  }

  return Object.freeze({
    fitProjection,
  });
}

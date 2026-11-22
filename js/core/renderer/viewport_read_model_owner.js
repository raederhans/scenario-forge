import { wrapLongitude } from "./regional_camera.js";

const WORLD_GEO_BOUNDS = Object.freeze([-180, -90, 180, 90]);

function normalizeProjectedBounds(bounds) {
  const minX = Number(bounds?.minX);
  const minY = Number(bounds?.minY);
  const maxX = Number(bounds?.maxX);
  const maxY = Number(bounds?.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function mergeProjectedBounds(boundsSnapshots = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const snapshot of Array.isArray(boundsSnapshots) ? boundsSnapshots : []) {
    const bounds = normalizeProjectedBounds(snapshot);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  return normalizeProjectedBounds({ minX, minY, maxX, maxY });
}

export function createViewportReadModelOwner({
  constants = {},
  getters = {},
  capabilities = {},
} = {}) {
  const {
    mapPanPaddingPx = 50,
    viewportGeoBoundsInsetXRatio = 0.12,
    viewportGeoBoundsInsetYRatio = 0.12,
    viewportGeoBoundsInsetXMax = 160,
    viewportGeoBoundsInsetYMax = 120,
  } = constants;

  function getViewportDimensions({ min = 0 } = {}) {
    const dimensions = typeof getters.getViewportDimensions === "function"
      ? getters.getViewportDimensions()
      : null;
    return {
      width: Math.max(min, Number(dimensions?.width || min)),
      height: Math.max(min, Number(dimensions?.height || min)),
    };
  }

  function getViewportDpr() {
    return Number(typeof getters.getViewportDpr === "function"
      ? getters.getViewportDpr()
      : 1) || 1;
  }

  function getViewportRenderSignature() {
    const { width, height } = getViewportDimensions();
    return [
      Math.round(width),
      Math.round(height),
      Number(getViewportDpr().toFixed(2)),
    ].join("|");
  }

  function getProjectionRenderSignature() {
    const projection = typeof capabilities.getProjectionSnapshot === "function"
      ? capabilities.getProjectionSnapshot()
      : null;
    if (!projection) return "projection:na";
    const translate = projection.translate || [0, 0];
    return [projection.scale || 0, translate[0] || 0, translate[1] || 0,
      ...(projection.rotate?.some(Boolean) ? projection.rotate : [])]
      .map((value) => Number(Number(value).toFixed(3))).join("|");
  }

  function getViewportGeoBounds() {
    if (typeof capabilities.invertProjectionPoint !== "function") {
      return [...WORLD_GEO_BOUNDS];
    }
    const transform = typeof capabilities.getZoomTransformSnapshot === "function"
      ? capabilities.getZoomTransformSnapshot()
      : null;
    if (!transform) return [...WORLD_GEO_BOUNDS];
    const { width, height } = getViewportDimensions({ min: 1 });
    const insetX = Math.min(width * viewportGeoBoundsInsetXRatio, viewportGeoBoundsInsetXMax);
    const insetY = Math.min(height * viewportGeoBoundsInsetYRatio, viewportGeoBoundsInsetYMax);
    const regionalBounds = capabilities.getRegionalBounds?.();
    const samplePoints = [
      [insetX, insetY],
      [width * 0.5, insetY],
      [Math.max(insetX, width - insetX), insetY],
      [insetX, height * 0.5],
      [width * 0.5, height * 0.5],
      [Math.max(insetX, width - insetX), height * 0.5],
      [insetX, Math.max(insetY, height - insetY)],
      [width * 0.5, Math.max(insetY, height - insetY)],
      [Math.max(insetX, width - insetX), Math.max(insetY, height - insetY)],
    ];
    const meridian = regionalBounds ? -capabilities.getProjectionSnapshot().rotate[0] : 0;
    const longitudes = [];
    const latitudes = [];
    samplePoints.forEach(([screenX, screenY]) => {
      try {
        const mapX = (Number(screenX || 0) - Number(transform.x || 0))
          / Math.max(0.0001, Number(transform.k || 1));
        const mapY = (Number(screenY || 0) - Number(transform.y || 0))
          / Math.max(0.0001, Number(transform.k || 1));
        const inverted = capabilities.invertProjectionPoint(regionalBounds ? [
          Math.max(regionalBounds[0][0], Math.min(regionalBounds[1][0], mapX)),
          Math.max(regionalBounds[0][1], Math.min(regionalBounds[1][1], mapY)),
        ] : [mapX, mapY]);
        if (!Array.isArray(inverted) || inverted.length < 2) return;
        const [lon, lat] = inverted.map((value) => Number(value));
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        longitudes.push(regionalBounds ? wrapLongitude(lon - meridian) : Math.max(-180, Math.min(180, lon)));
        latitudes.push(Math.max(-90, Math.min(90, lat)));
      } catch (_error) {
        // Projection inversion can fail near singularities; remaining samples still define the view.
      }
    });
    if (!longitudes.length || !latitudes.length) return [...WORLD_GEO_BOUNDS];
    const sortedLongitudes = [...longitudes].sort((left, right) => left - right);
    const sortedLatitudes = [...latitudes].sort((left, right) => left - right);
    const trimCount = sortedLongitudes.length >= 7 && sortedLatitudes.length >= 7 ? 1 : 0;
    const longitudeAt = (index) => regionalBounds
      ? wrapLongitude(sortedLongitudes[index] + meridian) : sortedLongitudes[index];
    return [
      longitudeAt(trimCount),
      sortedLatitudes[trimCount],
      longitudeAt(sortedLongitudes.length - 1 - trimCount),
      sortedLatitudes[sortedLatitudes.length - 1 - trimCount],
    ];
  }

  function readBoundsSnapshots(name) {
    const read = capabilities[name];
    return typeof read === "function" ? read() : [];
  }

  function calculatePanExtent() {
    const { width, height } = getViewportDimensions();
    const fallback = [
      [-mapPanPaddingPx, -mapPanPaddingPx],
      [width + mapPanPaddingPx, height + mapPanPaddingPx],
    ];
    const region = capabilities.getRegionalBounds?.();
    const bounds = region
      ? { minX: region[0][0], minY: region[0][1], maxX: region[1][0], maxY: region[1][1] }
      : mergeProjectedBounds(readBoundsSnapshots("getPanContentBoundsSnapshots"));
    if (!bounds) return fallback;
    return [
      [bounds.minX - mapPanPaddingPx, bounds.minY - mapPanPaddingPx],
      [bounds.maxX + mapPanPaddingPx, bounds.maxY + mapPanPaddingPx],
    ];
  }

  function getProjectedRenderableContentBounds() {
    const region = capabilities.getRegionalBounds?.();
    if (region) return normalizeProjectedBounds({ minX: region[0][0], minY: region[0][1], maxX: region[1][0], maxY: region[1][1] });
    return mergeProjectedBounds(readBoundsSnapshots("getProjectedRenderableContentBoundsSnapshots"));
  }

  function getCenteredFitZoomTransform({ centerX = true, centerY = false } = {}) {
    if (typeof capabilities.createZoomTransform !== "function") return null;
    const bounds = getProjectedRenderableContentBounds();
    const { width: viewportWidth, height: viewportHeight } = getViewportDimensions({ min: 1 });
    const x = bounds && centerX && bounds.width < viewportWidth
      ? ((viewportWidth - bounds.width) / 2) - bounds.minX
      : 0;
    const y = bounds && centerY && bounds.height < viewportHeight
      ? ((viewportHeight - bounds.height) / 2) - bounds.minY
      : 0;
    return capabilities.createZoomTransform({ x, y, translate: Boolean(bounds) });
  }

  function getZoomPercent() {
    const transform = typeof capabilities.getZoomTransformSnapshot === "function"
      ? capabilities.getZoomTransformSnapshot()
      : null;
    const scale = Math.max(0.01, Number(transform?.k) || 1);
    return `${Math.round(scale * 100)}%`;
  }

  return Object.freeze({
    getViewportRenderSignature,
    getProjectionRenderSignature,
    getViewportGeoBounds,
    calculatePanExtent,
    getProjectedRenderableContentBounds,
    getCenteredFitZoomTransform,
    getZoomPercent,
  });
}

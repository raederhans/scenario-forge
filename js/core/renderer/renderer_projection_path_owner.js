import { markProjectionGeometryChanged } from "./projection_geometry_identity.js";

function requireObject(value, name) {
  if (!value || typeof value !== "object") {
    throw new TypeError(`renderer projection/path owner requires ${name}`);
  }
  return value;
}

function requireFunction(owner, name, ownerName) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`renderer projection/path owner requires ${ownerName}.${name}`);
  }
  return owner[name].bind(owner);
}

function requireValue(value, name) {
  if (value === undefined || value === null) {
    throw new TypeError(`renderer projection/path owner requires ${name}`);
  }
  return value;
}

function createPath({ geoPath, projection, context, pointRadius, label }) {
  const path = context === undefined
    ? geoPath(projection)
    : geoPath(projection, context);
  return requireFunction(path, "pointRadius", label)(pointRadius);
}

export function createRendererProjectionPathOwner({
  surfaceHost,
  getters = {},
  constants = {},
} = {}) {
  const host = requireObject(surfaceHost, "surfaceHost");
  const getD3 = requireFunction(getters, "getD3", "getters");
  const projectionPrecision = requireValue(constants.projectionPrecision, "constants.projectionPrecision");
  const pathPointRadius = requireValue(constants.pathPointRadius, "constants.pathPointRadius");

  const hostApi = Object.freeze({
    getContext: requireFunction(host, "getContext", "surfaceHost"),
    getHitContext: requireFunction(host, "getHitContext", "surfaceHost"),
    setPathCanvas: requireFunction(host, "setPathCanvas", "surfaceHost"),
    setPathHitCanvas: requireFunction(host, "setPathHitCanvas", "surfaceHost"),
    setPathSvg: requireFunction(host, "setPathSvg", "surfaceHost"),
    setProjection: requireFunction(host, "setProjection", "surfaceHost"),
  });

  function getRequiredD3() {
    const d3 = getD3();
    requireObject(d3, "d3");
    requireFunction(d3, "geoEqualEarth", "d3");
    requireFunction(d3, "geoPath", "d3");
    return d3;
  }

  function getRequiredContext(name, getter) {
    const value = getter();
    if (!value) {
      throw new TypeError(`renderer projection/path owner requires surfaceHost.${name}`);
    }
    return value;
  }

  function initializeProjectionPaths() {
    const d3 = getRequiredD3();
    const context = getRequiredContext("context", hostApi.getContext);
    const hitContext = getRequiredContext("hitContext", hostApi.getHitContext);
    const rawProjection = d3.geoEqualEarth();
    const projection = requireFunction(rawProjection, "precision", "d3.geoEqualEarth()")(projectionPrecision);
    const nextProjection = hostApi.setProjection(projection);
    requireFunction(nextProjection, "clipExtent", "surfaceHost.setProjection(projection)")(null);
    markProjectionGeometryChanged(nextProjection);
    const pathSvg = hostApi.setPathSvg(createPath({
      geoPath: d3.geoPath.bind(d3),
      projection: nextProjection,
      pointRadius: pathPointRadius,
      label: "d3.geoPath()",
    }));
    const pathCanvas = hostApi.setPathCanvas(createPath({
      geoPath: d3.geoPath.bind(d3),
      projection: nextProjection,
      context,
      pointRadius: pathPointRadius,
      label: "d3.geoPath(projection, context)",
    }));
    const pathHitCanvas = hostApi.setPathHitCanvas(createPath({
      geoPath: d3.geoPath.bind(d3),
      projection: nextProjection,
      context: hitContext,
      pointRadius: pathPointRadius,
      label: "d3.geoPath(projection, hitContext)",
    }));

    return Object.freeze({
      context,
      hitContext,
      pathCanvas,
      pathHitCanvas,
      pathSvg,
      projection: nextProjection,
    });
  }

  return Object.freeze({
    initializeProjectionPaths,
  });
}

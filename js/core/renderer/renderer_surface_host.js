const RENDERER_SURFACE_HANDLE_DEFINITIONS = Object.freeze([
  ["mapContainer", "getMapContainer", "setMapContainer"],
  ["canvasLayers", "getCanvasLayers", "setCanvasLayers"],
  ["mapCanvas", "getMapCanvas", "setMapCanvas"],
  ["politicalPatchCanvas", "getPoliticalPatchCanvas", "setPoliticalPatchCanvas"],
  ["interactionOverlayCanvas", "getInteractionOverlayCanvas", "setInteractionOverlayCanvas"],
  ["hitCanvas", "getHitCanvas", "setHitCanvas"],
  ["mapSvg", "getMapSvg", "setMapSvg"],
  ["interactionRect", "getInteractionRect", "setInteractionRect"],
  ["tooltip", "getTooltip", "setTooltip"],
  ["context", "getContext", "setContext"],
  ["politicalPatchContext", "getPoliticalPatchContext", "setPoliticalPatchContext"],
  ["interactionOverlayContext", "getInteractionOverlayContext", "setInteractionOverlayContext"],
  ["hitContext", "getHitContext", "setHitContext"],
  ["projection", "getProjection", "setProjection"],
  ["pathSVG", "getPathSvg", "setPathSvg"],
  ["pathCanvas", "getPathCanvas", "setPathCanvas"],
  ["pathHitCanvas", "getPathHitCanvas", "setPathHitCanvas"],
  ["zoomBehavior", "getZoomBehavior", "setZoomBehavior"],
  ["viewportGroup", "getViewportGroup", "setViewportGroup"],
  ["strategicDefs", "getStrategicDefs", "setStrategicDefs"],
  ["operationalLinesGroup", "getOperationalLinesGroup", "setOperationalLinesGroup"],
  ["operationGraphicsGroup", "getOperationGraphicsGroup", "setOperationGraphicsGroup"],
  ["operationGraphicsEditorGroup", "getOperationGraphicsEditorGroup", "setOperationGraphicsEditorGroup"],
  ["unitCountersGroup", "getUnitCountersGroup", "setUnitCountersGroup"],
  ["specialZonesGroup", "getSpecialZonesGroup", "setSpecialZonesGroup"],
  ["specialZoneEditorGroup", "getSpecialZoneEditorGroup", "setSpecialZoneEditorGroup"],
  ["hoverGroup", "getHoverGroup", "setHoverGroup"],
  ["devSelectionGroup", "getDevSelectionGroup", "setDevSelectionGroup"],
  ["inspectorHighlightGroup", "getInspectorHighlightGroup", "setInspectorHighlightGroup"],
  ["intensityFieldPreviewGroup", "getIntensityFieldPreviewGroup", "setIntensityFieldPreviewGroup"],
]);

export const RENDERER_SURFACE_HANDLE_KEYS = Object.freeze(
  RENDERER_SURFACE_HANDLE_DEFINITIONS.map(([key]) => key),
);

function createEmptyHandles() {
  return Object.fromEntries(RENDERER_SURFACE_HANDLE_KEYS.map((key) => [key, null]));
}

function normalizeHandleValue(value) {
  return value === undefined ? null : value;
}

function describeHandle(value) {
  return Object.freeze({
    present: value !== null,
    type: value === null ? "null" : typeof value,
  });
}

export function createRendererSurfaceHost(options = {}) {
  const initialHandles = options?.handles && typeof options.handles === "object"
    ? options.handles
    : {};
  const handles = createEmptyHandles();

  function reset() {
    for (const key of RENDERER_SURFACE_HANDLE_KEYS) {
      handles[key] = null;
    }
  }

  function setMany(values = {}) {
    for (const key of RENDERER_SURFACE_HANDLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        handles[key] = normalizeHandleValue(values[key]);
      }
    }
    return surfaceHost;
  }

  function snapshot() {
    return Object.freeze(Object.fromEntries(
      RENDERER_SURFACE_HANDLE_KEYS.map((key) => [key, describeHandle(handles[key])]),
    ));
  }

  const surfaceHost = {
    reset,
    setMany,
    snapshot,
  };

  for (const [key, getterName, setterName] of RENDERER_SURFACE_HANDLE_DEFINITIONS) {
    surfaceHost[getterName] = () => handles[key];
    surfaceHost[setterName] = (value) => {
      handles[key] = normalizeHandleValue(value);
      return handles[key];
    };
  }

  setMany(initialHandles);

  return Object.freeze(surfaceHost);
}

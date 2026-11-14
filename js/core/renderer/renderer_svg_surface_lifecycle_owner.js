const SVG_NS = "http://www.w3.org/2000/svg";

const VIEWPORT_GROUP_DEFINITIONS = Object.freeze([
  {
    selector: "g.operational-lines-layer",
    className: "operational-lines-layer",
    setter: "setOperationalLinesGroup",
    pointerEvents: "none",
    label: "Operational lines",
  },
  {
    selector: "g.operation-graphics-layer",
    className: "operation-graphics-layer",
    setter: "setOperationGraphicsGroup",
    pointerEvents: "none",
    label: "Strategic operation graphics",
  },
  {
    selector: "g.operation-graphics-editor-layer",
    className: "operation-graphics-editor-layer",
    setter: "setOperationGraphicsEditorGroup",
    pointerEvents: "all",
    label: "Strategic operation graphics editor",
  },
  {
    selector: "g.unit-counters-layer",
    className: "unit-counters-layer",
    setter: "setUnitCountersGroup",
    pointerEvents: "all",
    label: "Strategic unit counters",
  },
  {
    selector: "g.special-zones-layer",
    className: "special-zones-layer",
    setter: "setSpecialZonesGroup",
    pointerEvents: "none",
    label: "Special zones overlay",
  },
  {
    selector: "g.special-zone-editor-layer",
    className: "special-zone-editor-layer",
    setter: "setSpecialZoneEditorGroup",
    pointerEvents: "none",
    label: "Special zone drawing overlay",
  },
  {
    selector: "g.hover-layer",
    className: "hover-layer",
    setter: "setHoverGroup",
    pointerEvents: "none",
    label: "Hovered region outline overlay",
  },
  {
    selector: "g.dev-selection-layer",
    className: "dev-selection-layer",
    setter: "setDevSelectionGroup",
    pointerEvents: "none",
    label: "Development selection overlay",
  },
  {
    selector: "g.inspector-highlight-layer",
    className: "inspector-highlight-layer",
    setter: "setInspectorHighlightGroup",
    pointerEvents: "none",
    label: "Inspector highlight overlay",
  },
]);

function requireObject(value, name) {
  if (!value || typeof value !== "object") {
    throw new TypeError(`renderer svg surface lifecycle owner requires ${name}`);
  }
  return value;
}

function requireFunction(owner, name, ownerName) {
  if (typeof owner?.[name] !== "function") {
    throw new TypeError(`renderer svg surface lifecycle owner requires ${ownerName}.${name}`);
  }
  return owner[name].bind(owner);
}

function addClasses(element, classNames) {
  if (element.classList?.add) {
    element.classList.add(...classNames);
    return;
  }
  const currentClasses = new Set(String(element.getAttribute?.("class") || "").split(/\s+/).filter(Boolean));
  for (const className of classNames) currentClasses.add(className);
  element.setAttribute?.("class", [...currentClasses].join(" "));
}

function applySvgRootProps(svgElement) {
  svgElement.setAttribute("id", "map-svg");
  addClasses(svgElement, ["map-layer", "map-layer-top"]);
  svgElement.style.position = "absolute";
  svgElement.style.inset = "0";
  svgElement.style.display = "block";
  svgElement.style.zIndex = "3";
  svgElement.style.pointerEvents = "none";
}

function createDefaultSvgElement(mapContainer) {
  const documentRef = mapContainer.ownerDocument;
  if (!documentRef || typeof documentRef.createElementNS !== "function") {
    throw new TypeError("renderer svg surface lifecycle owner requires mapContainer.ownerDocument.createElementNS");
  }
  return documentRef.createElementNS(SVG_NS, "svg");
}

function requireMapContainer(value) {
  if (!value || typeof value.querySelector !== "function" || typeof value.appendChild !== "function") {
    throw new TypeError("renderer svg surface lifecycle owner requires surfaceHost.mapContainer");
  }
  return value;
}

function getRequiredD3Select(getD3) {
  const d3 = getD3();
  requireObject(d3, "d3");
  return requireFunction(d3, "select", "d3");
}

function selectOrAppend(parentSelection, selector, elementName, className) {
  let selection = parentSelection.select(selector);
  if (selection.empty()) {
    selection = parentSelection.append(elementName).attr("class", className);
  }
  return selection;
}

function applyOverlayAttrs(selection, definition) {
  return selection
    .style("pointer-events", definition.pointerEvents)
    .attr("role", "img")
    .attr("aria-label", definition.label)
    .attr("aria-hidden", "true")
    .attr("focusable", "false");
}

export function createRendererSvgSurfaceLifecycleOwner({
  surfaceHost,
  getters = {},
  helpers = {},
} = {}) {
  const host = requireObject(surfaceHost, "surfaceHost");
  const getD3 = requireFunction(getters, "getD3", "getters");
  const createSvgElement = typeof helpers.createSvgElement === "function"
    ? helpers.createSvgElement.bind(helpers)
    : createDefaultSvgElement;

  const hostApi = Object.freeze({
    getMapContainer: requireFunction(host, "getMapContainer", "surfaceHost"),
    setDevSelectionGroup: requireFunction(host, "setDevSelectionGroup", "surfaceHost"),
    setHoverGroup: requireFunction(host, "setHoverGroup", "surfaceHost"),
    setInspectorHighlightGroup: requireFunction(host, "setInspectorHighlightGroup", "surfaceHost"),
    setIntensityFieldPreviewGroup: requireFunction(host, "setIntensityFieldPreviewGroup", "surfaceHost"),
    setInteractionRect: requireFunction(host, "setInteractionRect", "surfaceHost"),
    setMapSvg: requireFunction(host, "setMapSvg", "surfaceHost"),
    setOperationGraphicsEditorGroup: requireFunction(host, "setOperationGraphicsEditorGroup", "surfaceHost"),
    setOperationGraphicsGroup: requireFunction(host, "setOperationGraphicsGroup", "surfaceHost"),
    setOperationalLinesGroup: requireFunction(host, "setOperationalLinesGroup", "surfaceHost"),
    setSpecialZoneEditorGroup: requireFunction(host, "setSpecialZoneEditorGroup", "surfaceHost"),
    setSpecialZonesGroup: requireFunction(host, "setSpecialZonesGroup", "surfaceHost"),
    setStrategicDefs: requireFunction(host, "setStrategicDefs", "surfaceHost"),
    setUnitCountersGroup: requireFunction(host, "setUnitCountersGroup", "surfaceHost"),
    setViewportGroup: requireFunction(host, "setViewportGroup", "surfaceHost"),
  });

  function ensureSvgSurface() {
    const mapContainer = requireMapContainer(hostApi.getMapContainer());
    let nextMapSvg = mapContainer.querySelector("#map-svg");
    if (!nextMapSvg) {
      nextMapSvg = createSvgElement(mapContainer);
      mapContainer.appendChild(nextMapSvg);
    }
    applySvgRootProps(nextMapSvg);

    const mapSvg = hostApi.setMapSvg(nextMapSvg);
    const svg = getRequiredD3Select(getD3)(mapSvg);
    svg.style("pointer-events", "none");

    const viewportGroup = hostApi.setViewportGroup(
      selectOrAppend(svg, "g.viewport-layer", "g", "viewport-layer")
        .style("pointer-events", "none"),
    );
    const strategicDefs = hostApi.setStrategicDefs(
      selectOrAppend(svg, "defs.strategic-overlay-defs", "defs", "strategic-overlay-defs"),
    );

    const handles = {
      mapSvg,
      strategicDefs,
      viewportGroup,
    };

    for (const definition of VIEWPORT_GROUP_DEFINITIONS) {
      const group = applyOverlayAttrs(
        selectOrAppend(viewportGroup, definition.selector, "g", definition.className),
        definition,
      );
      handles[definition.setter.replace(/^set/, "").replace(/^\w/, (letter) => letter.toLowerCase())] = hostApi[definition.setter](group);
    }

    const intensityFieldPreviewGroup = hostApi.setIntensityFieldPreviewGroup(
      selectOrAppend(svg, "g.intensity-field-preview-layer", "g", "intensity-field-preview-layer")
        .style("pointer-events", "none")
        .attr("aria-hidden", "true")
        .attr("focusable", "false")
        .style("display", "none"),
    );

    let interactionRect = svg.select("rect.interaction-layer");
    if (interactionRect.empty()) {
      interactionRect = svg
        .append("rect")
        .attr("class", "interaction-layer")
        .attr("fill", "transparent");
    }
    interactionRect = hostApi.setInteractionRect(interactionRect);
    interactionRect
      .style("pointer-events", "all")
      // Keep the shared hit target behind editor handles.
      .lower();

    return Object.freeze({
      ...handles,
      intensityFieldPreviewGroup,
      interactionRect,
    });
  }

  return Object.freeze({
    ensureSvgSurface,
  });
}

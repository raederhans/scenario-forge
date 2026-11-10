import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createRendererSvgSurfaceLifecycleOwner } from "../js/core/renderer/renderer_svg_surface_lifecycle_owner.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ROOT_CHILD_ORDER = Object.freeze([
  "interaction-layer",
  "viewport-layer",
  "strategic-overlay-defs",
  "intensity-field-preview-layer",
]);

const VIEWPORT_GROUP_ORDER = Object.freeze([
  "frontline-overlay-layer",
  "frontline-labels-layer",
  "operational-lines-layer",
  "operation-graphics-layer",
  "operation-graphics-editor-layer",
  "unit-counters-layer",
  "special-zones-layer",
  "special-zone-editor-layer",
  "hover-layer",
  "dev-selection-layer",
  "inspector-highlight-layer",
]);

const SETTER_ORDER = Object.freeze([
  "setMapSvg",
  "setViewportGroup",
  "setStrategicDefs",
  "setFrontlineOverlayGroup",
  "setFrontlineLabelsGroup",
  "setOperationalLinesGroup",
  "setOperationGraphicsGroup",
  "setOperationGraphicsEditorGroup",
  "setUnitCountersGroup",
  "setSpecialZonesGroup",
  "setSpecialZoneEditorGroup",
  "setHoverGroup",
  "setDevSelectionGroup",
  "setInspectorHighlightGroup",
  "setIntensityFieldPreviewGroup",
  "setInteractionRect",
]);

class FakeElement {
  constructor(tagName, ownerDocument, namespaceURI = SVG_NS) {
    this.attributes = new Map();
    this.children = [];
    this.classNames = new Set();
    this.id = "";
    this.lowerCallCount = 0;
    this.namespaceURI = namespaceURI;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.style = {};
    this.tagName = tagName.toLowerCase();
    this.classList = {
      add: (...names) => {
        for (const name of names) this.classNames.add(name);
        this.attributes.set("class", [...this.classNames].join(" "));
      },
      contains: (name) => this.classNames.has(name),
    };
  }

  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  querySelector(selector) {
    return findDescendant(this, selector);
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "id") this.id = stringValue;
    if (name === "class") {
      this.classNames = new Set(stringValue.split(/\s+/).filter(Boolean));
    }
  }
}

class FakeDocument {
  createElementNS(namespaceURI, tagName) {
    return new FakeElement(tagName, this, namespaceURI);
  }
}

class FakeSelection {
  constructor(element) {
    this.element = element || null;
  }

  append(tagName) {
    const child = this.element.ownerDocument.createElementNS(SVG_NS, tagName);
    this.element.appendChild(child);
    return new FakeSelection(child);
  }

  attr(name, value) {
    if (this.element) this.element.setAttribute(name, value);
    return this;
  }

  empty() {
    return !this.element;
  }

  lower() {
    if (this.element?.parentNode) {
      const siblings = this.element.parentNode.children;
      const currentIndex = siblings.indexOf(this.element);
      if (currentIndex >= 0) {
        siblings.splice(currentIndex, 1);
        siblings.unshift(this.element);
      }
      this.element.lowerCallCount += 1;
    }
    return this;
  }

  select(selector) {
    if (!this.element) return new FakeSelection(null);
    return new FakeSelection(this.element.querySelector(selector));
  }

  style(name, value) {
    if (this.element) this.element.style[name] = String(value);
    return this;
  }
}

function findDescendant(root, selector) {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) return child;
    const nestedMatch = findDescendant(child, selector);
    if (nestedMatch) return nestedMatch;
  }
  return null;
}

function matchesSelector(element, selector) {
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  const [tagName, className] = selector.split(".");
  const tagMatches = !tagName || element.tagName === tagName.toLowerCase();
  const classMatches = !className || element.classNames.has(className);
  return tagMatches && classMatches;
}

function createSurfaceHost(mapContainer) {
  const calls = [];
  const handles = {};

  function setter(methodName, key) {
    return (value) => {
      calls.push({ methodName, value });
      handles[key] = value;
      return value;
    };
  }

  return {
    calls,
    handles,
    getMapContainer: () => mapContainer,
    setDevSelectionGroup: setter("setDevSelectionGroup", "devSelectionGroup"),
    setFrontlineLabelsGroup: setter("setFrontlineLabelsGroup", "frontlineLabelsGroup"),
    setFrontlineOverlayGroup: setter("setFrontlineOverlayGroup", "frontlineOverlayGroup"),
    setHoverGroup: setter("setHoverGroup", "hoverGroup"),
    setInspectorHighlightGroup: setter("setInspectorHighlightGroup", "inspectorHighlightGroup"),
    setIntensityFieldPreviewGroup: setter("setIntensityFieldPreviewGroup", "intensityFieldPreviewGroup"),
    setInteractionRect: setter("setInteractionRect", "interactionRect"),
    setMapSvg: setter("setMapSvg", "mapSvg"),
    setOperationGraphicsEditorGroup: setter("setOperationGraphicsEditorGroup", "operationGraphicsEditorGroup"),
    setOperationGraphicsGroup: setter("setOperationGraphicsGroup", "operationGraphicsGroup"),
    setOperationalLinesGroup: setter("setOperationalLinesGroup", "operationalLinesGroup"),
    setSpecialZoneEditorGroup: setter("setSpecialZoneEditorGroup", "specialZoneEditorGroup"),
    setSpecialZonesGroup: setter("setSpecialZonesGroup", "specialZonesGroup"),
    setStrategicDefs: setter("setStrategicDefs", "strategicDefs"),
    setUnitCountersGroup: setter("setUnitCountersGroup", "unitCountersGroup"),
    setViewportGroup: setter("setViewportGroup", "viewportGroup"),
  };
}

function createHarness() {
  const documentRef = new FakeDocument();
  const mapContainer = documentRef.createElementNS(SVG_NS, "div");
  const surfaceHost = createSurfaceHost(mapContainer);
  const d3 = {
    select: (element) => new FakeSelection(element),
  };
  const owner = createRendererSvgSurfaceLifecycleOwner({
    surfaceHost,
    getters: {
      getD3: () => d3,
    },
  });
  return {
    documentRef,
    d3,
    mapContainer,
    owner,
    surfaceHost,
  };
}

function childClassNames(element) {
  return element.children.map((child) => child.getAttribute("class"));
}

function countMapSvg(container) {
  return container.children.filter((child) => child.id === "map-svg").length;
}

test("creates and registers SVG root groups in the expected order", () => {
  const { mapContainer, owner, surfaceHost } = createHarness();

  const result = owner.ensureSvgSurface();
  const mapSvg = mapContainer.querySelector("#map-svg");

  assert.equal(Object.isFrozen(result), true);
  assert.equal(mapSvg.namespaceURI, SVG_NS);
  assert.equal(mapSvg.getAttribute("id"), "map-svg");
  assert.equal(mapSvg.classList.contains("map-layer"), true);
  assert.equal(mapSvg.classList.contains("map-layer-top"), true);
  assert.equal(mapSvg.style.display, "block");
  assert.equal(mapSvg.style.inset, "0");
  assert.equal(mapSvg.style.pointerEvents, "none");
  assert.equal(mapSvg.style["pointer-events"], "none");
  assert.equal(mapSvg.style.position, "absolute");
  assert.equal(mapSvg.style.zIndex, "3");
  assert.equal(result.mapSvg, mapSvg);
  assert.equal(surfaceHost.handles.mapSvg, mapSvg);
  assert.deepEqual(surfaceHost.calls.map((call) => call.methodName), SETTER_ORDER);
  assert.deepEqual(childClassNames(mapSvg), ROOT_CHILD_ORDER);
  assert.deepEqual(childClassNames(surfaceHost.handles.viewportGroup.element), VIEWPORT_GROUP_ORDER);
  assert.equal(surfaceHost.handles.operationGraphicsEditorGroup.element.style["pointer-events"], "all");
  assert.equal(surfaceHost.handles.unitCountersGroup.element.style["pointer-events"], "all");
  assert.equal(surfaceHost.handles.frontlineOverlayGroup.element.getAttribute("role"), "img");
  assert.equal(surfaceHost.handles.interactionRect.element.getAttribute("fill"), "transparent");
  assert.equal(surfaceHost.handles.interactionRect.element.style["pointer-events"], "all");
  assert.equal(surfaceHost.handles.interactionRect.element.lowerCallCount, 1);
});

test("reuses an existing map SVG without duplicating root nodes", () => {
  const { documentRef, mapContainer, owner, surfaceHost } = createHarness();
  const existingSvg = documentRef.createElementNS(SVG_NS, "svg");
  existingSvg.setAttribute("id", "map-svg");
  mapContainer.appendChild(existingSvg);

  const firstResult = owner.ensureSvgSurface();
  const secondResult = owner.ensureSvgSurface();

  assert.equal(firstResult.mapSvg, existingSvg);
  assert.equal(secondResult.mapSvg, existingSvg);
  assert.equal(surfaceHost.handles.mapSvg, existingSvg);
  assert.equal(countMapSvg(mapContainer), 1);
});

test("fails fast when required dependencies are missing", () => {
  const { d3, surfaceHost } = createHarness();

  assert.throws(
    () => createRendererSvgSurfaceLifecycleOwner(),
    /requires surfaceHost/,
  );
  assert.throws(
    () => createRendererSvgSurfaceLifecycleOwner({
      surfaceHost,
      getters: {},
    }),
    /requires getters\.getD3/,
  );
  assert.throws(
    () => createRendererSvgSurfaceLifecycleOwner({
      surfaceHost: { ...surfaceHost, setMapSvg: null },
      getters: { getD3: () => d3 },
    }),
    /requires surfaceHost\.setMapSvg/,
  );
  assert.throws(
    () => createRendererSvgSurfaceLifecycleOwner({
      surfaceHost: { ...surfaceHost, getMapContainer: () => null },
      getters: { getD3: () => d3 },
    }).ensureSvgSurface(),
    /requires surfaceHost\.mapContainer/,
  );
  assert.throws(
    () => createRendererSvgSurfaceLifecycleOwner({
      surfaceHost,
      getters: { getD3: () => ({}) },
    }).ensureSvgSurface(),
    /requires d3\.select/,
  );
});


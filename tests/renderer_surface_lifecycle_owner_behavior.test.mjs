import assert from "node:assert/strict";
import test from "node:test";

import { createRendererSurfaceLifecycleOwner } from "../js/core/renderer/renderer_surface_lifecycle_owner.js";
import { CANVAS_LAYER_NAMES } from "../js/core/map_renderer/canvas_layer_manager.js";

function createCanvas(name, calls = []) {
  return {
    name,
    getContext(type, options) {
      const context = { canvas: this, name: `${name}-context`, options: options || null, type };
      calls.push({ canvas: name, context, options: options || null, type });
      return context;
    },
  };
}

function createSurfaceHost(initialHandles = {}) {
  const handles = { ...initialHandles };
  const calls = [];

  function setter(methodName, key) {
    return (value) => {
      calls.push({ methodName, value });
      handles[key] = value ?? null;
      return handles[key];
    };
  }

  const host = {
    calls,
    handles,
    getHitCanvas: () => handles.hitCanvas || null,
    getMapCanvas: () => handles.mapCanvas || null,
    getMapContainer: () => handles.mapContainer || null,
    getPoliticalPatchCanvas: () => handles.politicalPatchCanvas || null,
    getInteractionOverlayCanvas: () => handles.interactionOverlayCanvas || null,
    setCanvasLayers: setter("setCanvasLayers", "canvasLayers"),
    setContext: setter("setContext", "context"),
    setHitCanvas: setter("setHitCanvas", "hitCanvas"),
    setHitContext: setter("setHitContext", "hitContext"),
    setInteractionOverlayCanvas: setter("setInteractionOverlayCanvas", "interactionOverlayCanvas"),
    setInteractionOverlayContext: setter("setInteractionOverlayContext", "interactionOverlayContext"),
    setMapCanvas: setter("setMapCanvas", "mapCanvas"),
    setMapContainer: setter("setMapContainer", "mapContainer"),
    setPoliticalPatchCanvas: setter("setPoliticalPatchCanvas", "politicalPatchCanvas"),
    setPoliticalPatchContext: setter("setPoliticalPatchContext", "politicalPatchContext"),
    setTooltip: setter("setTooltip", "tooltip"),
  };
  return host;
}

function createBaseDeps(overrides = {}) {
  const host = overrides.surfaceHost || createSurfaceHost();
  const documentCalls = [];
  const documentNodes = {
    mapContainer: { id: "mapContainer" },
    tooltip: { id: "tooltip" },
  };
  const documentRef = {
    getElementById(id) {
      documentCalls.push(id);
      return documentNodes[id] || null;
    },
  };
  const canvasCalls = [];
  const canvasLayerManager = {
    CANVAS_LAYER_NAMES,
    ensureCanvasLayers(container, options) {
      canvasCalls.push({ container, methodName: "ensureCanvasLayers", options });
      return {
        [CANVAS_LAYER_NAMES.composite]: { canvas: createCanvas("map") },
        [CANVAS_LAYER_NAMES.politicalPatch]: { canvas: createCanvas("politicalPatch") },
        [CANVAS_LAYER_NAMES.interactionOverlay]: { canvas: createCanvas("interactionOverlay") },
      };
    },
    getCanvasLayer(layers, name) {
      canvasCalls.push({ methodName: "getCanvasLayer", name });
      return layers[name] || null;
    },
  };
  return {
    canvasCalls,
    documentCalls,
    documentNodes,
    documentRef,
    surfaceHost: host,
    owner: createRendererSurfaceLifecycleOwner({
      surfaceHost: host,
      getters: { getDocument: () => documentRef },
      helpers: { createHitCanvasElement: () => createCanvas("hit") },
      canvasLayerManager,
      ...overrides,
    }),
  };
}

test("resolves map container and tooltip through the supplied document getter", () => {
  const { documentCalls, documentNodes, owner, surfaceHost } = createBaseDeps();

  const result = owner.resolveDomHandles({ containerId: "mapContainer" });

  assert.deepEqual(documentCalls, ["mapContainer", "tooltip"]);
  assert.equal(result.mapContainer, documentNodes.mapContainer);
  assert.equal(result.tooltip, documentNodes.tooltip);
  assert.equal(surfaceHost.handles.mapContainer, documentNodes.mapContainer);
  assert.equal(surfaceHost.handles.tooltip, documentNodes.tooltip);
});

test("registers named canvas layer handles through injected canvas layer helpers", () => {
  const surfaceHost = createSurfaceHost({ mapContainer: { id: "root" } });
  const before = { id: "legacyColorCanvas" };
  const { canvasCalls, owner } = createBaseDeps({ surfaceHost });

  const result = owner.ensureCanvasLayerHandles({ before });

  assert.equal(canvasCalls[0].methodName, "ensureCanvasLayers");
  assert.equal(canvasCalls[0].container, surfaceHost.handles.mapContainer);
  assert.deepEqual(canvasCalls[0].options, { before });
  assert.deepEqual(
    canvasCalls.filter((call) => call.methodName === "getCanvasLayer").map((call) => call.name),
    [
      CANVAS_LAYER_NAMES.composite,
      CANVAS_LAYER_NAMES.politicalPatch,
      CANVAS_LAYER_NAMES.interactionOverlay,
    ],
  );
  assert.equal(result.mapCanvas.name, "map");
  assert.equal(surfaceHost.handles.mapCanvas.name, "map");
  assert.equal(surfaceHost.handles.politicalPatchCanvas.name, "politicalPatch");
  assert.equal(surfaceHost.handles.interactionOverlayCanvas.name, "interactionOverlay");
});

test("creates a hit canvas only when the host has none", () => {
  const surfaceHost = createSurfaceHost();
  let createdCount = 0;
  const owner = createRendererSurfaceLifecycleOwner({
    surfaceHost,
    getters: { getDocument: () => ({ getElementById: () => null }) },
    helpers: {
      createHitCanvasElement: () => {
        createdCount += 1;
        return createCanvas(`hit-${createdCount}`);
      },
    },
    canvasLayerManager: {
      CANVAS_LAYER_NAMES,
      ensureCanvasLayers: () => ({}),
      getCanvasLayer: () => null,
    },
  });

  const firstHitCanvas = owner.ensureHitCanvasHandle();
  const secondHitCanvas = owner.ensureHitCanvasHandle();

  assert.equal(createdCount, 1);
  assert.equal(firstHitCanvas.name, "hit-1");
  assert.equal(secondHitCanvas, firstHitCanvas);
});

test("acquires map patch overlay and hit canvas contexts into the host", () => {
  const contextCalls = [];
  const surfaceHost = createSurfaceHost({
    hitCanvas: createCanvas("hit", contextCalls),
    interactionOverlayCanvas: createCanvas("interactionOverlay", contextCalls),
    mapCanvas: createCanvas("map", contextCalls),
    politicalPatchCanvas: createCanvas("politicalPatch", contextCalls),
  });
  const { owner } = createBaseDeps({ surfaceHost });

  const result = owner.acquireCanvasContexts();

  assert.equal(result.context.name, "map-context");
  assert.equal(result.politicalPatchContext.name, "politicalPatch-context");
  assert.equal(result.interactionOverlayContext.name, "interactionOverlay-context");
  assert.equal(result.hitContext.name, "hit-context");
  assert.deepEqual(contextCalls.map((call) => [call.canvas, call.type, call.options]), [
    ["map", "2d", null],
    ["politicalPatch", "2d", null],
    ["interactionOverlay", "2d", null],
    ["hit", "2d", { willReadFrequently: true }],
  ]);
  assert.equal(surfaceHost.handles.context, result.context);
  assert.equal(surfaceHost.handles.hitContext, result.hitContext);
});

test("fails fast when required dependencies are missing", () => {
  assert.throws(
    () => createRendererSurfaceLifecycleOwner(),
    /requires surfaceHost/,
  );
});

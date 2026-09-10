import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVAS_LAYER_NAMES,
  clearCanvasLayer,
  ensureCanvasLayers,
  getCanvasLayer,
  resizeCanvasLayers,
  shouldClearStaleCanvasOverlay,
} from "../js/core/map_renderer/canvas_layer_manager.js";

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.id = "";
    this.className = "";
    this.style = {};
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    child.parentNode = this;
    if (index < 0) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  contains(child) {
    return this.children.includes(child);
  }

  querySelector(selector) {
    if (!String(selector || "").startsWith("#")) {
      return null;
    }
    const id = String(selector).slice(1);
    return this.children.find((child) => child.id === id) || null;
  }
}

class FakeCanvas extends FakeElement {
  constructor(ownerDocument) {
    super("canvas", ownerDocument);
    this.width = 0;
    this.height = 0;
    this.context = {
      calls: [],
      globalAlpha: 0.3,
      globalCompositeOperation: "copy",
      shadowBlur: 4,
      filter: "blur(1px)",
      setTransform: (...args) => this.context.calls.push(["setTransform", ...args]),
      clearRect: (...args) => this.context.calls.push(["clearRect", ...args]),
      drawImage: (...args) => this.context.calls.push(["drawImage", ...args]),
    };
  }

  getContext(type) {
    return type === "2d" ? this.context : null;
  }
}

function createFakeDocument() {
  const documentRef = {
    createElement(tagName) {
      return String(tagName).toLowerCase() === "canvas"
        ? new FakeCanvas(documentRef)
        : new FakeElement(tagName, documentRef);
    },
  };
  return documentRef;
}

test("ensureCanvasLayers creates stable ordered canvases before legacy layers", () => {
  const documentRef = createFakeDocument();
  const container = new FakeElement("div", documentRef);
  const legacyCanvas = documentRef.createElement("canvas");
  legacyCanvas.id = "legacy-color-canvas";
  container.appendChild(legacyCanvas);

  const layers = ensureCanvasLayers(container, { before: legacyCanvas });

  assert.equal(getCanvasLayer(layers, CANVAS_LAYER_NAMES.composite).canvas.id, "map-canvas");
  assert.equal(getCanvasLayer(layers, CANVAS_LAYER_NAMES.politicalPatch).canvas.id, "map-political-patch-canvas");
  assert.equal(getCanvasLayer(layers, CANVAS_LAYER_NAMES.interactionOverlay).canvas.id, "map-interaction-overlay-canvas");
  assert.deepEqual(container.children.map((child) => child.id), [
    "map-canvas",
    "map-political-patch-canvas",
    "map-interaction-overlay-canvas",
    "legacy-color-canvas",
  ]);
  assert.deepEqual(container.children.slice(0, 3).map((child) => child.style.zIndex), ["0", "1", "2"]);
  assert.equal(container.children[1].style.pointerEvents, "none");
  assert.equal(container.children[2].attributes.get("aria-hidden"), "true");
});

test("ensureCanvasLayers restyles existing composite canvas and resize applies to every layer", () => {
  const documentRef = createFakeDocument();
  const container = new FakeElement("div", documentRef);
  const existingComposite = documentRef.createElement("canvas");
  existingComposite.id = "map-canvas";
  existingComposite.className = "old-class";
  container.appendChild(existingComposite);

  const layers = ensureCanvasLayers(container);
  const resize = resizeCanvasLayers(layers, { width: 320.2, height: 180.7, dpr: 2 });

  assert.equal(getCanvasLayer(layers, CANVAS_LAYER_NAMES.composite).canvas, existingComposite);
  assert.equal(existingComposite.className, "map-layer map-layer-composite");
  assert.deepEqual(resize, { pixelWidth: 640, pixelHeight: 362, logicalWidth: 320, logicalHeight: 181 });
  Object.values(CANVAS_LAYER_NAMES).forEach((name) => {
    const canvas = getCanvasLayer(layers, name).canvas;
    assert.equal(canvas.width, 640);
    assert.equal(canvas.height, 362);
    assert.equal(canvas.style.width, "320px");
    assert.equal(canvas.style.height, "181px");
  });
});

test("clearCanvasLayer resets transform and drawing state", () => {
  const documentRef = createFakeDocument();
  const canvas = documentRef.createElement("canvas");
  canvas.width = 12;
  canvas.height = 8;

  assert.equal(clearCanvasLayer(canvas), true);
  assert.deepEqual(canvas.context.calls, [
    ["setTransform", 1, 0, 0, 1, 0, 0],
    ["clearRect", 0, 0, 12, 8],
  ]);
  assert.equal(canvas.context.globalCompositeOperation, "source-over");
  assert.equal(canvas.context.globalAlpha, 1);
  assert.equal(canvas.context.shadowBlur, 0);
  assert.equal(canvas.context.filter, "none");
});

test("DPR resize retains the composite including pending political paint until the replacement frame", () => {
  const documentRef = createFakeDocument();
  const layers = ensureCanvasLayers(new FakeElement("div", documentRef));
  resizeCanvasLayers(layers, { width: 320, height: 180 });
  const composite = layers.composite.canvas;
  const patch = layers.politicalPatch.canvas;
  resizeCanvasLayers(layers, { width: 320, height: 180, dpr: 2, preserveComposite: true });
  const [restore] = composite.context.calls;
  assert.equal(restore[0], "drawImage");
  const retained = restore[1];
  assert.equal(retained.width, 320);
  assert.equal(retained.height, 180);
  assert.deepEqual(retained.context.calls, [["drawImage", composite, 0, 0], ["drawImage", patch, 0, 0]]);
  assert.deepEqual(restore.slice(2), [0, 0, 640, 360]);
  assert.deepEqual(patch.context.calls, []);
  resizeCanvasLayers(layers, { width: 320, height: 180, dpr: 2, preserveComposite: true });
  assert.equal(composite.context.calls.length, 1, "same-size calls must not clear or copy the frame");
});

test("initial or replacement scenes do not retain the old composite", () => {
  const documentRef = createFakeDocument();
  const layers = ensureCanvasLayers(new FakeElement("div", documentRef));
  resizeCanvasLayers(layers, { width: 320, height: 180, preserveComposite: true });
  resizeCanvasLayers(layers, { width: 320, height: 180, dpr: 2 });
  assert.deepEqual(layers.composite.canvas.context.calls, []);
});

test("shouldClearStaleCanvasOverlay clears on transform, phase, or deferred exact drift", () => {
  assert.equal(shouldClearStaleCanvasOverlay({ overlayTransformSignature: "" }), false);
  assert.equal(shouldClearStaleCanvasOverlay({
    overlayTransformSignature: "x:0;y:0;k:1",
    currentTransformSignature: "x:0;y:0;k:1",
    renderPhase: "idle",
    idleRenderPhase: "idle",
  }), false);
  assert.equal(shouldClearStaleCanvasOverlay({
    overlayTransformSignature: "x:0;y:0;k:1",
    currentTransformSignature: "x:10;y:0;k:1",
    renderPhase: "idle",
    idleRenderPhase: "idle",
  }), true);
  assert.equal(shouldClearStaleCanvasOverlay({
    overlayTransformSignature: "x:0;y:0;k:1",
    currentTransformSignature: "x:0;y:0;k:1",
    renderPhase: "interacting",
    idleRenderPhase: "idle",
  }), true);
  assert.equal(shouldClearStaleCanvasOverlay({
    overlayTransformSignature: "x:0;y:0;k:1",
    currentTransformSignature: "x:0;y:0;k:1",
    renderPhase: "idle",
    idleRenderPhase: "idle",
    deferExactAfterSettle: true,
  }), true);
});

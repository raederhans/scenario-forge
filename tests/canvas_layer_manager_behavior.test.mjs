import assert from "node:assert/strict";
import test from "node:test";
import { shouldClearStaleCanvasOverlay } from "../js/core/map_renderer/canvas_layer_manager.js";

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

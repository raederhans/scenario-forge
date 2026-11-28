import assert from "node:assert/strict";
import test from "node:test";
import { createTransformedFrameCompositorOwner } from "../js/core/map_renderer/transformed_frame_compositor_owner.js";

test("interaction label replay failure never blits a partially composed buffer", () => {
  const f = createHarness({ effects: { drawInteractionLabels: () => false } });
  assert.equal(f.owner.composeTransformedFrameToBuffer(f.runtime.currentTransform, []), false);
  assert.ok(!f.calls.some(([name]) => name === "blitCompositeBufferToMain"));
  assert.ok(!f.calls.some(([name, pass]) => name === "drawTransformedPass" && pass === "labels"));
});

function createHarness(overrides = {}) {
  const calls = [];
  const runtimeSnapshot = { currentTransform: { x: 12, y: 18, k: 2 } };
  const noop = () => {};
  const bufferCanvas = { getContext() { calls.push(["buffer.getContext"]); return {}; } };
  const dependencies = {
    constants: {
      interactionCompositePassNames: ["base", "political"],
      renderPhaseIdle: "idle",
      renderPhaseInteracting: "interacting",
      renderPhaseSettling: "settling",
    },
    getters: {
      getCurrentTransform: () => runtimeSnapshot.currentTransform,
      getRenderPassCacheSnapshot: noop,
      getActiveTransformedFramePassNames: noop,
      getRenderPhase: noop,
      getDeferExactAfterSettle: noop,
      getActiveScenarioId: noop,
      getPendingExactPoliticalFastFrame: noop,
      getZoomGestureScaleDelta: noop,
      getZoomGestureEndedAt: noop,
      getDpr: () => 2,
    },
    helpers: {
      nowMs: noop,
      canDrawTransformedPass: noop,
      getInteractionCompositeReuseDecision: noop,
    },
    effects: {
      ensureCompositeBufferCanvas: () => {
        calls.push(["ensureCompositeBufferCanvas"]);
        return bufferCanvas;
      },
      resetCanvasContext: () => calls.push(["resetCanvasContext"]),
      withRenderTarget: (context, callback) => {
        calls.push(["withRenderTarget.enter"]);
        callback();
        calls.push(["withRenderTarget.exit"]);
      },
      drawInteractionComposite: () => { calls.push(["drawInteractionComposite"]); return true; },
      composeRenderPassesToTarget: noop,
      drawTransformedPass: (passName, transform) => {
        calls.push(["drawTransformedPass", passName, transform]);
        return true;
      },
      drawInteractionBorderSnapshot: (transform) => {
        calls.push(["drawInteractionBorderSnapshot", transform]);
        return true;
      },
      drawBordersPass: (scale, options) => {
        calls.push(["drawBordersPass", scale, options]);
      },
      blitCompositeBufferToMain: (canvas) => {
        calls.push(["blitCompositeBufferToMain", canvas === bufferCanvas]);
      },
      setInteractionCompositeRejectedReason: noop,
      invalidateInteractionComposite: noop,
      buildInteractionComposite: noop,
      canDrawInteractionComposite: noop,
      setPendingExactPoliticalFastFrame: noop,
      recordRenderPerfMetric: noop,
      recordPassTiming: noop,
      incrementPerfCounter: noop,
      ...overrides.effects,
    },
  };

  return {
    owner: createTransformedFrameCompositorOwner(dependencies),
    calls,
    runtime: runtimeSnapshot,
  };
}

function callNames(harness) {
  return harness.calls.map(([name]) => name);
}

test("successful border snapshot skips fallback and still draws labels before blit", () => {
  const harness = createHarness();

  assert.equal(
    harness.owner.composeTransformedFrameToBuffer(
      harness.runtime.currentTransform,
      ["context", "effects"],
      { interactiveBorders: true },
    ),
    true,
  );

  assert.deepEqual(callNames(harness), [
    "ensureCompositeBufferCanvas",
    "buffer.getContext",
    "resetCanvasContext",
    "withRenderTarget.enter",
    "drawInteractionComposite",
    "drawTransformedPass",
    "drawTransformedPass",
    "drawInteractionBorderSnapshot",
    "drawTransformedPass",
    "withRenderTarget.exit",
    "blitCompositeBufferToMain",
  ]);
  assert.equal(callNames(harness).includes("drawBordersPass"), false);
  assert.deepEqual(harness.calls[8], ["drawTransformedPass", "labels", harness.runtime.currentTransform]);
});

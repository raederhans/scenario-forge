import assert from "node:assert/strict";
import test from "node:test";
import { createCachedPassCompositorOwner } from "../js/core/renderer/cached_pass_compositor_owner.js";

function createCanvasContext() {
  const calls = [];
  return {
    calls,
    save() {},
    setTransform() {},
    translate(...values) {
      calls.push(["translate", ...values]);
    },
    drawImage(...values) {
      calls.push(["drawImage", ...values]);
    },
    scale() {},
    restore() {},
  };
}

function cloneZoomTransform(transform) {
  return { ...transform };
}

function areZoomTransformsEquivalent(a, b, epsilon = 0.01) {
  return Math.abs(Number(a?.k || 1) - Number(b?.k || 1)) <= epsilon
    && Math.abs(Number(a?.x || 0) - Number(b?.x || 0)) <= epsilon
    && Math.abs(Number(a?.y || 0) - Number(b?.y || 0)) <= epsilon;
}

function createHarness(overrides = {}) {
  const canvases = {
    background: { id: "background-canvas" },
    labels: { id: "labels-canvas" },
  };
  const references = {
    background: { k: 2, x: 10, y: 20 },
    labels: { k: 1, x: 0, y: 0 },
  };
  const layouts = {
    background: { offsetX: 3, offsetY: 4 },
    labels: { offsetX: 1.25, offsetY: 2.75 },
  };
  const cacheSnapshot = { canvases };
  const dependencies = {
    constants: {
      renderPassNames: ["background", "labels"],
      ...overrides.constants,
    },
    getters: {
      getActiveTargetContext: () => null,
      getRenderPassCacheSnapshot: () => cacheSnapshot,
      getPassReferenceTransform: (passName) => references[passName] || null,
      getRenderPassLayout: (passName) => layouts[passName] || null,
      getDpr: () => 2,
      getRenderPhase: () => "interacting",
      isRenderDiagnosticsEnabled: () => false,
    },
    helpers: {
      cloneZoomTransform,
      areZoomTransformsEquivalent,
    },
    effects: {
      recordTransformedPassDiagnostics() {},
    },
  };
  return { owner: createCachedPassCompositorOwner(dependencies), canvases, layouts, references };
}

test("padded composite copies align both unchanged and transformed pass pixels", () => {
  const harness = createHarness();
  const target = createCanvasContext();
  harness.owner.composeRenderPassesToTarget(target, ["background", "labels"], { k: 2, x: 10, y: 20 }, {
    targetOffsetX: 3, targetOffsetY: 4, requireAllPasses: true,
  });
  const blits = target.calls.filter(([op]) => op === "drawImage");
  assert.deepEqual(blits[0], ["drawImage", harness.canvases.background, 0, 0]);
  assert.deepEqual(target.calls.find(([op]) => op === "translate"), ["translate", 21, 37]);
});

test("coverage uses the intersection of painted bounds rather than composite allocation", () => {
  const harness = createHarness({ constants: { paintedOverscanLimit: 96 } });
  Object.assign(harness.canvases.background, { width: 2600, height: 1800 });
  Object.assign(harness.canvases.labels, { width: 2000, height: 1200 });
  harness.layouts.background = { dpr: 2, offsetX: 150, offsetY: 150, logicalWidth: 1000, logicalHeight: 600 };
  harness.layouts.labels = { dpr: 2, offsetX: 0, offsetY: 0, logicalWidth: 1000, logicalHeight: 600 };
  harness.references.background = harness.references.labels = { x: 0, y: 0, k: 1 };
  assert.deepEqual(harness.owner.getPassCoverage("background", { x: 0, y: 0, k: 1 }), {
    minX: -96, minY: -96, maxX: 1096, maxY: 696,
  });
  assert.deepEqual(harness.owner.getCompositeCoverage(["background", "labels"], { x: 0, y: 0, k: 1 }), {
    minX: 0, minY: 0, maxX: 1000, maxY: 600,
  });
});

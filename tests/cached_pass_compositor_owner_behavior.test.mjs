import assert from "node:assert/strict";
import test from "node:test";

import { createCachedPassCompositorOwner } from "../js/core/renderer/cached_pass_compositor_owner.js";

function createCanvasContext(label) {
  const calls = [];
  return {
    label,
    calls,
    save() {
      calls.push(["save"]);
    },
    setTransform(...values) {
      calls.push(["setTransform", ...values]);
    },
    translate(...values) {
      calls.push(["translate", ...values]);
    },
    scale(...values) {
      calls.push(["scale", ...values]);
    },
    drawImage(...values) {
      calls.push(["drawImage", ...values]);
    },
    restore() {
      calls.push(["restore"]);
    },
  };
}

function cloneZoomTransform(transform) {
  return {
    k: Number(transform?.k || 1),
    x: Number(transform?.x || 0),
    y: Number(transform?.y || 0),
  };
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
  const dirty = { background: true, labels: false };
  const diagnostics = [];
  let activeTarget = createCanvasContext("first");
  const cacheSnapshot = { canvases, dirty };
  const dependencies = {
    constants: {
      renderPassNames: ["background", "labels"],
    },
    getters: {
      getActiveTargetContext: () => activeTarget,
      getRenderPassCacheSnapshot: () => {
        return cacheSnapshot;
      },
      getPassReferenceTransform: (passName) => references[passName] || null,
      getRenderPassLayout: (passName) => layouts[passName] || null,
      getDpr: () => 2,
      getRenderPhase: () => "interacting",
      isRenderDiagnosticsEnabled: () => true,
    },
    helpers: {
      cloneZoomTransform,
      areZoomTransformsEquivalent,
    },
    effects: {
      recordTransformedPassDiagnostics: (passName, detail) => {
        diagnostics.push({ passName, detail });
      },
    },
  };
  for (const namespace of ["constants", "getters", "helpers", "effects"]) {
    Object.assign(dependencies[namespace], overrides[namespace] || {});
  }
  return {
    owner: createCachedPassCompositorOwner(dependencies),
    canvases,
    references,
    layouts,
    diagnostics,
    cacheSnapshot,
    get activeTarget() {
      return activeTarget;
    },
    setActiveTarget(nextTarget) {
      activeTarget = nextTarget;
    },
  };
}

test("factory rejects a missing dependency", () => {
  assert.throws(
    () => createHarness({ getters: { getActiveTargetContext: null } }),
    /getters\.getActiveTargetContext must be a function/,
  );
});

test("draw and composition succeed with optional and required passes", () => {
  const drawHarness = createHarness();
  assert.equal(
    drawHarness.owner.drawTransformedPass("background", { k: 4, x: 50, y: 70 }),
    true,
  );

  const nonRequiredHarness = createHarness();
  assert.deepEqual(
    nonRequiredHarness.owner.composeRenderPassesToTarget(
      createCanvasContext("non-required"),
      ["background", "labels", "missing"],
      { k: 2, x: 10, y: 20 },
    ),
    { ok: true },
  );

  const requireAllHarness = createHarness();
  assert.deepEqual(
    requireAllHarness.owner.composeRenderPassesToTarget(
      createCanvasContext("require-all"),
      ["background", "labels"],
      { k: 2, x: 10, y: 20 },
      { requireAllPasses: true },
    ),
    { ok: true },
  );
});

test("padded composite copies align both unchanged and transformed pass pixels", () => {
  const harness = createHarness();
  const target = createCanvasContext("padded");
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

test("drawTransformedPass preserves missing-input and explicit-reference behavior", () => {
  const harness = createHarness();
  assert.equal(harness.owner.drawTransformedPass("missing", { k: 1, x: 0, y: 0 }), false);

  delete harness.references.background;
  assert.equal(harness.owner.drawTransformedPass("background", { k: 1, x: 0, y: 0 }), false);

  assert.equal(
    harness.owner.drawTransformedPass(
      "background",
      { k: 4, x: 50, y: 70 },
      { k: 2, x: 10, y: 20 },
    ),
    true,
  );
});

test("drawTransformedPass preserves exact transform math diagnostics and dynamic target lookup", () => {
  const harness = createHarness();
  const firstTarget = harness.activeTarget;
  const currentTransform = { k: 4, x: 50, y: 70 };

  assert.equal(harness.owner.drawTransformedPass("background", currentTransform), true);
  assert.deepEqual(firstTarget.calls, [
    ["save"],
    ["setTransform", 1, 0, 0, 1, 0, 0],
    ["translate", 48, 44],
    ["scale", 2, 2],
    ["drawImage", harness.canvases.background, 0, 0],
    ["restore"],
  ]);
  assert.deepEqual(harness.diagnostics, [{
    passName: "background",
    detail: {
      current: { k: 4, x: 50, y: 70 },
      reference: { k: 2, x: 10, y: 20 },
      scaleRatio: 2,
      dx: 30,
      dy: 30,
      layout: { offsetX: 3, offsetY: 4 },
      phase: "interacting",
      dirty: true,
    },
  }]);

  const secondTarget = createCanvasContext("second");
  harness.setActiveTarget(secondTarget);
  assert.equal(harness.owner.drawTransformedPass("labels", { k: 1, x: 0, y: 0 }), true);
  assert.equal(firstTarget.calls.filter(([name]) => name === "drawImage").length, 1);
  assert.equal(secondTarget.calls.filter(([name]) => name === "drawImage").length, 1);
});

test("diagnostics-disabled draws omit diagnostic effects", () => {
  let diagnosticEffects = 0;
  const harness = createHarness({
    getters: {
      isRenderDiagnosticsEnabled: () => false,
    },
    effects: {
      recordTransformedPassDiagnostics: () => {
        diagnosticEffects += 1;
      },
    },
  });

  assert.equal(harness.owner.drawTransformedPass("background", { k: 4, x: 50, y: 70 }), true);
  assert.deepEqual(
    harness.owner.composeRenderPassesToTarget(
      createCanvasContext("diagnostics-disabled"),
      ["background"],
      { k: 4, x: 50, y: 70 },
    ),
    { ok: true },
  );
  assert.equal(diagnosticEffects, 0);
});

test("composeRenderPassesToTarget preserves missing target and require-all preflight priority", () => {
  const harness = createHarness();
  assert.deepEqual(
    harness.owner.composeRenderPassesToTarget(null, ["background"], { k: 1, x: 0, y: 0 }),
    { ok: false, reason: "missing-target-context" },
  );

  delete harness.canvases.background;
  delete harness.canvases.labels;
  harness.references.background = null;
  assert.deepEqual(
    harness.owner.composeRenderPassesToTarget(
      createCanvasContext("target"),
      ["background", "labels"],
      { k: 1, x: 0, y: 0 },
      { requireAllPasses: true },
    ),
    {
      ok: false,
      reason: "missing-pass-canvas",
      passName: "background",
      missingPassNames: ["background", "labels"],
    },
  );
});

test("composeRenderPassesToTarget reports the complete require-all reference preflight", () => {
  const harness = createHarness();
  delete harness.references.background;
  delete harness.references.labels;
  assert.deepEqual(
    harness.owner.composeRenderPassesToTarget(
      createCanvasContext("target"),
      ["background", "labels"],
      { k: 1, x: 0, y: 0 },
      { requireAllPasses: true },
    ),
    {
      ok: false,
      reason: "missing-reference-transform",
      passName: "background",
      missingPassNames: ["background", "labels"],
    },
  );
});

test("composeRenderPassesToTarget keeps non-required missing references on the direct path", () => {
  const harness = createHarness();
  const target = createCanvasContext("target");
  delete harness.references.background;

  assert.deepEqual(
    harness.owner.composeRenderPassesToTarget(
      target,
      ["missing", "background"],
      { k: 1, x: 0, y: 0 },
    ),
    { ok: true },
  );
  assert.deepEqual(target.calls, [
    ["drawImage", harness.canvases.background, -6, -8],
  ]);
});

test("composeRenderPassesToTarget preserves transformed and equivalent direct composition", () => {
  const harness = createHarness();
  const transformedTarget = createCanvasContext("transformed");
  assert.deepEqual(
    harness.owner.composeRenderPassesToTarget(
      transformedTarget,
      ["background"],
      { k: 4, x: 50, y: 70 },
    ),
    { ok: true },
  );
  assert.deepEqual(transformedTarget.calls, [
    ["save"],
    ["setTransform", 1, 0, 0, 1, 0, 0],
    ["translate", 48, 44],
    ["scale", 2, 2],
    ["drawImage", harness.canvases.background, 0, 0],
    ["restore"],
  ]);
  assert.deepEqual(harness.diagnostics, [{
    passName: "background",
    detail: {
      current: { k: 4, x: 50, y: 70 },
      reference: { k: 2, x: 10, y: 20 },
      scaleRatio: 2,
      dx: 30,
      dy: 30,
      layout: { offsetX: 3, offsetY: 4 },
      phase: "interacting",
      dirty: true,
    },
  }]);

  const directTarget = createCanvasContext("direct");
  assert.deepEqual(
    harness.owner.composeRenderPassesToTarget(
      directTarget,
      null,
      { k: 2, x: 10, y: 20 },
    ),
    { ok: true },
  );
  assert.deepEqual(directTarget.calls, [
    ["drawImage", harness.canvases.background, -6, -8],
    ["save"],
    ["setTransform", 1, 0, 0, 1, 0, 0],
    ["translate", 15, 29],
    ["scale", 2, 2],
    ["drawImage", harness.canvases.labels, 0, 0],
    ["restore"],
  ]);
});

test("compose rejects null options", () => {
  const harness = createHarness();
  assert.throws(
    () => harness.owner.composeRenderPassesToTarget(
      createCanvasContext("null-options"),
      ["background"],
      { k: 2, x: 10, y: 20 },
      null,
    ),
    TypeError,
  );
});

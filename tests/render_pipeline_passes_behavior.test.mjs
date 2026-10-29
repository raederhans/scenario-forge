import assert from "node:assert/strict";
import test from "node:test";

import { createRenderPipelinePassesOwner } from "../js/core/renderer/render_pipeline_passes.js";

function createHarness({ passName = "borders", canvas = true, reference = true, dirty = true } = {}) {
  const oldCanvas = { pixels: "previous" };
  const transform = { x: 10, y: 20, k: 2 };
  const cache = {
    canvases: canvas ? { [passName]: oldCanvas } : {},
    signatures: { [passName]: "previous" },
    dirty: { [passName]: dirty },
    reasons: {},
    counters: {},
  };
  const prepared = [], painted = [], drawn = [], metrics = [];
  let pending = true;
  const owner = createRenderPipelinePassesOwner({
    state: { zoomTransform: transform, activeScenarioId: "tno_1962" },
    drawPasses: { drawBordersPass: (k) => drawn.push(k) },
    helpers: {
      getRenderPassCacheState: () => cache,
      getPassReferenceTransform: () => reference ? { x: 0, y: 0, k: 1 } : null,
      getRenderPassSignature: () => "next",
      prepareRenderPassAsync: (name) => { prepared.push(name); return pending; },
      renderPassToCache: (name, drawFn, currentTransform, timings) => {
        painted.push(name);
        oldCanvas.pixels = "updated";
        drawFn(currentTransform.k);
        cache.signatures[name] = "next";
        cache.dirty[name] = false;
        timings[name] = 1;
      },
      recordRenderPerfMetric: (...args) => metrics.push(args),
    },
  });
  return { owner, cache, oldCanvas, transform, prepared, painted, drawn, metrics,
    clearReference: () => { reference = false; },
    startPreparation: () => { pending = true; cache.dirty[passName] = true; },
    finishPreparation: () => { pending = false; } };
}

for (const dirty of [true, false]) {
  test(`pending borders reuses its surface without painting (initial dirty: ${dirty})`, () => {
    const { owner, cache, oldCanvas, prepared, painted, drawn, metrics } = createHarness({ dirty });
    const timings = {};
    assert.equal(owner.ensureIdleRenderPasses(timings, ["borders"]), true);
    assert.deepEqual(prepared, ["borders", "borders"]);
    assert.deepEqual(painted, []);
    assert.deepEqual(drawn, []);
    assert.equal(cache.canvases.borders, oldCanvas);
    assert.equal(oldCanvas.pixels, "previous");
    assert.equal(cache.signatures.borders, "previous");
    assert.equal(cache.dirty.borders, true);
    assert.equal(timings.usedDirtyFastFramePasses, "borders");
    assert.deepEqual(metrics, [["idleRenderPassDeferredForPreparation", 0, {
      passName: "borders",
      reason: "preparation-pending-reuse-surface",
      activeScenarioId: "tno_1962",
    }]]);
  });
}

for (const missing of ["canvas", "reference"]) {
  test(`pending borders blocks when its ${missing} is missing`, () => {
    const { owner, cache, transform, painted, metrics } = createHarness({ [missing]: false });
    const timings = {};
    assert.equal(owner.ensureIdleRenderPasses(timings, ["borders"]), false);
    assert.equal(owner.prepareIdleRenderPassDefinition("borders", () => {}, transform, timings), false);
    assert.equal(cache.dirty.borders, true);
    assert.deepEqual(painted, []);
    assert.deepEqual(metrics, [["idleRenderPassPreflightPending", 0, {
      passNames: "borders", activeScenarioId: "tno_1962",
    }]]);
    assert.deepEqual(timings, {});
  });
}

for (const passName of ["political", "physicalBase", "contextScenario", "contextMarkers", "labels"]) {
  test(`pending ${passName} still blocks with an existing surface`, () => {
    const { owner, cache, painted, metrics } = createHarness({ passName });
    const timings = {};
    assert.equal(owner.ensureIdleRenderPasses(timings, [passName]), false);
    assert.equal(cache.dirty[passName], true);
    assert.deepEqual(painted, []);
    assert.deepEqual(metrics, [["idleRenderPassPreflightPending", 0, {
      passNames: passName, activeScenarioId: "tno_1962",
    }]]);
    assert.deepEqual(timings, {});
  });
}

test("borders redraws and clears dirty on the frame after preparation completes", () => {
  const { owner, cache, oldCanvas, painted, drawn, metrics, finishPreparation } = createHarness();
  assert.equal(owner.ensureIdleRenderPasses({}, ["borders"]), true);
  finishPreparation();
  const timings = {};
  assert.equal(owner.ensureIdleRenderPasses(timings, ["borders"]), true);
  assert.deepEqual(painted, ["borders"]);
  assert.deepEqual(drawn, [2]);
  assert.equal(oldCanvas.pixels, "updated");
  assert.equal(cache.dirty.borders, false);
  assert.equal(cache.signatures.borders, "next");
  assert.deepEqual(timings, { borders: 1 });
  assert.equal(metrics.length, 1);
});

test("deferring borders preserves other dirty pass timing markers", () => {
  const { owner } = createHarness();
  const timings = { usedDirtyFastFramePasses: "political,labels" };
  assert.equal(owner.ensureIdleRenderPasses(timings, ["borders"]), true);
  assert.equal(timings.usedDirtyFastFramePasses, "political,labels,borders");
});

function commitThenInvalidateReference() {
  const harness = createHarness();
  harness.finishPreparation();
  assert.equal(harness.owner.ensureIdleRenderPasses({}, ["borders"]), true);
  harness.clearReference();
  harness.startPreparation();
  harness.painted.length = 0;
  harness.drawn.length = 0;
  harness.metrics.length = 0;
  return harness;
}

for (const delta of [0, 0.5e-6]) {
  test(`committed borders reuses its canvas after reference invalidation with transform delta ${delta}`, () => {
    const { owner, cache, oldCanvas, transform, painted, drawn, metrics } = commitThenInvalidateReference();
    for (const key of ["x", "y", "k"]) transform[key] += delta;
    const timings = {};
    assert.equal(owner.ensureIdleRenderPasses(timings, ["borders"]), true);
    assert.equal(cache.canvases.borders, oldCanvas);
    assert.equal(cache.dirty.borders, true);
    assert.deepEqual(painted, []);
    assert.deepEqual(drawn, []);
    assert.equal(timings.usedDirtyFastFramePasses, "borders");
    assert.deepEqual(metrics, [["idleRenderPassDeferredForPreparation", 0, {
      passName: "borders", reason: "preparation-pending-reuse-surface", activeScenarioId: "tno_1962",
    }]]);
  });
}

for (const changed of ["x", "y", "k", "canvas"]) {
  test(`committed borders blocks after reference invalidation when ${changed} changes`, () => {
    const { owner, cache, transform, painted, metrics } = commitThenInvalidateReference();
    if (changed === "canvas") cache.canvases.borders = { pixels: "replacement" };
    else transform[changed] += 2e-6;
    const timings = {};
    assert.equal(owner.ensureIdleRenderPasses(timings, ["borders"]), false);
    assert.equal(owner.prepareIdleRenderPassDefinition("borders", () => {}, transform, timings), false);
    assert.equal(cache.dirty.borders, true);
    assert.deepEqual(painted, []);
    assert.deepEqual(timings, {});
    assert.deepEqual(metrics, [["idleRenderPassPreflightPending", 0, {
      passNames: "borders", activeScenarioId: "tno_1962",
    }]]);
  });
}

test("a later successful borders draw replaces the committed transform snapshot", () => {
  const { owner, transform, painted, startPreparation, finishPreparation } = commitThenInvalidateReference();
  transform.x += 5;
  finishPreparation();
  assert.equal(owner.ensureIdleRenderPasses({}, ["borders"]), true);
  assert.deepEqual(painted, ["borders"]);
  startPreparation();
  const timings = {};
  assert.equal(owner.ensureIdleRenderPasses(timings, ["borders"]), true);
  assert.deepEqual(painted, ["borders"]);
  assert.equal(timings.usedDirtyFastFramePasses, "borders");
});

test("blocking preflight records all pending passes once in catalog order", () => {
  const { owner, metrics, prepared } = createHarness();
  assert.equal(owner.ensureIdleRenderPasses({}, ["labels", "borders", "political"]), false);
  assert.deepEqual(prepared, ["political", "borders", "labels"]);
  assert.deepEqual(metrics, [["idleRenderPassPreflightPending", 0, {
    passNames: "political,borders,labels", activeScenarioId: "tno_1962",
  }]]);
});

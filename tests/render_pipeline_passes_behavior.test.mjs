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
    assert.deepEqual(metrics, []);
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
    assert.deepEqual(metrics, []);
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

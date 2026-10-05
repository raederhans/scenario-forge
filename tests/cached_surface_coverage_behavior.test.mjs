import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { coversViewport, getSurfaceCoverage, intersectCoverage, transformCoverage } from "../js/core/renderer/cached_surface_coverage.js";
import { createRenderPipelinePassesOwner } from "../js/core/renderer/render_pipeline_passes.js";

test("idle preparation never resurrects a disabled pass, including explicitly requested passes", () => {
  const painted = [];
  const active = ["background", "political"];
  const cache = { dirty: {}, signatures: {}, reasons: {}, canvases: {}, counters: {} };
  const owner = createRenderPipelinePassesOwner({
    state: { zoomTransform: { x: 0, y: 0, k: 1 } },
    helpers: {
      getActiveRenderPassNames: () => active,
      getRenderPassCacheState: () => cache,
      getRenderPassSignature: () => "new",
      renderPassToCache: (name) => painted.push(name),
    },
  });
  assert.equal(owner.ensureIdleRenderPasses({}), true);
  assert.deepEqual(painted, active);
  painted.length = 0;
  assert.equal(owner.ensureIdleRenderPasses({}, ["physicalBase", "political"]), true);
  assert.deepEqual(painted, ["political"]);
});
import { createInteractionBorderSnapshotOwner } from "../js/core/renderer/interaction_border_snapshot_owner.js";
import { bindRenderBoundary, requestRender, markRenderBoundaryFlushed } from "../js/core/render_boundary.js";

const origin = { x: 0, y: 0, k: 1 };

test("production yield gate keeps startup political and context in one frame but slices ready interaction work", () => {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const bootGuard = source.match(/function isBootInteractionReady\(\) \{[\s\S]*?\n\}/)?.[0];
  const yieldGate = source.match(/canYieldRenderPassWork: (\(\) => [\s\S]*?),\r?\n\s+nowMs,/)?.[1];
  assert.ok(bootGuard && yieldGate);
  for (const [bootPhase, bootBlocking, shouldYield] of [["warmup", true, false], ["ready", true, false], ["ready", false, true]]) {
    const state = { firstVisibleFramePainted: true, bootPhase, bootBlocking, zoomTransform: origin };
    const canYield = vm.runInNewContext(`${bootGuard}; (${yieldGate})`, {
      runtimeState: state, hasPendingPoliticalColorEdit: () => false,
    });
    const painted = [], continuations = [];
    let time = 0;
    const cache = { dirty: { political: true, contextScenario: true }, signatures: {}, reasons: {}, counters: {}, canvases: {} };
    const owner = createRenderPipelinePassesOwner({ state, helpers: {
      getRenderPassCacheState: () => cache, nowMs: () => time, canYieldRenderPassWork: canYield,
      requestRenderContinuation: (reason) => continuations.push(reason),
      renderPassToCache: (name, _draw, _transform, timings) => {
        painted.push(name); time += 10; timings[name] = 10;
        cache.dirty[name] = false; cache.signatures[name] = "";
      },
    } });
    const prepare = () => owner.ensureIdleRenderPasses({}, ["political", "contextScenario"]);
    assert.equal(prepare(), !shouldYield, `${bootPhase}/${bootBlocking}`);
    assert.equal(continuations.length, shouldYield ? 1 : 0);
    if (shouldYield) {
      assert.deepEqual(painted, ["political"]);
      assert.equal(prepare(), true);
    }
    assert.deepEqual(painted, ["political", "contextScenario"]);
  }
});

test("exact fallback resolves colors before worker preparation and preserves all surfaces while waiting", () => {
  const events = [];
  const state = { zoomTransform: origin, legacyColorStateDirty: true, renderPhase: "settling" };
  const cache = { dirty: { background: true, political: true }, signatures: {}, reasons: {}, canvases: {}, counters: {} };
  let pending = true;
  const owner = createRenderPipelinePassesOwner({ state, helpers: {
    getRenderPassCacheState: () => cache,
    rebuildResolvedColors: () => { events.push("colors"); state.legacyColorStateDirty = false; },
    prepareRenderPassAsync: (name) => { events.push(`prepare:${name}`); return pending ? Promise.resolve() : null; },
    renderPassToCache: (name) => events.push(`paint:${name}`),
  } });
  assert.equal(owner.ensureIdleRenderPasses({}, ["background", "political"]), false);
  assert.deepEqual(events, ["colors", "prepare:political"]);
  pending = false;
  assert.equal(owner.ensureIdleRenderPasses({}, ["background", "political"]), true);
  assert.deepEqual(events.slice(2), ["prepare:political", "paint:background", "paint:political"]);
});

test("painted margins support short/reverse pans but reject exposed edges and zoom-out", () => {
  const coverage = getSurfaceCoverage({ width: 1500, height: 1050 }, { offsetX: 100, offsetY: 50, dpr: 1.5 });
  assert.deepEqual(coverage, { minX: -100, minY: -50, maxX: 900, maxY: 650 });
  for (const x of [-100, 0, 100]) assert.equal(coversViewport(transformCoverage(coverage, origin, { ...origin, x }), 800, 600), true);
  for (const x of [-101, 101, 300]) assert.equal(coversViewport(transformCoverage(coverage, origin, { ...origin, x }), 800, 600), false);
  assert.equal(coversViewport(transformCoverage(coverage, origin, { x: 200, y: 150, k: 0.5 }), 800, 600), false);
  assert.equal(coversViewport(transformCoverage(coverage, origin, { x: -400, y: -300, k: 2 }), 800, 600), true);
  assert.equal(coversViewport(null, 800, 600), false);
  assert.equal(coversViewport({ ...coverage, maxX: NaN }, 800, 600), false);
});

test("compositing into a larger canvas cannot manufacture painted coverage", () => {
  const padded = { minX: -100, minY: -50, maxX: 900, maxY: 650 };
  const viewportOnly = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  const actual = intersectCoverage(padded, viewportOnly);
  assert.deepEqual(actual, viewportOnly);
  assert.equal(coversViewport(transformCoverage(actual, origin, { ...origin, x: 1 }), 800, 600), false);
});

test("coverage refill redraws only exhausted clean passes, preserving unrelated passes and pending mutations", () => {
  const rendered = [];
  const coverages = { background: { minX: -20, minY: -20, maxX: 820, maxY: 620 }, political: { minX: 30, minY: 0, maxX: 830, maxY: 600 } };
  coverages.contextScenario = coverages.background;
  const cache = { dirty: { contextScenario: true }, canvases: { background: {}, political: {}, contextScenario: {} } };
  const owner = createRenderPipelinePassesOwner({
    state: { width: 800, height: 600, dpr: 1.5, zoomTransform: origin },
    helpers: {
      getRenderPassCacheState: () => cache, getPassReferenceTransform: () => origin,
      getPassCoverage: (name) => coverages[name],
      renderPassToCache: (name) => { rendered.push(name); coverages[name] = coverages.background; },
    },
  });
  owner.ensureTransformedPassCoverage({}, ["background", "political", "contextScenario"]);
  assert.deepEqual(rendered, ["political"]);
  owner.ensureTransformedPassCoverage({}, ["background", "political", "contextScenario"]);
  assert.deepEqual(rendered, ["political"], "covered frames do not repaint again");
  assert.equal(cache.dirty.contextScenario, true);
});

test("border snapshots reuse painted coverage between gestures and rebuild after invalidation or a large move", () => {
  let draws = 0;
  const context = {};
  const snapshot = { canvas: { width: 1120, height: 840, getContext: () => context }, valid: false };
  const state = { width: 800, height: 600, dpr: 1, landData: { features: [{}] } };
  const owner = createInteractionBorderSnapshotOwner({ state,
    getters: { getRenderPassCacheState: () => ({ borderSnapshot: snapshot }) },
    helpers: { drawBordersPass: () => { draws++; } },
  });
  owner.captureInteractionBorderSnapshot(origin);
  owner.captureInteractionBorderSnapshot({ ...origin, x: 100 });
  assert.equal(draws, 1);
  owner.captureInteractionBorderSnapshot({ ...origin, x: 300 });
  assert.equal(draws, 2);
  owner.invalidateInteractionBorderSnapshot("color-change");
  owner.captureInteractionBorderSnapshot({ ...origin, x: 300 });
  assert.equal(draws, 3);
});

test("coverage refill waits for asynchronous geometry before modifying any cached pass", () => {
  const painted = [];
  let pending = true;
  const owner = createRenderPipelinePassesOwner({
    state: { width: 800, height: 600, dpr: 1, zoomTransform: origin },
    helpers: {
      getRenderPassCacheState: () => ({ dirty: {}, canvases: { background: {}, political: {} } }),
      getPassReferenceTransform: () => origin,
      getPassCoverage: () => ({ minX: 300, minY: 0, maxX: 1100, maxY: 600 }),
      prepareRenderPassAsync: (name) => name === "political" && pending ? Promise.resolve() : null,
      renderPassToCache: (name) => painted.push(name),
    },
  });
  assert.equal(owner.ensureTransformedPassCoverage({}, ["background", "political"]), false);
  assert.deepEqual(painted, []);
  pending = false;
  assert.equal(owner.ensureTransformedPassCoverage({}, ["background", "political"]), true);
  assert.deepEqual(painted, ["background", "political"]);
});

test("settling rejects uncovered dirty layers instead of publishing empty edges", () => {
  const owner = createRenderPipelinePassesOwner({
    state: { width: 800, height: 600, zoomTransform: origin, renderPhase: "settling" },
    helpers: {
      getRenderPassCacheState: () => ({ dirty: { political: true }, canvases: { political: {} } }),
      getPassReferenceTransform: () => origin,
      getPassCoverage: () => ({ minX: 300, minY: 0, maxX: 1100, maxY: 600 }),
      renderPassToCache: () => assert.fail("pending mutations belong to exact preparation"),
    },
  });
  assert.equal(owner.ensureTransformedPassCoverage({}, ["political"]), false);
});

test("exact and coverage preparation yield between expensive passes and converge without repainting completed work", () => {
  for (const mode of ["exact", "coverage"]) {
    let time = 0;
    const painted = [];
    const continuations = [];
    const passNames = ["background", "political", "effects"];
    const cache = { dirty: {}, signatures: {}, reasons: {}, counters: {}, canvases: {} };
    const coverages = {};
    for (const name of passNames) {
      cache.dirty[name] = mode === "exact";
      cache.signatures[name] = "";
      cache.canvases[name] = {};
    }
    const owner = createRenderPipelinePassesOwner({
      state: { width: 800, height: 600, zoomTransform: origin },
      helpers: {
        getRenderPassCacheState: () => cache, getPassReferenceTransform: () => origin,
        getPassCoverage: (name) => coverages[name],
        nowMs: () => time, canYieldRenderPassWork: () => true,
        requestRenderContinuation: (reason) => continuations.push(reason),
        renderPassToCache: (name, _draw, _transform, timings) => {
          painted.push(name); time += 10; timings[name] = 10; cache.dirty[name] = false;
          coverages[name] = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
        },
      },
    });
    const prepare = () => mode === "exact" ? owner.ensureIdleRenderPasses({}, passNames)
      : owner.ensureTransformedPassCoverage({}, passNames);
    assert.equal(prepare(), false, mode);
    assert.equal(prepare(), false, mode);
    assert.equal(prepare(), true, mode);
    assert.deepEqual(painted, passNames, mode);
    assert.equal(continuations.length, 2, mode);
  }
});

test("yielded pass work schedules its next frame after the active render boundary has closed", async () => {
  const queued = [];
  bindRenderBoundary({ scheduleRender: () => queued.push("frame") });
  const cache = { dirty: { background: true, political: true }, signatures: {}, reasons: {}, counters: {} };
  let time = 0;
  const owner = createRenderPipelinePassesOwner({ state: { zoomTransform: origin }, helpers: {
    getRenderPassCacheState: () => cache, nowMs: () => time, canYieldRenderPassWork: () => true,
    renderPassToCache: (name, _draw, _transform, timings) => {
      cache.dirty[name] = false; cache.signatures[name] = ""; timings[name] = 10; time += 10;
    },
    requestRenderContinuation: (reason) => queueMicrotask(() => requestRender(reason)),
  } });
  try {
    requestRender("initial");
    assert.equal(owner.ensureIdleRenderPasses({}, ["background", "political"]), false);
    markRenderBoundaryFlushed();
    await Promise.resolve();
    assert.equal(queued.length, 2, "continuation survives request coalescing of the current frame");
    assert.equal(owner.ensureIdleRenderPasses({}, ["background", "political"]), true);
  } finally { bindRenderBoundary({}); }
});

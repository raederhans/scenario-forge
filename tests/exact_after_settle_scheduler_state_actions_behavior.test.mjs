import assert from "node:assert/strict";
import test from "node:test";

import { createExactAfterSettleScheduler } from "../js/core/map_renderer/exact_after_settle_scheduler.js";

test("rejected speculative deferred preparation cannot abort a replacement generation", async t => {
  let rejectDeferred;
  const deferred = new Promise((_, reject) => { rejectDeferred = reject; });
  const runtimeState = {
    activeScenarioId: "scenario-a", deferExactAfterSettle: true, renderPhase: "idle",
    zoomTransform: { k: 1, x: 0, y: 0 },
  };
  const profile = { exactQuietWindowMs: 25, exactContextRefreshDelayMs: 0, scaleDelta: 0.2, settleDurationMs: 40 };
  const passNames = ["political", "borders", "labels", "textureLabels"];
  const cache = { dirty: {} };
  const frames = [];
  const events = [];
  let runTimer;
  t.mock.method(globalThis, "setTimeout", callback => { runTimer = callback; return 1; });
  const scheduler = createExactAfterSettleScheduler({
    runtimeState, renderPassNames: passNames,
    prepareRenderPassAsync: pass => pass === "labels" ? deferred : null,
    getContext: () => ({ canvas: { width: 1200, height: 800 } }),
    getVisibleContextFlagSignature: () => "context:visible",
    cloneZoomTransform: transform => ({ ...transform }),
    getAdaptiveSettleProfile: () => profile,
    getContextBaseReuseDecision: () => ({ enabled: false, shouldExactRefresh: false }),
    shouldForceExactContextBaseRefresh: () => false,
    updateDprStage() {}, setCanvasSize() {}, cancelDeferredContextBaseEnhancement() {},
    setDeferContextBaseEnhancements() {}, shouldDeferContextBaseEnhancementsForExactRefresh: () => false,
    scheduleDeferredContextBaseEnhancements() {}, getRenderPassCacheState: () => cache,
    getRenderPipelinePassesOwner: () => ({
      getIdleRenderPassDefinitions: () => passNames.map(name => [name, () => {}]),
      prepareIdleRenderPassDefinition: (_, draw) => draw(),
    }),
    getPhysicalExactRefreshPasses: () => [],
    invalidateRenderPasses(passes) {
      for (const pass of Array.isArray(passes) ? passes : [passes]) cache.dirty[pass] = true;
    },
    rebuildResolvedColors() {}, requestRendererRender: () => true, render() {},
    recordRenderPerfMetric: name => events.push(name),
    readRenderPerfMetricDuration: () => 0, nowMs: () => 100,
    enqueueFrameTask(callback) { frames.push(callback); return { cancel() {} }; },
    scheduleDeferredWork: () => ({ cancel() {} }), cancelDeferredWork() {},
    flushPendingScenarioChunkRefreshAfterExact() {},
  });

  scheduler.scheduleExactAfterSettleRefresh(profile);
  runTimer();
  frames.shift()();
  frames.shift()();
  frames.shift()();
  scheduler.cancelExactAfterSettleRefresh();
  scheduler.scheduleExactAfterSettleRefresh(profile);
  const generation = runtimeState.exactAfterSettleController.generation;
  const abortCount = () => events.filter(name => name === "settleExactRefreshAbortBeforePaint").length;
  const aborts = abortCount();
  rejectDeferred(new Error("old source"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtimeState.exactAfterSettleController.generation, generation);
  assert.equal(runtimeState.exactAfterSettleController.phase, "scheduled");
  assert.equal(abortCount(), aborts);
});

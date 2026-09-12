import assert from "node:assert/strict";
import test from "node:test";

import { createExactAfterSettleScheduler } from "../js/core/map_renderer/exact_after_settle_scheduler.js";

function createHarness({ cameraSignatureMismatch = false, prepareRenderPassAsync = () => null, includeContextPasses = false, getRenderPassSignature } = {}) {
  const events = [];
  const metrics = [];
  const frameTasks = [];
  const deferredTasks = [];
  const timers = new Map();
  const cancelledTimerIds = new Set();
  const originalSetTimeout = globalThis.setTimeout;
  let nextTimerId = 1;
  let now = 100;

  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    events.push(`timer:${id}:${delay}`);
    return id;
  };

  const profile = {
    exactQuietWindowMs: 25,
    exactContextRefreshDelayMs: 0,
    scaleDelta: 0.2,
    settleDurationMs: 40,
  };
  const reuseDecision = {
    enabled: false,
    shouldExactRefresh: false,
    reason: "stable-cache",
    scaleRatio: 1,
    distancePx: 0,
    referenceTransform: { x: 1, y: 2, k: 3 },
    currentTransform: { x: 4, y: 5, k: 6 },
    maxDistancePx: 32,
    zoomBucket: 4,
    referenceZoomBucket: 4,
  };
  const schedulerRuntime = {
    activeScenarioId: "scenario-a",
    adaptiveSettleProfile: profile,
    colorRevision: 3,
    deferExactAfterSettle: true,
    dpr: 1,
    exactAfterSettleHandle: null,
    legacyColorStateDirty: false,
    pendingExactPoliticalFastFrame: true,
    renderPerfMetricSequence: 0,
    renderPerfMetrics: {},
    renderPhase: "idle",
    runtimeChunkLoadState: { selectionVersion: 2 },
    topologyRevision: 5,
    zoomGestureEndedAt: 17,
    zoomGestureScaleDelta: 0.2,
    zoomTransform: { k: 1, x: 0, y: 0 },
  };
  const cache = {
    dirty: {
      political: false,
      borders: false,
      labels: false,
      textureLabels: false,
    },
  };
  const definitions = [
    ...(cameraSignatureMismatch ? [["background", () => {}]] : []),
    ...(includeContextPasses ? [["physicalBase", () => {}], ["contextBase", () => {}]] : []),
    ["political", () => {}],
    ["borders", () => {}],
    ["labels", () => {}],
    ["textureLabels", () => {}],
  ];
  const pipelineOwner = {
    getIdleRenderPassDefinitions() {
      return definitions;
    },
    prepareIdleRenderPassDefinition(passName) {
      events.push(`prepare:${passName}`);
    },
  };

  const scheduler = createExactAfterSettleScheduler({
    prepareRenderPassAsync,
    runtimeState: schedulerRuntime,
    renderPassNames: definitions.map(([passName]) => passName),
    renderPhaseIdle: "idle",
    exactContextRefreshDelayMs: 0,
    getContext: () => ({ canvas: { width: 1200, height: 800 } }),
    getVisibleContextFlagSignature: () => "context:visible",
    cloneZoomTransform: (transform) => ({ ...transform }),
    getAdaptiveSettleProfile: () => profile,
    getContextBaseReuseDecision: () => reuseDecision,
    shouldForceExactContextBaseRefresh: () => false,
    updateDprStage: () => events.push("update-dpr"),
    setCanvasSize: () => events.push("set-canvas-size"),
    cancelDeferredContextBaseEnhancement: () => events.push("cancel-context-base"),
    setDeferContextBaseEnhancements: (value) => events.push(`defer-context-base:${value}`),
    shouldDeferContextBaseEnhancementsForExactRefresh: () => false,
    scheduleDeferredContextBaseEnhancements: () => events.push("schedule-context-base"),
    getRenderPassCacheState: () => cache,
    getRenderPassSignature: getRenderPassSignature ?? (cameraSignatureMismatch ? () => "new-camera" : undefined),
    getRenderPipelinePassesOwner: () => pipelineOwner,
    getPhysicalExactRefreshPasses: () => includeContextPasses ? ["physicalBase", "contextBase"] : [],
    invalidateRenderPasses: (passes, reason) => {
      events.push(`invalidate:${Array.isArray(passes) ? passes.join(",") : passes}:${reason}`);
      for (const pass of Array.isArray(passes) ? passes : [passes]) cache.dirty[pass] = true;
    },
    rebuildResolvedColors: () => events.push("rebuild-colors"),
    requestRendererRender: (reason, options) => {
      events.push(`request-render:${reason}:${Boolean(options?.flush)}`);
      return true;
    },
    render: () => events.push("render"),
    recordRenderPerfMetric: (name, duration, details) => {
      events.push(`metric:${name}`);
      metrics.push({ name, duration, details });
    },
    readRenderPerfMetricDuration: () => 0,
    nowMs: () => ++now,
    enqueueFrameTask: (callback, metadata = {}) => {
      const task = {
        callback,
        metadata,
        cancelled: false,
        cancel() {
          task.cancelled = true;
        },
      };
      frameTasks.push(task);
      events.push(`frame:${metadata.label || "anonymous"}`);
      return task;
    },
    scheduleDeferredWork: (callback, metadata = {}) => {
      const task = {
        callback,
        metadata,
        cancelled: false,
        cancel() {
          task.cancelled = true;
        },
      };
      deferredTasks.push(task);
      events.push("schedule-deferred-work");
      return task;
    },
    cancelDeferredWork: (handle) => {
      if (!handle) return;
      if (handle.type === "timeout") {
        cancelledTimerIds.add(handle.id);
        events.push(`cancel-timer:${handle.id}`);
        return;
      }
      handle.cancel?.();
      events.push("cancel-deferred-work");
    },
    flushPendingScenarioChunkRefreshAfterExact: () => events.push("flush-scenario-chunks"),
  });

  function runTimer(id = schedulerRuntime.exactAfterSettleHandle?.id) {
    assert.ok(id, "an exact-after-settle timer id must exist");
    assert.equal(cancelledTimerIds.has(id), false, `timer ${id} must remain active`);
    const timer = timers.get(id);
    assert.ok(timer, `timer ${id} must be registered`);
    timers.delete(id);
    timer.callback();
  }

  function runNextFrame(expectedLabel = "") {
    let task = frameTasks.shift();
    while (task?.cancelled) task = frameTasks.shift();
    assert.ok(task, "a frame task must be queued");
    if (expectedLabel) assert.equal(task.metadata.label, expectedLabel);
    task.callback();
    return task;
  }

  function driveToAwaitingPaint() {
    scheduler.scheduleExactAfterSettleRefresh(profile);
    const generation = schedulerRuntime.exactAfterSettleController.generation;
    assert.equal(schedulerRuntime.exactAfterSettleController.phase, "scheduled");
    runTimer();
    runNextFrame("exact-after-settle-Prepare");
    runNextFrame("exact-after-settle-Apply");
    assert.equal(schedulerRuntime.exactAfterSettleController.phase, "applying");
    assert.equal(schedulerRuntime.deferExactAfterSettle, true, "ordinary renders between slices must replay the committed frame");
    runNextFrame("exact-after-settle-pass-political");
    assert.equal(schedulerRuntime.deferExactAfterSettle, true);
    runNextFrame("exact-after-settle-pass-borders");
    assert.equal(schedulerRuntime.exactAfterSettleController.phase, "awaiting-paint");
    assert.equal(schedulerRuntime.deferExactAfterSettle, false);
    assert.equal(schedulerRuntime.exactAfterSettleController.generation, generation);
    return generation;
  }

  return {
    cache,
    cancelledTimerIds,
    deferredTasks,
    driveToAwaitingPaint,
    events,
    frameTasks,
    metrics,
    profile,
    restore() {
      globalThis.setTimeout = originalSetTimeout;
    },
    reuseDecision,
    runNextFrame,
    runTimer,
    runtimeState: schedulerRuntime,
    scheduler,
    setTopologyRevision(value) {
      schedulerRuntime.topologyRevision = Number(value || 0);
    },
    timers,
  };
}

function assertOrdered(events, expected) {
  let cursor = -1;
  for (const entry of expected) {
    const next = events.indexOf(entry, cursor + 1);
    assert.notEqual(next, -1, `missing ordered event ${entry}\n${events.join("\n")}`);
    cursor = next;
  }
}

test("visible urban scale changes refresh context after settle without refreshing physical passes", () => {
  const h = createHarness({ includeContextPasses: true });
  try {
    h.reuseDecision.enabled = true;
    h.runtimeState.showUrban = true;
    h.runtimeState.urbanData = { features: [{}] };
    h.driveToAwaitingPaint();
    const plan = h.runtimeState.exactAfterSettleController.pendingPlan;
    assert.equal(plan.urbanZoomExactRefresh, true);
    assert.equal(plan.forceExactContextBaseRefresh, false);
    assert.equal(plan.exactRefreshApplied, false);
    assert.deepEqual(plan.exactTargetPasses, ["political", "borders"]);
    assert.deepEqual(plan.deferredExactTargetPasses, ["contextBase", "labels", "textureLabels"]);
    assert.ok(h.events.includes("invalidate:contextBase:urban-zoom-exact"));
    assert.equal(h.events.includes("prepare:physicalBase"), false);
    assert.equal(h.events.includes("prepare:contextBase"), false);
    h.scheduler.finalizePendingExactAfterSettleRefreshAfterPaint();
    assert.equal(h.metrics.some(({ details }) => details?.contextBaseRefreshed), false);
    h.deferredTasks[0].callback();
    h.runNextFrame("deferred-exact-context-pass-contextBase");
    h.runNextFrame("deferred-exact-context-pass-labels");
    h.runNextFrame("deferred-exact-context-pass-textureLabels");
    assert.ok(h.events.includes("prepare:contextBase"));
    assert.equal(h.events.includes("prepare:physicalBase"), false);
    assert.ok(h.events.includes("request-render:deferred-exact-context-refresh:false"));
  } finally { h.restore(); }
});

test("pan, hidden or absent urban data, and disabled reuse retain the existing settle targets", () => {
  for (const condition of ["pan", "hidden", "empty", "missing", "reuse-disabled", "missing-reference"]) {
    const h = createHarness({ includeContextPasses: true });
    try {
      h.reuseDecision.enabled = true;
      h.runtimeState.showUrban = true;
      h.runtimeState.urbanData = { features: [{}] };
      if (condition === "pan") h.runtimeState.zoomTransform = { k: 3, x: 700, y: 200 };
      if (condition === "hidden") h.runtimeState.showUrban = false;
      if (condition === "empty") h.runtimeState.urbanData.features = [];
      if (condition === "missing") h.runtimeState.urbanData = null;
      if (condition === "reuse-disabled") h.reuseDecision.enabled = false;
      if (condition === "missing-reference") h.reuseDecision.referenceTransform = null;
      h.driveToAwaitingPaint();
      const plan = h.runtimeState.exactAfterSettleController.pendingPlan;
      assert.equal(plan.urbanZoomExactRefresh, false, condition);
      assert.deepEqual(plan.exactTargetPasses, ["political", "borders"], condition);
      assert.deepEqual(plan.deferredExactTargetPasses, ["labels", "textureLabels"], condition);
      assert.equal(h.events.includes("invalidate:contextBase:urban-zoom-exact"), false, condition);
    } finally { h.restore(); }
  }
});

test("async pass preparation preserves the visible frame and waits before pass draw or completion", async () => {
  let resolvePreparation;
  let ready = false;
  const preparation = new Promise((resolve) => { resolvePreparation = () => { ready = true; resolve(); }; });
  const h = createHarness({ prepareRenderPassAsync: (pass) => pass === "political" && !ready ? preparation : null });
  try {
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    h.runTimer(); h.runNextFrame(); h.runNextFrame(); h.runNextFrame("exact-after-settle-pass-political");
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "applying");
    assert.equal(h.runtimeState.deferExactAfterSettle, true);
    assert.equal(h.events.includes("prepare:political"), false);
    assert.equal(h.events.includes("request-render:exact-after-settle:true"), false);
    assert.equal(h.frameTasks.length, 0);
    resolvePreparation(); await Promise.resolve();
    h.runNextFrame("exact-after-settle-pass-political");
    assert.equal(h.events.includes("prepare:political"), true);
    h.runNextFrame("exact-after-settle-pass-borders");
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "awaiting-paint");
  } finally { h.restore(); }
});

test("late preparation cannot draw an old generation or an interrupted gesture", async () => {
  for (const interruption of ["new-generation", "gesture", "identity"]) {
    let resolvePreparation;
    const preparation = new Promise((resolve) => { resolvePreparation = resolve; });
    const h = createHarness({ prepareRenderPassAsync: () => preparation });
    try {
      h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
      h.runTimer(); h.runNextFrame(); h.runNextFrame(); h.runNextFrame();
      if (interruption === "new-generation") {
        h.scheduler.cancelExactAfterSettleRefresh();
        h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
      } else if (interruption === "gesture") h.runtimeState.renderPhase = "interacting";
      else h.setTopologyRevision(999);
      resolvePreparation(); await Promise.resolve();
      if (h.frameTasks.some((task) => !task.cancelled)) h.runNextFrame();
      assert.equal(h.events.includes("prepare:political"), false);
      assert.equal(h.events.includes("request-render:exact-after-settle:true"), false);
      if (interruption === "new-generation") assert.equal(h.runtimeState.exactAfterSettleController.phase, "scheduled");
    } finally { h.restore(); }
  }
});

test("signature callbacks receive camera values without borrowing the live transform", () => {
  const received = [];
  const harness = createHarness({ getRenderPassSignature: (_pass, transform) => {
    received.push(transform);
    return "current-camera";
  } });
  try {
    const transform = harness.runtimeState.zoomTransform;
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    harness.runTimer();
    harness.runNextFrame("exact-after-settle-Prepare");
    harness.runNextFrame("exact-after-settle-Apply");
    assert.ok(received.length > 0);
    assert.notEqual(received[0], transform);
    assert.deepEqual(received[0], transform);
    received[0].x = 99;
    assert.equal(transform.x, 0);
    harness.scheduler.cancelExactAfterSettleRefresh();
  } finally {
    harness.restore();
  }
});

test("camera signature changes enter cancellable passes before final paint even without a dirty bit", () => {
  const harness = createHarness({ cameraSignatureMismatch: true });
  try {
    harness.cache.signatures = { background: "old-camera" };
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    harness.runTimer();
    harness.runNextFrame("exact-after-settle-Prepare");
    harness.runNextFrame("exact-after-settle-Apply");
    harness.runNextFrame("exact-after-settle-pass-background");
    assert.ok(harness.events.includes("prepare:background"));
    assert.ok(!harness.events.includes("request-render:exact-after-settle:true"));
    harness.scheduler.cancelExactAfterSettleRefresh();
  } finally {
    harness.restore();
  }
});

test("schedule, apply, awaiting-paint, and finalize follow action-owned state transitions", () => {
  const harness = createHarness();
  try {
    const generation = harness.driveToAwaitingPaint();
    assertOrdered(harness.events, [
      "update-dpr",
      "set-canvas-size",
      "cancel-context-base",
      "defer-context-base:false",
      "invalidate:political:exact-after-settle-political",
      "prepare:political",
      "prepare:borders",
      "request-render:exact-after-settle:true",
    ]);

    assert.equal(harness.scheduler.finalizePendingExactAfterSettleRefreshAfterPaint(), true);
    assert.equal(harness.runtimeState.exactAfterSettleController.phase, "idle");
    assert.equal(harness.runtimeState.exactAfterSettleController.reason, "finalized");
    assert.equal(harness.runtimeState.exactAfterSettleController.generation, generation + 1);
    assert.equal(harness.runtimeState.exactAfterSettleController.pendingPlan, null);
    assert.equal(harness.deferredTasks.length, 1);
    assertOrdered(harness.events, [
      "request-render:exact-after-settle:true",
      "metric:settleExactRefreshWaitForPaint",
      "flush-scenario-chunks",
      "metric:settleExactRefresh",
      "schedule-deferred-work",
      "metric:settleExactRefreshFinalize",
      "metric:settleExactRefreshPhaseBreakdown",
    ]);
  } finally {
    harness.restore();
  }
});

test("pending plans are cloned at scheduler action boundaries", () => {
  const harness = createHarness();
  try {
    harness.driveToAwaitingPaint();
    const pendingPlan = harness.runtimeState.exactAfterSettleController.pendingPlan;
    assert.notEqual(pendingPlan.resolvedProfile, harness.profile);
    assert.notEqual(pendingPlan.reuseDecision, harness.reuseDecision);
    assert.notEqual(
      pendingPlan.reuseDecision.referenceTransform,
      harness.reuseDecision.referenceTransform,
    );
    assert.notEqual(
      pendingPlan.reuseDecision.currentTransform,
      harness.reuseDecision.currentTransform,
    );
    assert.equal(pendingPlan.resolvedProfile.settleDurationMs, 40);
    assert.equal(pendingPlan.reuseDecision.reason, "stable-cache");

    harness.profile.settleDurationMs = 999;
    harness.reuseDecision.reason = "caller-mutated";
    harness.reuseDecision.referenceTransform.x = 99;
    harness.reuseDecision.currentTransform.k = 99;
    assert.equal(pendingPlan.resolvedProfile.settleDurationMs, 40);
    assert.equal(pendingPlan.reuseDecision.reason, "stable-cache");
    assert.equal(pendingPlan.reuseDecision.referenceTransform.x, 1);
    assert.equal(pendingPlan.reuseDecision.currentTransform.k, 6);
  } finally {
    harness.restore();
  }
});

test("public controller reads return detached snapshots", () => {
  const harness = createHarness();
  try {
    harness.driveToAwaitingPaint();
    const snapshot = harness.scheduler.getExactAfterSettleControllerState();
    assert.notEqual(snapshot, harness.runtimeState.exactAfterSettleController);
    assert.notEqual(
      snapshot.pendingPlan,
      harness.runtimeState.exactAfterSettleController.pendingPlan,
    );
    assert.notEqual(
      snapshot.pendingPlan.reuseDecision,
      harness.runtimeState.exactAfterSettleController.pendingPlan.reuseDecision,
    );

    snapshot.phase = "caller-mutated";
    snapshot.pendingPlan.reuseDecision.reason = "caller-mutated";
    assert.equal(harness.runtimeState.exactAfterSettleController.phase, "awaiting-paint");
    assert.equal(
      harness.runtimeState.exactAfterSettleController.pendingPlan.reuseDecision.reason,
      "stable-cache",
    );
  } finally {
    harness.restore();
  }
});

test("generation mismatch fences queued scheduler segments", () => {
  const harness = createHarness();
  try {
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    harness.runTimer();
    assert.equal(harness.frameTasks.length, 1);
    harness.scheduler.resetExactAfterSettleController("external-reset");
    harness.runNextFrame("exact-after-settle-Prepare");
    assert.equal(harness.frameTasks.length, 0);
    assert.equal(harness.runtimeState.exactAfterSettleController.phase, "idle");
    assert.equal(harness.events.includes("update-dpr"), false);
  } finally {
    harness.restore();
  }
});

test("identity mismatch aborts and rearms an exact refresh with recovery ordering", () => {
  const harness = createHarness();
  try {
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    const firstGeneration = harness.runtimeState.exactAfterSettleController.generation;
    harness.runTimer();
    harness.setTopologyRevision(harness.runtimeState.topologyRevision + 1);
    harness.runNextFrame("exact-after-settle-Prepare");

    assert.equal(harness.runtimeState.exactAfterSettleController.phase, "scheduled");
    assert.ok(harness.runtimeState.exactAfterSettleController.generation > firstGeneration);
    assert.equal(harness.runtimeState.deferExactAfterSettle, true);
    assert.equal(harness.runtimeState.pendingExactPoliticalFastFrame, true);
    assertOrdered(harness.events, [
      "metric:settleExactRefreshAbortBeforePaint",
      "invalidate:political:exact-after-settle-abort",
      "request-render:exact-after-settle-abort-recover:false",
    ]);
  } finally {
    harness.restore();
  }
});

test("reschedule and cancel fence exact timer handles", () => {
  const harness = createHarness();
  try {
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    const firstHandle = harness.runtimeState.exactAfterSettleHandle;
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    const secondHandle = harness.runtimeState.exactAfterSettleHandle;

    assert.notEqual(secondHandle.id, firstHandle.id);
    assert.equal(harness.cancelledTimerIds.has(firstHandle.id), true);
    assert.equal(harness.cancelledTimerIds.has(secondHandle.id), false);
    assert.equal(harness.runtimeState.exactAfterSettleController.phase, "scheduled");

    harness.scheduler.cancelExactAfterSettleRefresh();
    assert.equal(harness.cancelledTimerIds.has(secondHandle.id), true);
    assert.equal(harness.runtimeState.exactAfterSettleHandle, null);
    assert.equal(harness.runtimeState.exactAfterSettleController.phase, "idle");
    assert.equal(harness.runtimeState.exactAfterSettleController.reason, "cancel");
    assert.equal(harness.runtimeState.deferExactAfterSettle, false);
    assert.equal(harness.runtimeState.pendingExactPoliticalFastFrame, false);
  } finally {
    harness.restore();
  }
});

test("compose failure recovery aborts awaiting-paint state through the public method", () => {
  const harness = createHarness();
  try {
    const generation = harness.driveToAwaitingPaint();
    assert.equal(
      harness.scheduler.abortPendingExactAfterSettleRefreshAfterPaint("compose-failed"),
      true,
    );
    assert.equal(harness.runtimeState.exactAfterSettleController.phase, "idle");
    assert.equal(harness.runtimeState.exactAfterSettleController.reason, "abort-compose-failed");
    assert.equal(harness.runtimeState.exactAfterSettleController.generation, generation + 1);
    assert.equal(harness.runtimeState.deferExactAfterSettle, false);
    assert.equal(harness.runtimeState.pendingExactPoliticalFastFrame, false);
    assertOrdered(harness.events, [
      "metric:settleExactRefreshAbortAfterPaintFailure",
      "invalidate:political:exact-after-settle-abort",
      "request-render:exact-after-settle-abort-recover:false",
    ]);
    assert.equal(harness.scheduler.abortPendingExactAfterSettleRefreshAfterPaint(), false);
  } finally {
    harness.restore();
  }
});

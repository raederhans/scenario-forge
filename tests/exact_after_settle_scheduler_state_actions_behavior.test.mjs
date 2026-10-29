import assert from "node:assert/strict";
import test from "node:test";

import { createExactAfterSettleScheduler } from "../js/core/map_renderer/exact_after_settle_scheduler.js";
import { filterEnabledRenderPassNames } from "../js/core/map_renderer/render_pass_visibility_policy.js";

function createHarness({ cameraSignatureMismatch = false, prepareRenderPassAsync = () => null, includeContextPasses = false, includeWaterPass = false, includeOptionalPasses = false, getActiveRenderPassNames, getRenderPassSignature } = {}) {
  const events = [];
  const drawCounts = {};
  const canvasSizeCalls = [];
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
    ...(includeWaterPass ? [["contextScenario", () => {}]] : []),
    ["political", () => {}],
    ...(includeOptionalPasses ? ["populationHeatmap", "effects", "lineEffects", "dayNight", "contextMarkers"]
      .map(passName => [passName, () => {}]) : []),
    ["borders", () => {}],
    ["labels", () => {}],
    ["textureLabels", () => {}],
  ].map(([passName]) => [passName, () => {
    drawCounts[passName] = (drawCounts[passName] || 0) + 1;
  }]);
  const pipelineOwner = {
    getIdleRenderPassDefinitions() {
      return definitions;
    },
    prepareIdleRenderPassDefinition(passName, drawFn) {
      events.push(`prepare:${passName}`);
      drawFn();
    },
  };

  const scheduler = createExactAfterSettleScheduler({
    prepareRenderPassAsync,
    runtimeState: schedulerRuntime,
    renderPassNames: definitions.map(([passName]) => passName),
    getActiveRenderPassNames,
    renderPhaseIdle: "idle",
    exactContextRefreshDelayMs: 0,
    getContext: () => ({ canvas: { width: 1200, height: 800 } }),
    getVisibleContextFlagSignature: () => "context:visible",
    cloneZoomTransform: (transform) => ({ ...transform }),
    getAdaptiveSettleProfile: () => profile,
    getContextBaseReuseDecision: () => reuseDecision,
    shouldForceExactContextBaseRefresh: () => false,
    updateDprStage: () => events.push("update-dpr"),
    setCanvasSize: options => {
      canvasSizeCalls.push(options);
      events.push("set-canvas-size");
    },
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
    canvasSizeCalls,
    drawCounts,
    passNames: definitions.map(([passName]) => passName),
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
    setNow(value) { now = value; },
    setTopologyRevision(value) {
      schedulerRuntime.topologyRevision = Number(value || 0);
    },
    timers,
  };
}

test("disabled passes stay unprepared and undrawn, including physical base in contours-only mode", () => {
  for (const showPhysical of [false, true]) {
    const preparations = [];
    const visibility = { showPhysical, physicalMode: "contours_only" };
    const h = createHarness({
      includeContextPasses: true,
      includeOptionalPasses: true,
      getActiveRenderPassNames: () => filterEnabledRenderPassNames(h.passNames, visibility),
      prepareRenderPassAsync: passName => { preparations.push(passName); return null; },
    });
    try {
      h.reuseDecision.enabled = true;
      h.reuseDecision.shouldExactRefresh = true;
      h.passNames.forEach(passName => { h.cache.dirty[passName] = true; });
      h.driveToAwaitingPaint();
      h.scheduler.finalizePendingExactAfterSettleRefreshAfterPaint();
      h.deferredTasks[0].callback();
      while (h.frameTasks.length) h.runNextFrame();
      const expected = showPhysical
        ? ["political", "borders", "contextBase", "labels"]
        : ["political", "borders", "labels"];
      assert.deepEqual(h.drawCounts, Object.fromEntries(expected.map(passName => [passName, 1])));
      assert.deepEqual(preparations, ["political", "borders", "labels", "political", "borders"]);
      assert.equal(h.canvasSizeCalls[0].targetPassesOnDprChange.includes("physicalBase"), false);

      visibility.showPhysical = true;
      visibility.physicalMode = "atlas_and_contours";
      visibility.populationHeatmapEnabled = true;
      visibility.textureMode = "graticule";
      preparations.length = 0;
      for (const key of Object.keys(h.drawCounts)) delete h.drawCounts[key];
      h.runtimeState.deferExactAfterSettle = true;
      h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
      h.runTimer();
      while (h.frameTasks.length) h.runNextFrame();
      h.scheduler.finalizePendingExactAfterSettleRefreshAfterPaint();
      h.deferredTasks.at(-1).callback();
      while (h.frameTasks.length) h.runNextFrame();
      const reenabled = filterEnabledRenderPassNames(h.passNames, visibility);
      assert.deepEqual(Object.keys(h.drawCounts).sort(), [...reenabled].sort());
      assert.ok(Object.values(h.drawCounts).every(count => count === 1));
      assert.ok(preparations.includes("physicalBase"));
      assert.ok(preparations.every(passName => reenabled.includes(passName)));
    } finally { h.restore(); }
  }
});

test("empty active targets complete without preparing or drawing the full catalog", () => {
  const preparations = [];
  const h = createHarness({
    includeOptionalPasses: true,
    getActiveRenderPassNames: () => [],
    prepareRenderPassAsync: passName => { preparations.push(passName); return null; },
  });
  try {
    h.passNames.forEach(passName => { h.cache.dirty[passName] = true; });
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    h.runTimer(); h.runNextFrame(); h.runNextFrame();
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "awaiting-paint");
    assert.equal(h.frameTasks.length, 0);
    assert.deepEqual(preparations, []);
    assert.deepEqual(h.drawCounts, {});
    assert.deepEqual(h.canvasSizeCalls[0].targetPassesOnDprChange, []);
    h.scheduler.finalizePendingExactAfterSettleRefreshAfterPaint();
    assert.equal(h.deferredTasks.length, 0);
  } finally { h.restore(); }
});

test("an empty immediate stage still completes its active deferred targets", () => {
  let active = ["labels", "textureLabels"];
  const h = createHarness({ getActiveRenderPassNames: () => active });
  try {
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    h.runTimer(); h.runNextFrame(); h.runNextFrame();
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "awaiting-paint");
    assert.deepEqual(h.drawCounts, {});
    assert.equal(h.frameTasks.length, 0);
    h.scheduler.finalizePendingExactAfterSettleRefreshAfterPaint();
    active = ["labels"];
    h.deferredTasks[0].callback();
    h.runNextFrame("deferred-exact-context-pass-labels");
    assert.deepEqual(h.drawCounts, { labels: 1 });
    assert.equal(h.frameTasks.length, 0);
  } finally { h.restore(); }
});

test("passes disabled after planning are skipped without stalling or reordering either queue", () => {
  let active;
  const preparations = [];
  const h = createHarness({
    includeOptionalPasses: true,
    getActiveRenderPassNames: () => active,
    prepareRenderPassAsync: passName => { preparations.push(passName); return null; },
  });
  try {
    active = h.passNames;
    h.passNames.forEach(passName => { h.cache.dirty[passName] = true; });
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    h.runTimer(); h.runNextFrame(); h.runNextFrame();
    active = active.filter(passName => !["populationHeatmap", "effects", "lineEffects", "dayNight"].includes(passName));
    preparations.length = 0;
    while (h.frameTasks.length) h.runNextFrame();
    assert.deepEqual(preparations, ["political", "borders"]);
    assert.deepEqual(h.drawCounts, { political: 1, borders: 1 });
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "awaiting-paint");
    h.scheduler.finalizePendingExactAfterSettleRefreshAfterPaint();
    h.deferredTasks[0].callback();
    active = active.filter(passName => !["contextMarkers", "textureLabels"].includes(passName));
    while (h.frameTasks.length) h.runNextFrame();
    assert.deepEqual(h.events.filter(event => event.startsWith("prepare:")), ["prepare:political", "prepare:borders", "prepare:labels"]);
    assert.deepEqual(h.drawCounts, { political: 1, borders: 1, labels: 1 });
    assert.ok(h.events.includes("request-render:deferred-exact-context-refresh:false"));
  } finally { h.restore(); }
});

test("preflight reads current visibility for each producer and async continuation skips a disabled pass", async () => {
  let active;
  let resolvePreparation;
  const preparations = [];
  const pending = new Promise(resolve => { resolvePreparation = resolve; });
  const h = createHarness({
    getActiveRenderPassNames: () => active,
    prepareRenderPassAsync: passName => {
      preparations.push(passName);
      if (passName === "political") {
        active = active.filter(name => name !== "labels");
        return pending;
      }
      return null;
    },
  });
  try {
    active = h.passNames;
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    h.runTimer(); h.runNextFrame(); h.runNextFrame();
    assert.deepEqual(preparations, ["political", "borders"]);
    h.runNextFrame("exact-after-settle-pass-political");
    active = active.filter(passName => passName !== "political");
    preparations.length = 0;
    resolvePreparation(); await Promise.resolve();
    h.runNextFrame("exact-after-settle-pass-political");
    h.runNextFrame("exact-after-settle-pass-borders");
    assert.deepEqual(preparations, ["borders"]);
    assert.deepEqual(h.drawCounts, { borders: 1 });
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "awaiting-paint");
  } finally { h.restore(); }
});

test("cancellation still fences remaining work after an inactive pass is skipped", () => {
  for (const phase of ["immediate", "deferred"]) {
    let active;
    const h = createHarness({ getActiveRenderPassNames: () => active, includeOptionalPasses: true });
    try {
      active = h.passNames;
      h.cache.dirty.contextMarkers = true;
      h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
      h.runTimer(); h.runNextFrame(); h.runNextFrame();
      if (phase === "immediate") {
        active = active.filter(passName => passName !== "political");
        h.runNextFrame("exact-after-settle-pass-political");
      } else {
        while (h.frameTasks.length) h.runNextFrame();
        h.scheduler.finalizePendingExactAfterSettleRefreshAfterPaint();
        h.deferredTasks[0].callback();
        active = active.filter(passName => passName !== "contextMarkers");
        h.runNextFrame("deferred-exact-context-pass-contextMarkers");
      }
      const drawsBeforeCancel = { ...h.drawCounts };
      const pendingTasks = [...h.frameTasks];
      h.scheduler.cancelExactAfterSettleRefresh();
      pendingTasks.forEach(task => task.callback());
      assert.deepEqual(h.drawCounts, drawsBeforeCancel);
      assert.equal(h.runtimeState.exactAfterSettleController.phase, "idle");
    } finally { h.restore(); }
  }
});

test("exact refresh waits only the remainder of the quiet window after settling", () => {
  const harness = createHarness();
  try {
    harness.profile.exactQuietWindowMs = 180;
    harness.runtimeState.zoomGestureEndedAt = 400;
    harness.setNow(500);
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    assert.equal(harness.timers.get(harness.runtimeState.exactAfterSettleHandle.id).delay, 79);
    harness.setNow(700);
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    assert.equal(harness.timers.get(harness.runtimeState.exactAfterSettleHandle.id).delay, 0);
    harness.runtimeState.zoomGestureEndedAt = 0;
    harness.scheduler.scheduleExactAfterSettleRefresh(harness.profile);
    assert.equal(harness.timers.get(harness.runtimeState.exactAfterSettleHandle.id).delay, 180);
  } finally { harness.restore(); }
});

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
  const preparationEpochs = [];
  const preparation = new Promise((resolve) => { resolvePreparation = () => { ready = true; resolve(); }; });
  const h = createHarness({ prepareRenderPassAsync: (pass) => {
    if (pass !== "political") return null;
    preparationEpochs.push(h.events.filter((event) => event === "invalidate:political:exact-after-settle-political").length);
    return ready ? null : preparation;
  } });
  try {
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    h.runTimer(); h.runNextFrame(); h.runNextFrame(); h.runNextFrame("exact-after-settle-pass-political");
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "applying");
    assert.equal(h.runtimeState.deferExactAfterSettle, true);
    assert.equal(h.events.includes("prepare:political"), false);
    assert.equal(h.events.includes("request-render:exact-after-settle:true"), false);
    assert.equal(h.frameTasks.length, 0);
    assert.deepEqual(preparationEpochs, [1, 1], "preflight and pass preparation must observe the invalidated snapshot epoch");
    resolvePreparation(); await Promise.resolve();
    h.runNextFrame("exact-after-settle-pass-political");
    assert.equal(h.events.includes("prepare:political"), true);
    assert.deepEqual(preparationEpochs, [1, 1, 1], "retry must preserve the prepared snapshot epoch");
    h.runNextFrame("exact-after-settle-pass-borders");
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "awaiting-paint");
    assert.equal(h.events.filter((event) => event === "invalidate:political:exact-after-settle-political").length, 1);
  } finally { h.restore(); }
});

test("exact preflight starts all private producers at one epoch without awaiting deferred work", async () => {
  const starts = [];
  let resolvePolitical;
  let ready = false;
  const political = new Promise(resolve => { resolvePolitical = () => { ready = true; resolve(); }; });
  const deferred = new Promise(() => {});
  const h = createHarness({ includeContextPasses: true, includeWaterPass: true,
    prepareRenderPassAsync: pass => {
      starts.push([pass, h.events.filter(event => event === "invalidate:political:exact-after-settle-political").length]);
      if (pass === "political") return ready ? null : political;
      if (pass === "labels" || pass === "contextScenario") return deferred;
      return null;
    } });
  try {
    h.cache.dirty.physicalBase = true;
    h.cache.dirty.contextScenario = true;
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    h.runTimer(); h.runNextFrame(); h.runNextFrame();
    assert.deepEqual(starts, ["physicalBase", "contextScenario", "political", "borders", "labels"].map(pass => [pass, 1]));
    assert.equal(h.events.some(event => event.startsWith("prepare:")), false, "preflight cannot paint a pass");
    h.runNextFrame("exact-after-settle-pass-physicalBase");
    h.runNextFrame("exact-after-settle-pass-political");
    assert.equal(h.events.includes("prepare:borders"), false);
    resolvePolitical(); await Promise.resolve();
    h.runNextFrame("exact-after-settle-pass-political");
    h.runNextFrame("exact-after-settle-pass-borders");
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "awaiting-paint", "deferred promises cannot delay exact paint");
    assert.deepEqual(h.events.filter(event => event.startsWith("prepare:")), ["prepare:physicalBase", "prepare:political", "prepare:borders"]);
    assert.equal(h.events.filter(event => event === "invalidate:political:exact-after-settle-political").length, 1);
  } finally { h.restore(); }
});

test("repeated preparation yields preserve one political epoch and fence late failures", async () => {
  for (const outcome of ["complete", "replacement"]) {
    let firstReady, secondReady, secondFailed;
    let stage = 0;
    const first = new Promise(resolve => { firstReady = () => { stage = 1; resolve(); }; });
    const second = new Promise((resolve, reject) => {
      secondReady = () => { stage = 2; resolve(); };
      secondFailed = reject;
    });
    const h = createHarness({ prepareRenderPassAsync: pass => pass === "political"
      ? [first, second, null][stage] : null });
    try {
      h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
      h.runTimer(); h.runNextFrame(); h.runNextFrame();
      h.runNextFrame("exact-after-settle-pass-political");
      firstReady(); await Promise.resolve();
      h.runNextFrame("exact-after-settle-pass-political");
      assert.equal(h.events.includes("prepare:political"), false);
      assert.equal(h.runtimeState.exactAfterSettleController.phase, "applying");
      assert.equal(h.events.filter(event => event === "invalidate:political:exact-after-settle-political").length, 1);
      if (outcome === "complete") {
        secondReady(); await Promise.resolve();
        h.runNextFrame("exact-after-settle-pass-political");
        h.runNextFrame("exact-after-settle-pass-borders");
        assert.equal(h.runtimeState.exactAfterSettleController.phase, "awaiting-paint");
        assert.equal(h.events.filter(event => event === "prepare:political").length, 1);
        assert.equal(h.events.filter(event => event === "invalidate:political:exact-after-settle-political").length, 1);
      } else {
        h.scheduler.cancelExactAfterSettleRefresh();
        h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
        const generation = h.runtimeState.exactAfterSettleController.generation;
        const aborts = h.events.filter(event => event === "metric:settleExactRefreshAbortBeforePaint").length;
        secondFailed(new Error("superseded second yield"));
        await Promise.resolve(); await Promise.resolve();
        assert.equal(h.runtimeState.exactAfterSettleController.generation, generation);
        assert.equal(h.runtimeState.exactAfterSettleController.phase, "scheduled");
        assert.equal(h.events.filter(event => event === "metric:settleExactRefreshAbortBeforePaint").length, aborts);
      }
    } finally { h.restore(); }
  }
});

test("rejected speculative deferred preparation cannot abort a replacement generation", async () => {
  for (const failedPass of ["labels", "political"]) {
  let rejectDeferred;
  const deferred = new Promise((_, reject) => { rejectDeferred = reject; });
  const h = createHarness({ prepareRenderPassAsync: pass => pass === failedPass ? deferred : null });
  try {
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    h.runTimer(); h.runNextFrame(); h.runNextFrame();
    h.runNextFrame("exact-after-settle-pass-political");
    h.scheduler.cancelExactAfterSettleRefresh();
    h.scheduler.scheduleExactAfterSettleRefresh(h.profile);
    const generation = h.runtimeState.exactAfterSettleController.generation;
    const aborts = h.events.filter(event => event === "metric:settleExactRefreshAbortBeforePaint").length;
    rejectDeferred(new Error("old source")); await Promise.resolve(); await Promise.resolve();
    assert.equal(h.runtimeState.exactAfterSettleController.generation, generation);
    assert.equal(h.runtimeState.exactAfterSettleController.phase, "scheduled");
    assert.equal(h.events.filter(event => event === "metric:settleExactRefreshAbortBeforePaint").length, aborts);
  } finally { h.restore(); }
  }
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

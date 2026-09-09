import assert from "node:assert/strict";
import test from "node:test";

import {
  createStartupReadyHandoffOwner,
} from "../js/bootstrap/startup_ready_handoff.js";
import { createPostReadyScheduler, POST_READY_IDLE_QUIET_MS } from "../js/bootstrap/post_ready_scheduler.js";
import { attachDeferredUiBootstrapRejectionObserver } from "../js/bootstrap/deferred_ui_bootstrap.js";
import { setUiHydrationState } from "../js/core/state/actions/boot_actions.js";

function createSchedulerRecorder({ order = null } = {}) {
  const tasks = [];
  const recordedOrderLabels = new Set();
  const orderLabelByTaskKey = {
    "post-ready-full-interaction-infra": "startDeferredFullInteractionInfrastructureBuild",
    "post-ready-localization-hydration": "schedulePostReadyHydration",
    "post-ready-context-warmup": "schedulePostReadyDeferredContextWarmup",
    "post-ready-visual-warmup": "schedulePostReadyVisualWarmup",
  };
  return {
    tasks,
    scheduleTask(key, callback, options = {}) {
      tasks.push({ key, callback: () => callback({
        throwIfStale() {
          if (options.isCurrent && !options.isCurrent()) throw new Error("stale");
        },
        waitFor: async (value) => {
          const result = await value;
          if (options.isCurrent && !options.isCurrent()) throw new Error("stale");
          return result;
        },
        yield: async () => {},
        commit: (apply) => {
          if (options.isCurrent && !options.isCurrent()) throw new Error("stale");
          return apply();
        },
      }), options });
      const orderLabel = orderLabelByTaskKey[key];
      if (order && orderLabel && !recordedOrderLabels.has(orderLabel)) {
        recordedOrderLabels.add(orderLabel);
        order.push(orderLabel);
      }
    },
  };
}

function createTargetRuntime(overrides = {}) {
  return {
    bootPhase: "ready",
    bootBlocking: false,
    detailDeferred: false,
    detailPromotionCompleted: false,
    runtimeChunkLoadState: {
      selectionVersion: 1,
      pendingReason: "",
      pendingPromotion: false,
    },
    styleConfig: {
      texture: { mode: "none" },
      dayNight: { enabled: false },
    },
    showCityPoints: true,
    baseCityDataState: "loaded",
    ...overrides,
  };
}

function createHelpers({ order = null, overrides = {} } = {}) {
  return {
    buildInteractionInfrastructureAfterStartup: async () => true,
    checkpointBootMetric(metricName) {
      order?.push(`checkpoint ${metricName}`);
    },
    completeBootSequenceLogging() {
      order?.push("completeBootSequenceLogging");
    },
    ensureActiveScenarioBundleHydrated: async () => true,
    ensureContextLayerDataReady: async () => true,
    ensureFullLocalizationDataReady: async () => true,
    reconcileDetailPromotionPoliticalPass: () => true,
    requestMainRender: () => {},
    scheduleDeferredDetailPromotion() {
      order?.push("scheduleDeferredDetailPromotion");
    },
    shouldFastTrackScenarioHydration: () => false,
    consoleWarn: () => {},
    ...overrides,
  };
}

function createOwnerHarness({
  targetRuntime = createTargetRuntime(),
  scheduler = createSchedulerRecorder(),
  helpers = createHelpers(),
  startupUiBootstrapPromise = null,
} = {}) {
  const ownerHelpers = {
    ...helpers,
  };
  const owner = createStartupReadyHandoffOwner({
    runtimeState: targetRuntime,
    postReadyScheduler: scheduler,
    effects: {
      commitUiHydrationState: helpers.commitUiHydrationState
        || ((patch) => setUiHydrationState(targetRuntime, patch)),
      getStartupUiBootstrapPromise: () => startupUiBootstrapPromise,
    },
    helpers: ownerHelpers,
  });
  return {
    helpers: ownerHelpers,
    owner,
    scheduler,
    targetRuntime,
  };
}

test("owner requires explicit hydration effects and freezes its public facade", () => {
  assert.throws(() => createStartupReadyHandoffOwner({
    runtimeState: createTargetRuntime(),
    postReadyScheduler: createSchedulerRecorder(),
    helpers: createHelpers(),
  }), /requires effects\.commitUiHydrationState/);

  const { owner } = createOwnerHarness();
  assert.equal(Object.isFrozen(owner), true);
});

test("scheduleReadyPostBootWork preserves ready handoff order", () => {
  const order = [];
  const targetRuntime = createTargetRuntime({
    runtimeChunkLoadState: { selectionVersion: 0, pendingReason: "", pendingPromotion: false },
    scheduleScenarioChunkRefreshFn() {
      order.push("flushPendingScenarioChunkRefreshAfterReady");
    },
    showRivers: true,
    styleConfig: { texture: { mode: "grain" }, dayNight: { enabled: false } },
  });
  const scheduler = createSchedulerRecorder({ order });
  const helpers = createHelpers({ order });
  const { owner } = createOwnerHarness({ targetRuntime, scheduler, helpers });

  owner.scheduleReadyPostBootWork({ schedule() {} }, "ready-state");

  assert.deepEqual(order, [
    "checkpoint time-to-interactive",
    "checkpoint first-interactive",
    "completeBootSequenceLogging",
    "flushPendingScenarioChunkRefreshAfterReady",
    "scheduleDeferredDetailPromotion",
    "startDeferredFullInteractionInfrastructureBuild",
    "schedulePostReadyHydration",
    "schedulePostReadyDeferredContextWarmup",
    "schedulePostReadyVisualWarmup",
  ]);
});

test("observePostReadyUiBootstrap replays the latest scenario only after UI is ready", async () => {
  let resolveUi;
  const uiPromise = new Promise((resolve) => {
    resolveUi = resolve;
  });
  const targetRuntime = createTargetRuntime({
    activeScenarioId: "scenario-at-ready",
    currentScenarioApplyRequestId: 4,
  });
  const { owner } = createOwnerHarness({ targetRuntime, startupUiBootstrapPromise: uiPromise });
  const replays = [];
  const readyCalls = [];
  const failures = [];

  const observation = owner.observePostReadyUiBootstrap({
    runPostScenarioUiReplay: (options) => replays.push(options),
    handleUiBootstrapReady: async () => readyCalls.push("ready"),
    handleUiBootstrapFailure: async (error) => failures.push(error),
  });
  targetRuntime.activeScenarioId = "scenario-selected-after-ready";
  targetRuntime.currentScenarioApplyRequestId = 5;
  assert.deepEqual(replays, []);

  resolveUi();
  const result = await observation;

  assert.deepEqual(result, { ready: true, skipped: false, error: null });
  assert.deepEqual(failures, []);
  assert.deepEqual(readyCalls, ["ready"]);
  assert.equal(targetRuntime.uiHydrationStatus, "ready");
  assert.deepEqual(replays, [{
    full: true,
    reason: "post-ready-ui-bootstrap",
    scenarioId: "scenario-selected-after-ready",
    scenarioApplyRequestId: 5,
  }]);
});

test("observePostReadyUiBootstrap routes rejection through explicit recovery", async () => {
  const failure = new Error("toolbar import failed");
  const recovered = [];
  const { owner, targetRuntime } = createOwnerHarness({
    startupUiBootstrapPromise: Promise.reject(failure),
  });
  assert.equal(owner.beginUiHydration(), "pending");

  const result = await owner.observePostReadyUiBootstrap({
    runPostScenarioUiReplay: () => assert.fail("failed UI must not replay"),
    handleUiBootstrapReady: async () => assert.fail("failed UI must not open interaction"),
    handleUiBootstrapFailure: async (error) => recovered.push(error),
  });

  assert.deepEqual(recovered, [failure]);
  assert.equal(targetRuntime.uiHydrationStatus, "failed");
  assert.equal(targetRuntime.uiHydrationError, "toolbar import failed");
  assert.equal(targetRuntime.bootPhase, "ready");
  assert.equal(targetRuntime.bootBlocking, false);
  assert.deepEqual(result, { ready: false, skipped: false, error: failure });
});

test("an immediately guarded UI rejection still reaches the failed lifecycle observer", async () => {
  const failure = new Error("fast toolbar import failure");
  const guardedPromise = attachDeferredUiBootstrapRejectionObserver(Promise.reject(failure));
  const { owner, targetRuntime } = createOwnerHarness({
    startupUiBootstrapPromise: guardedPromise,
  });
  owner.beginUiHydration();

  await Promise.resolve();
  const result = await owner.observePostReadyUiBootstrap({
    runPostScenarioUiReplay: () => assert.fail("fast rejection must not replay"),
    handleUiBootstrapReady: async () => assert.fail("fast rejection must not open UI"),
    handleUiBootstrapFailure: async () => {},
  });

  assert.equal(result.ready, false);
  assert.equal(result.error, failure);
  assert.equal(targetRuntime.uiHydrationStatus, "failed");
  assert.equal(targetRuntime.uiHydrationError, failure.message);
});

test("flushPendingScenarioChunkRefreshAfterReady seeds first-ready pending reason", () => {
  const refreshCalls = [];
  const targetRuntime = createTargetRuntime({
    runtimeChunkLoadState: {
      selectionVersion: 0,
      pendingReason: "",
      pendingPromotion: false,
    },
    scheduleScenarioChunkRefreshFn(payload) {
      refreshCalls.push(payload);
    },
  });
  const { owner } = createOwnerHarness({ targetRuntime });

  owner.flushPendingScenarioChunkRefreshAfterReady("ready-state");

  assert.equal(targetRuntime.runtimeChunkLoadState.pendingReason, "ready-state");
  assert.equal(targetRuntime.runtimeChunkLoadState.pendingDelayMs, 0);
  assert.deepEqual(refreshCalls, [{
    reason: "ready-state",
    delayMs: 0,
    flushPending: true,
  }]);
});

test("flushPendingScenarioChunkRefreshAfterReady skips missing refresh function", () => {
  const targetRuntime = createTargetRuntime({
    runtimeChunkLoadState: {
      selectionVersion: 0,
      pendingReason: "",
      pendingPromotion: false,
    },
  });
  const { owner } = createOwnerHarness({ targetRuntime });

  assert.doesNotThrow(() => {
    owner.flushPendingScenarioChunkRefreshAfterReady("ready-state");
  });
});

test("schedulePostReadyHydration schedules two task keys and preserves timing", () => {
  const slowHarness = createOwnerHarness({
    helpers: createHelpers({
      overrides: {
        shouldFastTrackScenarioHydration: () => false,
      },
    }),
  });

  slowHarness.owner.schedulePostReadyHydration();
  slowHarness.owner.schedulePostReadyHydration();

  assert.deepEqual(slowHarness.scheduler.tasks.map((task) => task.key), [
    "post-ready-localization-hydration",
    "post-ready-scenario-hydration",
  ]);
  assert.deepEqual(slowHarness.scheduler.tasks[0].options, {
    timeout: 2200,
    delayMs: 1200,
    retryDelayMs: 600,
  });
  assert.deepEqual(slowHarness.scheduler.tasks[1].options, {
    timeout: 4800,
    delayMs: 4200,
    retryDelayMs: 900,
  });

  const fastHarness = createOwnerHarness({
    helpers: createHelpers({
      overrides: {
        shouldFastTrackScenarioHydration: () => true,
      },
    }),
  });

  fastHarness.owner.schedulePostReadyHydration();

  assert.deepEqual(fastHarness.scheduler.tasks[1].options, {
    timeout: 4800,
    delayMs: 300,
    retryDelayMs: 450,
  });
});

test("hydration task callbacks catch and warn", async () => {
  const localizationFailure = new Error("localization failed");
  const scenarioFailure = new Error("scenario failed");
  const warnings = [];
  const { owner, scheduler } = createOwnerHarness({
    helpers: createHelpers({
      overrides: {
        ensureFullLocalizationDataReady: async () => {
          throw localizationFailure;
        },
        ensureActiveScenarioBundleHydrated: async () => {
          throw scenarioFailure;
        },
        consoleWarn: (...args) => warnings.push(args),
      },
    }),
  });

  owner.schedulePostReadyHydration();
  await scheduler.tasks[0].callback();
  await scheduler.tasks[1].callback();

  assert.equal(warnings[0][0], "[boot] Deferred full localization hydration failed during idle scheduling.");
  assert.equal(warnings[0][1], localizationFailure);
  assert.equal(warnings[1][0], "[boot] Deferred full scenario hydration failed during idle scheduling.");
  assert.equal(warnings[1][1], scenarioFailure);
});

test("schedulePostReadyPoliticalReconcile gates detail readiness and reschedules false requests", () => {
  const targetRuntime = createTargetRuntime({ detailPromotionCompleted: false });
  const reconcileCalls = [];
  const { owner, scheduler } = createOwnerHarness({
    targetRuntime,
    helpers: createHelpers({
      overrides: {
        reconcileDetailPromotionPoliticalPass(reason) {
          reconcileCalls.push(reason);
          return false;
        },
      },
    }),
  });

  assert.equal(owner.schedulePostReadyPoliticalReconcile("detail-ready"), false);
  assert.equal(scheduler.tasks.length, 0);

  targetRuntime.detailPromotionCompleted = true;
  assert.equal(owner.schedulePostReadyPoliticalReconcile("detail-ready"), true);
  assert.equal(scheduler.tasks[0].key, "post-ready-detail-promotion-political-reconcile");
  assert.deepEqual(scheduler.tasks[0].options, {
    timeout: 1200,
    delayMs: 0,
    retryDelayMs: 320,
    idleQuietMs: POST_READY_IDLE_QUIET_MS,
  });

  assert.equal(scheduler.tasks[0].callback(), false);
  assert.deepEqual(reconcileCalls, ["detail-ready"]);
  assert.equal(scheduler.tasks.length, 2);
});

test("startDeferredFullInteractionInfrastructureBuild defers until detail is complete", async () => {
  const buildCalls = [];
  const targetRuntime = createTargetRuntime({
    detailDeferred: true,
    detailPromotionCompleted: false,
  });
  const { owner, scheduler } = createOwnerHarness({
    targetRuntime,
    helpers: createHelpers({
      overrides: {
        buildInteractionInfrastructureAfterStartup: async (options) => {
          buildCalls.push(options);
          return true;
        },
      },
    }),
  });

  owner.startDeferredFullInteractionInfrastructureBuild("ready-state");
  assert.equal(scheduler.tasks[0].key, "post-ready-full-interaction-infra");
  assert.equal(scheduler.tasks[0].callback(), false);
  assert.deepEqual(buildCalls, []);
  assert.equal(scheduler.tasks.length, 2);

  targetRuntime.detailPromotionCompleted = true;
  await scheduler.tasks[1].callback();
  assert.deepEqual(buildCalls, [{
    chunked: true,
    buildHitCanvas: false,
    mode: "full",
  }]);
});

test("startDeferredFullInteractionInfrastructureBuild catches build rejection with reason", async () => {
  const failure = new Error("infra failed");
  const warnings = [];
  const { owner, scheduler } = createOwnerHarness({
    helpers: createHelpers({
      overrides: {
        buildInteractionInfrastructureAfterStartup: async () => {
          throw failure;
        },
        consoleWarn: (...args) => warnings.push(args),
      },
    }),
  });

  owner.startDeferredFullInteractionInfrastructureBuild("ready-state");
  await scheduler.tasks[0].callback();

  assert.equal(warnings[0][0], "[boot] Deferred full interaction infrastructure build failed. reason=ready-state");
  assert.equal(warnings[0][1], failure);
});

test("schedulePostReadyVisualWarmup respects visual state and boot blocking", async () => {
  const inactiveHarness = createOwnerHarness();
  inactiveHarness.owner.schedulePostReadyVisualWarmup();
  assert.equal(inactiveHarness.scheduler.tasks.length, 0);

  const renderCalls = [];
  const targetRuntime = createTargetRuntime({
    styleConfig: { texture: { mode: "paper" }, dayNight: { enabled: false } },
  });
  const { owner, scheduler } = createOwnerHarness({
    targetRuntime,
    helpers: createHelpers({
      overrides: {
        requestMainRender: (reason) => renderCalls.push(reason),
      },
    }),
  });

  owner.schedulePostReadyVisualWarmup();
  assert.equal(scheduler.tasks[0].key, "post-ready-visual-warmup");
  assert.deepEqual(scheduler.tasks[0].options, {
    timeout: 1200,
    delayMs: 900,
    retryDelayMs: 320,
    idleQuietMs: POST_READY_IDLE_QUIET_MS,
  });
  await scheduler.tasks[0].callback();
  assert.deepEqual(renderCalls, ["post-ready-visual-warmup"]);

  renderCalls.length = 0;
  targetRuntime.bootBlocking = true;
  await scheduler.tasks[0].callback();
  assert.deepEqual(renderCalls, []);

  const dayNightHarness = createOwnerHarness({
    targetRuntime: createTargetRuntime({
      styleConfig: { texture: { mode: "none" }, dayNight: { enabled: true } },
    }),
  });
  dayNightHarness.owner.schedulePostReadyVisualWarmup();
  assert.equal(dayNightHarness.scheduler.tasks[0].key, "post-ready-visual-warmup");
});

test("schedulePostReadyDeferredContextWarmup warms context layers, contours, and cities once", async () => {
  const contextCalls = [];
  const cityCalls = [];
  const renderCalls = [];
  const targetRuntime = createTargetRuntime({
    showRivers: true,
    showUrban: true,
    showPhysical: true,
    showCityPoints: true,
    baseCityDataState: "idle",
    ensureBaseCityDataFn: async (options) => {
      cityCalls.push(options);
      return true;
    },
  });
  const { owner, scheduler } = createOwnerHarness({
    targetRuntime,
    helpers: createHelpers({
      overrides: {
        ensureContextLayerDataReady: async (layerNames, options) => {
          contextCalls.push({ layerNames: [...layerNames], options });
          return true;
        },
        requestMainRender: (reason) => renderCalls.push(reason),
      },
    }),
  });

  owner.schedulePostReadyDeferredContextWarmup();

  assert.deepEqual(scheduler.tasks.map((task) => task.key), [
    "post-ready-context-warmup",
    "post-ready-contour-warmup",
  ]);
  assert.deepEqual(scheduler.tasks[0].options, {
    timeout: 1600,
    isCurrent: scheduler.tasks[0].options.isCurrent,
    maxWaitMs: 120_000,
    maxRunMs: 120_000,
    delayMs: 900,
    retryDelayMs: 420,
    idleQuietMs: POST_READY_IDLE_QUIET_MS,
  });
  assert.deepEqual(scheduler.tasks[1].options, {
    timeout: 1800,
    isCurrent: scheduler.tasks[1].options.isCurrent,
    maxWaitMs: 120_000,
    maxRunMs: 120_000,
    delayMs: 1400,
    retryDelayMs: 420,
    idleQuietMs: POST_READY_IDLE_QUIET_MS,
  });

  await scheduler.tasks[0].callback();
  assert.deepEqual(contextCalls[0], {
    layerNames: ["rivers", "urban", "physical-set"],
    options: { reason: "post-ready", renderNow: false },
  });
  assert.deepEqual(cityCalls, [{ reason: "post-ready", renderNow: false }]);
  assert.equal(renderCalls[0], "post-ready-context-warmup");

  await scheduler.tasks[1].callback();
  assert.deepEqual(contextCalls[1], {
    layerNames: ["physical-contours-set"],
    options: { reason: "post-ready-contours", renderNow: false },
  });
  assert.equal(renderCalls[1], "post-ready-contours");

  owner.schedulePostReadyDeferredContextWarmup();
  assert.equal(scheduler.tasks.length, 2);
});

test("reset clears internal scheduling flags", () => {
  const targetRuntime = createTargetRuntime({ showRivers: true });
  const { owner, scheduler } = createOwnerHarness({ targetRuntime });

  owner.schedulePostReadyHydration();
  owner.schedulePostReadyDeferredContextWarmup();
  assert.equal(scheduler.tasks.length, 3);

  owner.schedulePostReadyHydration();
  owner.schedulePostReadyDeferredContextWarmup();
  assert.equal(scheduler.tasks.length, 3);

  assert.deepEqual(owner.reset("bootstrap"), {
    reason: "bootstrap",
    postReadyContextWarmupScheduled: false,
    postReadyHydrationScheduled: false,
  });
  owner.schedulePostReadyHydration();
  owner.schedulePostReadyDeferredContextWarmup();
  assert.equal(scheduler.tasks.length, 6);
});

test("real scheduler and warmup owner discard a completion after a scene switch", async () => {
  const targetRuntime = createTargetRuntime({ showRivers: true, activeScenarioId: "A", currentScenarioApplyRequestId: 1 });
  const scheduler = createPostReadyScheduler({ targetState: targetRuntime });
  let finishLoad;
  let beginLoad;
  const started = new Promise((resolve) => { beginLoad = resolve; });
  const renders = [];
  const { owner } = createOwnerHarness({
    targetRuntime,
    scheduler: { scheduleTask: (key, callback, options) => scheduler.scheduleTask(key, callback, { ...options, delayMs: 0 }) },
    helpers: createHelpers({ overrides: {
      ensureContextLayerDataReady: () => new Promise((resolve) => { finishLoad = resolve; beginLoad(); }),
      requestMainRender: (reason) => renders.push(reason),
    } }),
  });
  try {
    owner.schedulePostReadyDeferredContextWarmup();
    await started;
    targetRuntime.activeScenarioId = "B";
    targetRuntime.currentScenarioApplyRequestId = 2;
    finishLoad({ rivers: { features: [] } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(renders, []);
    assert.equal(scheduler.getDiagnostics().taskOutcomes["post-ready-context-warmup"].reason, "stale");
    assert.deepEqual(scheduler.getDiagnostics().waitingTaskKeys, []);
  } finally {
    scheduler.reset("test-cleanup");
  }
});

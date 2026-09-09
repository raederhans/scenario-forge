import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostReadyScheduler,
  POST_READY_IDLE_QUIET_MS,
  POST_READY_IDLE_TIME_REMAINING_MS,
} from "../js/bootstrap/post_ready_scheduler.js";

function createTargetState(overrides = {}) {
  return {
    activePostReadyTaskKey: "",
    activePostReadyTaskStartedAt: 0,
    postReadyTaskDiagnostics: null,
    renderPerfMetrics: {},
    renderPhase: "idle",
    phaseEnteredAt: 0,
    zoomGestureEndedAt: 0,
    runtimeChunkLoadState: {},
    ...overrides,
  };
}

function createTimerScope({ idle = false } = {}) {
  let nextId = 1;
  const timeoutCalls = [];
  const idleCalls = [];
  const clearedTimeoutIds = [];
  const clearedIdleIds = [];
  const scope = {
    setTimeout(callback, delay = 0) {
      const record = { id: nextId, callback, delay, cleared: false };
      nextId += 1;
      timeoutCalls.push(record);
      return record.id;
    },
    clearTimeout(id) {
      clearedTimeoutIds.push(id);
      const record = timeoutCalls.find((item) => item.id === id);
      if (record) record.cleared = true;
    },
    __renderPerfMetrics: null,
    __test: {
      timeoutCalls,
      idleCalls,
      clearedTimeoutIds,
      clearedIdleIds,
      runNextTimeout() {
        const record = timeoutCalls.find((item) => !item.cleared && !item.ran);
        assert.ok(record, "expected a scheduled timeout");
        record.ran = true;
        record.callback();
        return record;
      },
      runNextIdle(deadline = { didTimeout: false, timeRemaining: () => Number.POSITIVE_INFINITY }) {
        const record = idleCalls.find((item) => !item.cleared && !item.ran);
        assert.ok(record, "expected a scheduled idle callback");
        record.ran = true;
        record.callback(deadline);
        return record;
      },
      runTimerById(id) {
        const record = timeoutCalls.find((item) => item.id === id);
        assert.ok(record, `expected timeout id ${id}`);
        record.ran = true;
        record.callback();
      },
    },
  };
  if (idle) {
    scope.requestIdleCallback = (callback, options = {}) => {
      const record = { id: nextId, callback, options, cleared: false };
      nextId += 1;
      idleCalls.push(record);
      return record.id;
    };
    scope.cancelIdleCallback = (id) => {
      clearedIdleIds.push(id);
      const record = idleCalls.find((item) => item.id === id);
      if (record) record.cleared = true;
    };
  }
  return scope;
}

async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("explicit resource wait releases the slot and cancellation prevents its commit", async () => {
  const targetState = createTargetState();
  const globalScope = createTimerScope();
  const scheduler = createPostReadyScheduler({ targetState, globalScope });
  let resolveDownload;
  let oldContext;
  let commits = 0;
  scheduler.scheduleTask("download", async (context) => {
    oldContext = context;
    await context.waitFor(new Promise((resolve) => { resolveDownload = resolve; }));
    context.commit(() => { commits += 1; });
  });
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  assert.equal(targetState.activePostReadyTaskKey, "");
  assert.deepEqual(scheduler.getDiagnostics().waitingTaskKeys, ["download"]);
  assert.deepEqual(scheduler.getDiagnostics().pendingTaskKeys, ["download"], "resource waits must not be reported as drained");
  scheduler.scheduleTask("independent", () => { commits += 10; });
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  assert.equal(commits, 10);
  scheduler.clearTask("download");
  assert.equal(oldContext.signal.aborted, true);
  resolveDownload();
  for (let n = 0; n < 12; n++) await Promise.resolve();
  assert.equal(commits, 10);
  assert.equal(scheduler.getDiagnostics().taskOutcomes.download.status, "cancelled");
  assert.deepEqual(scheduler.getDiagnostics().waitingTaskKeys, []);
});

test("queued cancellation leaves a terminal outcome and old callbacks cannot execute", () => {
  for (const operation of ["clearTask", "clearAllTasks", "reset"]) {
    const targetState = createTargetState();
    const globalScope = createTimerScope();
    const scheduler = createPostReadyScheduler({ targetState, globalScope });
    let calls = 0;
    scheduler.scheduleTask("queued", () => { calls += 1; });
    const oldId = globalScope.__test.timeoutCalls.at(-1).id;
    scheduler[operation]("queued");
    globalScope.__test.runTimerById(oldId);
    assert.equal(calls, 0);
    assert.deepEqual(scheduler.getDiagnostics().pendingTaskKeys, []);
    assert.equal(scheduler.getDiagnostics().taskOutcomes.queued.status, "cancelled");
  }
});

test("dependency wait has a terminal deadline and cannot run from a stale idle callback", () => {
  let now = 0;
  const targetState = createTargetState();
  const globalScope = createTimerScope({ idle: true });
  const scheduler = createPostReadyScheduler({ targetState, globalScope, clock: () => now });
  let ready = false;
  let calls = 0;
  scheduler.scheduleTask("dependent", () => { calls += 1; }, { canStart: () => ready, maxWaitMs: 500 });
  globalScope.__test.runNextTimeout();
  assert.equal(scheduler.getDiagnostics().lastBlockedReason, "dependency-pending");
  now = 600;
  globalScope.__test.runNextTimeout();
  ready = true;
  assert.equal(calls, 0);
  assert.equal(scheduler.getDiagnostics().taskOutcomes.dependent.reason, "waiting-deadline");
  scheduler.scheduleTask("idle", () => { calls += 1; }, { isCurrent: () => ready });
  globalScope.__test.runNextTimeout();
  ready = false;
  globalScope.__test.runNextIdle();
  assert.equal(calls, 0);
  assert.equal(scheduler.getDiagnostics().taskOutcomes.idle.reason, "stale");
});

test("cooperative yield returns to timers and rechecks document revision", async () => {
  const targetState = createTargetState();
  const globalScope = createTimerScope();
  const scheduler = createPostReadyScheduler({ targetState, globalScope });
  let revision = 1;
  const work = [];
  scheduler.scheduleTask("slice", async (context) => {
    work.push("first");
    await context.yield();
    context.commit(() => work.push("second"));
  }, { isCurrent: () => revision === 1 });
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  assert.deepEqual(work, ["first"]);
  revision += 1;
  globalScope.__test.runNextTimeout();
  for (let n = 0; n < 12; n++) await Promise.resolve();
  assert.deepEqual(work, ["first"]);
  assert.equal(scheduler.getDiagnostics().taskOutcomes.slice.reason, "stale");
});

test("execution deadline aborts a hung resource wait and frees all scheduler timers", async () => {
  const targetState = createTargetState();
  const globalScope = createTimerScope();
  const scheduler = createPostReadyScheduler({ targetState, globalScope });
  let context;
  scheduler.scheduleTask("hung", async (task) => {
    context = task;
    await task.waitFor(new Promise(() => {}));
  }, { maxRunMs: 1000 });
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  for (let n = 0; n < 12; n++) await Promise.resolve();
  assert.equal(context.signal.aborted, true);
  assert.equal(targetState.activePostReadyTaskKey, "");
  assert.deepEqual(scheduler.getDiagnostics().waitingTaskKeys, []);
  assert.equal(scheduler.getDiagnostics().taskOutcomes.hung.reason, "execution-deadline");
  assert.equal(globalScope.__test.timeoutCalls.filter((item) => !item.ran && !item.cleared).length, 0);
});

test("same-key replacement revokes a waiting execution and its final outcome", async () => {
  const targetState = createTargetState();
  const globalScope = createTimerScope();
  const scheduler = createPostReadyScheduler({ targetState, globalScope });
  let finishOld;
  const committed = [];
  scheduler.scheduleTask("same", async (task) => {
    await task.waitFor(new Promise((resolve) => { finishOld = resolve; }));
    task.commit(() => committed.push("old"));
  });
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  scheduler.scheduleTask("same", () => committed.push("new"));
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  finishOld();
  for (let n = 0; n < 16; n++) await Promise.resolve();
  assert.deepEqual(committed, ["new"]);
  assert.equal(scheduler.getDiagnostics().taskOutcomes.same.status, "completed");
});

test("resource continuation waits for interaction to end before reacquiring the slot", async () => {
  const targetState = createTargetState();
  const globalScope = createTimerScope();
  const scheduler = createPostReadyScheduler({ targetState, globalScope });
  let finishDownload;
  let commits = 0;
  scheduler.scheduleTask("resume", async (task) => {
    await task.waitFor(new Promise((resolve) => { finishDownload = resolve; }));
    task.commit(() => { commits += 1; });
  });
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  targetState.isInteracting = true;
  finishDownload();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  assert.equal(commits, 0);
  assert.equal(targetState.activePostReadyTaskKey, "");
  targetState.isInteracting = false;
  globalScope.__test.runNextTimeout();
  for (let n = 0; n < 12; n++) await Promise.resolve();
  assert.equal(commits, 1);
  assert.equal(scheduler.getDiagnostics().taskOutcomes.resume.status, "completed");
});

for (const rejects of [false, true]) {
  test(`old ${rejects ? "rejected" : "completed"} execution cannot finish a new same-key task after reset`, async () => {
    const targetState = createTargetState();
    const globalScope = createTimerScope();
    const warnings = [];
    const scheduler = createPostReadyScheduler({ targetState, globalScope, clock: () => 1000,
      warn: (...args) => warnings.push(args) });
    let finishOld;
    let finishNew;
    const oldError = new Error("old execution failed");
    scheduler.scheduleTask("same-key", () => new Promise((resolve, reject) => {
      finishOld = () => rejects ? reject(oldError) : resolve();
    }));
    globalScope.__test.runNextTimeout();
    globalScope.__test.runNextTimeout();
    scheduler.reset();
    scheduler.scheduleTask("same-key", () => new Promise((resolve) => { finishNew = resolve; }));
    globalScope.__test.runNextTimeout();
    globalScope.__test.runNextTimeout();
    const diagnostics = targetState.postReadyTaskDiagnostics;
    finishOld();
    await drainMicrotasks();
    assert.equal(targetState.activePostReadyTaskKey, "same-key");
    assert.equal(targetState.postReadyTaskDiagnostics, diagnostics, "stale finish must not publish diagnostics");
    assert.equal(warnings.length, rejects ? 1 : 0);
    if (rejects) assert.equal(warnings[0][1], oldError);
    finishNew();
    await drainMicrotasks();
    assert.equal(targetState.activePostReadyTaskKey, "");
    assert.equal(targetState.postReadyTaskDiagnostics.lastFinishedTaskKey, "same-key");
  });
}

for (const stage of ["start", "timeout", "idle", "retry"]) {
  for (const invalidate of ["reset", "replace", "clear", "clear-all"]) {
    test(`stale ${stage} callback after ${invalidate} preserves the replacement handle`, async () => {
      const targetState = createTargetState();
      const globalScope = createTimerScope({ idle: stage === "idle" });
      const scheduler = createPostReadyScheduler({ targetState, globalScope, clock: () => 1000 });
      let oldRuns = 0;
      let newRuns = 0;
      if (stage === "retry") targetState.bootBlocking = true;
      scheduler.scheduleTask("same-key", () => { oldRuns += 1; });
      if (stage !== "start") globalScope.__test.runNextTimeout();
      const staleCallback = stage === "idle"
        ? globalScope.__test.idleCalls.at(-1).callback
        : globalScope.__test.timeoutCalls.at(-1).callback;
      if (invalidate === "reset") scheduler.reset();
      if (invalidate === "clear") scheduler.clearTask("same-key");
      if (invalidate === "clear-all") scheduler.clearAllTasks();
      targetState.bootBlocking = false;
      scheduler.scheduleTask("same-key", () => { newRuns += 1; });
      const replacement = globalScope.__test.timeoutCalls.at(-1);
      const diagnostics = targetState.postReadyTaskDiagnostics;
      staleCallback({ didTimeout: false, timeRemaining: () => 20 });
      assert.equal(oldRuns, 0);
      assert.equal(replacement.cleared, false);
      assert.equal(targetState.postReadyTaskDiagnostics, diagnostics);
      assert.deepEqual(scheduler.getDiagnostics().pendingTaskKeys, ["same-key"]);
      globalScope.__test.runNextTimeout();
      if (stage === "idle") globalScope.__test.runNextIdle();
      else globalScope.__test.runNextTimeout();
      await drainMicrotasks();
      assert.equal(oldRuns, 0);
      assert.equal(newRuns, 1);
      assert.equal(targetState.activePostReadyTaskKey, "");
      assert.deepEqual(scheduler.getDiagnostics().pendingTaskKeys, []);
    });
  }
}

test("post-ready idle block reason preserves blocker order", () => {
  let currentTime = 1000;
  const targetState = createTargetState({
    bootBlocking: true,
    scenarioApplyInFlight: true,
    startupReadonly: true,
    startupReadonlyUnlockInFlight: true,
    deferExactAfterSettle: true,
    runtimeChunkLoadState: {
      promotionCommitInFlight: true,
      pendingVisualPromotion: true,
      pendingPromotion: true,
      pendingInfraPromotion: true,
    },
    hitCanvasBuildScheduled: true,
    interactionInfrastructureBuildInFlight: true,
    activeInteractionRecoveryTaskKey: "recover",
    isInteracting: true,
    renderPhase: "rendering",
    phaseEnteredAt: 900,
    zoomGestureEndedAt: 900,
  });
  const scheduler = createPostReadyScheduler({
    targetState,
    globalScope: createTimerScope(),
    clock: () => currentTime,
  });

  assert.equal(scheduler.resolveIdleBlockReason(), "boot-blocking");
  targetState.bootBlocking = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "scenario-apply-in-flight");
  targetState.scenarioApplyInFlight = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "startup-readonly");
  targetState.startupReadonly = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "startup-readonly-unlock");
  targetState.startupReadonlyUnlockInFlight = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "defer-exact-after-settle");
  targetState.deferExactAfterSettle = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "chunk-promotion-commit-in-flight");
  targetState.runtimeChunkLoadState.promotionCommitInFlight = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "chunk-visual-promotion");
  targetState.runtimeChunkLoadState.pendingVisualPromotion = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "chunk-promotion");
  targetState.runtimeChunkLoadState.pendingPromotion = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "chunk-infra-promotion");
  targetState.runtimeChunkLoadState.pendingInfraPromotion = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "hit-canvas-build-scheduled");
  targetState.hitCanvasBuildScheduled = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "interaction-infra-in-flight");
  targetState.interactionInfrastructureBuildInFlight = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "interaction-recovery-task");
  targetState.activeInteractionRecoveryTaskKey = "";
  assert.equal(scheduler.resolveIdleBlockReason(), "interacting");
  targetState.isInteracting = false;
  assert.equal(scheduler.resolveIdleBlockReason(), "render-non-idle");
  targetState.renderPhase = "idle";
  assert.equal(scheduler.resolveIdleBlockReason(), "phase-quiet-window");
  targetState.phaseEnteredAt = 0;
  assert.equal(scheduler.resolveIdleBlockReason(), "zoom-quiet-window");
  targetState.zoomGestureEndedAt = 0;
  assert.equal(scheduler.resolveIdleBlockReason(), "ready");

  targetState.runtimeChunkLoadState.pendingPromotion = true;
  assert.equal(scheduler.resolveIdleBlockReason(), "chunk-promotion");
  assert.equal(scheduler.resolveIdleBlockReason({ allowChunkBacklog: true }), "ready");
  currentTime += 1;
});

test("scheduleTask records pending diagnostics and runs through timeout fallback", async () => {
  let currentTime = 1000;
  const targetState = createTargetState();
  const globalScope = createTimerScope();
  let runCount = 0;
  const scheduler = createPostReadyScheduler({
    targetState,
    globalScope,
    clock: () => currentTime,
  });

  scheduler.scheduleTask("post-ready-test", () => {
    runCount += 1;
  }, {
    delayMs: 50,
    retryDelayMs: 300,
    timeout: 1200,
  });

  assert.deepEqual(targetState.postReadyTaskDiagnostics.pendingTaskKeys, ["post-ready-test"]);
  assert.equal(targetState.postReadyTaskDiagnostics.pendingTaskCount, 1);
  assert.equal(targetState.postReadyTaskDiagnostics.lastScheduledTaskKey, "post-ready-test");
  assert.equal(targetState.postReadyTaskDiagnostics.idleQuietMs, POST_READY_IDLE_QUIET_MS);
  assert.equal(targetState.postReadyTaskDiagnostics.minIdleTimeRemainingMs, POST_READY_IDLE_TIME_REMAINING_MS);
  assert.equal(targetState.renderPerfMetrics.postReadySchedulerState.pendingTaskCount, 1);
  assert.notEqual(
    targetState.renderPerfMetrics.postReadySchedulerState,
    targetState.postReadyTaskDiagnostics,
  );
  assert.deepEqual(
    targetState.renderPerfMetrics.postReadySchedulerState,
    targetState.postReadyTaskDiagnostics,
  );
  assert.equal(globalScope.__renderPerfMetrics, targetState.renderPerfMetrics);

  assert.equal(globalScope.__test.timeoutCalls[0].delay, 50);
  currentTime += 50;
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  await drainMicrotasks();

  assert.equal(runCount, 1);
  assert.equal(targetState.activePostReadyTaskKey, "");
  assert.equal(targetState.postReadyTaskDiagnostics.lastStartedTaskKey, "post-ready-test");
  assert.equal(targetState.postReadyTaskDiagnostics.lastFinishedTaskKey, "post-ready-test");
  assert.deepEqual(targetState.postReadyTaskDiagnostics.pendingTaskKeys, []);
});

test("scheduleTask can run user-visible tasks through chunk backlog", async () => {
  const targetState = createTargetState({
    runtimeChunkLoadState: {
      pendingInfraPromotion: true,
    },
  });
  const globalScope = createTimerScope();
  let runCount = 0;
  const scheduler = createPostReadyScheduler({
    targetState,
    globalScope,
    clock: () => 1000,
  });

  scheduler.scheduleTask("startup-sample-project-import", () => {
    runCount += 1;
  }, {
    allowChunkBacklog: true,
    idleQuietMs: 0,
    minIdleTimeRemainingMs: 0,
  });

  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  await drainMicrotasks();

  assert.equal(runCount, 1);
  assert.equal(targetState.postReadyTaskDiagnostics.lastStartedTaskKey, "startup-sample-project-import");
  assert.deepEqual(targetState.postReadyTaskDiagnostics.pendingTaskKeys, []);
});

test("scheduleTask warns and clears active task after synchronous and async failures", async () => {
  const warnings = [];
  const targetState = createTargetState();
  const globalScope = createTimerScope();
  const scheduler = createPostReadyScheduler({
    targetState,
    globalScope,
    clock: () => 1000,
    warn: (...args) => warnings.push(args),
  });

  scheduler.scheduleTask("post-ready-throws", () => {
    throw new Error("sync failure");
  });
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  await drainMicrotasks();

  scheduler.scheduleTask("post-ready-rejects", () => Promise.reject(new Error("async failure")));
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextTimeout();
  await drainMicrotasks();

  assert.equal(warnings.length, 2);
  assert.equal(warnings[0][0], "[boot] Post-ready task failed. task=post-ready-throws");
  assert.equal(warnings[1][0], "[boot] Post-ready task failed. task=post-ready-rejects");
  assert.equal(targetState.activePostReadyTaskKey, "");
  assert.equal(targetState.activePostReadyTaskStartedAt, 0);
});

test("reset cancels pending handles and prevents stale callbacks from running", () => {
  const targetState = createTargetState();
  const globalScope = createTimerScope();
  let runCount = 0;
  const scheduler = createPostReadyScheduler({
    targetState,
    globalScope,
    clock: () => 1000,
  });

  scheduler.scheduleTask("post-ready-stale", () => {
    runCount += 1;
  }, { delayMs: 25 });
  const staleStartId = globalScope.__test.timeoutCalls[0].id;

  scheduler.reset("bootstrap");

  assert.deepEqual(globalScope.__test.clearedTimeoutIds, [staleStartId]);
  assert.equal(targetState.activePostReadyTaskKey, "");
  assert.equal(targetState.activePostReadyTaskStartedAt, 0);
  assert.equal(targetState.postReadyTaskDiagnostics.lastBlockedReason, "bootstrap");
  assert.deepEqual(targetState.postReadyTaskDiagnostics.pendingTaskKeys, []);

  globalScope.__test.runTimerById(staleStartId);
  assert.equal(runCount, 0);
});

test("requestIdleCallback path retries when the idle budget is too low", () => {
  const targetState = createTargetState();
  const globalScope = createTimerScope({ idle: true });
  let runCount = 0;
  const scheduler = createPostReadyScheduler({
    targetState,
    globalScope,
    clock: () => 1000,
  });

  scheduler.scheduleTask("post-ready-idle", () => {
    runCount += 1;
  }, {
    retryDelayMs: 420,
    minIdleTimeRemainingMs: 8,
  });
  globalScope.__test.runNextTimeout();
  globalScope.__test.runNextIdle({ didTimeout: false, timeRemaining: () => 1 });

  assert.equal(runCount, 0);
  assert.equal(targetState.postReadyTaskDiagnostics.lastBlockedReason, "idle-time-remaining");
  assert.equal(targetState.postReadyTaskDiagnostics.maxRetryCount, 1);
  assert.deepEqual(targetState.postReadyTaskDiagnostics.pendingTaskKeys, ["post-ready-idle"]);
});

import {
  clearActivePostReadyTask,
  replacePostReadyTaskDiagnostics,
  setActivePostReadyTask,
} from "../core/state/actions/boot_actions.js";

export const POST_READY_IDLE_QUIET_MS = 850;
export const POST_READY_IDLE_TIME_REMAINING_MS = 8;

function defaultNowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function normalizeTaskKey(taskKey) {
  return String(taskKey || "").trim();
}

function getTimerApi(globalScope) {
  return {
    setTimeout: typeof globalScope?.setTimeout === "function"
      ? globalScope.setTimeout.bind(globalScope)
      : globalThis.setTimeout.bind(globalThis),
    clearTimeout: typeof globalScope?.clearTimeout === "function"
      ? globalScope.clearTimeout.bind(globalScope)
      : globalThis.clearTimeout.bind(globalThis),
    requestIdleCallback: typeof globalScope?.requestIdleCallback === "function"
      ? globalScope.requestIdleCallback.bind(globalScope)
      : null,
    cancelIdleCallback: typeof globalScope?.cancelIdleCallback === "function"
      ? globalScope.cancelIdleCallback.bind(globalScope)
      : null,
    cancelAnimationFrame: typeof globalScope?.cancelAnimationFrame === "function"
      ? globalScope.cancelAnimationFrame.bind(globalScope)
      : null,
  };
}

export function createPostReadyScheduler({
  targetState,
  globalScope = globalThis,
  clock = defaultNowMs,
  warn = console.warn,
} = {}) {
  if (!targetState || typeof targetState !== "object") {
    throw new Error("createPostReadyScheduler requires targetState.");
  }

  const taskHandles = new Map();
  const taskDiagnostics = new Map();
  let taskEpoch = 0;
  let activeExecution = null;
  const executions = new Set();
  const outcomes = new Map();

  function recordOutcome(taskKey, status, reason = "") {
    outcomes.delete(taskKey);
    outcomes.set(taskKey, { status, reason, finishedAt: nowMs() });
    if (outcomes.size > 32) outcomes.delete(outcomes.keys().next().value);
  }

  function nowMs() {
    const value = typeof clock === "function" ? Number(clock()) : Number.NaN;
    return Number.isFinite(value) ? value : defaultNowMs();
  }

  function clearTaskHandle(handle) {
    if (!handle) return;
    const timers = getTimerApi(globalScope);
    if (handle.type === "idle" && timers.cancelIdleCallback) {
      timers.cancelIdleCallback(handle.id);
      return;
    }
    if (handle.type === "raf" && timers.cancelAnimationFrame) {
      timers.cancelAnimationFrame(handle.id);
      return;
    }
    timers.clearTimeout(handle.id);
  }

  function updateDiagnostics({
    taskKey = "",
    lastBlockedReason = "",
    lastScheduledTaskKey = "",
    lastStartedTaskKey = "",
    lastFinishedTaskKey = "",
  } = {}) {
    const currentMs = nowMs();
    const pendingEntries = [...taskDiagnostics.entries()];
    const pendingTaskKeys = [...new Set([
      ...taskHandles.keys(),
      ...[...executions].filter((entry) => entry.waiting).map((entry) => entry.taskKey),
    ])].sort();
    const maxPendingAgeMs = pendingEntries.reduce((maxAge, [_key, entry]) => (
      Math.max(maxAge, Math.max(0, currentMs - Number(entry.firstScheduledAt ?? currentMs)))
    ), 0);
    const maxRetryCount = pendingEntries.reduce((maxRetry, [_key, entry]) => (
      Math.max(maxRetry, Number(entry.retryCount || 0))
    ), 0);
    const diagnostics = replacePostReadyTaskDiagnostics(targetState, {
      activeTaskKey: String(targetState.activePostReadyTaskKey || ""),
      activeTaskAgeMs: targetState.activePostReadyTaskStartedAt
        ? Math.max(0, currentMs - Number(targetState.activePostReadyTaskStartedAt || 0))
        : 0,
      pendingTaskKeys,
      pendingTaskCount: pendingTaskKeys.length,
      lastBlockedReason: String(lastBlockedReason || targetState.postReadyTaskDiagnostics?.lastBlockedReason || ""),
      lastTaskKey: String(taskKey || ""),
      lastScheduledTaskKey: String(lastScheduledTaskKey || targetState.postReadyTaskDiagnostics?.lastScheduledTaskKey || ""),
      lastStartedTaskKey: String(lastStartedTaskKey || targetState.postReadyTaskDiagnostics?.lastStartedTaskKey || ""),
      lastFinishedTaskKey: String(lastFinishedTaskKey || targetState.postReadyTaskDiagnostics?.lastFinishedTaskKey || ""),
      maxPendingAgeMs,
      maxRetryCount,
      idleQuietMs: POST_READY_IDLE_QUIET_MS,
      minIdleTimeRemainingMs: POST_READY_IDLE_TIME_REMAINING_MS,
      taskOutcomes: Object.fromEntries(outcomes),
      waitingTaskKeys: [...executions].filter((entry) => entry.waiting).map((entry) => entry.taskKey),
      reasonStateHint: {
        renderPhase: String(targetState.renderPhase || ""),
        isInteracting: !!targetState.isInteracting,
        deferExactAfterSettle: !!targetState.deferExactAfterSettle,
        interactionInfrastructureBuildInFlight: !!targetState.interactionInfrastructureBuildInFlight,
        activeInteractionRecoveryTaskKey: String(targetState.activeInteractionRecoveryTaskKey || ""),
        hitCanvasBuildScheduled: !!targetState.hitCanvasBuildScheduled,
        chunkShellStatus: String(targetState.runtimeChunkLoadState?.shellStatus || ""),
        hasPendingChunkVisualPromotion: !!targetState.runtimeChunkLoadState?.pendingVisualPromotion,
        hasPendingChunkPromotion: !!targetState.runtimeChunkLoadState?.pendingPromotion,
        hasPendingChunkInfraPromotion: !!targetState.runtimeChunkLoadState?.pendingInfraPromotion,
      },
      recordedAt: Date.now(),
    });
    targetState.renderPerfMetrics = targetState.renderPerfMetrics && typeof targetState.renderPerfMetrics === "object"
      ? targetState.renderPerfMetrics
      : {};
    targetState.renderPerfMetrics.postReadySchedulerState = { ...diagnostics };
    globalScope.__renderPerfMetrics = targetState.renderPerfMetrics;
    return diagnostics;
  }

  function clearTaskInternal(taskKey, { recordDiagnostics = true } = {}) {
    const normalizedTaskKey = normalizeTaskKey(taskKey);
    if (!normalizedTaskKey) return;
    const handle = taskHandles.get(normalizedTaskKey);
    if (handle) {
      clearTaskHandle(handle);
    }
    taskHandles.delete(normalizedTaskKey);
    taskDiagnostics.delete(normalizedTaskKey);
    if (recordDiagnostics) {
      updateDiagnostics({ lastBlockedReason: "cleared", taskKey: normalizedTaskKey });
    }
  }

  function clearTask(taskKey) {
    if (taskHandles.has(normalizeTaskKey(taskKey))) recordOutcome(normalizeTaskKey(taskKey), "cancelled", "cancelled");
    clearTaskInternal(taskKey);
    for (const execution of executions) {
      if (execution.taskKey === normalizeTaskKey(taskKey)) execution.cancel("cancelled");
    }
  }

  function clearAllTasks() {
    for (const execution of executions) execution.cancel("cancelled");
    taskHandles.forEach((handle) => {
      clearTaskHandle(handle);
    });
    taskHandles.forEach((_handle, taskKey) => recordOutcome(taskKey, "cancelled", "cancelled"));
    taskHandles.clear();
    taskDiagnostics.clear();
    updateDiagnostics({ lastBlockedReason: "cleared-all" });
  }

  function reset(reason = "reset") {
    for (const execution of executions) execution.cancel(String(reason || "reset"));
    taskEpoch += 1;
    activeExecution = null;
    taskHandles.forEach((handle) => {
      clearTaskHandle(handle);
    });
    taskHandles.forEach((_handle, taskKey) => recordOutcome(taskKey, "cancelled", String(reason || "reset")));
    taskHandles.clear();
    taskDiagnostics.clear();
    clearActivePostReadyTask(targetState);
    updateDiagnostics({ lastBlockedReason: String(reason || "reset").trim() || "reset" });
  }

  function resolveIdleBlockReason({
    quietMs = POST_READY_IDLE_QUIET_MS,
    allowChunkBacklog = false,
  } = {}) {
    const phaseEnteredAt = Number(targetState.phaseEnteredAt || 0);
    const zoomEndedAt = Number(targetState.zoomGestureEndedAt || 0);
    const currentMs = nowMs();
    const idleForMs = phaseEnteredAt > 0 ? currentMs - phaseEnteredAt : Number.POSITIVE_INFINITY;
    const zoomQuietForMs = zoomEndedAt > 0 ? currentMs - zoomEndedAt : Number.POSITIVE_INFINITY;
    const requiredQuietMs = Math.max(0, Number(quietMs) || 0);
    if (targetState.bootBlocking) return "boot-blocking";
    if (targetState.scenarioApplyInFlight) return "scenario-apply-in-flight";
    if (targetState.startupReadonly) return "startup-readonly";
    if (targetState.startupReadonlyUnlockInFlight) return "startup-readonly-unlock";
    if (targetState.deferExactAfterSettle) return "defer-exact-after-settle";
    if (!allowChunkBacklog && targetState.runtimeChunkLoadState?.promotionCommitInFlight) return "chunk-promotion-commit-in-flight";
    if (!allowChunkBacklog && targetState.runtimeChunkLoadState?.pendingVisualPromotion) return "chunk-visual-promotion";
    if (!allowChunkBacklog && targetState.runtimeChunkLoadState?.pendingPromotion) return "chunk-promotion";
    if (!allowChunkBacklog && targetState.runtimeChunkLoadState?.pendingInfraPromotion) return "chunk-infra-promotion";
    if (targetState.hitCanvasBuildScheduled) return "hit-canvas-build-scheduled";
    if (targetState.interactionInfrastructureBuildInFlight) return "interaction-infra-in-flight";
    if (targetState.activeInteractionRecoveryTaskKey) return "interaction-recovery-task";
    if (targetState.isInteracting) return "interacting";
    if (String(targetState.renderPhase || "idle") !== "idle") return "render-non-idle";
    if (idleForMs < requiredQuietMs) return "phase-quiet-window";
    if (zoomQuietForMs < requiredQuietMs) return "zoom-quiet-window";
    return "ready";
  }

  function markTaskRetry(taskKey, reason) {
    const entry = taskDiagnostics.get(taskKey);
    if (entry) {
      entry.retryCount = Math.max(0, Number(entry.retryCount || 0) + 1);
      entry.lastRetryAt = nowMs();
      entry.lastBlockedReason = String(reason || "");
    }
    updateDiagnostics({ taskKey, lastBlockedReason: reason });
  }

  function canRunIdleWork({
    quietMs = POST_READY_IDLE_QUIET_MS,
    allowChunkBacklog = false,
  } = {}) {
    return resolveIdleBlockReason({ quietMs, allowChunkBacklog }) === "ready";
  }

  function runTaskCallback(taskKey, callback, {
    isCurrent = () => true, maxRunMs = 0,
    idleQuietMs = POST_READY_IDLE_QUIET_MS, allowChunkBacklog = false,
  } = {}) {
    const timers = getTimerApi(globalScope);
    const controller = new AbortController();
    const execution = { epoch: taskEpoch, taskKey, waiting: false, cancel: null };
    executions.add(execution);
    activeExecution = execution;
    setActivePostReadyTask(targetState, {
      taskKey,
      startedAt: nowMs(),
    });
    taskDiagnostics.delete(taskKey);
    updateDiagnostics({ taskKey, lastStartedTaskKey: taskKey });

    const releaseSlot = () => {
      if (activeExecution !== execution || execution.epoch !== taskEpoch) return;
      activeExecution = null;
      clearActivePostReadyTask(targetState, { expectedTaskKey: taskKey });
    };
    let deadlineId = null;
    const clearActiveTask = () => {
      executions.delete(execution);
      if (deadlineId !== null) timers.clearTimeout(deadlineId);
      if (execution.epoch !== taskEpoch || controller.signal.aborted) return;
      releaseSlot();
      updateDiagnostics({ taskKey, lastFinishedTaskKey: taskKey });
    };
    execution.cancel = (reason) => {
      if (controller.signal.aborted) return;
      controller.abort(reason);
      releaseSlot();
      executions.delete(execution);
      if (deadlineId !== null) timers.clearTimeout(deadlineId);
      recordOutcome(taskKey, "cancelled", reason);
      updateDiagnostics({ taskKey, lastFinishedTaskKey: taskKey });
    };
    const checkCurrent = () => {
      if (controller.signal.aborted || execution.epoch !== taskEpoch || !isCurrent()) {
        const error = new Error("Post-ready task is no longer current.");
        error.name = "AbortError";
        throw error;
      }
    };
    const waitWithSignal = (promise) => new Promise((resolve, reject) => {
      const onAbort = () => {
        const error = new Error(String(controller.signal.reason || "Task cancelled."));
        error.name = "AbortError";
        reject(error);
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => {
        controller.signal.removeEventListener("abort", onAbort);
      });
      if (controller.signal.aborted) onAbort();
    });
    const pause = (delay = 0) => new Promise((resolve) => {
      const finish = () => {
        timers.clearTimeout(id);
        controller.signal.removeEventListener("abort", finish);
        resolve();
      };
      const id = timers.setTimeout(finish, delay);
      controller.signal.addEventListener("abort", finish, { once: true });
    });
    const waitFor = async (promise) => {
      // Only explicit resource waits release the execution slot. Legacy callbacks
      // remain serialized, and a continuation reacquires it before doing CPU work.
      checkCurrent();
      execution.waiting = true;
      releaseSlot();
      updateDiagnostics({ taskKey });
      let value;
      let failure;
      try { value = await waitWithSignal(promise); } catch (error) { failure = error; }
      checkCurrent();
      while ((activeExecution && activeExecution !== execution)
        || resolveIdleBlockReason({ quietMs: idleQuietMs, allowChunkBacklog }) !== "ready") {
        await waitWithSignal(pause(120));
        checkCurrent();
      }
      activeExecution = execution;
      execution.waiting = false;
      setActivePostReadyTask(targetState, { taskKey, startedAt: nowMs() });
      updateDiagnostics({ taskKey });
      if (failure) throw failure;
      return value;
    };
    const context = Object.freeze({
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted && execution.epoch === taskEpoch && isCurrent(),
      throwIfStale: checkCurrent,
      waitFor,
      yield: () => waitFor(pause()),
      commit: (apply) => { checkCurrent(); return apply(); },
    });
    if (Number(maxRunMs) > 0) {
      deadlineId = timers.setTimeout(() => execution.cancel("execution-deadline"), Number(maxRunMs));
    }

    try {
      checkCurrent();
      Promise.resolve(callback(context))
        .then(() => {
          if (context.isCurrent()) recordOutcome(taskKey, "completed");
          else if (!controller.signal.aborted && execution.epoch === taskEpoch) recordOutcome(taskKey, "cancelled", "stale");
        })
        .catch((error) => {
          if (error?.name === "AbortError") {
            if (!controller.signal.aborted && execution.epoch === taskEpoch) recordOutcome(taskKey, "cancelled", "stale");
            return;
          }
          if (execution.epoch === taskEpoch && !controller.signal.aborted) recordOutcome(taskKey, "failed", error?.message || String(error));
          warn(`[boot] Post-ready task failed. task=${taskKey}`, error);
        })
        .finally(clearActiveTask);
    } catch (error) {
      recordOutcome(taskKey, error?.name === "AbortError" ? "cancelled" : "failed", error?.message || String(error));
      warn(`[boot] Post-ready task failed. task=${taskKey}`, error);
      clearActiveTask();
    }
  }

  function rescheduleTask(normalizedTaskKey, callback, {
    timeout,
    retryDelayMs,
    idleQuietMs,
    minIdleTimeRemainingMs,
    allowChunkBacklog,
    isCurrent,
    canStart,
    maxWaitMs,
    maxRunMs,
  } = {}) {
    scheduleTask(normalizedTaskKey, callback, {
      timeout,
      delayMs: retryDelayMs,
      retryDelayMs,
      idleQuietMs,
      minIdleTimeRemainingMs,
      allowChunkBacklog,
      isCurrent,
      canStart,
      maxWaitMs,
      maxRunMs,
    });
  }

  function scheduleTask(
    taskKey,
    callback,
    {
      timeout = 1200,
      delayMs = 0,
      retryDelayMs = 320,
      idleQuietMs = POST_READY_IDLE_QUIET_MS,
      minIdleTimeRemainingMs = POST_READY_IDLE_TIME_REMAINING_MS,
      allowChunkBacklog = false,
      isCurrent = () => true,
      canStart = () => true,
      maxWaitMs = 0,
      maxRunMs = 0,
    } = {}
  ) {
    const normalizedTaskKey = normalizeTaskKey(taskKey);
    if (!normalizedTaskKey) return;
    for (const execution of executions) {
      if (execution.taskKey === normalizedTaskKey) execution.cancel("superseded");
    }
    const shouldAllowChunkBacklog = !!allowChunkBacklog;
    const timers = getTimerApi(globalScope);
    const previousDiagnostic = taskDiagnostics.get(normalizedTaskKey);
    clearTaskInternal(normalizedTaskKey, { recordDiagnostics: false });
    taskDiagnostics.set(normalizedTaskKey, {
      firstScheduledAt: previousDiagnostic?.firstScheduledAt ?? nowMs(),
      lastScheduledAt: nowMs(),
      retryCount: Math.max(0, Number(previousDiagnostic?.retryCount || 0)),
      lastBlockedReason: String(previousDiagnostic?.lastBlockedReason || ""),
      timeout,
      retryDelayMs,
      idleQuietMs,
      minIdleTimeRemainingMs,
      allowChunkBacklog: shouldAllowChunkBacklog,
    });
    const scheduledEpoch = taskEpoch;
    const scheduledHandle = { type: "timeout", id: null };
    const ownsScheduledHandle = () => scheduledEpoch === taskEpoch
      && taskHandles.get(normalizedTaskKey) === scheduledHandle;
    const registerHandle = (type, id) => {
      scheduledHandle.type = type;
      scheduledHandle.id = id;
      taskHandles.set(normalizedTaskKey, scheduledHandle);
    };

    const runWhenIdle = () => {
      if (!ownsScheduledHandle()) return;
      const age = nowMs() - taskDiagnostics.get(normalizedTaskKey).firstScheduledAt;
      if (!isCurrent() || (Number(maxWaitMs) > 0 && age >= Number(maxWaitMs))) {
        const reason = !isCurrent() ? "stale" : "waiting-deadline";
        clearTaskInternal(normalizedTaskKey, { recordDiagnostics: false });
        recordOutcome(normalizedTaskKey, "cancelled", reason);
        updateDiagnostics({ taskKey: normalizedTaskKey, lastFinishedTaskKey: normalizedTaskKey, lastBlockedReason: reason });
        return;
      }
      const blockReason = targetState.activePostReadyTaskKey
        ? "active-task"
        : !canStart() ? "dependency-pending"
          : resolveIdleBlockReason({ quietMs: idleQuietMs, allowChunkBacklog: shouldAllowChunkBacklog });
      if (blockReason !== "ready") {
        markTaskRetry(normalizedTaskKey, blockReason);
        const retryId = timers.setTimeout(runWhenIdle, Math.max(120, retryDelayMs));
        registerHandle("timeout", retryId);
        return;
      }
      if (timers.requestIdleCallback) {
        const idleId = timers.requestIdleCallback((deadline) => {
          if (!ownsScheduledHandle()) return;
          if (!isCurrent() || !canStart() || (Number(maxWaitMs) > 0 && nowMs() - taskDiagnostics.get(normalizedTaskKey).firstScheduledAt >= Number(maxWaitMs))) {
            runWhenIdle();
            return;
          }
          taskHandles.delete(normalizedTaskKey);
          const remainingMs = typeof deadline?.timeRemaining === "function"
            ? Number(deadline.timeRemaining())
            : Number.POSITIVE_INFINITY;
          if (!deadline?.didTimeout && remainingMs < minIdleTimeRemainingMs) {
            markTaskRetry(normalizedTaskKey, "idle-time-remaining");
            rescheduleTask(normalizedTaskKey, callback, { timeout, retryDelayMs, idleQuietMs, minIdleTimeRemainingMs, allowChunkBacklog: shouldAllowChunkBacklog, isCurrent, canStart, maxWaitMs, maxRunMs });
            return;
          }
          const idleBlockReason = targetState.activePostReadyTaskKey
            ? "active-task"
            : resolveIdleBlockReason({ quietMs: idleQuietMs, allowChunkBacklog: shouldAllowChunkBacklog });
          if (idleBlockReason !== "ready") {
            markTaskRetry(normalizedTaskKey, idleBlockReason);
            rescheduleTask(normalizedTaskKey, callback, { timeout, retryDelayMs, idleQuietMs, minIdleTimeRemainingMs, allowChunkBacklog: shouldAllowChunkBacklog, isCurrent, canStart, maxWaitMs, maxRunMs });
            return;
          }
          runTaskCallback(normalizedTaskKey, callback, { isCurrent, maxRunMs, idleQuietMs, allowChunkBacklog: shouldAllowChunkBacklog });
        }, { timeout });
        registerHandle("idle", idleId);
        return;
      }
      const timeoutId = timers.setTimeout(() => {
        if (!ownsScheduledHandle()) return;
        if (!isCurrent() || !canStart() || (Number(maxWaitMs) > 0 && nowMs() - taskDiagnostics.get(normalizedTaskKey).firstScheduledAt >= Number(maxWaitMs))) {
          runWhenIdle();
          return;
        }
        taskHandles.delete(normalizedTaskKey);
        const timeoutBlockReason = targetState.activePostReadyTaskKey
          ? "active-task"
          : resolveIdleBlockReason({ quietMs: idleQuietMs, allowChunkBacklog: shouldAllowChunkBacklog });
        if (timeoutBlockReason !== "ready") {
          markTaskRetry(normalizedTaskKey, timeoutBlockReason);
          rescheduleTask(normalizedTaskKey, callback, { timeout, retryDelayMs, idleQuietMs, minIdleTimeRemainingMs, allowChunkBacklog: shouldAllowChunkBacklog, isCurrent, canStart, maxWaitMs, maxRunMs });
          return;
        }
        runTaskCallback(normalizedTaskKey, callback, { isCurrent, maxRunMs, idleQuietMs, allowChunkBacklog: shouldAllowChunkBacklog });
      }, 0);
      registerHandle("timeout", timeoutId);
    };

    const startId = timers.setTimeout(runWhenIdle, Math.max(0, delayMs));
    registerHandle("timeout", startId);
    updateDiagnostics({
      taskKey: normalizedTaskKey,
      lastBlockedReason: String(previousDiagnostic?.lastBlockedReason || ""),
      lastScheduledTaskKey: normalizedTaskKey,
    });
  }

  function getDiagnostics() {
    return updateDiagnostics();
  }

  return {
    scheduleTask,
    clearTask,
    clearAllTasks,
    reset,
    canRunIdleWork,
    resolveIdleBlockReason,
    getDiagnostics,
  };
}

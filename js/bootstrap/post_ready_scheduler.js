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
    const pendingTaskKeys = [...taskHandles.keys()].sort();
    const maxPendingAgeMs = pendingEntries.reduce((maxAge, [_key, entry]) => (
      Math.max(maxAge, Math.max(0, currentMs - Number(entry.firstScheduledAt || currentMs)))
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
    clearTaskInternal(taskKey);
  }

  function clearAllTasks() {
    taskHandles.forEach((handle) => {
      clearTaskHandle(handle);
    });
    taskHandles.clear();
    taskDiagnostics.clear();
    updateDiagnostics({ lastBlockedReason: "cleared-all" });
  }

  function reset(reason = "reset") {
    taskEpoch += 1;
    activeExecution = null;
    taskHandles.forEach((handle) => {
      clearTaskHandle(handle);
    });
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

  function runTaskCallback(taskKey, callback) {
    const execution = { epoch: taskEpoch };
    activeExecution = execution;
    setActivePostReadyTask(targetState, {
      taskKey,
      startedAt: nowMs(),
    });
    taskDiagnostics.delete(taskKey);
    updateDiagnostics({ taskKey, lastStartedTaskKey: taskKey });

    const clearActiveTask = () => {
      if (activeExecution !== execution || execution.epoch !== taskEpoch) return;
      activeExecution = null;
      clearActivePostReadyTask(targetState, { expectedTaskKey: taskKey });
      updateDiagnostics({ taskKey, lastFinishedTaskKey: taskKey });
    };

    try {
      Promise.resolve(callback())
        .catch((error) => {
          warn(`[boot] Post-ready task failed. task=${taskKey}`, error);
        })
        .finally(clearActiveTask);
    } catch (error) {
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
  } = {}) {
    scheduleTask(normalizedTaskKey, callback, {
      timeout,
      delayMs: retryDelayMs,
      retryDelayMs,
      idleQuietMs,
      minIdleTimeRemainingMs,
      allowChunkBacklog,
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
    } = {}
  ) {
    const normalizedTaskKey = normalizeTaskKey(taskKey);
    if (!normalizedTaskKey) return;
    const shouldAllowChunkBacklog = !!allowChunkBacklog;
    const timers = getTimerApi(globalScope);
    const previousDiagnostic = taskDiagnostics.get(normalizedTaskKey);
    clearTaskInternal(normalizedTaskKey, { recordDiagnostics: false });
    taskDiagnostics.set(normalizedTaskKey, {
      firstScheduledAt: Number(previousDiagnostic?.firstScheduledAt || 0) || nowMs(),
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
      const blockReason = targetState.activePostReadyTaskKey
        ? "active-task"
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
          taskHandles.delete(normalizedTaskKey);
          const remainingMs = typeof deadline?.timeRemaining === "function"
            ? Number(deadline.timeRemaining())
            : Number.POSITIVE_INFINITY;
          if (!deadline?.didTimeout && remainingMs < minIdleTimeRemainingMs) {
            markTaskRetry(normalizedTaskKey, "idle-time-remaining");
            rescheduleTask(normalizedTaskKey, callback, { timeout, retryDelayMs, idleQuietMs, minIdleTimeRemainingMs, allowChunkBacklog: shouldAllowChunkBacklog });
            return;
          }
          const idleBlockReason = targetState.activePostReadyTaskKey
            ? "active-task"
            : resolveIdleBlockReason({ quietMs: idleQuietMs, allowChunkBacklog: shouldAllowChunkBacklog });
          if (idleBlockReason !== "ready") {
            markTaskRetry(normalizedTaskKey, idleBlockReason);
            rescheduleTask(normalizedTaskKey, callback, { timeout, retryDelayMs, idleQuietMs, minIdleTimeRemainingMs, allowChunkBacklog: shouldAllowChunkBacklog });
            return;
          }
          runTaskCallback(normalizedTaskKey, callback);
        }, { timeout });
        registerHandle("idle", idleId);
        return;
      }
      const timeoutId = timers.setTimeout(() => {
        if (!ownsScheduledHandle()) return;
        taskHandles.delete(normalizedTaskKey);
        const timeoutBlockReason = targetState.activePostReadyTaskKey
          ? "active-task"
          : resolveIdleBlockReason({ quietMs: idleQuietMs, allowChunkBacklog: shouldAllowChunkBacklog });
        if (timeoutBlockReason !== "ready") {
          markTaskRetry(normalizedTaskKey, timeoutBlockReason);
          rescheduleTask(normalizedTaskKey, callback, { timeout, retryDelayMs, idleQuietMs, minIdleTimeRemainingMs, allowChunkBacklog: shouldAllowChunkBacklog });
          return;
        }
        runTaskCallback(normalizedTaskKey, callback);
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

const DEFAULT_RENDER_PHASE_IDLE = "idle";
const DEFAULT_IDLE_TIMEOUT_MS = 0;

const REQUIRED_EFFECT_NAMES = Object.freeze([
  "scheduleDeferredWork",
  "cancelDeferredWork",
  "setScheduledHitCanvasBuildHandle",
  "runScheduledHitCanvasBuild",
]);

const REQUIRED_GETTER_NAMES = Object.freeze([
  "hasHitCanvasRuntime",
  "isHitCanvasDirty",
  "isHitCanvasBuildDeferred",
  "getRenderPhase",
  "getScheduledHitCanvasBuildHandle",
  "getActiveScenarioId",
]);

function requireFunction(source, name, label) {
  const candidate = source?.[name];
  if (typeof candidate !== "function") {
    throw new TypeError(`${label}.${name} must be a function.`);
  }
  return candidate;
}

function normalizeReason(reason, defaultReason) {
  const normalized = String(reason || "").trim();
  return normalized || defaultReason;
}

function createTrace() {
  return {
    effectOrder: [],
    getterOrder: [],
  };
}

function createSummary({
  reason,
  scheduled = false,
  canceled = false,
  skipped = false,
  skipReason = "",
  trace,
}) {
  return Object.freeze({
    reason,
    scheduled: Boolean(scheduled),
    canceled: Boolean(canceled),
    skipped: Boolean(skipped),
    skipReason: String(skipReason || ""),
    effectOrder: Object.freeze([...(trace?.effectOrder || [])]),
    getterOrder: Object.freeze([...(trace?.getterOrder || [])]),
  });
}

export function createHitCanvasSchedulingOwner({ state = {}, effects = {}, getters = {} } = {}) {
  const renderPhaseIdle = String(state.renderPhaseIdle || DEFAULT_RENDER_PHASE_IDLE);
  const idleTimeoutMs = Math.max(0, Number(state.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS) || 0);
  const effectApi = Object.fromEntries(
    REQUIRED_EFFECT_NAMES.map((name) => [name, requireFunction(effects, name, "effects")]),
  );
  const getterApi = Object.fromEntries(
    REQUIRED_GETTER_NAMES.map((name) => [name, requireFunction(getters, name, "getters")]),
  );
  let activeTask = null;
  const getBuildIdentity = typeof getters.getHitCanvasBuildIdentity === "function"
    ? getters.getHitCanvasBuildIdentity : () => String(getterApi.getActiveScenarioId() || "");

  function runEffect(trace, name, ...args) {
    trace.effectOrder.push(name);
    return effectApi[name](...args);
  }

  function runGetter(trace, name, ...args) {
    trace.getterOrder.push(name);
    return getterApi[name](...args);
  }

  function getScheduleSkipReason(trace) {
    if (!runGetter(trace, "hasHitCanvasRuntime")) return "missing-hit-runtime";
    if (!runGetter(trace, "isHitCanvasDirty")) return "clean";
    if (runGetter(trace, "isHitCanvasBuildDeferred")) return "deferred";
    if (String(runGetter(trace, "getRenderPhase") || "") !== renderPhaseIdle) return "phase-not-idle";
    if (runGetter(trace, "getScheduledHitCanvasBuildHandle")) return "duplicate-schedule";
    return "";
  }

  function shouldRunScheduledBuild() {
    if (!getterApi.hasHitCanvasRuntime()) return false;
    if (!getterApi.isHitCanvasDirty()) return false;
    if (getterApi.isHitCanvasBuildDeferred()) return false;
    return String(getterApi.getRenderPhase() || "") === renderPhaseIdle;
  }

  function scheduleHitCanvasBuildIfNeeded({ reason = "idle-render" } = {}) {
    const trace = createTrace();
    const normalizedReason = normalizeReason(reason, "idle-render");
    const skipReason = getScheduleSkipReason(trace);
    if (skipReason) {
      return createSummary({
        reason: normalizedReason,
        skipped: true,
        skipReason,
        trace,
      });
    }

    const task = { identity: getBuildIdentity(), handle: null };
    activeTask = task;
    const scheduledHandle = runEffect(trace, "scheduleDeferredWork", () => {
      if (activeTask !== task || !task.handle || getterApi.getScheduledHitCanvasBuildHandle() !== task.handle) return;
      activeTask = null;
      runEffect(createTrace(), "setScheduledHitCanvasBuildHandle", null);
      if (getBuildIdentity() !== task.identity) return;
      if (!shouldRunScheduledBuild()) return;
      runEffect(createTrace(), "runScheduledHitCanvasBuild", {
        mode: "deferred",
        reason: normalizedReason,
        activeScenarioId: String(getterApi.getActiveScenarioId() || ""),
      });
    }, {
      timeout: idleTimeoutMs,
    });
    task.handle = scheduledHandle;
    if (!scheduledHandle) activeTask = null;
    runEffect(trace, "setScheduledHitCanvasBuildHandle", scheduledHandle);

    return createSummary({
      reason: normalizedReason,
      scheduled: Boolean(scheduledHandle),
      skipped: !scheduledHandle,
      skipReason: scheduledHandle ? "" : "schedule-returned-empty-handle",
      trace,
    });
  }

  function cancelScheduledHitCanvasBuild({ reason = "hit-canvas-schedule-cancel" } = {}) {
    const trace = createTrace();
    const normalizedReason = normalizeReason(reason, "hit-canvas-schedule-cancel");
    const scheduledHandle = runGetter(trace, "getScheduledHitCanvasBuildHandle");
    activeTask = null;
    if (!scheduledHandle) {
      return createSummary({
        reason: normalizedReason,
        skipped: true,
        skipReason: "no-scheduled-handle",
        trace,
      });
    }
    runEffect(trace, "cancelDeferredWork", scheduledHandle);
    runEffect(trace, "setScheduledHitCanvasBuildHandle", null);
    return createSummary({
      reason: normalizedReason,
      canceled: true,
      trace,
    });
  }

  return Object.freeze({
    scheduleHitCanvasBuildIfNeeded,
    cancelScheduledHitCanvasBuild,
  });
}

import { emit } from "../bus.js";

// Canonical boot/startup state mutations.
// Callers keep lifecycle ordering, hooks, metrics, scheduling, and DOM effects.

function isStateTarget(target) {
  return !!target && typeof target === "object";
}

export function setStartupInteractionMode(target, mode = "readonly") {
  if (!isStateTarget(target)) {
    return "readonly";
  }
  const nextMode = mode === "full" ? "full" : "readonly";
  target.startupInteractionMode = nextMode;
  return nextMode;
}

export function setBootPreviewVisibleState(target, active) {
  if (!isStateTarget(target)) {
    return false;
  }
  const nextVisible = !!active;
  target.bootPreviewVisible = nextVisible;
  return nextVisible;
}

export function setUiHydrationState(target, {
  status = "pending",
  error = "",
  updatedAt = 0,
} = {}) {
  if (!isStateTarget(target)) {
    return "pending";
  }
  const normalizedStatus = ["pending", "ready", "failed"].includes(String(status || "").trim())
    ? String(status).trim()
    : "pending";
  target.uiHydrationStatus = normalizedStatus;
  target.uiHydrationError = normalizedStatus === "failed" ? String(error || "") : "";
  target.uiHydrationUpdatedAt = Number(updatedAt) || 0;
  return normalizedStatus;
}

export function commitStartupReadonlyStateFields(
  target,
  {
    active,
    reason = "",
    unlockInFlight = false,
    since = 0,
  } = {},
) {
  if (!isStateTarget(target)) {
    return false;
  }
  const nextActive = !!active;
  target.startupReadonly = nextActive;
  target.startupReadonlyReason = nextActive
    ? String(reason || "detail-promotion").trim()
    : "";
  target.startupReadonlyUnlockInFlight = nextActive ? !!unlockInFlight : false;
  target.startupReadonlySince = nextActive
    ? (Number(target.startupReadonlySince) || Number(since) || 0)
    : 0;
  return nextActive;
}

export function clearStartupReadonlyStateFields(target, { preserveSince = true } = {}) {
  if (!isStateTarget(target)) {
    return false;
  }
  target.startupReadonly = false;
  target.startupReadonlyReason = "";
  target.startupReadonlyUnlockInFlight = false;
  if (!preserveSince) {
    target.startupReadonlySince = 0;
  }
  return false;
}

export function clearStartupReadonlyStateForReason(
  target,
  reason = "",
  { preserveSince = true } = {},
) {
  if (!isStateTarget(target)) {
    return false;
  }
  if (String(target.startupReadonlyReason || "").trim() !== String(reason || "").trim()) {
    return false;
  }
  target.startupReadonly = false;
  target.startupReadonlyReason = "";
  target.startupReadonlyUnlockInFlight = false;
  if (!preserveSince) {
    target.startupReadonlySince = 0;
  }
  return true;
}

export function setBootStateFields(target, patch = {}) {
  const {
    phase,
    message,
    progress,
    blocking,
    error,
    canContinueWithoutScenario,
  } = patch;
  if (!isStateTarget(target)) {
    return null;
  }
  if (phase !== undefined) {
    target.bootPhase = phase;
  }
  if (message !== undefined) {
    target.bootMessage = message;
  }
  if (progress !== undefined) {
    target.bootProgress = progress;
  }
  if (blocking !== undefined) {
    target.bootBlocking = !!blocking;
  }
  if (error !== undefined) {
    target.bootError = String(error || "");
  }
  if (canContinueWithoutScenario !== undefined) {
    target.bootCanContinueWithoutScenario = !!canContinueWithoutScenario;
  }
  return phase !== undefined ? phase || null : String(target.bootPhase || "") || null;
}

export function replaceBootMetricsState(target, metrics = {}) {
  if (!isStateTarget(target)) {
    return {};
  }
  const nextMetrics = metrics && typeof metrics === "object" ? metrics : {};
  target.bootMetrics = nextMetrics;
  return nextMetrics;
}

export function replaceStartupBootCacheState(target, nextState = null) {
  if (!isStateTarget(target)) {
    return {};
  }
  const nextCacheState = nextState && typeof nextState === "object" ? nextState : {};
  target.startupBootCacheState = nextCacheState;
  return nextCacheState;
}

export function setStartupScenarioBootstrapCacheStatus(target, status = "") {
  if (
    !isStateTarget(target)
    || !target.startupBootCacheState
    || typeof target.startupBootCacheState !== "object"
  ) {
    return "";
  }
  target.startupBootCacheState.scenarioBootstrap = status;
  return status;
}

export function replaceSampleProjectDeeplinkState(target, nextState = null) {
  if (!isStateTarget(target)) {
    return {};
  }
  const nextDeeplinkState = nextState && typeof nextState === "object" ? nextState : {};
  target.sampleProjectDeeplink = nextDeeplinkState;
  return nextDeeplinkState;
}

export function setActivePostReadyTask(
  target,
  { taskKey = "", startedAt = 0 } = {},
) {
  if (!isStateTarget(target)) {
    return "";
  }
  target.activePostReadyTaskKey = taskKey;
  target.activePostReadyTaskStartedAt = startedAt;
  return taskKey;
}

export function clearActivePostReadyTask(
  target,
  { expectedTaskKey } = {},
) {
  if (!isStateTarget(target)) {
    return false;
  }
  if (
    expectedTaskKey !== undefined
    && target.activePostReadyTaskKey !== expectedTaskKey
  ) {
    return false;
  }
  target.activePostReadyTaskKey = "";
  target.activePostReadyTaskStartedAt = 0;
  return true;
}

export function replacePostReadyTaskDiagnostics(target, diagnostics = null) {
  if (!isStateTarget(target)) {
    return {};
  }
  const nextDiagnostics = diagnostics && typeof diagnostics === "object"
    ? diagnostics
    : {};
  target.postReadyTaskDiagnostics = nextDiagnostics;
  return nextDiagnostics;
}

export function setLongAnimationFrameObserver(target, observer = null) {
  if (!isStateTarget(target)) {
    return null;
  }
  target.longAnimationFrameObserver = observer;
  return observer;
}

export function setStartupInitialScenarioChunkVisualPromotion(target, result = null) {
  if (!isStateTarget(target)) {
    return null;
  }
  target.startupInitialScenarioChunkVisualPromotion = result;
  return result;
}

export function setUiShellDebugState(target, active) {
  if (!isStateTarget(target)) {
    return false;
  }
  const nextActive = !!active;
  target.uiShellDebug = nextActive;
  return nextActive;
}

export function setUiShellDebugTerritorySeededState(target, active) {
  if (!isStateTarget(target)) {
    return false;
  }
  const nextActive = !!active;
  target.uiShellDebugTerritorySeeded = nextActive;
  return nextActive;
}

export function setBootSubProgress(target, progress) {
  target.bootSubProgress = progress;
  emit("boot-sub-progress", target);
}

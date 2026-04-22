// Boot state defaults.
// 这里收口 startup/boot 壳层和只读解锁相关默认 shape，
// 保持 state.js 继续作为公开 facade。

export function createDefaultStartupBootCacheState() {
  return {
    enabled: false,
    baseTopology: "idle",
    localization: "idle",
    scenarioBootstrap: "idle",
  };
}

export function createDefaultBootState() {
  return {
    bootPhase: "shell",
    bootMessage: "Starting workspace…",
    bootProgress: 0,
    bootBlocking: true,
    bootPreviewVisible: false,
    bootError: "",
    bootCanContinueWithoutScenario: false,
    startupInteractionMode: "readonly",
    startupReadonly: false,
    startupReadonlyReason: "",
    startupReadonlyUnlockInFlight: false,
    startupReadonlySince: 0,
    bootMetrics: {},
    startupBootCacheState: createDefaultStartupBootCacheState(),
  };
}

function normalizeStartupInteractionMode(mode = "readonly") {
  return String(mode || "readonly").trim().toLowerCase() === "full" ? "full" : "readonly";
}

export function setStartupInteractionMode(target, mode = "readonly") {
  if (!target || typeof target !== "object") {
    return "readonly";
  }
  target.startupInteractionMode = normalizeStartupInteractionMode(mode);
  return target.startupInteractionMode;
}

export function setBootPreviewVisibleState(target, active) {
  if (!target || typeof target !== "object") {
    return false;
  }
  target.bootPreviewVisible = !!active;
  return target.bootPreviewVisible;
}

export function setStartupReadonlyStateFields(
  target,
  { active, reason = "", unlockInFlight = false, since = Date.now() } = {},
) {
  if (!target || typeof target !== "object") {
    return false;
  }
  target.startupReadonly = !!active;
  target.startupReadonlyReason = target.startupReadonly
    ? String(reason || "detail-promotion").trim()
    : "";
  target.startupReadonlyUnlockInFlight = target.startupReadonly ? !!unlockInFlight : false;
  target.startupReadonlySince = target.startupReadonly
    ? (Number(target.startupReadonlySince) || Number(since) || Date.now())
    : 0;
  return target.startupReadonly;
}

export function setBootStateFields(
  target,
  {
    phase,
    message,
    progress,
    blocking,
    error,
    canContinueWithoutScenario,
  } = {},
) {
  if (!target || typeof target !== "object") {
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
  return target.bootPhase || null;
}

export function replaceBootMetricsState(target, metrics = {}) {
  if (!target || typeof target !== "object") {
    return {};
  }
  target.bootMetrics = metrics && typeof metrics === "object" ? metrics : {};
  return target.bootMetrics;
}

export function setStartupBootCacheState(target, nextState = null) {
  if (!target || typeof target !== "object") {
    return createDefaultStartupBootCacheState();
  }
  target.startupBootCacheState = {
    ...createDefaultStartupBootCacheState(),
    ...(
      nextState && typeof nextState === "object"
        ? nextState
        : {}
    ),
  };
  return target.startupBootCacheState;
}

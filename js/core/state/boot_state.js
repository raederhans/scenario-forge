// Boot state defaults.
// 这里收口 startup/boot 壳层和只读解锁相关默认 shape，
// 保持 state.js 继续作为公开 facade。

import {
  clearStartupReadonlyStateFields as clearStartupReadonlyStateFieldsAction,
  clearStartupReadonlyStateForReason as clearStartupReadonlyStateForReasonAction,
  commitStartupReadonlyStateFields,
  replaceBootMetricsState as replaceBootMetricsStateAction,
  replaceStartupBootCacheState,
  setBootPreviewVisibleState as setBootPreviewVisibleStateAction,
  setBootStateFields as setBootStateFieldsAction,
  setStartupInteractionMode as setStartupInteractionModeAction,
} from "./actions/boot_actions.js";

export function createDefaultStartupBootCacheState() {
  return {
    enabled: false,
    baseTopology: "idle",
    localization: "idle",
    scenarioBootstrap: "idle",
  };
}

export function createDefaultSampleProjectDeeplinkState() {
  return {
    status: "idle",
    sampleId: "",
    scenarioId: "",
    projectUrl: "",
    appProjectUrl: "",
    fileName: "",
    title: "",
    manifestVersion: 0,
    errorCode: "",
    errorMessage: "",
    updatedAt: 0,
    completedAt: 0,
  };
}

export function createDefaultBootState() {
  return {
    bootPhase: "shell",
    bootMessage: "Starting workspace…",
    bootProgress: 0,
    bootSubProgress: null,
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
    sampleProjectDeeplink: createDefaultSampleProjectDeeplinkState(),
  };
}

function normalizeStartupInteractionMode(mode = "readonly") {
  return String(mode || "readonly").trim().toLowerCase() === "full" ? "full" : "readonly";
}

export function setStartupInteractionMode(target, mode = "readonly") {
  return setStartupInteractionModeAction(target, normalizeStartupInteractionMode(mode));
}

export function setBootPreviewVisibleState(target, active) {
  return setBootPreviewVisibleStateAction(target, active);
}

export function setStartupReadonlyStateFields(
  target,
  { active, reason = "", unlockInFlight = false, since = Date.now() } = {},
) {
  return commitStartupReadonlyStateFields(target, {
    active,
    reason,
    unlockInFlight,
    since: active ? (Number(since) || Date.now()) : since,
  });
}

export function hasStartupReadonlyReason(target, reason = "") {
  if (!target || typeof target !== "object") {
    return false;
  }
  return String(target.startupReadonlyReason || "").trim() === String(reason || "").trim();
}

export function clearStartupReadonlyStateFields(target, { preserveSince = true } = {}) {
  return clearStartupReadonlyStateFieldsAction(target, { preserveSince });
}

export function clearStartupReadonlyStateForReason(
  target,
  reason = "",
  { preserveSince = true } = {},
) {
  if (!hasStartupReadonlyReason(target, reason)) {
    return false;
  }
  return clearStartupReadonlyStateForReasonAction(target, reason, { preserveSince });
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
  return setBootStateFieldsAction(target, {
    phase,
    message,
    progress,
    blocking,
    error,
    canContinueWithoutScenario,
  });
}

export function replaceBootMetricsState(target, metrics = {}) {
  return replaceBootMetricsStateAction(target, metrics);
}

export function setStartupBootCacheState(target, nextState = null) {
  if (!target || typeof target !== "object") {
    return createDefaultStartupBootCacheState();
  }
  return replaceStartupBootCacheState(target, {
    ...createDefaultStartupBootCacheState(),
    ...(
      nextState && typeof nextState === "object"
        ? nextState
        : {}
    ),
  });
}

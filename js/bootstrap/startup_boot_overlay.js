import { state as runtimeState } from "../core/state.js";
import {
  replaceBootMetricsState,
  setBootPreviewVisibleState,
  setBootStateFields,
  setStartupReadonlyStateFields,
} from "../core/state/boot_state.js";
import { callRuntimeHook } from "../core/state/index.js";
import { getBootLanguage, nowMs } from "./startup_bootstrap_support.js";
const state = runtimeState;

const BOOT_PHASE_WINDOWS = {
  shell: { min: 0, max: 8, durationMs: 900 },
  "base-data": { min: 8, max: 52, durationMs: 8800 },
  "scenario-bundle": { min: 52, max: 80, durationMs: 6400 },
  "scenario-apply": { min: 80, max: 94, durationMs: 3400 },
  warmup: { min: 94, max: 96, durationMs: 1200 },
  "detail-promotion": { min: 96, max: 98, durationMs: 2200 },
  "interaction-infra": { min: 98, max: 99, durationMs: 2800 },
  ready: { min: 100, max: 100, durationMs: 0 },
  error: { min: 0, max: 99, durationMs: 0 },
};

const BOOT_COPY = {
  en: {
    shell: {
      title: "Preparing application shell",
      message: "Loading the workspace frame before interaction unlocks.",
      retry: "Retry",
      continue: "Continue without scenario",
    },
    "base-data": {
      title: "Loading base map",
      message: "Fetching topology, palette, hierarchy, and core localization data.",
    },
    "scenario-bundle": {
      title: "Loading default scenario",
      message: "Preparing the TNO 1962 scenario bundle for the first visible frame.",
    },
    "scenario-apply": {
      title: "Applying default scenario",
      message: "Composing ownership, controllers, runtime topology, and UI state in one pass.",
    },
    warmup: {
      title: "Finalizing first render",
      message: "Flushing the first visible frame before detailed interactions finish preparing.",
    },
    "detail-promotion": {
      title: "Preparing detailed interactions",
      message: "Promoting the detailed topology behind the visible map.",
    },
    "interaction-infra": {
      title: "Building interaction indexes",
      message: "Finishing selection, hover, and hit-testing before the interface unlocks.",
    },
    ready: {
      title: "Ready",
      message: "The default scenario is loaded.",
    },
    error: {
      title: "Startup blocked",
      message: "The default scenario could not be prepared. Retry or continue with the base map.",
    },
  },
  zh: {
    shell: {
      title: "正在准备应用框架",
      message: "先完成工作区壳层初始化，再开放交互。",
      retry: "重试",
      continue: "无剧本继续",
    },
    "base-data": {
      title: "正在加载基础地图",
      message: "正在获取基础拓扑、调色板、层级和核心地名数据。",
    },
    "scenario-bundle": {
      title: "正在加载默认剧本",
      message: "正在准备 TNO 1962 剧本包，用于首个可见画面。",
    },
    "scenario-apply": {
      title: "正在应用默认剧本",
      message: "正在一次性组合归属、控制、运行时拓扑和 UI 状态。",
    },
    warmup: {
      title: "正在完成首帧渲染",
      message: "首个可见画面即将就绪，随后继续准备细分交互。",
    },
    "detail-promotion": {
      title: "正在准备细分交互",
      message: "正在在可见地图背后提升细分拓扑。",
    },
    "interaction-infra": {
      title: "正在建立交互索引",
      message: "正在完成点击、悬停与选择支持，随后开放交互。",
    },
    ready: {
      title: "加载完成",
      message: "默认剧本已经就绪。",
    },
    error: {
      title: "启动被阻断",
      message: "默认剧本未能完成启动。你可以重试，或先进入基础地图。",
    },
  },
};

const STARTUP_READONLY_COPY = {
  en: {
    pending: "Detailed interactions are still loading. Pan and zoom remain available.",
    loading: "Preparing detailed interactions. The map is view-only for a moment.",
    failed: "Detailed interactions are unavailable right now. The map stays view-only until the detail layer recovers.",
    healthGate: "Scenario data is being held in safe mode. The map stays view-only until startup recovery finishes.",
  },
  zh: {
    pending: "细分交互仍在加载中。当前可平移缩放，但保持只读。",
    loading: "正在准备细分交互。当前地图暂时只读。",
    failed: "细分交互暂时不可用。在细分图层恢复前，地图将保持只读。",
    healthGate: "场景数据已切换到安全模式。在启动恢复完成前，地图将保持只读。",
  },
};

function getBootCopy(phase = runtimeState.bootPhase) {
  const language = getBootLanguage();
  return BOOT_COPY[language]?.[phase] || BOOT_COPY.en[phase] || BOOT_COPY.en.shell;
}

function getBootDom() {
  if (typeof document === "undefined") {
    return {};
  }
  return {
    appShell: document.getElementById("appShell"),
    overlay: document.getElementById("bootOverlay"),
    title: document.getElementById("bootOverlayTitle"),
    message: document.getElementById("bootOverlayMessage"),
    progressTrack: document.getElementById("bootOverlayProgress"),
    progressBar: document.getElementById("bootOverlayProgressBar"),
    progressText: document.getElementById("bootOverlayProgressText"),
    actions: document.getElementById("bootOverlayActions"),
    retryBtn: document.getElementById("bootRetryBtn"),
    continueBtn: document.getElementById("bootContinueBtn"),
    readonlyBanner: document.getElementById("startupReadonlyBanner"),
    readonlyMessage: document.getElementById("startupReadonlyMessage"),
  };
}

function getStartupReadonlyCopy() {
  const language = getBootLanguage();
  return STARTUP_READONLY_COPY[language] || STARTUP_READONLY_COPY.en;
}

export function resolveStartupInteractionMode() {
  const search = globalThis.location?.search || "";
  if (search && globalThis.URLSearchParams) {
    const params = new globalThis.URLSearchParams(search);
    const raw = String(params.get("startup_interaction") || "").trim().toLowerCase();
    if (raw === "full" || raw === "readonly") {
      return raw;
    }
  }
  return "readonly";
}

export function createStartupBootOverlayController() {
  let bootOverlayBound = false;
  let bootContinueHandler = null;
  let bootProgressAnimationHandle = null;
  let bootProgressPhaseStartedAt = nowMs();
  let startupReadonlyUnlockHandle = null;
  let bootMetricsLogged = false;

  const getStartupReadonlyMessage = () => {
    const copy = getStartupReadonlyCopy();
    if (runtimeState.startupReadonlyReason === "detail-promotion-failed") {
      return copy.failed;
    }
    if (runtimeState.startupReadonlyReason === "scenario-health-gate") {
      return copy.healthGate;
    }
    if (runtimeState.startupReadonlyUnlockInFlight) {
      return copy.loading;
    }
    return copy.pending;
  };

  const getBootProgressWindow = (phase = runtimeState.bootPhase) => {
    return BOOT_PHASE_WINDOWS[phase] || BOOT_PHASE_WINDOWS.shell;
  };

  const sampleBootPhaseProgress = (phase = runtimeState.bootPhase) => {
    const window = getBootProgressWindow(phase);
    if (phase === "ready") {
      return 100;
    }
    if (phase === "error") {
      return Math.max(window.min, Math.min(99, Number(runtimeState.bootProgress || window.min)));
    }
    const elapsedMs = Math.max(0, nowMs() - bootProgressPhaseStartedAt);
    const ratio = window.durationMs > 0
      ? Math.min(1, elapsedMs / window.durationMs)
      : 1;
    const next = window.min + ((window.max - window.min) * ratio);
    return Math.max(window.min, Math.min(window.max, next));
  };

  const stopBootProgressAnimation = () => {
    if (bootProgressAnimationHandle !== null) {
      globalThis.cancelAnimationFrame?.(bootProgressAnimationHandle);
      bootProgressAnimationHandle = null;
    }
  };

  const syncBootOverlay = () => {
    if (typeof document === "undefined") {
      return;
    }
    const dom = getBootDom();
    const copy = getBootCopy(runtimeState.bootPhase);
    const blocking = runtimeState.bootBlocking !== false;
    document.body?.classList.toggle("app-booting", blocking);
    document.body?.classList.toggle("app-startup-readonly", !!runtimeState.startupReadonly);
    if (dom.overlay) {
      // CSS `.boot-overlay` sets `display: flex`, which overrides the HTML
      // `[hidden]` attribute's default `display: none`. The actual fade-out
      // rule lives at `.boot-overlay.hidden { opacity: 0; visibility: hidden }`,
      // so we must toggle the `.hidden` class — not the HTML attribute, and
      // not a `--visible` modifier class that doesn't exist in the stylesheet.
      dom.overlay.classList.toggle("hidden", !blocking);
    }
    if (dom.appShell) {
      dom.appShell.classList.toggle("boot-preview-visible", !!runtimeState.bootPreviewVisible);
    }
    if (dom.title) {
      dom.title.textContent = String(runtimeState.bootError ? copy.title : copy.title || "");
    }
    if (dom.message) {
      dom.message.textContent = String(runtimeState.bootError || runtimeState.bootMessage || copy.message || "");
    }
    if (dom.progressTrack) {
      dom.progressTrack.hidden = !blocking;
    }
    if (dom.progressBar) {
      dom.progressBar.style.width = `${Math.max(0, Math.min(100, Number(runtimeState.bootProgress || 0)))}%`;
    }
    if (dom.progressText) {
      dom.progressText.textContent = `${Math.round(Math.max(0, Math.min(100, Number(runtimeState.bootProgress || 0))))}%`;
    }
    if (dom.actions) {
      dom.actions.hidden = runtimeState.bootPhase !== "error";
    }
    if (dom.retryBtn) {
      dom.retryBtn.textContent = copy.retry || BOOT_COPY.en.shell.retry;
    }
    if (dom.continueBtn) {
      dom.continueBtn.textContent = copy.continue || BOOT_COPY.en.shell.continue;
      dom.continueBtn.hidden = !runtimeState.bootCanContinueWithoutScenario;
    }
    if (dom.readonlyBanner) {
      const readonlyVisible = !!runtimeState.startupReadonly && !blocking;
      // `.startup-readonly-banner` has no `display` override, so the HTML
      // `[hidden]` attribute works here. The previous `--visible` class toggle
      // targeted a CSS rule that does not exist and was dead code.
      dom.readonlyBanner.hidden = !readonlyVisible;
    }
    if (dom.readonlyMessage) {
      dom.readonlyMessage.textContent = getStartupReadonlyMessage();
    }
  };

  const startBootProgressAnimation = () => {
    stopBootProgressAnimation();
    const tick = () => {
      bootProgressAnimationHandle = null;
      if (runtimeState.bootPhase === "ready" || runtimeState.bootPhase === "error") {
        return;
      }
      const nextProgress = sampleBootPhaseProgress(runtimeState.bootPhase);
      if (nextProgress > runtimeState.bootProgress) {
        setBootStateFields(state, { progress: nextProgress });
        syncBootOverlay();
      }
      bootProgressAnimationHandle = globalThis.requestAnimationFrame?.(tick) ?? null;
    };
    bootProgressAnimationHandle = globalThis.requestAnimationFrame?.(tick) ?? null;
  };

  const clearStartupReadonlyUnlockHandle = () => {
    if (startupReadonlyUnlockHandle === null) return;
    globalThis.clearTimeout?.(startupReadonlyUnlockHandle);
    startupReadonlyUnlockHandle = null;
  };

  const setStartupReadonlyState = (active, { reason = "", unlockInFlight = false } = {}) => {
    setStartupReadonlyStateFields(state, {
      active,
      reason,
      unlockInFlight,
    });
    if (!runtimeState.startupReadonly) {
      clearStartupReadonlyUnlockHandle();
    }
    syncBootOverlay();
    callRuntimeHook(state, "updateScenarioUIFn");
  };

  const setBootPreviewVisible = (active) => {
    setBootPreviewVisibleState(state, active);
    syncBootOverlay();
  };

  const initializeBootOverlay = () => {
    const dom = getBootDom();
    if (!dom.overlay || bootOverlayBound) {
      syncBootOverlay();
      return;
    }
    dom.retryBtn?.addEventListener("click", () => {
      globalThis.location.reload();
    });
    dom.continueBtn?.addEventListener("click", () => {
      if (typeof bootContinueHandler === "function") {
        void bootContinueHandler();
      }
    });
    bootOverlayBound = true;
    syncBootOverlay();
  };

  const setBootState = (
    phase,
    {
      message = null,
      progress = null,
      blocking = null,
      error = "",
      canContinueWithoutScenario = false,
    } = {},
  ) => {
    setBootStateFields(state, {
      phase,
      message: message ?? getBootCopy(phase).message,
      error,
      canContinueWithoutScenario,
    });
    if (blocking !== null) {
      setBootStateFields(state, { blocking });
    } else if (phase === "ready") {
      setBootStateFields(state, { blocking: false });
    } else if (phase === "error") {
      setBootStateFields(state, { blocking: true });
    }
    const window = getBootProgressWindow(phase);
    if (progress === null) {
      bootProgressPhaseStartedAt = nowMs();
      setBootStateFields(state, { progress: window.min });
    } else {
      setBootStateFields(state, {
        progress: Math.max(window.min, Math.min(window.max, Number(progress || 0))),
      });
    }
    if (phase === "ready" || phase === "error") {
      stopBootProgressAnimation();
    } else {
      startBootProgressAnimation();
    }
    syncBootOverlay();
    callRuntimeHook(state, "updateScenarioUIFn");
  };

  const resetBootMetrics = () => {
    bootMetricsLogged = false;
    replaceBootMetricsState(state, {
      total: {
        startedAt: nowMs(),
      },
    });
    globalThis.__bootMetrics = runtimeState.bootMetrics;
  };

  const startBootMetric = (name) => {
    const nextMetrics = {
      ...(runtimeState.bootMetrics || {}),
      [name]: {
        startedAt: nowMs(),
      },
    };
    replaceBootMetricsState(state, nextMetrics);
    globalThis.__bootMetrics = runtimeState.bootMetrics;
  };

  const finishBootMetric = (name, extra = {}) => {
    const finishedAt = nowMs();
    const metric = runtimeState.bootMetrics[name] || {};
    const startedAt = Number(metric.startedAt);
    replaceBootMetricsState(state, {
      ...(runtimeState.bootMetrics || {}),
      [name]: {
        ...metric,
        ...extra,
        finishedAt,
        durationMs: Number.isFinite(startedAt) ? finishedAt - startedAt : null,
      },
    });
    globalThis.__bootMetrics = runtimeState.bootMetrics;
  };

  const checkpointBootMetric = (name) => {
    const metric = runtimeState.bootMetrics[name] || {};
    const totalStartedAt = Number(runtimeState.bootMetrics?.total?.startedAt);
    replaceBootMetricsState(state, {
      ...(runtimeState.bootMetrics || {}),
      [name]: {
        ...metric,
        atMs: Number.isFinite(totalStartedAt) ? nowMs() - totalStartedAt : 0,
      },
    });
    globalThis.__bootMetrics = runtimeState.bootMetrics;
    return runtimeState.bootMetrics[name];
  };

  const checkpointBootMetricOnce = (name) => {
    if (runtimeState.bootMetrics[name]?.atMs !== undefined) {
      return runtimeState.bootMetrics[name];
    }
    return checkpointBootMetric(name);
  };

  const logBootMetrics = () => {
    const printable = {};
    Object.entries(runtimeState.bootMetrics || {}).forEach(([name, metric]) => {
      if (Number.isFinite(metric?.durationMs)) {
        printable[name] = `${metric.durationMs.toFixed(1)}ms`;
        return;
      }
      if (Number.isFinite(metric?.atMs)) {
        printable[name] = `${metric.atMs.toFixed(1)}ms`;
      }
    });
    console.info("[boot] metrics", printable);
  };

  const completeBootSequenceLogging = () => {
    if (bootMetricsLogged) {
      return;
    }
    bootMetricsLogged = true;
    finishBootMetric("total");
    logBootMetrics();
  };

  const setBootContinueHandler = (handler) => {
    bootContinueHandler = typeof handler === "function" ? handler : null;
  };

  const hasStartupReadonlyUnlockScheduled = () => {
    return startupReadonlyUnlockHandle !== null;
  };

  const scheduleStartupReadonlyUnlockTimer = (callback, delayMs) => {
    clearStartupReadonlyUnlockHandle();
    startupReadonlyUnlockHandle = globalThis.setTimeout(() => {
      startupReadonlyUnlockHandle = null;
      callback();
    }, delayMs);
    return startupReadonlyUnlockHandle;
  };

  return {
    initializeBootOverlay,
    setBootState,
    getBootProgressWindow,
    resetBootMetrics,
    startBootMetric,
    finishBootMetric,
    checkpointBootMetric,
    checkpointBootMetricOnce,
    completeBootSequenceLogging,
    setStartupReadonlyState,
    setBootPreviewVisible,
    resolveStartupInteractionMode,
    setBootContinueHandler,
    hasStartupReadonlyUnlockScheduled,
    scheduleStartupReadonlyUnlockTimer,
    clearStartupReadonlyUnlockHandle,
    getBootCopy,
    getBootDom,
  };
}



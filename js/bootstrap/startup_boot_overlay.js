import { state as runtimeState } from "../core/state.js";
import {
  commitStartupReadonlyStateFields,
  replaceBootMetricsState,
  setBootPreviewVisibleState,
  setBootStateFields,
  setBootSubProgress,
} from "../core/state/actions/boot_actions.js";
import { on, off } from "../core/state/bus.js";
import { callRuntimeHook } from "../core/state/index.js";
import { getBootLanguage, nowMs } from "./startup_bootstrap_support.js";
const state = runtimeState;

const BOOT_PHASE_WINDOWS = {
  shell: { min: 0, max: 3 },
  "base-data": { min: 3, max: 16 },
  "scenario-bundle": { min: 16, max: 36 },
  "scenario-apply": { min: 36, max: 40 },
  "initial-chunk-visual": { min: 40, max: 88 },
  warmup: { min: 88, max: 90 },
  "detail-promotion": { min: 90, max: 92 },
  "interaction-infra": { min: 92, max: 99 },
  ready: { min: 100, max: 100 },
  error: { min: 0, max: 99 },
};
const BOOT_STEPS = Object.keys(BOOT_PHASE_WINDOWS).filter((phase) => phase !== "error");

const BOOT_COPY = {
  en: {
    steps: { completed: "Completed", active: "In progress", pending: "Pending" },
    "initial-chunk-visual": { title: "Loading visible map chunks", message: "Preparing the initial scenario map." },
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
      message: "Preparing the {scenario} scenario bundle for the first visible frame.",
    },
    "scenario-apply": {
      title: "Applying default scenario",
      message: "Composing ownership, controllers, runtime topology, and UI state for {scenario}.",
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
      title: "The map could not be opened",
      message: "Reload the page to try again.",
      continueMessage: "Try again, or open the base map without a scenario.",
      details: "Technical details",
    },
  },
  zh: {
    steps: { completed: "已完成", active: "进行中", pending: "待处理" },
    "initial-chunk-visual": { title: "正在加载首屏地图分片", message: "正在准备剧本首屏地图。" },
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
      message: "正在准备 {scenario} 剧本包，用于首个可见画面。",
    },
    "scenario-apply": {
      title: "正在应用默认剧本",
      message: "正在为 {scenario} 组合归属、控制、运行时拓扑和 UI 状态。",
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
      title: "地图未能打开",
      message: "请重新加载页面，再试一次。",
      continueMessage: "你可以重试，或不加载剧本，先进入基础地图。",
      details: "技术详情",
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
  const copy = BOOT_COPY[language]?.[phase] || BOOT_COPY.en[phase] || BOOT_COPY.en.shell;
  const scenarioId = runtimeState.activeScenarioId || runtimeState.scenarioRegistry?.default_scenario_id || "";
  const scenario = runtimeState.scenarioRegistry?.scenarios?.find((entry) => entry.scenario_id === scenarioId);
  return { ...copy, message: copy.message?.replace("{scenario}", scenario?.display_name || scenarioId) };
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
    errorDetails: document.getElementById("bootOverlayErrorDetails"),
    errorSummary: document.getElementById("bootOverlayErrorSummary"),
    errorText: document.getElementById("bootOverlayErrorText"),
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
  let bootSubProgressListener = null;
  let stepNodes = [];
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

  const syncBootOverlay = () => {
    if (typeof document === "undefined") {
      return;
    }
    const window = getBootProgressWindow();
    const subProgress = runtimeState.bootSubProgress;
    if (subProgress?.total > 0 && runtimeState.bootPhase !== "error") {
      const next = window.min + (window.max - window.min) * Math.min(1, subProgress.done / subProgress.total);
      setBootStateFields(state, { progress: Math.max(runtimeState.bootProgress, next) });
    }
    const dom = getBootDom();
    const stepCopy = BOOT_COPY[getBootLanguage()].steps;
    const currentStep = BOOT_STEPS.indexOf(runtimeState.bootPhase);
    stepNodes.forEach((node, index) => {
      const status = index < currentStep || runtimeState.bootPhase === "ready"
        ? "completed" : index === currentStep ? "active" : "pending";
      node.textContent = `${getBootCopy(BOOT_STEPS[index]).title} — ${stepCopy[status]}`;
      node.setAttribute("data-status", status);
    });
    const copy = getBootCopy(runtimeState.bootPhase);
    const shellCopy = getBootCopy("shell");
    const failed = runtimeState.bootPhase === "error";
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
      dom.overlay.setAttribute("aria-busy", String(blocking && !failed));
    }
    if (dom.appShell) {
      dom.appShell.classList.toggle("boot-preview-visible", !!runtimeState.bootPreviewVisible);
    }
    if (dom.title) {
      dom.title.textContent = String(copy.title || "");
    }
    if (dom.message) {
      dom.message.textContent = failed
        ? (runtimeState.bootCanContinueWithoutScenario ? copy.continueMessage : copy.message)
        : String(runtimeState.bootMessage || copy.message || "");
    }
    if (dom.errorDetails) {
      const showDetails = failed && !!runtimeState.bootError;
      dom.errorDetails.hidden = !showDetails;
      dom.errorDetails.classList.toggle("hidden", !showDetails);
      if (!showDetails) dom.errorDetails.open = false;
    }
    if (dom.errorSummary) {
      dom.errorSummary.textContent = getBootCopy("error").details;
    }
    if (dom.errorText) {
      dom.errorText.textContent = String(failed ? runtimeState.bootError ?? "" : "");
    }
    if (dom.progressTrack) {
      dom.progressTrack.hidden = !blocking || failed;
      dom.progressTrack.classList.toggle("hidden", !blocking || failed);
    }
    if (dom.progressBar) {
      dom.progressBar.style.width = `${Math.max(0, Math.min(100, Number(runtimeState.bootProgress || 0)))}%`;
    }
    if (dom.progressText) {
      dom.progressText.hidden = !blocking || failed;
      dom.progressText.classList.toggle("hidden", !blocking || failed);
      dom.progressText.textContent = `${Math.round(Math.max(0, Math.min(100, Number(runtimeState.bootProgress || 0))))}%`;
    }
    if (dom.actions) {
      dom.actions.hidden = !failed;
      dom.actions.classList.toggle("hidden", !failed);
    }
    if (dom.retryBtn) {
      dom.retryBtn.textContent = shellCopy.retry;
    }
    if (dom.continueBtn) {
      dom.continueBtn.textContent = shellCopy.continue;
      const showContinue = failed && runtimeState.bootCanContinueWithoutScenario;
      dom.continueBtn.hidden = !showContinue;
      dom.continueBtn.classList.toggle("hidden", !showContinue);
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

  const clearStartupReadonlyUnlockHandle = () => {
    if (startupReadonlyUnlockHandle === null) return;
    globalThis.clearTimeout?.(startupReadonlyUnlockHandle);
    startupReadonlyUnlockHandle = null;
  };

  const setStartupReadonlyState = (active, { reason = "", unlockInFlight = false } = {}) => {
    commitStartupReadonlyStateFields(state, {
      active,
      reason,
      unlockInFlight,
      since: active
        ? (Number(runtimeState.startupReadonlySince) || Date.now())
        : 0,
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
    const steps = document.createElement("ol");
    steps.id = "bootOverlaySteps";
    stepNodes = BOOT_STEPS.map(() => {
      const node = document.createElement("li");
      steps.appendChild(node);
      return node;
    });
    dom.title.parentElement.appendChild(steps);
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
    setBootSubProgress(state, null);
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
      setBootStateFields(state, { progress: Math.max(runtimeState.bootProgress, window.min) });
    } else {
      setBootStateFields(state, {
        progress: Math.max(runtimeState.bootProgress, window.min, Math.min(window.max, Number(progress || 0))),
      });
    }
    if (phase === "ready" || phase === "error") {
      off("boot-sub-progress", bootSubProgressListener);
      bootSubProgressListener = null;
    } else if (!bootSubProgressListener) {
      bootSubProgressListener = on("boot-sub-progress", (target) => {
        if (target === state) syncBootOverlay();
      });
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



// App entry point (Phase 13)
import { normalizeCityLayerStyleConfig, state } from "./core/state.js";
import {
  buildCityLocalizationPatch,
  loadCitySupportData,
  loadContextLayerPack,
  loadDeferredDetailBundle,
  loadLocalizationData,
  loadMapData,
  normalizeRequestedContextLayerNames,
} from "./core/data_loader.js";
import {
  buildInteractionInfrastructureAfterStartup,
  initMap,
  invalidateContextLayerVisualStateBatch,
  setMapData,
  render,
} from "./core/map_renderer.js";
import { applyActivePaletteState } from "./core/palette_manager.js";
import {
  hydrateActiveScenarioBundle,
  createStartupScenarioBundleFromPayload,
  enforceScenarioHydrationHealthGate,
  hasScenarioRuntimeShellContract,
  validateScenarioRuntimeShellContract,
  loadScenarioBundle,
  loadScenarioRegistry,
} from "./core/scenario_resources.js";
import { bindRenderBoundary, flushRenderBoundary, requestRender } from "./core/render_boundary.js";
import { applyScenarioBundleCommand } from "./core/scenario_dispatcher.js";
import { initPresetState } from "./core/preset_state.js";
import { syncScenarioLocalizationState } from "./core/scenario_localization_state.js";
import { initTranslations } from "./ui/i18n.js";
import { initToast } from "./ui/toast.js";
import { bindBeforeUnload } from "./core/dirty_state.js";
import { normalizeCountryCodeAlias } from "./core/country_code_aliases.js";
import { loadStartupBundleViaWorker } from "./core/startup_worker_client.js";

const VALID_BATCH_FILL_SCOPES = new Set(["parent", "country"]);
const VIEW_SETTINGS_STORAGE_KEY = "map_view_settings_v1";

function requestMainRender(reason = "", { flush = false } = {}) {
  return flush ? flushRenderBoundary(reason) : requestRender(reason);
}

function normalizeCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

function normalizeBatchFillScopes(rawScopes) {
  const scopes = Array.isArray(rawScopes) ? rawScopes : [];
  const normalized = scopes
    .map((scope) => String(scope || "").trim().toLowerCase())
    .filter((scope) => VALID_BATCH_FILL_SCOPES.has(scope));
  return normalized.length ? Array.from(new Set(normalized)) : ["parent", "country"];
}

function processHierarchyData(data) {
  state.hierarchyData = data || null;
  state.hierarchyGroupsByCode = new Map();
  state.countryGroupsData = state.hierarchyData?.country_groups || null;
  state.countryGroupMetaByCode = new Map();
  state.countryInteractionPoliciesByCode = new Map();

  if (state.hierarchyData?.groups) {
    const labels = state.hierarchyData.labels || {};
    Object.entries(state.hierarchyData.groups).forEach(([groupId, children]) => {
      const code = normalizeCountryCode(groupId.split("_")[0]);
      if (!code) return;
      const list = state.hierarchyGroupsByCode.get(code) || [];
      list.push({
        id: groupId,
        label: labels[groupId] || groupId,
        children: Array.isArray(children) ? children : [],
      });
      state.hierarchyGroupsByCode.set(code, list);
    });
  }

  state.hierarchyGroupsByCode.forEach((groups) => {
    groups.sort((a, b) => a.label.localeCompare(b.label));
  });

  const countryMeta = state.countryGroupsData?.country_meta || {};
  Object.entries(countryMeta).forEach(([rawCode, meta]) => {
    const code = normalizeCountryCode(rawCode);
    if (!code || !meta || typeof meta !== "object") return;
    state.countryGroupMetaByCode.set(code, {
      continentId: String(meta.continent_id || "").trim(),
      continentLabel: String(meta.continent_label || "").trim(),
      subregionId: String(meta.subregion_id || "").trim(),
      subregionLabel: String(meta.subregion_label || "").trim(),
    });
  });

  const interactionPolicies = state.hierarchyData?.interaction_policies || {};
  Object.entries(interactionPolicies).forEach(([rawCode, policy]) => {
    const code = normalizeCountryCode(rawCode);
    if (!code || !policy || typeof policy !== "object") return;
    state.countryInteractionPoliciesByCode.set(code, {
      leafSource: String(policy.leaf_source || "").trim().toLowerCase(),
      leafKind: String(policy.leaf_kind || "").trim().toLowerCase(),
      parentSource: String(policy.parent_source || "").trim().toLowerCase(),
      parentScopeLabel: String(policy.parent_scope_label || "").trim(),
      requiresComposite: !!policy.requires_composite,
      quickFillScopes: normalizeBatchFillScopes(policy.quick_fill_scopes),
    });
  });
}

function hydrateLanguage() {
  try {
    const storedLang = localStorage.getItem("map_lang");
    if (storedLang) {
      state.currentLanguage = storedLang;
    }
  } catch (error) {
    console.warn("Language preference not available:", error);
  }
}

function hydrateViewSettings() {
  try {
    const raw = localStorage.getItem(VIEW_SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const cityPoints = parsed.cityPoints && typeof parsed.cityPoints === "object"
      ? parsed.cityPoints
      : {};
    if (cityPoints.show !== undefined) {
      state.showCityPoints = !!cityPoints.show;
    }
    if (cityPoints.style && typeof cityPoints.style === "object") {
      state.styleConfig.cityPoints = normalizeCityLayerStyleConfig({
        ...(state.styleConfig.cityPoints || {}),
        ...cityPoints.style,
      });
    }
  } catch (error) {
    console.warn("View settings preference not available:", error);
  }
}

function persistViewSettings() {
  try {
    localStorage.setItem(
      VIEW_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        cityPoints: {
          show: state.showCityPoints !== false,
          style: normalizeCityLayerStyleConfig(state.styleConfig?.cityPoints),
        },
      })
    );
  } catch (error) {
    console.warn("Unable to persist view settings:", error);
  }
}

function createRenderDispatcher(renderFn) {
  let framePending = false;

  const flush = () => {
    framePending = false;
    renderFn();
  };

  const schedule = () => {
    if (framePending) return;
    framePending = true;
    globalThis.requestAnimationFrame(flush);
  };

  return { schedule, flush };
}

function initLongAnimationFrameObserver() {
  if (typeof globalThis.PerformanceObserver !== "function") return;
  try {
    const observer = new globalThis.PerformanceObserver((list) => {
      const entries = list.getEntries ? list.getEntries() : [];
      if (!entries.length) return;
      const latest = entries[entries.length - 1];
      if (!latest) return;
      if (!state.renderPerfMetrics || typeof state.renderPerfMetrics !== "object") {
        state.renderPerfMetrics = {};
      }
      state.renderPerfMetrics.longAnimationFrameBlockingDuration = {
        durationMs: Math.max(0, Number(latest.duration || 0)),
        blockingDuration: Math.max(0, Number(latest.blockingDuration || 0)),
        startTime: Math.max(0, Number(latest.startTime || 0)),
        renderStart: Math.max(0, Number(latest.renderStart || 0)),
        firstUIEventTimestamp: Math.max(0, Number(latest.firstUIEventTimestamp || 0)),
        recordedAt: Date.now(),
      };
      globalThis.__renderPerfMetrics = state.renderPerfMetrics;
    });
    observer.observe({ type: "long-animation-frame", buffered: true });
    state.longAnimationFrameObserver = observer;
  } catch (_error) {
    // Experimental API; ignore unsupported browsers.
  }
}

function getDeferredPromotionDelay(profile) {
  if (profile === "balanced") return 250;
  if (profile === "auto") return 1200;
  return 0;
}

let deferredPromotionHandle = null;
let bootOverlayBound = false;
let bootContinueHandler = null;
let bootProgressAnimationHandle = null;
let bootProgressPhaseStartedAt = nowMs();
let milsymbolLoadPromise = null;
let deferredUiBootstrapPromise = null;
let postReadyContextWarmupScheduled = false;
let postReadyHydrationScheduled = false;
let startupReadonlyUnlockHandle = null;
let bootMetricsLogged = false;

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
const CONTEXT_LAYER_LOAD_ORDER = [
  "rivers",
  "urban",
  "physical",
  "physical_semantics",
  "physical_contours_major",
  "physical_contours_minor",
];
const PHYSICAL_CONTEXT_LAYER_SET = [
  "physical",
  "physical_semantics",
  "physical_contours_major",
  "physical_contours_minor",
];

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

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function getBootLanguage() {
  return String(state.currentLanguage || "en").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
}

function getConfiguredDefaultScenarioId() {
  if (typeof document === "undefined") {
    return "";
  }
  try {
    const params = typeof globalThis.URLSearchParams === "function"
      ? new globalThis.URLSearchParams(globalThis.location?.search || "")
      : null;
    const queryOverride = String(params?.get("default_scenario") || "").trim();
    if (queryOverride) {
      return queryOverride;
    }
  } catch (_error) {
    // Ignore malformed location/search state and fall back to the static default.
  }
  const configured = document
    .querySelector('meta[name="default-scenario"]')
    ?.getAttribute("content");
  return String(configured || "").trim();
}

function getStartupBundleLanguage() {
  return getBootLanguage() === "zh" ? "zh" : "en";
}

function getStartupBundleUrl(scenarioId, language = getStartupBundleLanguage()) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) {
    return "";
  }
  const bundleLanguage = String(language || "en").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
  return `data/scenarios/${normalizedScenarioId}/startup.bundle.${bundleLanguage}.json`;
}

function getStartupScenarioSupportUrl(scenarioId, filename) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  const normalizedFilename = String(filename || "").trim();
  if (!normalizedScenarioId || !normalizedFilename) {
    return "";
  }
  return `data/scenarios/${normalizedScenarioId}/${normalizedFilename}`;
}

function createStartupBundleLoadDiagnostics({
  startupBundleUrl = "",
  language = "en",
  metrics = null,
} = {}) {
  const runtimeTopologyAvailable = Number(metrics?.runtimeTopology?.featureCount || 0) > 0;
  const bootstrapStrategy = String(metrics?.startupBundle?.bootstrapStrategy || "").trim();
  return {
    optionalResources: {
      runtime_topology: {
        ok: runtimeTopologyAvailable,
        reason: runtimeTopologyAvailable ? "startup-bundle" : (bootstrapStrategy || "deferred"),
        errorMessage: "",
        metrics: metrics?.runtimeTopology || null,
        url: startupBundleUrl,
      },
      geo_locale_patch: {
        ok: !!metrics?.geoLocalePatch?.present,
        reason: "startup-bundle",
        errorMessage: "",
        language,
        localeSpecific: true,
        metrics: metrics?.geoLocalePatch || null,
      },
    },
    requiredResources: {
      manifest: metrics?.startupBundle || null,
      countries: metrics?.countries || null,
      owners: metrics?.owners || null,
      controllers: metrics?.controllers || null,
      cores: metrics?.cores || null,
    },
    bundleLevel: "bootstrap",
    startupBundle: true,
  };
}

function createStartupBootArtifactsOverride({
  payload = null,
  baseDecodedCollections = null,
  metrics = null,
} = {}) {
  const hasScenarioRuntimeBootstrap = hasScenarioRuntimeShellContract({
    runtimeTopologyPayload: payload?.scenario?.runtime_topology_bootstrap || null,
    runtimePoliticalMeta: payload?.scenario?.runtime_political_meta || null,
  });
  return {
    topologyPrimary: payload?.base?.topology_primary || null,
    locales: payload?.base?.locales || { ui: {}, geo: {} },
    geoAliases: payload?.base?.geo_aliases || { alias_to_stable_key: {} },
    hasScenarioRuntimeBootstrap,
    localeLevel: "startup",
    startupBootCacheState: {
      enabled: false,
      baseTopology: "startup-bundle",
      localization: "startup-bundle",
      scenarioBootstrap: "startup-bundle",
    },
    startupWorkerUsed: true,
    decodedCollections: baseDecodedCollections || null,
    resourceMetrics: {
      topologyPrimary: metrics?.topologyPrimary || null,
      locales: null,
      geoAliases: null,
    },
  };
}

function formatStartupRuntimeShellContractFailure(contract) {
  const missingParts = [
    ...(Array.isArray(contract?.missingObjects) ? contract.missingObjects.map((objectName) => `missing-${objectName}`) : []),
    ...(contract?.missingPoliticalMeta ? ["missing-runtime-political-meta"] : []),
  ];
  return missingParts.join(", ") || "incomplete-runtime-shell";
}

function warnOnStartupBundleIntegrity(bundle, { source = "" } = {}) {
  if (String(source || "").trim() !== "startup-bundle") {
    return;
  }
  const missingCollections = [];
  const baseObjects = state.topologyPrimary?.objects || {};
  const runtimeObjects = bundle?.runtimeTopologyPayload?.objects || {};
  if (baseObjects.ocean && !Array.isArray(state.oceanData?.features)) {
    missingCollections.push("base.ocean");
  }
  if (baseObjects.land && !Array.isArray(state.landBgData?.features)) {
    missingCollections.push("base.land");
  }
  if (baseObjects.water_regions && !Array.isArray(state.waterRegionsData?.features)) {
    missingCollections.push("base.water_regions");
  }
  if (runtimeObjects.scenario_water && !Array.isArray(state.scenarioWaterRegionsData?.features)) {
    missingCollections.push("scenario.scenario_water");
  }
  if (runtimeObjects.context_land_mask && !Array.isArray(state.scenarioContextLandMaskData?.features)) {
    missingCollections.push("scenario.context_land_mask");
  }
  if (!missingCollections.length) {
    return;
  }
  console.warn(
    `[startup-bundle] Boot completed with missing startup collections: ${missingCollections.join(", ")}.`,
    {
      activeScenarioId: String(state.activeScenarioId || bundle?.manifest?.scenario_id || ""),
      topologyBundleMode: String(state.topologyBundleMode || ""),
    }
  );
}

function getBootCopy(phase = state.bootPhase) {
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

function getStartupReadonlyMessage() {
  const copy = getStartupReadonlyCopy();
  if (state.startupReadonlyReason === "detail-promotion-failed") {
    return copy.failed;
  }
  if (state.startupReadonlyReason === "scenario-health-gate") {
    return copy.healthGate;
  }
  if (state.startupReadonlyUnlockInFlight) {
    return copy.loading;
  }
  return copy.pending;
}

function resolveStartupInteractionMode() {
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

function clearStartupReadonlyUnlockHandle() {
  if (startupReadonlyUnlockHandle === null) return;
  globalThis.clearTimeout?.(startupReadonlyUnlockHandle);
  startupReadonlyUnlockHandle = null;
}

function setStartupReadonlyState(active, { reason = "", unlockInFlight = false } = {}) {
  state.startupReadonly = !!active;
  state.startupReadonlyReason = state.startupReadonly ? String(reason || "detail-promotion").trim() : "";
  state.startupReadonlyUnlockInFlight = state.startupReadonly ? !!unlockInFlight : false;
  state.startupReadonlySince = state.startupReadonly
    ? (Number(state.startupReadonlySince) || Date.now())
    : 0;
  if (!state.startupReadonly) {
    clearStartupReadonlyUnlockHandle();
  }
  syncBootOverlay();
}
state.setStartupReadonlyStateFn = setStartupReadonlyState;

function setBootPreviewVisible(active) {
  state.bootPreviewVisible = !!active;
  syncBootOverlay();
}

function getBootProgressWindow(phase = state.bootPhase) {
  return BOOT_PHASE_WINDOWS[phase] || BOOT_PHASE_WINDOWS.shell;
}

function sampleBootPhaseProgress(phase = state.bootPhase) {
  const window = getBootProgressWindow(phase);
  if (phase === "ready") {
    return 100;
  }
  if (phase === "error") {
    return Math.max(window.min, Math.min(99, Number(state.bootProgress) || window.min));
  }
  const elapsedMs = Math.max(0, nowMs() - bootProgressPhaseStartedAt);
  const normalizedElapsed = Math.min(1, elapsedMs / Math.max(1, window.durationMs || 1));
  const shapedProgress = (normalizedElapsed * 0.68) + ((normalizedElapsed * normalizedElapsed) * 0.32);
  const ceiling = phase === "warmup" || phase === "interaction-infra"
    ? 99
    : Math.max(window.min, window.max - 0.35);
  return Math.max(window.min, Math.min(ceiling, window.min + ((window.max - window.min) * shapedProgress)));
}

function stopBootProgressAnimation() {
  if (bootProgressAnimationHandle !== null) {
    globalThis.cancelAnimationFrame?.(bootProgressAnimationHandle);
    bootProgressAnimationHandle = null;
  }
}

function startBootProgressAnimation() {
  stopBootProgressAnimation();
  const tick = () => {
    bootProgressAnimationHandle = null;
    if (state.bootPhase === "ready" || state.bootPhase === "error") {
      return;
    }
    const nextProgress = sampleBootPhaseProgress(state.bootPhase);
    if (nextProgress > Number(state.bootProgress || 0)) {
      state.bootProgress = nextProgress;
      syncBootOverlay();
    }
    bootProgressAnimationHandle = globalThis.requestAnimationFrame?.(tick) ?? null;
  };
  bootProgressAnimationHandle = globalThis.requestAnimationFrame?.(tick) ?? null;
}

function syncBootOverlay() {
  if (typeof document === "undefined") {
    return;
  }
  const dom = getBootDom();
  if (!dom.overlay) {
    return;
  }
  const copy = getBootCopy(state.bootPhase);
  const progress = Math.max(0, Math.min(100, Number(state.bootProgress) || 0));
  const showPreviewPeek = !!state.bootPreviewVisible && state.bootPhase !== "ready" && state.bootPhase !== "error";
  document.body?.classList.toggle("app-booting", !!state.bootBlocking);
  document.body?.classList.toggle("app-startup-readonly", !!state.startupReadonly);
  if (dom.appShell) {
    dom.appShell.setAttribute("aria-busy", state.bootPhase === "ready" ? "false" : "true");
  }
  dom.overlay.classList.toggle("hidden", state.bootPhase === "ready");
  dom.overlay.classList.toggle("is-peek", showPreviewPeek);
  dom.overlay.setAttribute("aria-busy", state.bootPhase === "ready" ? "false" : "true");
  if (dom.title) {
    dom.title.textContent = copy.title;
  }
  if (dom.message) {
    dom.message.textContent = state.bootPhase === "error"
      ? (state.bootError || copy.message)
      : (state.bootMessage || copy.message);
  }
  if (dom.progressBar) {
    dom.progressBar.style.width = `${progress}%`;
  }
  if (dom.progressTrack) {
    dom.progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
    dom.progressTrack.setAttribute("aria-valuetext", `${Math.round(progress)}%`);
  }
  if (dom.progressText) {
    dom.progressText.textContent = `${Math.round(progress)}%`;
  }
  if (dom.retryBtn) {
    dom.retryBtn.textContent = copy.retry || BOOT_COPY.en.shell.retry;
  }
  if (dom.continueBtn) {
    dom.continueBtn.textContent = copy.continue || BOOT_COPY.en.shell.continue;
  }
  if (dom.actions) {
    const showActions = state.bootPhase === "error";
    dom.actions.classList.toggle("hidden", !showActions);
  }
  if (dom.continueBtn) {
    dom.continueBtn.classList.toggle("hidden", !state.bootCanContinueWithoutScenario);
  }
  if (dom.readonlyBanner) {
    dom.readonlyBanner.classList.toggle("hidden", state.bootBlocking || !state.startupReadonly);
    dom.readonlyBanner.setAttribute("aria-busy", state.startupReadonlyUnlockInFlight ? "true" : "false");
  }
  if (dom.readonlyMessage) {
    dom.readonlyMessage.textContent = getStartupReadonlyMessage();
  }
}

function initializeBootOverlay() {
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
}

function setBootState(
  phase,
  {
    message = null,
    progress = undefined,
    blocking = null,
    error = null,
    canContinueWithoutScenario = null,
  } = {}
) {
  const previousPhase = String(state.bootPhase || "");
  state.bootPhase = phase;
  state.bootMessage = message ?? getBootCopy(phase).message;
  state.bootBlocking = blocking == null ? phase !== "ready" : !!blocking;
  state.bootError = phase === "error" ? String(error || state.bootError || "") : "";
  state.bootCanContinueWithoutScenario =
    canContinueWithoutScenario == null
      ? (phase === "error" ? !!state.bootCanContinueWithoutScenario : false)
      : !!canContinueWithoutScenario;
  const window = getBootProgressWindow(phase);
  if (phase !== previousPhase) {
    bootProgressPhaseStartedAt = nowMs();
  }
  if (phase === "ready" || phase === "error") {
    state.bootPreviewVisible = false;
  }
  if (progress !== undefined) {
    state.bootProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  } else if (phase === "ready") {
    state.bootProgress = 100;
  } else if (phase === "error") {
    state.bootProgress = Math.max(window.min, Math.min(99, Number(state.bootProgress) || window.min));
  } else {
    state.bootProgress = Math.max(Number(state.bootProgress) || 0, window.min);
  }
  if (phase === "ready" || phase === "error") {
    stopBootProgressAnimation();
  } else {
    startBootProgressAnimation();
  }
  syncBootOverlay();
}

function resetBootMetrics() {
  state.bootMetrics = {
    total: {
      startedAt: nowMs(),
    },
  };
}

function startBootMetric(name) {
  state.bootMetrics[name] = {
    ...(state.bootMetrics[name] || {}),
    startedAt: nowMs(),
  };
}

function finishBootMetric(name, extra = {}) {
  const finishedAt = nowMs();
  const metric = {
    ...(state.bootMetrics[name] || {}),
    finishedAt,
    ...extra,
  };
  if (Number.isFinite(metric.startedAt)) {
    metric.durationMs = finishedAt - metric.startedAt;
  }
  state.bootMetrics[name] = metric;
  return metric;
}

function checkpointBootMetric(name) {
  const startedAt = Number(state.bootMetrics?.total?.startedAt);
  state.bootMetrics[name] = {
    atMs: Number.isFinite(startedAt) ? nowMs() - startedAt : 0,
  };
  return state.bootMetrics[name];
}

function checkpointBootMetricOnce(name) {
  if (state.bootMetrics?.[name]) {
    return state.bootMetrics[name];
  }
  return checkpointBootMetric(name);
}

function logBootMetrics() {
  const summary = Object.entries(state.bootMetrics || {}).reduce((accumulator, [name, metric]) => {
    if (Number.isFinite(metric?.durationMs)) {
      accumulator[name] = `${metric.durationMs.toFixed(1)}ms`;
      return accumulator;
    }
    if (Number.isFinite(metric?.atMs)) {
      accumulator[name] = `${metric.atMs.toFixed(1)}ms`;
    }
    return accumulator;
  }, {});
  console.info("[boot] Startup metrics:", summary);
}

function completeBootSequenceLogging() {
  if (bootMetricsLogged) {
    return;
  }
  bootMetricsLogged = true;
  finishBootMetric("total");
  logBootMetrics();
  console.log("Initial render complete.");
}

function yieldToMain() {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function loadDeferredMilsymbol() {
  if (globalThis.ms?.Symbol) {
    return Promise.resolve(true);
  }
  if (milsymbolLoadPromise) {
    return milsymbolLoadPromise;
  }
  if (typeof document === "undefined") {
    return Promise.resolve(false);
  }

  const existingScript = Array.from(document.scripts || []).find((script) => (
    String(script?.src || "").endsWith("/vendor/milsymbol.js")
    || String(script?.getAttribute?.("src") || "").trim() === "vendor/milsymbol.js"
  ));
  if (existingScript) {
    milsymbolLoadPromise = new Promise((resolve) => {
      const finalize = (loaded) => resolve(loaded && !!globalThis.ms?.Symbol);
      existingScript.addEventListener("load", () => finalize(true), { once: true });
      existingScript.addEventListener("error", () => finalize(false), { once: true });
      if (globalThis.ms?.Symbol) {
        finalize(true);
      }
    });
    return milsymbolLoadPromise;
  }

  milsymbolLoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "vendor/milsymbol.js";
    script.async = true;
    script.onload = () => resolve(!!globalThis.ms?.Symbol);
    script.onerror = () => {
      console.warn("[boot] Failed to load deferred milsymbol renderer.");
      resolve(false);
    };
    document.body?.appendChild(script);
  });
  return milsymbolLoadPromise;
}

function bootstrapDeferredUi(renderApp) {
  if (deferredUiBootstrapPromise) {
    return deferredUiBootstrapPromise;
  }
  deferredUiBootstrapPromise = (async () => {
    const [
      { initToolbar },
      { initSidebar },
      { initScenarioControls },
      { initShortcuts },
    ] = await Promise.all([
      import("./ui/toolbar.js"),
      import("./ui/sidebar.js"),
      import("./ui/scenario_controls.js"),
      import("./ui/shortcuts.js"),
    ]);
    await yieldToMain();
    initToolbar({ render: renderApp });
    await yieldToMain();
    initSidebar({ render: renderApp });
    await yieldToMain();
    initScenarioControls();
    initTranslations();
    initShortcuts();
    return true;
  })().catch((error) => {
    deferredUiBootstrapPromise = null;
    throw error;
  });
  return deferredUiBootstrapPromise;
}

async function ensureBaseCityDataReady({ reason = "manual", renderNow = true } = {}) {
  if (state.worldCitiesData && state.baseCityDataState === "loaded") {
    if (renderNow) {
      requestMainRender(`base-city-ready:${reason}`, { flush: true });
    }
    return state.worldCitiesData;
  }
  if (state.baseCityDataPromise) {
    return state.baseCityDataPromise;
  }
  state.baseCityDataState = "loading";
  state.baseCityDataError = "";
  const promise = loadCitySupportData({
    d3Client: globalThis.d3,
    locales: {
      ui: state.locales?.ui || {},
      geo: state.baseGeoLocales && typeof state.baseGeoLocales === "object"
        ? state.baseGeoLocales
        : (state.locales?.geo || {}),
    },
    geoAliases: {
      alias_to_stable_key: state.baseGeoAliasToStableKey && typeof state.baseGeoAliasToStableKey === "object"
        ? state.baseGeoAliasToStableKey
        : (state.geoAliasToStableKey || {}),
    },
  })
    .then((result) => {
      state.worldCitiesData = result.worldCities || null;
      state.baseCityAliasesData = result.cityAliases || null;
      state.baseGeoLocales = {
        ...(
          result.locales?.geo && typeof result.locales.geo === "object"
            ? result.locales.geo
            : (state.baseGeoLocales || {})
        ),
      };
      state.baseGeoAliasToStableKey = {
        ...(
          result.geoAliases?.alias_to_stable_key && typeof result.geoAliases.alias_to_stable_key === "object"
            ? result.geoAliases.alias_to_stable_key
            : (state.baseGeoAliasToStableKey || {})
        ),
      };
      if (state.activeScenarioId) {
        syncScenarioLocalizationState({
          cityOverridesPayload: state.scenarioCityOverridesData,
          geoLocalePatchPayload: state.scenarioGeoLocalePatchData,
        });
      } else {
        state.locales = {
          ...(state.locales || {}),
          geo: { ...state.baseGeoLocales },
        };
        state.geoAliasToStableKey = { ...state.baseGeoAliasToStableKey };
        state.cityLayerRevision = (Number(state.cityLayerRevision) || 0) + 1;
      }
      state.baseCityDataState = "loaded";
      state.baseCityDataPromise = null;
      if (typeof state.updateDevWorkspaceUIFn === "function") {
        state.updateDevWorkspaceUIFn();
      }
      if (renderNow) {
        requestMainRender(`base-city-loaded:${reason}`, { flush: true });
      }
      console.info(`[boot] Base city support data loaded on demand. reason=${reason}`);
      return state.worldCitiesData;
    })
    .catch((error) => {
      state.baseCityDataState = "error";
      state.baseCityDataError = error?.message || String(error || "Unknown city data loading error.");
      state.baseCityDataPromise = null;
      console.warn(`[boot] Failed to load base city support data. reason=${reason}`, error);
      throw error;
    });
  state.baseCityDataPromise = promise;
  return promise;
}

async function ensureFullLocalizationDataReady({ reason = "post-ready", renderNow = true } = {}) {
  if (state.baseLocalizationLevel === "full" && state.baseLocalizationDataState === "loaded") {
    return {
      locales: state.locales,
      geoAliases: { alias_to_stable_key: state.geoAliasToStableKey || {} },
    };
  }
  if (state.baseLocalizationDataPromise) {
    return state.baseLocalizationDataPromise;
  }
  state.baseLocalizationDataState = "loading";
  state.baseLocalizationDataError = "";
  startBootMetric("localization:full:load");
  const promise = loadLocalizationData({
    d3Client: globalThis.d3,
    localeLevel: "full",
  })
    .then((result) => {
      const fullBaseGeoLocales =
        result.locales?.geo && typeof result.locales.geo === "object"
          ? { ...result.locales.geo }
          : {};
      const fullUiLocales =
        result.locales?.ui && typeof result.locales.ui === "object"
          ? { ...result.locales.ui }
          : (state.locales?.ui || {});
      const fullBaseAliasMap =
        result.geoAliases?.alias_to_stable_key && typeof result.geoAliases.alias_to_stable_key === "object"
          ? { ...result.geoAliases.alias_to_stable_key }
          : {};
      if (state.worldCitiesData || state.baseCityAliasesData) {
        const cityPatch = buildCityLocalizationPatch({
          cityCollection: state.worldCitiesData || null,
          cityAliases: state.baseCityAliasesData || null,
        });
        Object.assign(fullBaseGeoLocales, cityPatch.geo || {});
        Object.assign(fullBaseAliasMap, cityPatch.aliasToStableKey || {});
      }
      state.baseGeoLocales = fullBaseGeoLocales;
      state.baseGeoAliasToStableKey = fullBaseAliasMap;
      state.baseLocalizationLevel = "full";
      state.locales = {
        ...(state.locales || {}),
        ui: fullUiLocales,
      };
      if (state.activeScenarioId) {
        syncScenarioLocalizationState({
          cityOverridesPayload: state.scenarioCityOverridesData,
          geoLocalePatchPayload: state.scenarioGeoLocalePatchData,
        });
      } else {
        state.locales = {
          ...(state.locales || {}),
          ui: fullUiLocales,
          geo: { ...state.baseGeoLocales },
        };
        state.geoAliasToStableKey = { ...state.baseGeoAliasToStableKey };
      }
      state.baseLocalizationDataState = "loaded";
      state.baseLocalizationDataError = "";
      state.baseLocalizationDataPromise = null;
      finishBootMetric("localization:full:load", {
        reason,
        resourceMetrics: result.resourceMetrics || {},
      });
      if (typeof state.updateDevWorkspaceUIFn === "function") {
        state.updateDevWorkspaceUIFn();
      }
      if (renderNow) {
        requestMainRender(`localization-full-ready:${reason}`, { flush: true });
      }
      return result;
    })
    .catch((error) => {
      state.baseLocalizationDataState = "error";
      state.baseLocalizationDataError = error?.message || String(error || "Unknown localization hydration error.");
      state.baseLocalizationDataPromise = null;
      finishBootMetric("localization:full:load", {
        reason,
        failed: true,
        errorMessage: state.baseLocalizationDataError,
      });
      console.warn(`[boot] Failed to hydrate full localization data. reason=${reason}`, error);
      throw error;
    });
  state.baseLocalizationDataPromise = promise;
  return promise;
}

state.ensureFullLocalizationDataReadyFn = ensureFullLocalizationDataReady;

async function ensureActiveScenarioBundleHydrated({ reason = "post-ready", renderNow = true } = {}) {
  const scenarioId = String(state.activeScenarioId || "").trim();
  if (!scenarioId) return null;
  startBootMetric("scenario:full:hydrate");
  try {
    const bundle = await loadScenarioBundle(scenarioId, {
      d3Client: globalThis.d3,
      bundleLevel: "full",
    });
    hydrateActiveScenarioBundle(bundle, { renderNow });
    const healthGateResult = await enforceScenarioHydrationHealthGate({
      renderNow,
      reason,
      autoRetry: true,
    });
    finishBootMetric("scenario:full:hydrate", {
      reason,
      bundleLevel: bundle?.bundleLevel || "full",
      healthGateOk: healthGateResult?.ok !== false,
      healthGateRetried: !!healthGateResult?.attemptedRetry,
      ownerFeatureOverlapRatio: Number(healthGateResult?.report?.overlapRatio || 0),
      ownerFeatureOverlapCount: Number(healthGateResult?.report?.overlapCount || 0),
      ownerFeatureRenderedCount: Number(healthGateResult?.report?.renderedFeatureCount || 0),
      waterConsistency: String(healthGateResult?.waterConsistency?.reason || "unknown"),
    });
    return bundle;
  } catch (error) {
    finishBootMetric("scenario:full:hydrate", {
      reason,
      failed: true,
      errorMessage: error?.message || String(error || "Unknown scenario hydration error."),
    });
    console.warn(`[boot] Failed to hydrate active scenario bundle. reason=${reason}`, error);
    throw error;
  }
}

function schedulePostReadyHydration() {
  if (postReadyHydrationScheduled) {
    return;
  }
  postReadyHydrationScheduled = true;
  scheduleIdleTask(() => (
    ensureFullLocalizationDataReady({ reason: "post-ready-idle", renderNow: true }).catch((error) => {
      console.warn("[boot] Deferred full localization hydration failed during idle scheduling.", error);
      return null;
    })
  ), {
    timeout: 2200,
    delayMs: 1200,
  });
  scheduleIdleTask(() => (
    ensureActiveScenarioBundleHydrated({ reason: "post-ready-idle", renderNow: true }).catch((error) => {
      console.warn("[boot] Deferred full scenario hydration failed during idle scheduling.", error);
      return null;
    })
  ), {
    timeout: 4800,
    delayMs: 4200,
  });
}

function expandDeferredContextLayerNames(requestedLayerNames) {
  const requested = Array.isArray(requestedLayerNames) ? requestedLayerNames : [requestedLayerNames];
  const expanded = requested.flatMap((name) => {
    const normalized = String(name || "").trim().toLowerCase();
    if (!normalized) return [];
    if (normalized === "physical-set") {
      return PHYSICAL_CONTEXT_LAYER_SET;
    }
    return [normalized];
  });
  const normalized = normalizeRequestedContextLayerNames(expanded);
  return normalized.sort((left, right) => {
    const leftIndex = CONTEXT_LAYER_LOAD_ORDER.indexOf(left);
    const rightIndex = CONTEXT_LAYER_LOAD_ORDER.indexOf(right);
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
  });
}

function updateContextLayerDerivedState(layerName, collection) {
  state.contextLayerExternalDataByName = {
    ...(state.contextLayerExternalDataByName || {}),
    [layerName]: collection,
  };
  if (layerName === "rivers") {
    state.riversData = collection;
  } else if (layerName === "airports") {
    state.airportsData = collection;
  } else if (layerName === "ports") {
    state.portsData = collection;
  } else if (layerName === "urban") {
    state.urbanData = collection;
  } else if (layerName === "physical") {
    state.physicalData = collection;
  } else if (layerName === "physical_semantics") {
    state.physicalSemanticsData = collection;
  } else if (layerName === "physical_contours_major") {
    state.physicalContourMajorData = collection;
  } else if (layerName === "physical_contours_minor") {
    state.physicalContourMinorData = collection;
  }
}

function topologyAlreadyProvidesContextLayer(layerName) {
  const primaryTopology = state.topologyPrimary || state.topology;
  const detailTopology = state.topologyDetail;
  return Boolean(
    primaryTopology?.objects?.[layerName]
    || detailTopology?.objects?.[layerName]
  );
}

async function ensureContextLayerDataReady(
  requestedLayerNames,
  { reason = "manual", renderNow = true } = {}
) {
  const layerNames = expandDeferredContextLayerNames(requestedLayerNames);
  const results = {};
  const pendingEntries = [];
  for (const layerName of layerNames) {
    if (Array.isArray(state.contextLayerExternalDataByName?.[layerName]?.features)) {
      results[layerName] = state.contextLayerExternalDataByName[layerName];
      continue;
    }
    if (topologyAlreadyProvidesContextLayer(layerName)) {
      state.contextLayerLoadStateByName[layerName] = "loaded";
      results[layerName] = null;
      continue;
    }
    if (state.contextLayerLoadPromiseByName?.[layerName]) {
      pendingEntries.push({
        layerName,
        promise: state.contextLayerLoadPromiseByName[layerName],
      });
      continue;
    }
    state.contextLayerLoadStateByName[layerName] = "loading";
    state.contextLayerLoadErrorByName[layerName] = "";
    startBootMetric(`layer:${layerName}:load`);
    const promise = loadContextLayerPack(layerName, globalThis.d3)
      .then((collection) => {
        if (!Array.isArray(collection?.features)) {
          state.contextLayerLoadStateByName[layerName] = "error";
          state.contextLayerLoadErrorByName[layerName] = `Deferred context layer "${layerName}" is unavailable.`;
          finishBootMetric(`layer:${layerName}:load`, {
            failed: true,
            reason,
          });
          return null;
        }
        updateContextLayerDerivedState(layerName, collection);
        state.contextLayerRevision = (Number(state.contextLayerRevision) || 0) + 1;
        state.contextLayerLoadStateByName[layerName] = "loaded";
        finishBootMetric(`layer:${layerName}:load`, {
          featureCount: collection.features.length,
          reason,
        });
        return collection;
      })
      .catch((error) => {
        state.contextLayerLoadStateByName[layerName] = "error";
        state.contextLayerLoadErrorByName[layerName] = error?.message || String(error || "Unknown context layer error.");
        finishBootMetric(`layer:${layerName}:load`, {
          failed: true,
          reason,
        });
        console.warn(`[boot] Deferred context layer failed to load: ${layerName}. reason=${reason}`, error);
        return null;
      })
      .finally(() => {
        delete state.contextLayerLoadPromiseByName[layerName];
      });
    state.contextLayerLoadPromiseByName[layerName] = promise;
    pendingEntries.push({ layerName, promise });
  }

  if (pendingEntries.length) {
    const settled = await Promise.allSettled(pendingEntries.map(({ promise }) => promise));
    const loadedLayerNames = [];
    settled.forEach((entry, index) => {
      const { layerName } = pendingEntries[index];
      const value = entry.status === "fulfilled" ? entry.value : null;
      results[layerName] = value;
      if (Array.isArray(value?.features)) {
        loadedLayerNames.push(layerName);
      }
    });
    if (loadedLayerNames.length) {
      invalidateContextLayerVisualStateBatch(loadedLayerNames, `context-layer:${reason}`, {
        renderNow,
      });
      if (renderNow) {
        loadedLayerNames.forEach((layerName) => {
          checkpointBootMetric(`layer:${layerName}:first-render-after-load`);
        });
      }
    }
  }
  return results;
}

function scheduleIdleTask(callback, { timeout = 1200, delayMs = 0 } = {}) {
  const run = () => {
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(() => {
        void callback();
      }, { timeout });
      return;
    }
    globalThis.setTimeout(() => {
      void callback();
    }, 0);
  };
  globalThis.setTimeout(run, Math.max(0, delayMs));
}

function schedulePostReadyVisualWarmup() {
  const textureMode = String(state.styleConfig?.texture?.mode || "none").trim().toLowerCase();
  const dayNightEnabled = !!state.styleConfig?.dayNight?.enabled;
  if (textureMode === "none" && !dayNightEnabled) {
    return;
  }
  globalThis.requestAnimationFrame?.(() => {
    if (!state.bootBlocking) {
      requestMainRender("post-ready-visual-warmup");
    }
  });
}

function schedulePostReadyDeferredContextWarmup() {
  if (state.bootBlocking || postReadyContextWarmupScheduled) {
    return;
  }
  const requestedLayerNames = [];
  if (state.showRivers) {
    requestedLayerNames.push("rivers");
  }
  if (state.showAirports) {
    requestedLayerNames.push("airports");
  }
  if (state.showPorts) {
    requestedLayerNames.push("ports");
  }
  if (state.showUrban) {
    requestedLayerNames.push("urban");
  }
  if (state.showPhysical) {
    requestedLayerNames.push("physical-set");
  }
  const shouldWarmCities =
    state.showCityPoints !== false
    && state.baseCityDataState === "idle"
    && typeof state.ensureBaseCityDataFn === "function";
  if (!requestedLayerNames.length && !shouldWarmCities) {
    return;
  }
  postReadyContextWarmupScheduled = true;
  scheduleIdleTask(async () => {
    if (state.bootBlocking) {
      return;
    }
    const tasks = [];
    if (requestedLayerNames.length) {
      tasks.push(ensureContextLayerDataReady(requestedLayerNames, {
        reason: "post-ready",
        renderNow: true,
      }));
    }
    if (shouldWarmCities && state.baseCityDataState === "idle" && typeof state.ensureBaseCityDataFn === "function") {
      tasks.push(state.ensureBaseCityDataFn({ reason: "post-ready", renderNow: true }));
    }
    await Promise.allSettled(tasks);
  }, {
    timeout: 1000,
    delayMs: 120,
  });
}

function schedulePostReadyCityWarmup() {
  if (
    state.bootBlocking
    || state.showCityPoints === false
    || state.baseCityDataState !== "idle"
    || typeof state.ensureBaseCityDataFn !== "function"
  ) {
    return;
  }
  const run = () => {
    if (state.bootBlocking || state.baseCityDataState !== "idle") {
      return;
    }
    void state.ensureBaseCityDataFn({ reason: "post-ready", renderNow: true }).catch(() => {});
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(() => {
      run();
    }, { timeout: 2200 });
  } else {
    globalThis.setTimeout(run, 900);
  }
}

function hasDetailTopologyLoaded() {
  return !!state.topologyDetail?.objects?.political;
}

async function ensureDetailTopologyReady({
  renderDispatcher = null,
  requireIdle = false,
  applyMapData = true,
} = {}) {
  if (hasDetailTopologyLoaded()) {
    if (state.topologyBundleMode !== "composite") {
      state.topologyBundleMode = "composite";
      if (applyMapData) {
        setMapData({ refitProjection: false, resetZoom: false });
        if (renderDispatcher?.schedule) {
          renderDispatcher.schedule();
        } else {
          requestMainRender("detail-topology-ready");
        }
      }
    }
    state.detailDeferred = false;
    state.detailPromotionCompleted = true;
    return true;
  }

  if (state.detailPromotionInFlight) return false;
  if (requireIdle && (state.isInteracting || state.renderPhase !== "idle")) {
    return false;
  }

  state.detailPromotionInFlight = true;
  try {
    const {
      topologyDetail,
      runtimePoliticalTopology,
      topologyBundleMode,
      detailSourceUsed,
    } = await loadDeferredDetailBundle({
      detailSourceKey: state.detailSourceRequested,
    });

    if (!topologyDetail) {
      state.detailDeferred = false;
      console.warn("[main] Detail promotion skipped: no detail topology was loaded.");
      return false;
    }

    state.topologyDetail = topologyDetail;
    state.runtimePoliticalTopology = runtimePoliticalTopology || state.runtimePoliticalTopology;
    if (!state.activeScenarioId) {
      state.defaultRuntimePoliticalTopology = state.runtimePoliticalTopology || null;
    }
    state.topologyBundleMode = topologyBundleMode || "composite";
    state.detailDeferred = false;
    state.detailPromotionCompleted = true;
    state.detailSourceRequested = detailSourceUsed || state.detailSourceRequested;

    console.info(
      `[main] Detail promotion applied. source=${state.detailSourceRequested}, mode=${state.topologyBundleMode}.`
    );
    if (applyMapData) {
      setMapData({ refitProjection: false, resetZoom: false });
      if (renderDispatcher?.schedule) {
        renderDispatcher.schedule();
      } else {
        requestMainRender("detail-topology-promoted");
      }
    }
    return true;
  } catch (error) {
    console.warn("[main] Detail promotion failed:", error);
    return false;
  } finally {
    state.detailPromotionInFlight = false;
  }
}

async function unlockStartupReadonlyWithDetail(renderDispatcher) {
  if (!state.startupReadonly || state.startupReadonlyUnlockInFlight) {
    return false;
  }
  setStartupReadonlyState(true, {
    reason: "detail-promotion",
    unlockInFlight: true,
  });
  startBootMetric("startup-readonly:unlock");
  startBootMetric("detail-promotion");
  setBootState("detail-promotion", {
    blocking: true,
    canContinueWithoutScenario: false,
  });
  try {
    const promoted = await ensureDetailTopologyReady({
      renderDispatcher,
      requireIdle: false,
      applyMapData: false,
    });
    const detailReady = promoted || hasDetailTopologyLoaded();
    if (!detailReady) {
      finishBootMetric("detail-promotion", {
        failed: true,
      });
      finishBootMetric("startup-readonly:unlock", {
        failed: true,
      });
      setStartupReadonlyState(true, {
        reason: "detail-promotion-failed",
        unlockInFlight: false,
      });
      return false;
    }
    finishBootMetric("detail-promotion", {
      activeScenarioId: String(state.activeScenarioId || ""),
    });
    setMapData({
      refitProjection: false,
      resetZoom: false,
      suppressRender: true,
      interactionLevel: "full",
      deferInteractionInfrastructure: true,
    });
    const activeScenarioId = String(state.activeScenarioId || "").trim();
    if (activeScenarioId) {
      const cachedBundle = state.scenarioBundleCacheById?.[activeScenarioId] || null;
      if (cachedBundle?.manifest) {
        await applyScenarioBundleCommand(cachedBundle, {
          renderMode: "none",
          suppressRender: true,
          markDirtyReason: "",
          showToastOnComplete: false,
          interactionLevel: "full",
        });
        warnOnStartupBundleIntegrity(cachedBundle, {
          source: cachedBundle?.loadDiagnostics?.startupBundle ? "startup-bundle" : "legacy",
        });
      }
    }
    renderDispatcher?.flush?.();
    setBootState("interaction-infra", {
      blocking: true,
      canContinueWithoutScenario: false,
    });
    startBootMetric("interaction-infra");
    await buildInteractionInfrastructureAfterStartup({
      chunked: true,
      buildHitCanvas: false,
    });
    finishBootMetric("interaction-infra", {
      activeScenarioId,
    });
    finishBootMetric("startup-readonly:unlock", {
      activeScenarioId,
    });
    setStartupReadonlyState(false);
    checkpointBootMetric("startup-readonly:unlocked");
    checkpointBootMetric("time-to-interactive");
    checkpointBootMetric("first-interactive");
    setBootState("ready", {
      blocking: false,
      progress: 100,
      canContinueWithoutScenario: false,
    });
    completeBootSequenceLogging();
    schedulePostReadyHydration();
    schedulePostReadyDeferredContextWarmup();
    schedulePostReadyVisualWarmup();
    return true;
  } catch (error) {
    finishBootMetric("detail-promotion", {
      failed: true,
      errorMessage: error?.message || String(error || "Unknown detail promotion error."),
    });
    finishBootMetric("interaction-infra", {
      failed: true,
      errorMessage: error?.message || String(error || "Unknown interaction infrastructure error."),
    });
    finishBootMetric("startup-readonly:unlock", {
      failed: true,
      errorMessage: error?.message || String(error || "Unknown startup readonly unlock error."),
    });
    console.warn("[boot] Startup readonly unlock failed:", error);
    setStartupReadonlyState(true, {
      reason: "detail-promotion-failed",
      unlockInFlight: false,
    });
    return false;
  }
}

function scheduleStartupReadonlyUnlock(
  renderDispatcher,
  { delayMs = 120, attempt = 0, maxAttempts = 5 } = {},
) {
  if (!state.startupReadonly || state.startupReadonlyUnlockInFlight || startupReadonlyUnlockHandle !== null) {
    return;
  }
  if (attempt >= maxAttempts) {
    console.warn(`[boot] Startup readonly unlock failed after ${maxAttempts} attempts, force-unlocking.`);
    setStartupReadonlyState(false);
    setBootState("ready", {
      blocking: false,
      progress: 100,
      canContinueWithoutScenario: false,
    });
    checkpointBootMetric("time-to-interactive");
    checkpointBootMetric("first-interactive");
    completeBootSequenceLogging();
    scheduleDeferredDetailPromotion(renderDispatcher);
    schedulePostReadyHydration();
    schedulePostReadyDeferredContextWarmup();
    schedulePostReadyVisualWarmup();
    return;
  }
  startupReadonlyUnlockHandle = globalThis.setTimeout(() => {
    startupReadonlyUnlockHandle = null;
    void unlockStartupReadonlyWithDetail(renderDispatcher).then((unlocked) => {
      if (!unlocked && state.startupReadonly) {
        scheduleStartupReadonlyUnlock(renderDispatcher, {
          delayMs: 1600,
          attempt: attempt + 1,
          maxAttempts,
        });
      }
    });
  }, Math.max(0, delayMs));
}

function scheduleDeferredDetailPromotion(renderDispatcher) {
  if (
    !state.detailDeferred ||
    state.detailPromotionCompleted ||
    state.detailPromotionInFlight ||
    deferredPromotionHandle !== null
  ) {
    return;
  }

  const runPromotion = async () => {
    deferredPromotionHandle = null;
    if (!state.detailDeferred || state.detailPromotionCompleted || state.detailPromotionInFlight) {
      return;
    }
    const promoted = await ensureDetailTopologyReady({
      renderDispatcher,
      requireIdle: true,
    });
    if (!promoted && (state.isInteracting || state.renderPhase !== "idle")) {
      scheduleDeferredDetailPromotion(renderDispatcher);
    }
  };

  const delayMs = getDeferredPromotionDelay(state.renderProfile);
  if (typeof globalThis.requestIdleCallback === "function") {
    deferredPromotionHandle = globalThis.requestIdleCallback(() => {
      void runPromotion();
    }, { timeout: Math.max(600, delayMs) });
  } else {
    deferredPromotionHandle = globalThis.setTimeout(() => {
      void runPromotion();
    }, delayMs);
  }
}

async function finalizeReadyState(renderDispatcher) {
  const shouldEnterStartupReadonly = (
    !!String(state.activeScenarioId || "").trim()
    && state.startupInteractionMode === "readonly"
    && state.detailDeferred
    && !hasDetailTopologyLoaded()
  );
  const startupBootstrapStrategy = String(
    state.activeScenarioManifest?.startup_bootstrap_strategy || ""
  ).trim();
  const shouldUseChunkedCoarseStartup =
    shouldEnterStartupReadonly
    && startupBootstrapStrategy === "chunked-coarse-first";
  if (shouldUseChunkedCoarseStartup) {
    setBootState("interaction-infra", {
      blocking: true,
      progress: Math.max(Number(state.bootProgress) || 0, BOOT_PHASE_WINDOWS["detail-promotion"].min),
      canContinueWithoutScenario: false,
    });
    startBootMetric("interaction-infra");
    await buildInteractionInfrastructureAfterStartup({
      chunked: true,
      buildHitCanvas: false,
    });
    finishBootMetric("interaction-infra", {
      activeScenarioId: String(state.activeScenarioId || ""),
      startupBootstrapStrategy,
    });
    setStartupReadonlyState(false);
    setBootState("ready", {
      blocking: false,
      progress: 100,
      canContinueWithoutScenario: false,
    });
    checkpointBootMetric("time-to-interactive");
    checkpointBootMetric("first-interactive");
    completeBootSequenceLogging();
    scheduleDeferredDetailPromotion(renderDispatcher);
    schedulePostReadyHydration();
    schedulePostReadyDeferredContextWarmup();
    schedulePostReadyVisualWarmup();
    return;
  }
  if (shouldEnterStartupReadonly) {
    setStartupReadonlyState(true, {
      reason: "detail-promotion",
      unlockInFlight: false,
    });
    setBootState("detail-promotion", {
      blocking: true,
      progress: Math.max(Number(state.bootProgress) || 0, BOOT_PHASE_WINDOWS["detail-promotion"].min),
      canContinueWithoutScenario: false,
    });
    scheduleStartupReadonlyUnlock(renderDispatcher);
    return;
  }
  setBootState("ready", {
    blocking: false,
    progress: 100,
    canContinueWithoutScenario: false,
  });
  checkpointBootMetric("time-to-interactive");
  checkpointBootMetric("first-interactive");
  completeBootSequenceLogging();
  scheduleDeferredDetailPromotion(renderDispatcher);
  schedulePostReadyHydration();
  schedulePostReadyDeferredContextWarmup();
  schedulePostReadyVisualWarmup();
}

async function bootstrap() {
  initializeBootOverlay();
  if (!globalThis.d3 || !globalThis.topojson) {
    console.error("D3/topojson not loaded. Ensure scripts are included before main.js.");
    setBootState("error", {
      error: "D3/topojson not loaded. Ensure scripts are included before main.js.",
      canContinueWithoutScenario: false,
      progress: 0,
    });
    return;
  }

  hydrateLanguage();
  resetBootMetrics();
  state.bootPreviewVisible = false;
  setBootState("shell", {
    progress: BOOT_PHASE_WINDOWS.shell.min,
    canContinueWithoutScenario: false,
  });
  bootContinueHandler = null;
  bootMetricsLogged = false;
  deferredUiBootstrapPromise = null;
  postReadyContextWarmupScheduled = false;
  postReadyHydrationScheduled = false;
  state.startupInteractionMode = resolveStartupInteractionMode();
  setStartupReadonlyState(false);

  let renderDispatcher = null;
  try {
    bindBeforeUnload();
    setBootState("base-data");
    startBootMetric("base-data");
    const d3Client = globalThis.d3;
    const configuredDefaultScenarioId = getConfiguredDefaultScenarioId();
    const scenarioRegistryPromise = configuredDefaultScenarioId
      ? Promise.resolve(null)
      : loadScenarioRegistry({ d3Client });
    const registryDefaultScenarioIdPromise = configuredDefaultScenarioId
      ? Promise.resolve(configuredDefaultScenarioId)
      : scenarioRegistryPromise.then((registry) => {
        const defaultScenarioId = String(registry?.default_scenario_id || "").trim();
        if (!defaultScenarioId) {
          throw new Error("Default scenario is not configured in data/scenarios/index.json.");
        }
        return defaultScenarioId;
      });
    const requestedDefaultScenarioIdPromise = configuredDefaultScenarioId
      ? Promise.resolve(configuredDefaultScenarioId)
      : registryDefaultScenarioIdPromise;
    const startupBundleLanguage = getStartupBundleLanguage();
    startBootMetric("scenario-bundle");
    const startupBundleResultPromise = requestedDefaultScenarioIdPromise
      .then(async (defaultScenarioId) => {
        const startupBundleUrl = getStartupBundleUrl(defaultScenarioId, startupBundleLanguage);
        if (!startupBundleUrl) {
          throw new Error("Default startup scenario bundle URL could not be resolved.");
        }
        const startupBundleResult = await loadStartupBundleViaWorker({
          startupBundleUrl,
          scenarioId: defaultScenarioId,
          language: startupBundleLanguage,
        });
        if (!startupBundleResult.payload) {
          throw new Error(`Startup bundle "${startupBundleUrl}" did not return a payload.`);
        }
        const loadDiagnostics = createStartupBundleLoadDiagnostics({
          startupBundleUrl,
          language: startupBundleLanguage,
          metrics: startupBundleResult.metrics,
        });
        const startupScenarioBundle = createStartupScenarioBundleFromPayload({
          scenarioId: defaultScenarioId,
          language: startupBundleLanguage,
          payload: startupBundleResult.payload,
          runtimeDecodedCollections: startupBundleResult.runtimeDecodedCollections,
          runtimePoliticalMeta: startupBundleResult.runtimePoliticalMeta,
          loadDiagnostics,
        });
        const runtimeShellContract = validateScenarioRuntimeShellContract({
          runtimeTopologyPayload: startupScenarioBundle.runtimeTopologyPayload,
          runtimePoliticalMeta: startupScenarioBundle.runtimePoliticalMeta,
        });
        if (
          String(startupScenarioBundle.bootstrapStrategy || "").trim() === "chunked-coarse-first"
          && !runtimeShellContract.ok
        ) {
          throw new Error(
            `[boot] Startup bundle for "${defaultScenarioId}" is missing the minimum runtime shell (${formatStartupRuntimeShellContractFailure(runtimeShellContract)}).`
          );
        }
        return {
          ok: true,
          scenarioId: defaultScenarioId,
          source: "startup-bundle",
          startupBundleUrl,
          startupBootArtifactsOverride: createStartupBootArtifactsOverride({
            payload: startupBundleResult.payload,
            baseDecodedCollections: startupBundleResult.baseDecodedCollections,
            metrics: startupBundleResult.metrics,
          }),
          bundle: startupScenarioBundle,
        };
      })
      .catch((error) => ({
        ok: false,
        source: "startup-bundle",
        error,
      }));
    const scenarioBundlePromise = requestedDefaultScenarioIdPromise
      .then(async (defaultScenarioId) => {
        const startupBundleResult = await startupBundleResultPromise;
        if (startupBundleResult.ok && startupBundleResult.bundle?.manifest) {
          return startupBundleResult;
        }
        if (startupBundleResult.error) {
          console.warn(
            `[boot] Startup bundle failed for "${defaultScenarioId}", falling back to legacy bootstrap bundle.`,
            startupBundleResult.error
          );
        }
        const bundle = await loadScenarioBundle(defaultScenarioId, {
          d3Client,
          bundleLevel: "bootstrap",
        });
        return {
          ok: true,
          scenarioId: defaultScenarioId,
          source: "legacy",
          bundle,
        };
      })
      .catch((error) => ({ ok: false, error }));
    const startupFallbackScenarioId = await requestedDefaultScenarioIdPromise;
    const {
      topology,
      topologyPrimary,
      topologyDetail,
      runtimePoliticalTopology,
      topologyBundleMode,
      renderProfile,
      detailDeferred,
      detailSourceRequested,
      locales,
      geoAliases,
      hierarchy,
      ruCityOverrides,
      specialZones,
      contextLayerExternal,
      paletteRegistry,
      releasableCatalog,
      activePaletteMeta,
      activePalettePack,
      activePaletteMap,
      localeLevel,
      startupBootCacheState,
      resourceMetrics,
      startupDecodedCollections,
    } = await loadMapData({
      d3Client,
      includeCityData: false,
      includeContextLayers: false,
      localeLevel: "startup",
      localesUrl: getStartupScenarioSupportUrl(startupFallbackScenarioId, "locales.startup.json"),
      geoAliasesUrl: getStartupScenarioSupportUrl(startupFallbackScenarioId, "geo_aliases.startup.json"),
      useStartupWorker: true,
      useStartupCache: true,
      startupBootArtifactsOverride: startupBundleResultPromise.then((result) => (
        result.ok ? result.startupBootArtifactsOverride : null
      )),
    });
    state.topology = topology || topologyPrimary || topologyDetail;
    state.topologyPrimary = topologyPrimary || state.topology;
    state.topologyDetail = topologyDetail || null;
    state.runtimePoliticalTopology = runtimePoliticalTopology || null;
    state.defaultRuntimePoliticalTopology = state.runtimePoliticalTopology || null;
    state.topologyBundleMode = topologyBundleMode || "single";
    state.renderProfile = renderProfile || "auto";
    state.detailDeferred = !!detailDeferred;
    state.detailSourceRequested = detailSourceRequested || "na_v2";
    state.detailPromotionInFlight = false;
    state.detailPromotionCompleted = !detailDeferred;
    state.locales = locales || { ui: {}, geo: {} };
    state.baseLocalizationLevel = localeLevel || "full";
    state.baseLocalizationDataState = state.baseLocalizationLevel === "full" ? "loaded" : "partial";
    state.baseLocalizationDataError = "";
    state.baseLocalizationDataPromise = null;
    state.baseGeoLocales = { ...(state.locales?.geo || {}) };
    state.geoAliasToStableKey = geoAliases?.alias_to_stable_key || {};
    state.baseGeoAliasToStableKey = { ...state.geoAliasToStableKey };
    state.startupBootCacheState = startupBootCacheState || state.startupBootCacheState;
    state.worldCitiesData = null;
    state.baseCityAliasesData = null;
    state.baseCityDataState = "idle";
    state.baseCityDataError = "";
    state.baseCityDataPromise = null;
    state.cityLayerRevision = (Number(state.cityLayerRevision) || 0) + 1;
    state.ruCityOverrides = ruCityOverrides || null;
    state.specialZonesExternalData = specialZones || null;
    state.contextLayerExternalDataByName = contextLayerExternal || {};
    state.contextLayerRevision = (Number(state.contextLayerRevision) || 0) + 1;
    state.contextLayerLoadStateByName = {
      rivers: "idle",
      urban: "idle",
      airports: "idle",
      ports: "idle",
      physical: "idle",
      physical_semantics: "idle",
      physical_contours_major: "idle",
      physical_contours_minor: "idle",
    };
    state.contextLayerLoadErrorByName = {};
    state.contextLayerLoadPromiseByName = {};
    state.physicalSemanticsData = null;
    state.physicalContourMajorData = null;
    state.physicalContourMinorData = null;
    state.airportsData = null;
    state.portsData = null;
    state.paletteRegistry = paletteRegistry || null;
    state.defaultReleasableCatalog = releasableCatalog || null;
    state.releasableCatalog = releasableCatalog || null;
    state.activePaletteMeta = activePaletteMeta || null;
    state.activePalettePack = activePalettePack || null;
    state.activePaletteMap = activePaletteMap || null;
    state.activePaletteId = String(
      activePaletteMeta?.palette_id
      || paletteRegistry?.default_palette_id
      || state.activePaletteId
      || "hoi4_vanilla"
    ).trim();
    state.currentPaletteTheme = String(
      activePaletteMeta?.display_name
      || state.currentPaletteTheme
      || "HOI4 Vanilla"
    );
    state.palettePackCacheById = state.palettePackCacheById || {};
    state.paletteMapCacheById = state.paletteMapCacheById || {};
    state.paletteLoadErrorById = state.paletteLoadErrorById || {};
    if (state.activePaletteId && activePalettePack) {
      state.palettePackCacheById[state.activePaletteId] = activePalettePack;
    }
    if (state.activePaletteId && activePaletteMap) {
      state.paletteMapCacheById[state.activePaletteId] = activePaletteMap;
    }
    applyActivePaletteState({ overwriteCountryPalette: true });
    processHierarchyData(hierarchy);
    hydrateViewSettings();
    state.persistViewSettingsFn = persistViewSettings;
    state.ensureBaseCityDataFn = ensureBaseCityDataReady;
    state.ensureContextLayerDataFn = ensureContextLayerDataReady;

    if (!state.topologyPrimary) {
      throw new Error("CRITICAL: TopoJSON file loaded but is null/undefined");
    }

    const objects = state.topologyPrimary.objects || {};
    if (!objects.political) {
      throw new Error("CRITICAL: 'political' object missing from TopoJSON");
    }
    const primaryCount = Array.isArray(objects.political.geometries)
      ? objects.political.geometries.length
      : 0;
    const detailCount =
      state.topologyDetail?.objects?.political?.geometries &&
      Array.isArray(state.topologyDetail.objects.political.geometries)
        ? state.topologyDetail.objects.political.geometries.length
        : 0;
    const overrideCount = Array.isArray(state.ruCityOverrides?.features)
      ? state.ruCityOverrides.features.length
      : 0;
    console.log(
      `[main] Loaded topology bundle mode=${state.topologyBundleMode}, primary=${primaryCount}, detail=${detailCount}, ruOverrides=${overrideCount}.`
    );

    const baseTopologyDecodeStartedAt = nowMs();
    state.landData =
      startupDecodedCollections?.landData
      || globalThis.topojson.feature(state.topologyPrimary, objects.political);

    if (state.specialZonesExternalData?.features) {
      state.specialZonesData = state.specialZonesExternalData;
    } else if (objects.special_zones) {
      state.specialZonesData = startupDecodedCollections?.specialZonesData
        || globalThis.topojson.feature(state.topologyPrimary, objects.special_zones);
    }
    if (objects.rivers) {
      state.riversData = startupDecodedCollections?.riversData
        || globalThis.topojson.feature(state.topologyPrimary, objects.rivers);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.rivers?.features)) {
      state.riversData = state.contextLayerExternalDataByName.rivers;
    }
    if (objects.water_regions) {
      state.waterRegionsData = startupDecodedCollections?.waterRegionsData
        || globalThis.topojson.feature(state.topologyPrimary, objects.water_regions);
    }
    if (objects.ocean) {
      state.oceanData = startupDecodedCollections?.oceanData
        || globalThis.topojson.feature(state.topologyPrimary, objects.ocean);
    }
    if (objects.land) {
      state.landBgData = startupDecodedCollections?.landBgData
        || globalThis.topojson.feature(state.topologyPrimary, objects.land);
    }
    if (objects.urban) {
      state.urbanData = startupDecodedCollections?.urbanData
        || globalThis.topojson.feature(state.topologyPrimary, objects.urban);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.urban?.features)) {
      state.urbanData = state.contextLayerExternalDataByName.urban;
    }
    if (objects.physical) {
      state.physicalData = startupDecodedCollections?.physicalData
        || globalThis.topojson.feature(state.topologyPrimary, objects.physical);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.physical?.features)) {
      state.physicalData = state.contextLayerExternalDataByName.physical;
    }
    const baseTopologyDecodeMs = nowMs() - baseTopologyDecodeStartedAt;
    finishBootMetric("base-data", {
      topologyBundleMode: state.topologyBundleMode,
      primaryCount,
      detailCount,
      topologyDecodeMs: baseTopologyDecodeMs,
      resourceMetrics: resourceMetrics || {},
    });
    const registryDefaultScenarioId = configuredDefaultScenarioId
      ? configuredDefaultScenarioId
      : await registryDefaultScenarioIdPromise;
    if (configuredDefaultScenarioId && registryDefaultScenarioId !== configuredDefaultScenarioId) {
      console.warn(
        `[boot] Configured default scenario "${configuredDefaultScenarioId}" differs from registry default "${registryDefaultScenarioId}".`
      );
    }
    initLongAnimationFrameObserver();
    const startupInteractionLevel = state.startupInteractionMode === "readonly" ? "readonly-startup" : "full";
    initMap({
      suppressRender: true,
      interactionLevel: startupInteractionLevel,
      deferInteractionInfrastructure: startupInteractionLevel === "readonly-startup",
    });
    setMapData({
      suppressRender: true,
      interactionLevel: startupInteractionLevel,
      deferInteractionInfrastructure: startupInteractionLevel === "readonly-startup",
    });

    renderDispatcher = createRenderDispatcher(render);
    const renderApp = () => {
      renderDispatcher.schedule();
    };
    globalThis.renderApp = renderApp;
    bindRenderBoundary({
      scheduleRender: () => renderDispatcher.schedule(),
      flushRender: () => renderDispatcher.flush(),
      ensureDetailTopology: (options = {}) =>
        ensureDetailTopologyReady({
          renderDispatcher,
          ...options,
        }),
    });
    const flushRenderNow = () => flushRenderBoundary("legacy-render-now");
    globalThis.renderNow = flushRenderNow;
    state.renderNowFn = flushRenderNow;
    state.ensureDetailTopologyFn = (options = {}) =>
      ensureDetailTopologyReady({
        renderDispatcher,
        ...options,
      });

    initToast();
    renderDispatcher.flush();
    checkpointBootMetricOnce("first-visible");
    checkpointBootMetricOnce("first-visible-base");
    setBootPreviewVisible(true);
    initPresetState();
    void loadDeferredMilsymbol();
    deferredUiBootstrapPromise = bootstrapDeferredUi(renderApp);

    setBootState("scenario-bundle");
    const scenarioBundleResult = await scenarioBundlePromise;
    if (!scenarioBundleResult.ok) {
      throw scenarioBundleResult.error;
    }
    let defaultScenarioBundle = scenarioBundleResult.bundle;
    let scenarioBundleSource = String(scenarioBundleResult.source || "legacy").trim() || "legacy";
    let startupRecoveryReason = "";
    if (!defaultScenarioBundle?.manifest) {
      throw new Error("Default scenario bundle did not include a manifest.");
    }
    finishBootMetric("scenario-bundle", {
      source: scenarioBundleResult.source || "legacy",
      requiresDetailTopology: false,
      expectedScenarioFeatureCount: Number(defaultScenarioBundle.manifest?.summary?.feature_count || 0),
      bundleLevel: defaultScenarioBundle?.bundleLevel || "bootstrap",
      resourceMetrics: defaultScenarioBundle?.loadDiagnostics?.optionalResources?.runtime_topology?.metrics
        ? {
          runtimeTopology: defaultScenarioBundle.loadDiagnostics.optionalResources.runtime_topology.metrics,
          geoLocalePatch: defaultScenarioBundle.loadDiagnostics.optionalResources.geo_locale_patch?.metrics || null,
          manifest: defaultScenarioBundle.loadDiagnostics.requiredResources?.manifest || null,
        }
        : {
          geoLocalePatch: defaultScenarioBundle?.loadDiagnostics?.optionalResources?.geo_locale_patch?.metrics || null,
          manifest: defaultScenarioBundle?.loadDiagnostics?.requiredResources?.manifest || null,
        },
    });

    await deferredUiBootstrapPromise;
    setBootState("scenario-apply");
    startBootMetric("scenario-apply");
    state.scenarioApplyInFlight = true;
    if (typeof state.updateScenarioUIFn === "function") {
      state.updateScenarioUIFn();
    }
    try {
      await applyScenarioBundleCommand(defaultScenarioBundle, {
        renderMode: "none",
        suppressRender: true,
        markDirtyReason: "",
        showToastOnComplete: false,
        interactionLevel: state.startupInteractionMode === "readonly" ? "readonly-startup" : "full",
      });
    } catch (startupApplyError) {
      if (scenarioBundleSource !== "startup-bundle") {
        throw startupApplyError;
      }
      startupRecoveryReason = String(startupApplyError?.message || "startup-bundle-apply-failed");
      console.warn(
        `[boot] Startup bundle apply failed for "${defaultScenarioBundle.manifest?.scenario_id || ""}", falling back to legacy bootstrap bundle.`,
        startupApplyError
      );
      defaultScenarioBundle = await loadScenarioBundle(String(defaultScenarioBundle.manifest?.scenario_id || ""), {
        d3Client,
        bundleLevel: "bootstrap",
        forceReload: true,
      });
      scenarioBundleSource = "legacy-bootstrap-recovery";
      await applyScenarioBundleCommand(defaultScenarioBundle, {
        renderMode: "none",
        suppressRender: true,
        markDirtyReason: "",
        showToastOnComplete: false,
        interactionLevel: state.startupInteractionMode === "readonly" ? "readonly-startup" : "full",
      });
    }
    warnOnStartupBundleIntegrity(defaultScenarioBundle, {
      source: scenarioBundleSource,
    });
    finishBootMetric("scenario-apply", {
      activeScenarioId: String(state.activeScenarioId || ""),
      source: scenarioBundleSource,
      startupRecoveryReason,
    });
    state.scenarioApplyInFlight = false;
    if (typeof state.updateScenarioUIFn === "function") {
      state.updateScenarioUIFn();
    }

    setBootState("warmup");
    renderDispatcher.flush();
    checkpointBootMetricOnce("first-visible-scenario");
    await finalizeReadyState(renderDispatcher);
  } catch (error) {
    state.scenarioApplyInFlight = false;
    if (typeof state.updateScenarioUIFn === "function") {
      state.updateScenarioUIFn();
    }
    finishBootMetric("total", { failed: true });
    console.error("Failed to boot application:", error);
    console.error("Stack trace:", error?.stack);
    setStartupReadonlyState(false);
    const canContinueWithoutScenario =
      !!state.landData?.features?.length
      && !!renderDispatcher?.flush;
    bootContinueHandler = canContinueWithoutScenario
      ? async () => {
        if (deferredUiBootstrapPromise) {
          await deferredUiBootstrapPromise;
        }
        setBootState("warmup", {
          message: getBootLanguage() === "zh"
            ? "正在以基础地图模式继续。"
            : "Continuing with the base map only.",
          canContinueWithoutScenario: false,
        });
        renderDispatcher.flush();
        checkpointBootMetricOnce("first-visible");
        checkpointBootMetricOnce("first-visible-base");
        await finalizeReadyState(renderDispatcher);
      }
      : null;
    setBootState("error", {
      error: error?.message || "Failed to load the default startup scenario.",
      canContinueWithoutScenario,
      progress: state.bootProgress || BOOT_PHASE_WINDOWS["scenario-apply"].min,
    });
  }
}

bootstrap();

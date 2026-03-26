// App entry point (Phase 13)
import { normalizeCityLayerStyleConfig, state } from "./core/state.js";
import { loadCitySupportData, loadDeferredDetailBundle, loadMapData } from "./core/data_loader.js";
import { initMap, setMapData, render } from "./core/map_renderer.js";
import { applyActivePaletteState } from "./core/palette_manager.js";
import {
  applyScenarioBundle,
  initScenarioManager,
  loadScenarioBundle,
  loadScenarioRegistry,
  syncScenarioLocalizationState,
} from "./core/scenario_manager.js";
import { initSidebar, initPresetState } from "./ui/sidebar.js";
import { initShortcuts } from "./ui/shortcuts.js";
import { initToolbar } from "./ui/toolbar.js";
import { initTranslations } from "./ui/i18n.js";
import { initToast } from "./ui/toast.js";
import { bindBeforeUnload } from "./core/dirty_state.js";
import { normalizeCountryCodeAlias } from "./core/country_code_aliases.js";

const VALID_BATCH_FILL_SCOPES = new Set(["parent", "country"]);
const VIEW_SETTINGS_STORAGE_KEY = "map_view_settings_v1";

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

function getDeferredPromotionDelay(profile) {
  if (profile === "balanced") return 250;
  if (profile === "auto") return 1200;
  return 0;
}

let deferredPromotionHandle = null;
let bootOverlayBound = false;
let bootContinueHandler = null;

const BOOT_PHASE_PROGRESS = {
  shell: 4,
  "base-data": 32,
  "scenario-bundle": 64,
  "scenario-apply": 88,
  warmup: 96,
  ready: 100,
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
      message: "Preparing the TNO 1962 scenario bundle and any required detail topology.",
    },
    "scenario-apply": {
      title: "Applying default scenario",
      message: "Composing ownership, controllers, runtime topology, and UI state in one pass.",
    },
    warmup: {
      title: "Finalizing first render",
      message: "Flushing the first visible frame and unlocking the interface next.",
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
      message: "正在准备 TNO 1962 剧本包，以及所需的细分拓扑。",
    },
    "scenario-apply": {
      title: "正在应用默认剧本",
      message: "正在一次性组合归属、控制、运行时拓扑和 UI 状态。",
    },
    warmup: {
      title: "正在完成首帧渲染",
      message: "首个可见画面即将就绪，随后开放交互。",
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

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function getBootLanguage() {
  return String(state.currentLanguage || "en").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
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
    overlay: document.getElementById("bootOverlay"),
    title: document.getElementById("bootOverlayTitle"),
    message: document.getElementById("bootOverlayMessage"),
    progressBar: document.getElementById("bootOverlayProgressBar"),
    progressText: document.getElementById("bootOverlayProgressText"),
    actions: document.getElementById("bootOverlayActions"),
    retryBtn: document.getElementById("bootRetryBtn"),
    continueBtn: document.getElementById("bootContinueBtn"),
  };
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
  document.body?.classList.toggle("app-booting", !!state.bootBlocking);
  dom.overlay.classList.toggle("hidden", state.bootPhase === "ready");
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
    progress = null,
    blocking = null,
    error = null,
    canContinueWithoutScenario = null,
  } = {}
) {
  state.bootPhase = phase;
  state.bootMessage = message ?? getBootCopy(phase).message;
  state.bootProgress =
    progress == null
      ? (BOOT_PHASE_PROGRESS[phase] ?? state.bootProgress ?? 0)
      : Math.max(0, Math.min(100, Number(progress) || 0));
  state.bootBlocking = blocking == null ? phase !== "ready" : !!blocking;
  state.bootError = phase === "error" ? String(error || state.bootError || "") : "";
  state.bootCanContinueWithoutScenario =
    canContinueWithoutScenario == null
      ? (phase === "error" ? !!state.bootCanContinueWithoutScenario : false)
      : !!canContinueWithoutScenario;
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

async function ensureBaseCityDataReady({ reason = "manual", renderNow = true } = {}) {
  if (state.worldCitiesData && state.baseCityDataState === "loaded") {
    if (renderNow && typeof state.renderNowFn === "function") {
      state.renderNowFn();
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
      if (renderNow && typeof state.renderNowFn === "function") {
        state.renderNowFn();
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
        } else if (typeof state.renderNowFn === "function") {
          state.renderNowFn();
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
      } else if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
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
  initializeBootOverlay();
  resetBootMetrics();
  setBootState("shell", {
    progress: BOOT_PHASE_PROGRESS.shell,
    canContinueWithoutScenario: false,
  });
  bootContinueHandler = null;

  let renderDispatcher = null;
  try {
    bindBeforeUnload();
    setBootState("base-data");
    startBootMetric("base-data");
    const d3Client = globalThis.d3;
    const scenarioRegistryPromise = loadScenarioRegistry({ d3Client });
    const defaultScenarioIdPromise = scenarioRegistryPromise.then((registry) => {
      const defaultScenarioId = String(registry?.default_scenario_id || "").trim();
      if (!defaultScenarioId) {
        throw new Error("Default scenario is not configured in data/scenarios/index.json.");
      }
      return defaultScenarioId;
    });
    const scenarioBundlePromise = defaultScenarioIdPromise
      .then((defaultScenarioId) => loadScenarioBundle(defaultScenarioId, { d3Client }))
      .then((bundle) => ({ ok: true, bundle }))
      .catch((error) => ({ ok: false, error }));
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
    } = await loadMapData({
      d3Client,
      includeCityData: false,
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
    state.baseGeoLocales = { ...(state.locales?.geo || {}) };
    state.geoAliasToStableKey = geoAliases?.alias_to_stable_key || {};
    state.baseGeoAliasToStableKey = { ...state.geoAliasToStableKey };
    state.worldCitiesData = null;
    state.baseCityAliasesData = null;
    state.baseCityDataState = "idle";
    state.baseCityDataError = "";
    state.baseCityDataPromise = null;
    state.cityLayerRevision = (Number(state.cityLayerRevision) || 0) + 1;
    state.ruCityOverrides = ruCityOverrides || null;
    state.specialZonesExternalData = specialZones || null;
    state.contextLayerExternalDataByName = contextLayerExternal || {};
    state.physicalSemanticsData = state.contextLayerExternalDataByName?.physical_semantics || null;
    state.physicalContourMajorData = state.contextLayerExternalDataByName?.physical_contours_major || null;
    state.physicalContourMinorData = state.contextLayerExternalDataByName?.physical_contours_minor || null;
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

    state.landData = globalThis.topojson.feature(state.topologyPrimary, objects.political);

    if (state.specialZonesExternalData?.features) {
      state.specialZonesData = state.specialZonesExternalData;
    } else if (objects.special_zones) {
      state.specialZonesData = globalThis.topojson.feature(state.topologyPrimary, objects.special_zones);
    }
    if (objects.rivers) {
      state.riversData = globalThis.topojson.feature(state.topologyPrimary, objects.rivers);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.rivers?.features)) {
      state.riversData = state.contextLayerExternalDataByName.rivers;
    }
    if (objects.ocean) {
      state.oceanData = globalThis.topojson.feature(state.topologyPrimary, objects.ocean);
    }
    if (objects.land) {
      state.landBgData = globalThis.topojson.feature(state.topologyPrimary, objects.land);
    }
    if (objects.urban) {
      state.urbanData = globalThis.topojson.feature(state.topologyPrimary, objects.urban);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.urban?.features)) {
      state.urbanData = state.contextLayerExternalDataByName.urban;
    }
    if (objects.physical) {
      state.physicalData = globalThis.topojson.feature(state.topologyPrimary, objects.physical);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.physical?.features)) {
      state.physicalData = state.contextLayerExternalDataByName.physical;
    }
    state.physicalSemanticsData = state.contextLayerExternalDataByName?.physical_semantics || null;
    state.physicalContourMajorData = state.contextLayerExternalDataByName?.physical_contours_major || null;
    state.physicalContourMinorData = state.contextLayerExternalDataByName?.physical_contours_minor || null;
    finishBootMetric("base-data", {
      topologyBundleMode: state.topologyBundleMode,
      primaryCount,
      detailCount,
    });
    await scenarioRegistryPromise;

    initPresetState();
    initMap({ suppressRender: true });
    setMapData({ suppressRender: true });

    renderDispatcher = createRenderDispatcher(render);
    const renderApp = () => {
      renderDispatcher.schedule();
    };
    globalThis.renderApp = renderApp;
    globalThis.renderNow = renderDispatcher.flush;
    state.renderNowFn = renderDispatcher.flush;
    state.ensureDetailTopologyFn = (options = {}) =>
      ensureDetailTopologyReady({
        renderDispatcher,
        ...options,
      });

    initToast();
    initToolbar({ render: renderApp });
    initTranslations();
    initSidebar({ render: renderApp });
    initScenarioManager({ render: renderApp });
    initShortcuts();

    setBootState("scenario-bundle");
    startBootMetric("scenario-bundle");
    const scenarioBundleResult = await scenarioBundlePromise;
    if (!scenarioBundleResult.ok) {
      throw scenarioBundleResult.error;
    }
    const defaultScenarioBundle = scenarioBundleResult.bundle;
    if (!defaultScenarioBundle?.manifest) {
      throw new Error("Default scenario bundle did not include a manifest.");
    }
    const expectedScenarioFeatureCount = Number(defaultScenarioBundle.manifest?.summary?.feature_count || 0);
    const requiresDetailTopology =
      state.detailDeferred
      && !hasDetailTopologyLoaded()
      && expectedScenarioFeatureCount > primaryCount;
    if (requiresDetailTopology) {
      setBootState("scenario-bundle", {
        message: getBootLanguage() === "zh"
          ? "正在为默认剧本准备细分拓扑。"
          : "Preparing detail topology for the default scenario.",
      });
      await ensureDetailTopologyReady({
        renderDispatcher,
        applyMapData: false,
      });
    }
    finishBootMetric("scenario-bundle", {
      requiresDetailTopology,
      expectedScenarioFeatureCount,
    });

    setBootState("scenario-apply");
    startBootMetric("scenario-apply");
    await applyScenarioBundle(defaultScenarioBundle, {
      renderNow: false,
      suppressRender: true,
      markDirtyReason: "",
      showToastOnComplete: false,
    });
    finishBootMetric("scenario-apply", {
      activeScenarioId: String(state.activeScenarioId || ""),
    });

    setBootState("warmup");
    renderDispatcher.flush();
    checkpointBootMetric("first-visible");
    scheduleDeferredDetailPromotion(renderDispatcher);
    setBootState("ready", {
      blocking: false,
      progress: 100,
      canContinueWithoutScenario: false,
    });
    checkpointBootMetric("first-interactive");
    finishBootMetric("total");
    schedulePostReadyCityWarmup();
    logBootMetrics();
    console.log("Initial render complete.");
  } catch (error) {
    finishBootMetric("total", { failed: true });
    console.error("Failed to boot application:", error);
    console.error("Stack trace:", error?.stack);
    const canContinueWithoutScenario =
      !!state.landData?.features?.length
      && !!renderDispatcher?.flush;
    bootContinueHandler = canContinueWithoutScenario
      ? async () => {
        setBootState("warmup", {
          message: getBootLanguage() === "zh"
            ? "正在以基础地图模式继续。"
            : "Continuing with the base map only.",
          canContinueWithoutScenario: false,
        });
        renderDispatcher.flush();
        checkpointBootMetric("first-visible");
        scheduleDeferredDetailPromotion(renderDispatcher);
        setBootState("ready", {
          blocking: false,
          progress: 100,
          canContinueWithoutScenario: false,
        });
        checkpointBootMetric("first-interactive");
      }
      : null;
    setBootState("error", {
      error: error?.message || "Failed to load the default startup scenario.",
      canContinueWithoutScenario,
      progress: state.bootProgress || BOOT_PHASE_PROGRESS["scenario-apply"],
    });
  }
}

bootstrap();

import { normalizeCityLayerStyleConfig, state as runtimeState } from "../core/state.js";
import {
  hydrateHierarchyState,
  hydrateStoredViewSettings,
  setCurrentLanguage,
} from "../core/state/content_state.js";
import { hasScenarioRuntimeShellContract } from "../core/scenario_resources.js";
import {
  getScenarioStartupBundleFilename,
  normalizeScenarioLocaleLanguage,
} from "../core/scenario/locale_asset_contract.js";
import { normalizeCountryCodeAlias } from "../core/country_code_aliases.js";
import { consumeStartupSupportKeyUsageAuditReport } from "../ui/i18n.js";
const state = runtimeState;

const VALID_BATCH_FILL_SCOPES = new Set(["parent", "country"]);
const STARTUP_SUPPORT_AUDIT_PARAM = "startup_support_audit";
const STARTUP_SUPPORT_AUDIT_LABEL_PARAM = "startup_support_audit_label";
const STARTUP_SUPPORT_AUDIT_DEFER_PARAM = "startup_support_audit_defer";
const STARTUP_SUPPORT_AUDIT_REPORT_URL = "/__dev/startup-support/key-usage-report";
const VIEW_SETTINGS_STORAGE_KEY = "map_view_settings_v1";

/**
 * Startup bootstrap support helpers.
 * 这里统一放启动期的纯辅助逻辑、默认场景解析、startup bundle URL 组装和启动审计辅助。
 * main.js 继续保留启动顺序编排、boot overlay 状态推进和最终 bootstrap 入口。
 */

export function normalizeCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

export function normalizeBatchFillScopes(rawScopes) {
  const scopes = Array.isArray(rawScopes) ? rawScopes : [];
  const normalized = scopes
    .map((scope) => String(scope || "").trim().toLowerCase())
    .filter((scope) => VALID_BATCH_FILL_SCOPES.has(scope));
  return normalized.length ? Array.from(new Set(normalized)) : ["parent", "country"];
}

export function isStartupSupportAuditEnabled() {
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    const raw = String(params.get(STARTUP_SUPPORT_AUDIT_PARAM) || "").trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(raw);
  } catch (_error) {
    return false;
  }
}

export function shouldDeferStartupSupportAuditPost() {
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    const raw = String(params.get(STARTUP_SUPPORT_AUDIT_DEFER_PARAM) || "").trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(raw);
  } catch (_error) {
    return false;
  }
}

export async function postStartupSupportKeyUsageReport({ scenarioId = "", source = "" } = {}) {
  if (!isStartupSupportAuditEnabled()) {
    return;
  }
  if (shouldDeferStartupSupportAuditPost()) {
    return;
  }
  const usage = consumeStartupSupportKeyUsageAuditReport();
  if (!usage) {
    return;
  }
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    const sampleLabel = String(params.get(STARTUP_SUPPORT_AUDIT_LABEL_PARAM) || "").trim();
    await fetch(STARTUP_SUPPORT_AUDIT_REPORT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scenarioId: String(scenarioId || "").trim(),
        source: String(source || "").trim(),
        sampleLabel,
        usage,
      }),
    });
  } catch (error) {
    console.warn("[startup-support-audit] Unable to persist startup support key-usage report.", error);
  }
}

export function processHierarchyData(data) {
  return hydrateHierarchyState(state, data, {
    normalizeCountryCode,
    normalizeBatchFillScopes,
  });
}

export function hydrateLanguage() {
  try {
    const storedLang = localStorage.getItem("map_lang");
    if (storedLang) {
      setCurrentLanguage(state, storedLang);
    }
  } catch (error) {
    console.warn("Language preference not available:", error);
  }
}

export function hydrateViewSettings() {
  try {
    const raw = localStorage.getItem(VIEW_SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    hydrateStoredViewSettings(state, parsed, { normalizeCityLayerStyleConfig });
  } catch (error) {
    console.warn("View settings preference not available:", error);
  }
}

export function persistViewSettings() {
  try {
    localStorage.setItem(
      VIEW_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        cityPoints: {
          show: runtimeState.showCityPoints !== false,
          style: normalizeCityLayerStyleConfig(runtimeState.styleConfig?.cityPoints),
        },
      })
    );
  } catch (error) {
    console.warn("Unable to persist view settings:", error);
  }
}

export function createRenderDispatcher(renderFn) {
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

export function initLongAnimationFrameObserver() {
  if (typeof globalThis.PerformanceObserver !== "function") return;
  try {
    const observer = new globalThis.PerformanceObserver((list) => {
      const entries = list.getEntries ? list.getEntries() : [];
      if (!entries.length) return;
      const latest = entries[entries.length - 1];
      if (!latest) return;
      if (!runtimeState.renderPerfMetrics || typeof runtimeState.renderPerfMetrics !== "object") {
        runtimeState.renderPerfMetrics = {};
      }
      runtimeState.renderPerfMetrics.longAnimationFrameBlockingDuration = {
        durationMs: Math.max(0, Number(latest.duration || 0)),
        blockingDuration: Math.max(0, Number(latest.blockingDuration || 0)),
        startTime: Math.max(0, Number(latest.startTime || 0)),
        renderStart: Math.max(0, Number(latest.renderStart || 0)),
        firstUIEventTimestamp: Math.max(0, Number(latest.firstUIEventTimestamp || 0)),
        bootPhase: String(runtimeState.bootPhase || ""),
        renderPhase: String(runtimeState.renderPhase || ""),
        startupReadonly: !!runtimeState.startupReadonly,
        activePostReadyTaskKey: String(runtimeState.activePostReadyTaskKey || ""),
        activePostReadyTaskStartedAt: Math.max(0, Number(runtimeState.activePostReadyTaskStartedAt || 0)),
        activePostReadyTaskAgeMs: runtimeState.activePostReadyTaskStartedAt
          ? Math.max(0, nowMs() - Number(runtimeState.activePostReadyTaskStartedAt || 0))
          : 0,
        pendingPostReadyTaskCount: Math.max(0, Number(runtimeState.postReadyTaskDiagnostics?.pendingTaskCount || 0)),
        pendingPostReadyTaskKeys: Array.isArray(runtimeState.postReadyTaskDiagnostics?.pendingTaskKeys)
          ? [...runtimeState.postReadyTaskDiagnostics.pendingTaskKeys]
          : [],
        postReadyMaxPendingAgeMs: Math.max(0, Number(runtimeState.postReadyTaskDiagnostics?.maxPendingAgeMs || 0)),
        postReadyMaxRetryCount: Math.max(0, Number(runtimeState.postReadyTaskDiagnostics?.maxRetryCount || 0)),
        interactionRecoveryTaskKey: String(runtimeState.renderPerfMetrics?.interactionRecoveryTaskMs?.taskKey || ""),
        activeInteractionRecoveryTaskKey: String(runtimeState.activeInteractionRecoveryTaskKey || ""),
        interactionRecoveryTaskMs: Math.max(0, Number(runtimeState.renderPerfMetrics?.interactionRecoveryTaskMs?.durationMs || 0)),
        interactionRecoveryWindowMs: Math.max(0, Number(runtimeState.renderPerfMetrics?.interactionRecoveryWindowMs?.durationMs || 0)),
        recordedAt: Date.now(),
      };
      globalThis.__renderPerfMetrics = runtimeState.renderPerfMetrics;
    });
    observer.observe({ type: "long-animation-frame", buffered: true });
    runtimeState.longAnimationFrameObserver = observer;
  } catch (_error) {
    // Experimental API; ignore unsupported browsers.
  }
}

export function getDeferredPromotionDelay(profile) {
  if (profile === "balanced") return 250;
  if (profile === "auto") return 1200;
  return 0;
}

export function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

export function getBootLanguage() {
  return String(runtimeState.currentLanguage || "en").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function getConfiguredDefaultScenarioId() {
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

export function getStartupBundleLanguage() {
  return normalizeScenarioLocaleLanguage(getBootLanguage());
}

export function getStartupBundleUrl(scenarioId, language = getStartupBundleLanguage()) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) {
    return "";
  }
  return `data/scenarios/${normalizedScenarioId}/${getScenarioStartupBundleFilename(language)}`;
}

export function getStartupScenarioSupportUrl(scenarioId, filename) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  const normalizedFilename = String(filename || "").trim();
  if (!normalizedScenarioId || !normalizedFilename) {
    return "";
  }
  return `data/scenarios/${normalizedScenarioId}/${normalizedFilename}`;
}

export function createStartupBundleLoadDiagnostics({
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

export function createStartupBootArtifactsOverride({
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
    locales: payload?.base?.locales || null,
    geoAliases: payload?.base?.geo_aliases || null,
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

export function formatStartupRuntimeShellContractFailure(contract) {
  const missingParts = [
    ...(Array.isArray(contract?.missingObjects) ? contract.missingObjects.map((objectName) => `missing-${objectName}`) : []),
    ...(contract?.missingPoliticalMeta ? ["missing-runtime-political-meta"] : []),
  ];
  return missingParts.join(", ") || "incomplete-runtime-shell";
}

export function warnOnStartupBundleIntegrity(bundle, { source = "" } = {}) {
  if (String(source || "").trim() !== "startup-bundle") {
    return;
  }
  const missingCollections = [];
  const baseObjects = runtimeState.topologyPrimary?.objects || {};
  const runtimeObjects = bundle?.runtimeTopologyPayload?.objects || {};
  if (baseObjects.ocean && !Array.isArray(runtimeState.oceanData?.features)) {
    missingCollections.push("base.ocean");
  }
  if (baseObjects.land && !Array.isArray(runtimeState.landBgData?.features)) {
    missingCollections.push("base.land");
  }
  if (baseObjects.water_regions && !Array.isArray(runtimeState.waterRegionsData?.features)) {
    missingCollections.push("base.water_regions");
  }
  if (runtimeObjects.scenario_water && !Array.isArray(runtimeState.scenarioWaterRegionsData?.features)) {
    missingCollections.push("scenario.scenario_water");
  }
  if (runtimeObjects.context_land_mask && !Array.isArray(runtimeState.scenarioContextLandMaskData?.features)) {
    missingCollections.push("scenario.context_land_mask");
  }
  if (!missingCollections.length) {
    return;
  }
  console.warn(
    `[startup-bundle] Boot completed with missing startup collections: ${missingCollections.join(", ")}.`,
    {
      activeScenarioId: String(runtimeState.activeScenarioId || bundle?.manifest?.scenario_id || ""),
      topologyBundleMode: String(runtimeState.topologyBundleMode || ""),
    }
  );
}


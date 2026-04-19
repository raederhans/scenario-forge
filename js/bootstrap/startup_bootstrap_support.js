import { normalizeCityLayerStyleConfig, state } from "../core/state.js";
import { hasScenarioRuntimeShellContract } from "../core/scenario_resources.js";
import { normalizeCountryCodeAlias } from "../core/country_code_aliases.js";
import { consumeStartupSupportKeyUsageAuditReport } from "../ui/i18n.js";

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

export function hydrateLanguage() {
  try {
    const storedLang = localStorage.getItem("map_lang");
    if (storedLang) {
      state.currentLanguage = storedLang;
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

export function persistViewSettings() {
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

export function getDeferredPromotionDelay(profile) {
  if (profile === "balanced") return 250;
  if (profile === "auto") return 1200;
  return 0;
}

export function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

export function getBootLanguage() {
  return String(state.currentLanguage || "en").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
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
  return getBootLanguage() === "zh" ? "zh" : "en";
}

export function getStartupBundleUrl(scenarioId, language = getStartupBundleLanguage()) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) {
    return "";
  }
  const bundleLanguage = String(language || "en").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
  return `data/scenarios/${normalizedScenarioId}/startup.bundle.${bundleLanguage}.json`;
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

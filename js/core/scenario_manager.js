import { countryNames, defaultCountryPalette, state } from "./state.js";
import { ensureSovereigntyState, resetAllFeatureOwnersToCanonical } from "./sovereignty_manager.js";
import { recomputeDynamicBordersNow, refreshColorState, setMapData } from "./map_renderer.js";
import { loadDeferredDetailBundle } from "./data_loader.js";
import { setActivePaletteSource, syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { markDirty } from "./dirty_state.js";
import {
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
  rebuildPresetState,
} from "./releasable_manager.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";

const SCENARIO_REGISTRY_URL = "data/scenarios/index.json";
const DETAIL_POLITICAL_MIN_FEATURES = 1000;
const SCENARIO_DETAIL_MIN_RATIO_STRICT = 0.7;
const SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD = 1000;
const DEFAULT_OCEAN_FILL_COLOR = "#aadaff";

function cacheBust(url) {
  if (!url) return url;
  const sep = String(url).includes("?") ? "&" : "?";
  return `${url}${sep}_t=${Date.now()}`;
}

function normalizeScenarioId(value) {
  return String(value || "").trim();
}

function normalizeScenarioViewMode(value) {
  return String(value || "").trim().toLowerCase() === "frontline" ? "frontline" : "ownership";
}

function normalizeScenarioOceanFillColor(value, fallback = DEFAULT_OCEAN_FILL_COLOR) {
  const candidate = String(value || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate.toLowerCase();
  if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  return fallback;
}

function getScenarioOceanFillOverride(manifest) {
  const rawValue = String(manifest?.style_defaults?.ocean?.fillColor || "").trim();
  return rawValue ? normalizeScenarioOceanFillColor(rawValue, "") : "";
}

function syncScenarioOceanFillForActivation(manifest) {
  const nextOverride = getScenarioOceanFillOverride(manifest);
  const previousOverride = getScenarioOceanFillOverride(state.activeScenarioManifest);
  if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
    state.styleConfig.ocean = {};
  }
  if (!state.activeScenarioId && state.scenarioOceanFillBeforeActivate === null) {
    state.scenarioOceanFillBeforeActivate = normalizeScenarioOceanFillColor(state.styleConfig.ocean.fillColor);
  }
  if (nextOverride) {
    state.styleConfig.ocean.fillColor = nextOverride;
  } else if (previousOverride && state.scenarioOceanFillBeforeActivate !== null) {
    state.styleConfig.ocean.fillColor = normalizeScenarioOceanFillColor(state.scenarioOceanFillBeforeActivate);
  }
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
}

function restoreScenarioOceanFillAfterExit() {
  if (state.scenarioOceanFillBeforeActivate === null) {
    return;
  }
  if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
    state.styleConfig.ocean = {};
  }
  state.styleConfig.ocean.fillColor = normalizeScenarioOceanFillColor(state.scenarioOceanFillBeforeActivate);
  state.scenarioOceanFillBeforeActivate = null;
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
}

function getPoliticalGeometryCount(topology) {
  const geometries = topology?.objects?.political?.geometries;
  return Array.isArray(geometries) ? geometries.length : 0;
}

function hasUsablePoliticalTopology(topology, { minFeatures = DETAIL_POLITICAL_MIN_FEATURES } = {}) {
  return getPoliticalGeometryCount(topology) >= Math.max(1, Number(minFeatures) || 1);
}

function countOwnerControllerSplit({
  ownersByFeatureId = state.sovereigntyByFeatureId || {},
  controllersByFeatureId = state.scenarioControllersByFeatureId || {},
} = {}) {
  let split = 0;
  const seen = new Set();
  Object.entries(ownersByFeatureId || {}).forEach(([featureId, owner]) => {
    const normalizedId = String(featureId || "").trim();
    if (!normalizedId) return;
    seen.add(normalizedId);
    const ownerTag = String(owner || "").trim().toUpperCase();
    const controllerTag = String(controllersByFeatureId?.[normalizedId] || ownerTag || "").trim().toUpperCase();
    if (ownerTag && controllerTag && ownerTag !== controllerTag) {
      split += 1;
    }
  });
  Object.entries(controllersByFeatureId || {}).forEach(([featureId, controller]) => {
    const normalizedId = String(featureId || "").trim();
    if (!normalizedId || seen.has(normalizedId)) return;
    const controllerTag = String(controller || "").trim().toUpperCase();
    const ownerTag = String(ownersByFeatureId?.[normalizedId] || controllerTag || "").trim().toUpperCase();
    if (ownerTag && controllerTag && ownerTag !== controllerTag) {
      split += 1;
    }
  });
  return split;
}

function recalculateScenarioOwnerControllerDiffCount() {
  state.scenarioOwnerControllerDiffCount = state.activeScenarioId
    ? countOwnerControllerSplit({
      ownersByFeatureId: state.sovereigntyByFeatureId,
      controllersByFeatureId: state.scenarioControllersByFeatureId,
    })
    : 0;
  return state.scenarioOwnerControllerDiffCount;
}

function evaluateScenarioDataHealth(
  manifest = state.activeScenarioManifest,
  { minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT } = {}
) {
  const expectedFeatureCount = Number(manifest?.summary?.feature_count || 0);
  const runtimeFeatureCount = Array.isArray(state.landData?.features) ? state.landData.features.length : 0;
  const ratio = expectedFeatureCount > 0 ? runtimeFeatureCount / expectedFeatureCount : 1;
  const normalizedMinRatio = Math.min(Math.max(Number(minRatio) || SCENARIO_DETAIL_MIN_RATIO_STRICT, 0.1), 1);
  let warning = "";
  let severity = "";
  if (expectedFeatureCount >= DETAIL_POLITICAL_MIN_FEATURES) {
    const severeDrop = runtimeFeatureCount > 0 && ratio < normalizedMinRatio;
    const absoluteDrop = expectedFeatureCount - runtimeFeatureCount >= SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD;
    if (severeDrop && absoluteDrop) {
      warning = t("Detail topology not fully loaded; scenario is shown in coarse mode.", "ui");
      severity = "error";
    }
  }
  return {
    expectedFeatureCount,
    runtimeFeatureCount,
    ratio,
    minRatio: normalizedMinRatio,
    warning,
    severity,
  };
}

function scenarioNeedsDetailTopology(manifest = state.activeScenarioManifest) {
  return Number(manifest?.summary?.feature_count || 0) >= DETAIL_POLITICAL_MIN_FEATURES;
}

function refreshScenarioDataHealth({
  showWarningToast = false,
  showErrorToast = false,
  minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT,
} = {}) {
  if (!state.activeScenarioId || !state.activeScenarioManifest) {
    state.scenarioDataHealth = {
      expectedFeatureCount: 0,
      runtimeFeatureCount: 0,
      ratio: 1,
      minRatio: SCENARIO_DETAIL_MIN_RATIO_STRICT,
      warning: "",
      severity: "",
    };
    return state.scenarioDataHealth;
  }
  const health = evaluateScenarioDataHealth(state.activeScenarioManifest, { minRatio });
  state.scenarioDataHealth = health;
  const shouldToast = health.warning && (showErrorToast || showWarningToast);
  if (shouldToast) {
    const errorLevel = showErrorToast || health.severity === "error";
    showToast(health.warning, {
      title: errorLevel
        ? t("Scenario visibility error", "ui")
        : t("Scenario visibility warning", "ui"),
      tone: errorLevel ? "error" : "warning",
      duration: errorLevel ? 6200 : 5200,
    });
  }
  return health;
}

function getRuntimeGeometryFeatureId(geometry) {
  const props = geometry?.properties || {};
  return String(props.id || geometry?.id || "").trim();
}

function getRuntimeGeometryFeatureName(geometry) {
  const props = geometry?.properties || {};
  return String(props.name || props.NAME || "").trim();
}

function isScenarioShellCandidate(featureId, featureName = "") {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return false;
  if (normalizedId.includes("_FB_")) return true;
  return String(featureName || "").toLowerCase().includes("shell fallback");
}

function getScenarioEffectiveOwnerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    state.sovereigntyByFeatureId?.[normalizedId]
    || state.runtimeCanonicalCountryByFeatureId?.[normalizedId]
    || ""
  ).trim().toUpperCase();
}

function getScenarioEffectiveControllerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    state.scenarioControllersByFeatureId?.[normalizedId]
    || getScenarioEffectiveOwnerCodeByFeatureId(normalizedId)
    || ""
  ).trim().toUpperCase();
}

function getScenarioRuntimeNeighborGraph(geometries) {
  const runtimeGraph = Array.isArray(state.runtimeNeighborGraph) ? state.runtimeNeighborGraph : [];
  const hasPopulatedNeighbors = runtimeGraph.some((neighbors) => Array.isArray(neighbors) && neighbors.length > 0);
  if (runtimeGraph.length === geometries.length && hasPopulatedNeighbors) {
    return runtimeGraph.map((neighbors) => (Array.isArray(neighbors) ? neighbors : []));
  }
  if (typeof globalThis.topojson?.neighbors === "function") {
    try {
      const fallback = globalThis.topojson.neighbors(geometries);
      if (Array.isArray(fallback) && fallback.length === geometries.length) {
        return fallback.map((neighbors) => (Array.isArray(neighbors) ? neighbors : []));
      }
    } catch (error) {
      console.warn("[scenario] Failed to derive fallback runtime neighbors for shell overlays:", error);
    }
  }
  return new Array(geometries.length).fill(null).map(() => []);
}

function haveSameScenarioShellMapping(previousMap, nextMap) {
  const previousKeys = Object.keys(previousMap || {});
  const nextKeys = Object.keys(nextMap || {});
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of previousKeys) {
    if (String(previousMap?.[key] || "") !== String(nextMap?.[key] || "")) {
      return false;
    }
  }
  return true;
}

function refreshScenarioShellOverlays({ renderNow = false, borderReason = "scenario-shell-overlay" } = {}) {
  const previousOwnerMap = state.scenarioAutoShellOwnerByFeatureId || {};
  const previousControllerMap = state.scenarioAutoShellControllerByFeatureId || {};
  let nextOwnerMap = {};
  let nextControllerMap = {};

  if (state.activeScenarioId) {
    const geometries = state.runtimePoliticalTopology?.objects?.political?.geometries || [];
    if (Array.isArray(geometries) && geometries.length) {
      const neighborGraph = getScenarioRuntimeNeighborGraph(geometries);
      geometries.forEach((geometry, index) => {
        const featureId = getRuntimeGeometryFeatureId(geometry);
        const featureName = getRuntimeGeometryFeatureName(geometry);
        if (!isScenarioShellCandidate(featureId, featureName)) return;
        const neighborIndexes = Array.isArray(neighborGraph[index]) ? neighborGraph[index] : [];
        if (!neighborIndexes.length) return;
        const ownerCodes = new Set();
        const controllerCodes = new Set();
        neighborIndexes.forEach((neighborIndex) => {
          const neighborGeometry = geometries[neighborIndex];
          const neighborId = getRuntimeGeometryFeatureId(neighborGeometry);
          const neighborName = getRuntimeGeometryFeatureName(neighborGeometry);
          if (!neighborId || isScenarioShellCandidate(neighborId, neighborName)) {
            return;
          }
          const ownerCode = getScenarioEffectiveOwnerCodeByFeatureId(neighborId);
          const controllerCode = getScenarioEffectiveControllerCodeByFeatureId(neighborId);
          if (ownerCode) ownerCodes.add(ownerCode);
          if (controllerCode) controllerCodes.add(controllerCode);
        });
        if (ownerCodes.size === 1) {
          nextOwnerMap[featureId] = [...ownerCodes][0];
        }
        if (controllerCodes.size === 1) {
          nextControllerMap[featureId] = [...controllerCodes][0];
        }
      });
    }
  }

  const changed =
    !haveSameScenarioShellMapping(previousOwnerMap, nextOwnerMap)
    || !haveSameScenarioShellMapping(previousControllerMap, nextControllerMap);

  state.scenarioAutoShellOwnerByFeatureId = nextOwnerMap;
  state.scenarioAutoShellControllerByFeatureId = nextControllerMap;
  if (changed) {
    state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
  }
  refreshColorState({ renderNow: false });
  recomputeDynamicBordersNow({ renderNow: false, reason: borderReason });
  if (renderNow && typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
  return {
    changed,
    ownerCount: Object.keys(nextOwnerMap).length,
    controllerCount: Object.keys(nextControllerMap).length,
  };
}

function getScenarioDisplayOwnerByFeatureId(featureId, { fallbackOwner = "" } = {}) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return String(fallbackOwner || "").trim().toUpperCase();
  const fallback = String(fallbackOwner || "").trim().toUpperCase();
  const shellOwner = String(state.scenarioAutoShellOwnerByFeatureId?.[normalizedId] || "").trim().toUpperCase();
  if (!state.activeScenarioId || normalizeScenarioViewMode(state.scenarioViewMode) !== "frontline") {
    return shellOwner || fallback;
  }
  return String(
    state.scenarioAutoShellControllerByFeatureId?.[normalizedId]
    || state.scenarioControllersByFeatureId?.[normalizedId]
    || shellOwner
    || fallback
    || state.sovereigntyByFeatureId?.[normalizedId]
    || ""
  ).trim().toUpperCase();
}

function getScenarioRegistryEntries() {
  return Array.isArray(state.scenarioRegistry?.scenarios) ? state.scenarioRegistry.scenarios : [];
}

function getScenarioNameMap(countryMap = {}) {
  const next = {};
  Object.entries(countryMap || {}).forEach(([tag, entry]) => {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    const displayName = String(entry?.display_name || entry?.displayName || normalizedTag).trim();
    if (normalizedTag && displayName) {
      next[normalizedTag] = displayName;
    }
  });
  return next;
}

function getScenarioFixedOwnerColors(countryMap = {}) {
  const next = {};
  Object.entries(countryMap || {}).forEach(([tag, entry]) => {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    const color = String(entry?.color_hex || entry?.colorHex || "").trim().toLowerCase();
    if (normalizedTag && /^#[0-9a-f]{6}$/.test(color)) {
      next[normalizedTag] = color;
    }
  });
  return next;
}

async function loadScenarioRegistry({ d3Client = globalThis.d3 } = {}) {
  if (state.scenarioRegistry) {
    return state.scenarioRegistry;
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for scenario registry loading.");
  }
  const registry = await d3Client.json(cacheBust(SCENARIO_REGISTRY_URL));
  state.scenarioRegistry = registry || { version: 1, default_scenario_id: "", scenarios: [] };
  return state.scenarioRegistry;
}

function getScenarioMetaById(scenarioId) {
  const targetId = normalizeScenarioId(scenarioId);
  return getScenarioRegistryEntries().find(
    (entry) => normalizeScenarioId(entry?.scenario_id) === targetId
  ) || null;
}

function getScenarioManifestVersion(manifest) {
  const version = Number(manifest?.version || 1);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

function getScenarioManifestSummary(manifest = state.activeScenarioManifest) {
  return manifest?.summary && typeof manifest.summary === "object" ? manifest.summary : {};
}

function getScenarioBaselineHashFromBundle(bundle) {
  return String(bundle?.manifest?.baseline_hash || bundle?.ownersPayload?.baseline_hash || "").trim();
}

function getScenarioBlockerCount(summary = {}) {
  const flattened = Number(summary.blocker_count);
  if (Number.isFinite(flattened)) {
    return flattened;
  }
  return (
    Number(summary.geometry_blocker_count || 0)
    + Number(summary.topology_blocker_count || 0)
    + Number(summary.scenario_rule_blocker_count || 0)
  );
}

function getScenarioDefaultCountryCode(manifest, countryMap = {}) {
  return String(
    manifest?.default_active_country_code
    || manifest?.default_country
    || Object.keys(countryMap || {})[0]
    || ""
  ).trim().toUpperCase();
}

function ensureScenarioAuditUiState() {
  if (!state.scenarioAuditUi || typeof state.scenarioAuditUi !== "object") {
    state.scenarioAuditUi = {
      loading: false,
      loadedForScenarioId: "",
      errorMessage: "",
    };
  }
  if (typeof state.scenarioAuditUi.loading !== "boolean") {
    state.scenarioAuditUi.loading = false;
  }
  if (typeof state.scenarioAuditUi.loadedForScenarioId !== "string") {
    state.scenarioAuditUi.loadedForScenarioId = "";
  }
  if (typeof state.scenarioAuditUi.errorMessage !== "string") {
    state.scenarioAuditUi.errorMessage = "";
  }
  return state.scenarioAuditUi;
}

function setScenarioAuditUiState(partial = {}) {
  const current = ensureScenarioAuditUiState();
  Object.assign(current, partial);
  return current;
}

function syncScenarioInspectorSelection(countryCode = "") {
  const normalized = String(countryCode || "").trim().toUpperCase();
  state.selectedInspectorCountryCode = normalized;
  state.inspectorHighlightCountryCode = normalized;
  state.inspectorExpansionInitialized = false;
  if (state.expandedInspectorContinents instanceof Set) {
    state.expandedInspectorContinents.clear();
  }
  if (state.expandedInspectorReleaseParents instanceof Set) {
    state.expandedInspectorReleaseParents.clear();
  }
}

async function loadScenarioBundle(scenarioId, { d3Client = globalThis.d3, forceReload = false } = {}) {
  const targetId = normalizeScenarioId(scenarioId);
  if (!targetId) {
    throw new Error("Scenario id is required.");
  }
  if (!forceReload && state.scenarioBundleCacheById?.[targetId]) {
    return state.scenarioBundleCacheById[targetId];
  }
  await loadScenarioRegistry({ d3Client });
  const meta = getScenarioMetaById(targetId);
  if (!meta?.manifest_url) {
    throw new Error(`Unknown scenario id: ${targetId}`);
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for scenario loading.");
  }
  const manifest = await d3Client.json(cacheBust(meta.manifest_url));
  const [countriesPayload, ownersPayload, controllersPayload, coresPayload] = await Promise.all([
    d3Client.json(cacheBust(manifest.countries_url)),
    d3Client.json(cacheBust(manifest.owners_url)),
    manifest.controllers_url ? d3Client.json(cacheBust(manifest.controllers_url)) : Promise.resolve(null),
    d3Client.json(cacheBust(manifest.cores_url)),
  ]);
  const bundle = {
    meta,
    manifest,
    countriesPayload,
    ownersPayload,
    controllersPayload,
    coresPayload,
    auditPayload: null,
  };
  const ownerCount = Object.keys(ownersPayload?.owners || {}).length;
  const controllerCount = Object.keys(controllersPayload?.controllers || {}).length;
  const countryCount = Object.keys(countriesPayload?.countries || {}).length;
  console.log(
    `[scenario] Loaded bundle "${targetId}": ${ownerCount} owner entries, ${controllerCount} controller entries, ${countryCount} countries, baseline=${String(manifest?.baseline_hash || "").slice(0, 12)}`
  );
  state.scenarioBundleCacheById[targetId] = bundle;
  return bundle;
}

async function loadScenarioAuditPayload(
  bundleOrScenarioId,
  {
    d3Client = globalThis.d3,
    forceReload = false,
  } = {}
) {
  const bundle = typeof bundleOrScenarioId === "string"
    ? await loadScenarioBundle(bundleOrScenarioId, { d3Client })
    : bundleOrScenarioId;
  const requestedScenarioId = normalizeScenarioId(
    bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id
  );
  if (!bundle?.manifest?.audit_url) {
    return null;
  }
  if (bundle.auditPayload && !forceReload) {
    if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
      state.scenarioAudit = bundle.auditPayload;
      setScenarioAuditUiState({
        loading: false,
        loadedForScenarioId: requestedScenarioId,
        errorMessage: "",
      });
      syncScenarioUi();
    }
    return bundle.auditPayload;
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for scenario audit loading.");
  }

  if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
    setScenarioAuditUiState({
      loading: true,
      errorMessage: "",
    });
    syncScenarioUi();
  }

  try {
    const auditPayload = await d3Client.json(cacheBust(bundle.manifest.audit_url));
    bundle.auditPayload = auditPayload || null;
    if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
      state.scenarioAudit = bundle.auditPayload;
      setScenarioAuditUiState({
        loading: false,
        loadedForScenarioId: bundle.auditPayload ? requestedScenarioId : "",
        errorMessage: "",
      });
      syncScenarioUi();
    }
    return bundle.auditPayload;
  } catch (error) {
    if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
      setScenarioAuditUiState({
        loading: false,
        errorMessage: String(error?.message || "Unable to load audit details."),
      });
      syncScenarioUi();
    }
    throw error;
  }
}

async function validateImportedScenarioBaseline(projectScenario, { d3Client = globalThis.d3 } = {}) {
  const scenarioId = normalizeScenarioId(projectScenario?.id);
  if (!scenarioId) {
    return { ok: true, bundle: null, message: "" };
  }

  let bundle = null;
  try {
    bundle = await loadScenarioBundle(scenarioId, { d3Client });
  } catch (error) {
    return {
      ok: false,
      bundle: null,
      message: `Scenario "${scenarioId}" is not available in the current asset set.`,
      reason: "missing_scenario",
      error,
    };
  }

  const currentVersion = getScenarioManifestVersion(bundle.manifest);
  const currentBaselineHash = getScenarioBaselineHashFromBundle(bundle);
  const expectedVersion = Number(projectScenario?.version || 1) || 1;
  const expectedBaselineHash = String(projectScenario?.baselineHash || "").trim();
  const mismatches = [];

  if (currentVersion !== expectedVersion) {
    mismatches.push(`version ${expectedVersion} -> ${currentVersion}`);
  }
  if (expectedBaselineHash !== currentBaselineHash) {
    mismatches.push("baseline hash differs");
  }

  return {
    ok: mismatches.length === 0,
    bundle,
    message: mismatches.length
      ? `Saved scenario baseline does not match current assets (${mismatches.join(", ")}).`
      : "",
    reason: mismatches.length ? "baseline_mismatch" : "",
    currentVersion,
    currentBaselineHash,
  };
}

function syncScenarioUi() {
  if (typeof state.updateScenarioUIFn === "function") {
    state.updateScenarioUIFn();
  }
  if (typeof state.renderScenarioAuditPanelFn === "function") {
    state.renderScenarioAuditPanelFn();
  }
}

function syncCountryUi({ renderNow = false } = {}) {
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
  if (typeof state.updateActiveSovereignUIFn === "function") {
    state.updateActiveSovereignUIFn();
  }
  if (typeof state.updateDynamicBorderStatusUIFn === "function") {
    state.updateDynamicBorderStatusUIFn();
  }
  if (typeof state.updateScenarioContextBarFn === "function") {
    state.updateScenarioContextBarFn();
  }
  syncScenarioUi();
  if (renderNow && typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
}

function setScenarioViewMode(
  viewMode,
  {
    renderNow = true,
    markDirtyReason = "",
  } = {}
) {
  const nextMode = normalizeScenarioViewMode(viewMode);
  if (!state.activeScenarioId) {
    state.scenarioViewMode = "ownership";
    return false;
  }
  if (state.scenarioViewMode === nextMode) {
    return false;
  }
  state.scenarioViewMode = nextMode;
  recalculateScenarioOwnerControllerDiffCount();
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  refreshColorState({ renderNow: false });
  recomputeDynamicBordersNow({ renderNow: false, reason: `scenario-view:${nextMode}` });
  syncCountryUi({ renderNow });
  return true;
}

async function ensureScenarioDetailTopologyLoaded() {
  const hasDetailNow = hasUsablePoliticalTopology(state.topologyDetail);
  if (hasDetailNow && state.topologyBundleMode !== "composite") {
    state.topologyBundleMode = "composite";
    setMapData({ refitProjection: false, resetZoom: false });
    return true;
  }
  if (hasDetailNow && state.topologyBundleMode === "composite") {
    return false;
  }
  if (state.detailPromotionInFlight) {
    return false;
  }
  state.detailPromotionInFlight = true;
  try {
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const {
          topologyDetail,
          runtimePoliticalTopology,
          detailSourceUsed,
        } = await loadDeferredDetailBundle({
          detailSourceKey: state.detailSourceRequested,
        });

        const runtimeFallback = runtimePoliticalTopology || state.runtimePoliticalTopology || null;
        const resolvedDetail = hasUsablePoliticalTopology(topologyDetail)
          ? topologyDetail
          : (hasUsablePoliticalTopology(runtimeFallback) ? runtimeFallback : null);
        if (!resolvedDetail) {
          console.warn(`[scenario] Detail promotion attempt ${attempt}/2 resolved no usable topology.`);
          continue;
        }
        if (!hasUsablePoliticalTopology(topologyDetail) && hasUsablePoliticalTopology(runtimeFallback)) {
          console.warn(`[scenario] Detail promotion attempt ${attempt}/2 using runtime political fallback.`);
        }
        state.topologyDetail = resolvedDetail;
        state.runtimePoliticalTopology = runtimeFallback;
        state.topologyBundleMode = "composite";
        state.detailDeferred = false;
        state.detailPromotionCompleted = true;
        state.detailSourceRequested = detailSourceUsed || state.detailSourceRequested;
        setMapData({ refitProjection: false, resetZoom: false });
        return true;
      } catch (error) {
        lastError = error;
        console.warn(`[scenario] Detail promotion attempt ${attempt}/2 failed.`, error);
      }
    }

    state.detailDeferred = false;
    if (lastError) {
      console.warn("[scenario] Detail topology could not be promoted after retry. Staying on coarse map.", lastError);
    } else {
      console.warn("[scenario] Detail topology could not be promoted after retry. Staying on coarse map.");
    }
    return false;
  } catch (error) {
    console.warn("Unable to force-load detail topology before scenario apply:", error);
    return false;
  } finally {
    state.detailPromotionInFlight = false;
  }
}

function disableScenarioParentBorders() {
  if (!state.activeScenarioId && state.scenarioParentBorderEnabledBeforeActivate === null) {
    state.scenarioParentBorderEnabledBeforeActivate = {
      ...(state.parentBorderEnabledByCountry || {}),
    };
  }
  const next = {};
  Object.keys(state.parentBorderEnabledByCountry || {}).forEach((countryCode) => {
    next[countryCode] = false;
  });
  state.parentBorderEnabledByCountry = next;
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
}

function restoreParentBordersAfterScenario() {
  if (state.scenarioParentBorderEnabledBeforeActivate && typeof state.scenarioParentBorderEnabledBeforeActivate === "object") {
    state.parentBorderEnabledByCountry = {
      ...state.scenarioParentBorderEnabledBeforeActivate,
    };
  }
  state.scenarioParentBorderEnabledBeforeActivate = null;
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
}

function applyScenarioPaintMode() {
  if (!state.activeScenarioId && !state.scenarioPaintModeBeforeActivate) {
    state.scenarioPaintModeBeforeActivate = {
      paintMode: String(state.paintMode || "visual") === "sovereignty" ? "sovereignty" : "visual",
      interactionGranularity: String(state.interactionGranularity || "subdivision") === "country"
        ? "country"
        : "subdivision",
      politicalEditingExpanded: !!state.ui?.politicalEditingExpanded,
    };
  }
  state.paintMode = "sovereignty";
  state.interactionGranularity = "subdivision";
  if (state.ui && typeof state.ui === "object") {
    state.ui.politicalEditingExpanded = false;
    state.ui.scenarioVisualAdjustmentsOpen = false;
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
}

function restorePaintModeAfterScenario() {
  const previous = state.scenarioPaintModeBeforeActivate;
  if (previous && typeof previous === "object") {
    state.paintMode = previous.paintMode === "sovereignty" ? "sovereignty" : "visual";
    state.interactionGranularity = previous.interactionGranularity === "country"
      ? "country"
      : "subdivision";
    if (state.ui && typeof state.ui === "object") {
      state.ui.politicalEditingExpanded = !!previous.politicalEditingExpanded;
      state.ui.scenarioVisualAdjustmentsOpen = false;
    }
  }
  state.scenarioPaintModeBeforeActivate = null;
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
}

async function applyScenarioBundle(
  bundle,
  {
    renderNow = true,
    markDirtyReason = "scenario-apply",
    syncPalette = true,
    showToastOnComplete = false,
  } = {}
) {
  if (!bundle?.manifest) {
    throw new Error("Scenario bundle is missing a manifest.");
  }
  const detailPromoted = await ensureScenarioDetailTopologyLoaded();
  const detailReady = (
    state.topologyBundleMode === "composite"
    && hasUsablePoliticalTopology(state.topologyDetail)
  ) || !!detailPromoted;
  if (!detailReady && scenarioNeedsDetailTopology(bundle.manifest)) {
    const scenarioLabel = String(bundle.manifest?.display_name || bundle.manifest?.scenario_id || "Scenario").trim();
    const message = `Detailed political topology could not be loaded. ${scenarioLabel} cannot be applied in coarse mode.`;
    console.error(`[scenario] ${message}`);
    throw new Error(message);
  }
  if (!detailReady && state.topologyBundleMode !== "composite") {
    console.warn("[scenario] Applying bundle without confirmed detail promotion; health gate will validate runtime topology.");
  }
  if (syncPalette) {
    await setActivePaletteSource(
      normalizeScenarioId(bundle.manifest?.palette_id) || "hoi4_vanilla",
      {
      syncUI: true,
      overwriteCountryPalette: false,
      }
    );
  }

  const scenarioId = normalizeScenarioId(bundle.manifest.scenario_id || bundle.meta?.scenario_id);
  const baseCountryMap = bundle.countriesPayload?.countries || {};
  const owners = bundle.ownersPayload?.owners || {};
  const controllers = bundle.controllersPayload?.controllers || owners;
  const cores = bundle.coresPayload?.cores || {};
  const defaultCountryCode = getScenarioDefaultCountryCode(bundle.manifest, baseCountryMap);
  disableScenarioParentBorders();

  state.activeScenarioId = scenarioId;
  state.scenarioReleasableIndex = buildScenarioReleasableIndex(scenarioId);
  const releasableCountries = getScenarioReleasableCountries(scenarioId);
  Object.keys(releasableCountries).forEach((tag) => {
    if (baseCountryMap[tag]) {
      console.warn(`[scenario] Releasable tag conflict detected for "${tag}" while applying "${scenarioId}".`);
    }
  });
  const countryMap = {
    ...baseCountryMap,
    ...releasableCountries,
  };
  const scenarioNameMap = getScenarioNameMap(countryMap);
  const scenarioColorMap = getScenarioFixedOwnerColors(countryMap);
  state.scenarioBorderMode = "scenario_owner_only";
  state.activeScenarioManifest = bundle.manifest || null;
  state.scenarioCountriesByTag = countryMap;
  state.scenarioFixedOwnerColors = scenarioColorMap;
  state.scenarioAudit = bundle.auditPayload || null;
  setScenarioAuditUiState({
    loading: false,
    loadedForScenarioId: bundle.auditPayload ? scenarioId : "",
    errorMessage: "",
  });
  state.scenarioBaselineHash = getScenarioBaselineHashFromBundle(bundle);
  state.scenarioBaselineOwnersByFeatureId = { ...owners };
  state.scenarioControllersByFeatureId = { ...controllers };
  state.scenarioAutoShellOwnerByFeatureId = {};
  state.scenarioAutoShellControllerByFeatureId = {};
  state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
  state.scenarioBaselineControllersByFeatureId = { ...controllers };
  state.scenarioBaselineCoresByFeatureId = { ...cores };
  state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  state.scenarioViewMode = "ownership";
  state.countryNames = {
    ...countryNames,
    ...scenarioNameMap,
  };
  state.sovereigntyByFeatureId = { ...owners };
  state.sovereigntyInitialized = false;
  ensureSovereigntyState({ force: true });
  recalculateScenarioOwnerControllerDiffCount();
  state.visualOverrides = {};
  state.featureOverrides = {};
  state.sovereignBaseColors = { ...scenarioColorMap };
  state.countryBaseColors = { ...scenarioColorMap };
  state.activeSovereignCode = defaultCountryCode;
  syncScenarioInspectorSelection(defaultCountryCode);
  rebuildPresetState();
  applyScenarioPaintMode();
  syncScenarioOceanFillForActivation(bundle.manifest);
  if (typeof document !== "undefined") {
    const presetSection = document.getElementById("selectedCountryActionsSection");
    if (presetSection && "open" in presetSection) {
      presetSection.open = true;
    }
  }

  // Diagnostic: verify key ownership/frontline assignments took effect.
  const spotChecks = [
    "SYR-134",
    "LBN-3022",
    "BY_HIST_POL_VITEBSK_WEST",
    "CN_CITY_17275852B74586174185496",
    "CN_CITY_17275852B2295538790743",
  ];
  spotChecks.forEach((fid) => {
    const owner = state.sovereigntyByFeatureId[fid];
    const controller = state.scenarioControllersByFeatureId?.[fid] || owner;
    if (owner) {
      const color = scenarioColorMap[owner] || "(no color)";
      console.log(`[scenario] Spot-check: ${fid} -> owner=${owner}, controller=${controller}, color=${color}`);
    }
  });

  refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario:${scenarioId}` });
  const dataHealth = refreshScenarioDataHealth({
    showWarningToast: true,
    showErrorToast: true,
    minRatio: SCENARIO_DETAIL_MIN_RATIO_STRICT,
  });
  if (dataHealth.warning) {
    console.warn(
      `[scenario] Detail visibility gate triggered for ${scenarioId}: runtime=${dataHealth.runtimeFeatureCount}, expected=${dataHealth.expectedFeatureCount}, ratio=${dataHealth.ratio.toFixed(3)} (min=${dataHealth.minRatio}).`
    );
  }
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  syncCountryUi({ renderNow });
  if (typeof state.triggerScenarioGuideFn === "function") {
    state.triggerScenarioGuideFn();
  }

  if (showToastOnComplete) {
      showToast(
        t("Scenario loaded. Expand the parent country and use Activate to apply releasable territory.", "ui"),
        {
          title: t("Scenario loaded", "ui"),
      tone: "success",
      duration: 4200,
      }
    );
  }
}

async function applyScenarioById(
  scenarioId,
  {
    renderNow = true,
    markDirtyReason = "scenario-apply",
    showToastOnComplete = false,
  } = {}
) {
  const bundle = await loadScenarioBundle(scenarioId);
  await applyScenarioBundle(bundle, {
    renderNow,
    markDirtyReason,
    showToastOnComplete,
  });
  return bundle;
}

function resetToScenarioBaseline(
  {
    renderNow = true,
    markDirtyReason = "scenario-reset",
    showToastOnComplete = false,
  } = {}
) {
  if (!state.activeScenarioId || !state.scenarioBaselineOwnersByFeatureId) {
    return false;
  }
  const previousSelectedInspectorCountryCode = String(state.selectedInspectorCountryCode || "").trim().toUpperCase();
  const previousExpandedInspectorContinents = state.expandedInspectorContinents instanceof Set
    ? new Set(state.expandedInspectorContinents)
    : new Set();
  const previousExpandedInspectorReleaseParents = state.expandedInspectorReleaseParents instanceof Set
    ? new Set(state.expandedInspectorReleaseParents)
    : new Set();
  const previousInspectorExpansionInitialized = !!state.inspectorExpansionInitialized;
  state.sovereigntyByFeatureId = { ...(state.scenarioBaselineOwnersByFeatureId || {}) };
  state.scenarioControllersByFeatureId = { ...(state.scenarioBaselineControllersByFeatureId || {}) };
  state.scenarioAutoShellOwnerByFeatureId = {};
  state.scenarioAutoShellControllerByFeatureId = {};
  state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
  state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  state.scenarioViewMode = "ownership";
  state.sovereigntyInitialized = false;
  ensureSovereigntyState({ force: true });
  recalculateScenarioOwnerControllerDiffCount();
  state.visualOverrides = {};
  state.featureOverrides = {};
  state.sovereignBaseColors = { ...(state.scenarioFixedOwnerColors || {}) };
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.activeSovereignCode = getScenarioDefaultCountryCode(
    state.activeScenarioManifest,
    state.scenarioCountriesByTag
  ) || String(state.activeSovereignCode || "").trim().toUpperCase();
  if (state.ui && typeof state.ui === "object") {
    state.ui.scenarioVisualAdjustmentsOpen = false;
  }
  const restoredInspectorCode =
    previousSelectedInspectorCountryCode && state.scenarioCountriesByTag?.[previousSelectedInspectorCountryCode]
      ? previousSelectedInspectorCountryCode
      : state.activeSovereignCode;
  state.selectedInspectorCountryCode = restoredInspectorCode;
  state.inspectorHighlightCountryCode = restoredInspectorCode;
  state.expandedInspectorContinents = previousExpandedInspectorContinents;
  state.expandedInspectorReleaseParents = previousExpandedInspectorReleaseParents;
  state.inspectorExpansionInitialized =
    previousInspectorExpansionInitialized || previousExpandedInspectorContinents.size > 0;
  setScenarioAuditUiState({
    loading: false,
    errorMessage: "",
  });
  state.scenarioBorderMode = "scenario_owner_only";
  disableScenarioParentBorders();
  refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario-reset:${state.activeScenarioId}` });
  refreshScenarioDataHealth({ showWarningToast: false });
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  syncCountryUi({ renderNow });
  if (showToastOnComplete) {
    showToast(t("Scenario reset to baseline.", "ui"), {
      title: t("Scenario reset", "ui"),
      tone: "success",
    });
  }
  return true;
}

function clearActiveScenario(
  {
    renderNow = true,
    markDirtyReason = "scenario-clear",
    showToastOnComplete = false,
  } = {}
) {
  state.activeScenarioId = "";
  state.scenarioBorderMode = "canonical";
  state.activeScenarioManifest = null;
  state.scenarioCountriesByTag = {};
  state.scenarioFixedOwnerColors = {};
  state.scenarioReleasableIndex = {
    byTag: {},
    childTagsByParent: {},
    consumedPresetNamesByParentLookup: {},
  };
  state.scenarioAudit = null;
  setScenarioAuditUiState({
    loading: false,
    loadedForScenarioId: "",
    errorMessage: "",
  });
  state.scenarioBaselineHash = "";
  state.scenarioBaselineOwnersByFeatureId = {};
  state.scenarioControllersByFeatureId = {};
  state.scenarioAutoShellOwnerByFeatureId = {};
  state.scenarioAutoShellControllerByFeatureId = {};
  state.scenarioBaselineControllersByFeatureId = {};
  state.scenarioBaselineCoresByFeatureId = {};
  state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
  state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  state.scenarioOwnerControllerDiffCount = 0;
  state.scenarioDataHealth = {
    expectedFeatureCount: 0,
    runtimeFeatureCount: 0,
    ratio: 1,
    minRatio: SCENARIO_DETAIL_MIN_RATIO_STRICT,
    warning: "",
    severity: "",
  };
  state.scenarioViewMode = "ownership";
  state.countryNames = { ...countryNames };
  resetAllFeatureOwnersToCanonical();
  state.visualOverrides = {};
  state.featureOverrides = {};
  const defaults = syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });
  state.sovereignBaseColors = { ...(defaults || state.resolvedDefaultCountryPalette || defaultCountryPalette) };
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.activeSovereignCode = "";
  syncScenarioInspectorSelection("");
  restoreParentBordersAfterScenario();
  restorePaintModeAfterScenario();
  restoreScenarioOceanFillAfterExit();
  rebuildPresetState();
  refreshScenarioShellOverlays({ renderNow: false, borderReason: "scenario-clear" });
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  syncCountryUi({ renderNow });
  if (showToastOnComplete) {
    showToast(t("Scenario cleared.", "ui"), {
      title: t("Scenario cleared", "ui"),
      tone: "success",
    });
  }
}

function formatScenarioStatusText() {
  if (!state.activeScenarioId || !state.activeScenarioManifest) {
    return t("No scenario active", "ui");
  }
  const displayName = String(state.activeScenarioManifest.display_name || state.activeScenarioId || "").trim();
  const warning = String(state.scenarioDataHealth?.warning || "").trim();
  return warning ? `${displayName} · ${warning}` : displayName;
}

function formatScenarioAuditText() {
  if (!state.activeScenarioId || !state.activeScenarioManifest) {
    return "";
  }
  const splitCount = Number(state.activeScenarioManifest?.summary?.owner_controller_split_feature_count || 0);
  if (splitCount > 0) {
    return `${t("Frontline", "ui")}: ${splitCount} split features.`;
  }
  return t("No frontline control split in current scenario.", "ui");
}

function initScenarioManager({ render } = {}) {
  const scenarioSelect = document.getElementById("scenarioSelect");
  const applyScenarioBtn = document.getElementById("applyScenarioBtn");
  const resetScenarioBtn = document.getElementById("resetScenarioBtn");
  const clearScenarioBtn = document.getElementById("clearScenarioBtn");
  const scenarioStatus = document.getElementById("scenarioStatus");
  const scenarioAuditHint = document.getElementById("scenarioAuditHint");
  const scenarioViewModeLabel = document.getElementById("lblScenarioViewMode");
  const scenarioViewModeSelect = document.getElementById("scenarioViewModeSelect");

  const renderScenarioControls = () => {
    const entries = getScenarioRegistryEntries();
    if (scenarioSelect) {
      const currentValue = normalizeScenarioId(state.activeScenarioId || scenarioSelect.value);
      scenarioSelect.replaceChildren();
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = t("None", "ui");
      scenarioSelect.appendChild(emptyOption);
      entries.forEach((entry) => {
        const option = document.createElement("option");
        option.value = normalizeScenarioId(entry.scenario_id);
        option.textContent = String(entry.display_name || entry.scenario_id || "").trim();
        scenarioSelect.appendChild(option);
      });
      scenarioSelect.value = currentValue || "";
    }

    if (scenarioStatus) {
      scenarioStatus.textContent = formatScenarioStatusText();
    }
    if (scenarioAuditHint) {
      const auditText = formatScenarioAuditText();
      scenarioAuditHint.textContent = auditText;
      scenarioAuditHint.classList.toggle("hidden", !auditText);
    }
    if (scenarioViewModeSelect) {
      const hasScenario = !!state.activeScenarioId;
      const hasControllerData = Object.keys(state.scenarioControllersByFeatureId || {}).length > 0;
      const hasSplit = Number(state.activeScenarioManifest?.summary?.owner_controller_split_feature_count || 0) > 0;
      scenarioViewModeSelect.value = normalizeScenarioViewMode(state.scenarioViewMode);
      scenarioViewModeSelect.disabled = !hasScenario || !hasControllerData || !hasSplit;
      scenarioViewModeSelect.classList.toggle("hidden", !hasScenario);
      scenarioViewModeLabel?.classList.toggle("hidden", !hasScenario);
      scenarioViewModeSelect.title = hasSplit
        ? t("Toggle legal ownership vs frontline control.", "ui")
        : t("No frontline control split in current scenario.", "ui");
    }
    if (resetScenarioBtn) {
      resetScenarioBtn.textContent = t("Reset Changes To Baseline", "ui");
      resetScenarioBtn.disabled = !state.activeScenarioId;
      resetScenarioBtn.classList.toggle("hidden", !state.activeScenarioId);
    }
    if (clearScenarioBtn) {
      clearScenarioBtn.textContent = t("Exit Scenario", "ui");
      clearScenarioBtn.disabled = !state.activeScenarioId;
      clearScenarioBtn.classList.toggle("hidden", !state.activeScenarioId);
    }
    if (applyScenarioBtn) {
      const selectedScenarioId = normalizeScenarioId(scenarioSelect?.value);
      const isSelectedScenarioActive =
        !!selectedScenarioId && selectedScenarioId === normalizeScenarioId(state.activeScenarioId);
      applyScenarioBtn.textContent = t("Apply", "ui");
      applyScenarioBtn.disabled = !selectedScenarioId || isSelectedScenarioActive;
      applyScenarioBtn.classList.toggle("hidden", isSelectedScenarioActive);
    }
  };
  state.updateScenarioUIFn = renderScenarioControls;

  if (scenarioSelect && !scenarioSelect.dataset.bound) {
    scenarioSelect.addEventListener("change", () => {
      renderScenarioControls();
    });
    scenarioSelect.dataset.bound = "true";
  }

  if (scenarioViewModeSelect && !scenarioViewModeSelect.dataset.bound) {
    scenarioViewModeSelect.addEventListener("change", (event) => {
      const changed = setScenarioViewMode(event?.target?.value, {
        renderNow: true,
      });
      if (changed) {
        renderScenarioControls();
      }
    });
    scenarioViewModeSelect.dataset.bound = "true";
  }

  if (applyScenarioBtn && !applyScenarioBtn.dataset.bound) {
    applyScenarioBtn.addEventListener("click", async () => {
      const scenarioId = normalizeScenarioId(scenarioSelect?.value);
      if (!scenarioId) return;
      try {
        await applyScenarioById(scenarioId, {
          renderNow: true,
          markDirtyReason: "scenario-apply",
          showToastOnComplete: true,
        });
        renderScenarioControls();
        if (typeof render === "function") {
          render();
        }
      } catch (error) {
        console.error("Failed to apply scenario:", error);
        const message = String(error?.message || "").trim() || t("Unable to apply scenario.", "ui");
        showToast(message, {
          title: t("Scenario failed", "ui"),
          tone: "error",
          duration: 5200,
        });
      }
    });
    applyScenarioBtn.dataset.bound = "true";
  }

  if (resetScenarioBtn && !resetScenarioBtn.dataset.bound) {
    resetScenarioBtn.addEventListener("click", () => {
      if (!state.activeScenarioId) return;
      resetToScenarioBaseline({
        renderNow: true,
        markDirtyReason: "scenario-reset",
        showToastOnComplete: true,
      });
      renderScenarioControls();
      if (typeof render === "function") {
        render();
      }
    });
    resetScenarioBtn.dataset.bound = "true";
  }

  if (clearScenarioBtn && !clearScenarioBtn.dataset.bound) {
    clearScenarioBtn.addEventListener("click", () => {
      if (!state.activeScenarioId) return;
      clearActiveScenario({
        renderNow: true,
        markDirtyReason: "scenario-clear",
        showToastOnComplete: true,
      });
      renderScenarioControls();
      if (typeof render === "function") {
        render();
      }
    });
    clearScenarioBtn.dataset.bound = "true";
  }

  loadScenarioRegistry()
    .then(() => {
      renderScenarioControls();
    })
    .catch((error) => {
      console.warn("Unable to load scenario registry:", error);
      renderScenarioControls();
    });
}

export {
  applyScenarioBundle,
  applyScenarioById,
  clearActiveScenario,
  getScenarioDisplayOwnerByFeatureId,
  initScenarioManager,
  loadScenarioAuditPayload,
  loadScenarioBundle,
  loadScenarioRegistry,
  refreshScenarioShellOverlays,
  resetToScenarioBaseline,
  setScenarioViewMode,
  validateImportedScenarioBaseline,
};


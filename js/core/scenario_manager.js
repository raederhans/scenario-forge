import { countryNames, defaultCountryPalette, state } from "./state.js";
import { ensureSovereigntyState, resetAllFeatureOwnersToCanonical } from "./sovereignty_manager.js";
import { recomputeDynamicBordersNow, refreshColorState, setMapData } from "./map_renderer.js";
import { loadDeferredDetailBundle } from "./data_loader.js";
import { setActivePaletteSource, syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { markDirty } from "./dirty_state.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";

const SCENARIO_REGISTRY_URL = "data/scenarios/index.json";

function normalizeScenarioId(value) {
  return String(value || "").trim();
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
  const registry = await d3Client.json(SCENARIO_REGISTRY_URL);
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
}

async function loadScenarioBundle(scenarioId, { d3Client = globalThis.d3 } = {}) {
  const targetId = normalizeScenarioId(scenarioId);
  if (!targetId) {
    throw new Error("Scenario id is required.");
  }
  if (state.scenarioBundleCacheById?.[targetId]) {
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
  const manifest = await d3Client.json(meta.manifest_url);
  const [countriesPayload, ownersPayload, coresPayload] = await Promise.all([
    d3Client.json(manifest.countries_url),
    d3Client.json(manifest.owners_url),
    d3Client.json(manifest.cores_url),
  ]);
  const bundle = {
    meta,
    manifest,
    countriesPayload,
    ownersPayload,
    coresPayload,
    auditPayload: null,
  };
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
    const auditPayload = await d3Client.json(bundle.manifest.audit_url);
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
  syncScenarioUi();
  if (renderNow && typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
}

async function ensureScenarioDetailTopologyLoaded() {
  if (!state.detailDeferred || state.detailPromotionCompleted || state.detailPromotionInFlight) {
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
      return false;
    }
    state.topologyDetail = topologyDetail;
    state.runtimePoliticalTopology = runtimePoliticalTopology || state.runtimePoliticalTopology;
    state.topologyBundleMode = topologyBundleMode || "composite";
    state.detailDeferred = false;
    state.detailPromotionCompleted = true;
    state.detailSourceRequested = detailSourceUsed || state.detailSourceRequested;
    setMapData({ refitProjection: false, resetZoom: false });
    return true;
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
  await ensureScenarioDetailTopologyLoaded();
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
  const countryMap = bundle.countriesPayload?.countries || {};
  const owners = bundle.ownersPayload?.owners || {};
  const cores = bundle.coresPayload?.cores || {};
  const scenarioNameMap = getScenarioNameMap(countryMap);
  const scenarioColorMap = getScenarioFixedOwnerColors(countryMap);
  const defaultCountryCode = getScenarioDefaultCountryCode(bundle.manifest, countryMap);
  disableScenarioParentBorders();

  state.activeScenarioId = scenarioId;
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
  state.scenarioBaselineCoresByFeatureId = { ...cores };
  state.countryNames = {
    ...countryNames,
    ...scenarioNameMap,
  };
  state.sovereigntyByFeatureId = { ...owners };
  state.sovereigntyInitialized = false;
  ensureSovereigntyState({ force: true });
  state.visualOverrides = {};
  state.featureOverrides = {};
  state.sovereignBaseColors = { ...scenarioColorMap };
  state.countryBaseColors = { ...scenarioColorMap };
  state.activeSovereignCode = defaultCountryCode;
  syncScenarioInspectorSelection(defaultCountryCode);

  refreshColorState({ renderNow: false });
  recomputeDynamicBordersNow({ renderNow: false, reason: `scenario:${scenarioId}` });
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  syncCountryUi({ renderNow });

  if (showToastOnComplete) {
    showToast(t("Scenario applied.", "ui"), {
      title: t("Scenario loaded", "ui"),
      tone: "success",
    });
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
  state.sovereigntyByFeatureId = { ...(state.scenarioBaselineOwnersByFeatureId || {}) };
  state.sovereigntyInitialized = false;
  ensureSovereigntyState({ force: true });
  state.visualOverrides = {};
  state.featureOverrides = {};
  state.sovereignBaseColors = { ...(state.scenarioFixedOwnerColors || {}) };
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.activeSovereignCode = getScenarioDefaultCountryCode(
    state.activeScenarioManifest,
    state.scenarioCountriesByTag
  ) || String(state.activeSovereignCode || "").trim().toUpperCase();
  syncScenarioInspectorSelection(state.activeSovereignCode);
  setScenarioAuditUiState({
    loading: false,
    errorMessage: "",
  });
  state.scenarioBorderMode = "scenario_owner_only";
  disableScenarioParentBorders();
  refreshColorState({ renderNow: false });
  recomputeDynamicBordersNow({ renderNow: false, reason: `scenario-reset:${state.activeScenarioId}` });
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
  state.scenarioAudit = null;
  setScenarioAuditUiState({
    loading: false,
    loadedForScenarioId: "",
    errorMessage: "",
  });
  state.scenarioBaselineHash = "";
  state.scenarioBaselineOwnersByFeatureId = {};
  state.scenarioBaselineCoresByFeatureId = {};
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
  refreshColorState({ renderNow: false });
  recomputeDynamicBordersNow({ renderNow: false, reason: "scenario-clear" });
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
  const summary = state.activeScenarioManifest.summary || {};
  const owners = Number(summary.owner_count || 0);
  const features = Number(summary.feature_count || 0);
  return `${state.activeScenarioManifest.display_name || state.activeScenarioId} · ${owners} ${t("owners", "ui")} · ${features} ${t("features", "ui")}`;
}

function formatScenarioAuditText() {
  const summary = getScenarioManifestSummary();
  if (!state.activeScenarioId || !Object.keys(summary).length) {
    return t("Coverage report unavailable", "ui");
  }
  const hints = [
    `${t("Approximate", "ui")}: ${
      Number(summary.approximate_count)
      || Number(summary.quality_counts?.approx_existing_geometry)
      || 0
    }`,
  ];
  const criticalCheckCount = Number(
    summary.critical_region_check_count
    || summary.manual_reviewed_region_count
    || 0
  );
  if (criticalCheckCount > 0) {
    hints.push(`Critical checks: ${criticalCheckCount}`);
  }
  hints.push(`${t("Synthetic", "ui")}: ${
    Number(summary.synthetic_count)
    || Number(summary.synthetic_owner_feature_count)
    || 0
  }`);
  hints.push(`${t("Blockers", "ui")}: ${getScenarioBlockerCount(summary)}`);
  return hints.join(" · ");
}

function initScenarioManager({ render } = {}) {
  const scenarioSelect = document.getElementById("scenarioSelect");
  const applyScenarioBtn = document.getElementById("applyScenarioBtn");
  const resetScenarioBtn = document.getElementById("resetScenarioBtn");
  const clearScenarioBtn = document.getElementById("clearScenarioBtn");
  const scenarioStatus = document.getElementById("scenarioStatus");
  const scenarioAuditHint = document.getElementById("scenarioAuditHint");

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
      scenarioAuditHint.textContent = formatScenarioAuditText();
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
        showToast(t("Unable to apply scenario.", "ui"), {
          title: t("Scenario failed", "ui"),
          tone: "error",
          duration: 4200,
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
  initScenarioManager,
  loadScenarioAuditPayload,
  loadScenarioBundle,
  loadScenarioRegistry,
  resetToScenarioBaseline,
  validateImportedScenarioBaseline,
};

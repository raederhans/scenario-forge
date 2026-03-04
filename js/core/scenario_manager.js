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
  const [countriesPayload, ownersPayload, coresPayload, auditPayload] = await Promise.all([
    d3Client.json(manifest.countries_url),
    d3Client.json(manifest.owners_url),
    d3Client.json(manifest.cores_url),
    d3Client.json(manifest.audit_url),
  ]);
  const bundle = {
    meta,
    manifest,
    countriesPayload,
    ownersPayload,
    coresPayload,
    auditPayload,
  };
  state.scenarioBundleCacheById[targetId] = bundle;
  return bundle;
}

function syncScenarioUi() {
  if (typeof state.updateScenarioUIFn === "function") {
    state.updateScenarioUIFn();
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
    await setActivePaletteSource("hoi4_vanilla", {
      syncUI: true,
      overwriteCountryPalette: false,
    });
  }

  const scenarioId = normalizeScenarioId(bundle.manifest.scenario_id || bundle.meta?.scenario_id);
  const countryMap = bundle.countriesPayload?.countries || {};
  const owners = bundle.ownersPayload?.owners || {};
  const cores = bundle.coresPayload?.cores || {};
  const scenarioNameMap = getScenarioNameMap(countryMap);
  const scenarioColorMap = getScenarioFixedOwnerColors(countryMap);
  disableScenarioParentBorders();

  state.activeScenarioId = scenarioId;
  state.scenarioBorderMode = "scenario_owner_only";
  state.activeScenarioManifest = bundle.manifest || null;
  state.scenarioCountriesByTag = countryMap;
  state.scenarioFixedOwnerColors = scenarioColorMap;
  state.scenarioAudit = bundle.auditPayload || null;
  state.scenarioBaselineHash = String(
    bundle.manifest?.baseline_hash || bundle.ownersPayload?.baseline_hash || ""
  ).trim();
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
  state.activeSovereignCode = String(
    bundle.manifest?.default_country
    || Object.keys(countryMap)[0]
    || ""
  ).trim().toUpperCase();

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
  state.activeSovereignCode = String(
    state.activeScenarioManifest?.default_country
    || state.activeSovereignCode
    || ""
  ).trim().toUpperCase();
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
  if (!state.activeScenarioId || !state.scenarioAudit?.summary) {
    return t("Coverage report unavailable", "ui");
  }
  const summary = state.scenarioAudit.summary || {};
  return [
    `${t("Approximate", "ui")}: ${summary.quality_counts?.approx_existing_geometry || 0}`,
    `${t("Synthetic", "ui")}: ${summary.synthetic_owner_feature_count || 0}`,
    `${t("Blockers", "ui")}: ${summary.geometry_blocker_count || 0}`,
  ].join(" · ");
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
      resetScenarioBtn.disabled = !state.activeScenarioId;
    }
    if (clearScenarioBtn) {
      clearScenarioBtn.disabled = !state.activeScenarioId;
    }
    if (applyScenarioBtn) {
      applyScenarioBtn.disabled = !scenarioSelect?.value;
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
  loadScenarioBundle,
  loadScenarioRegistry,
  resetToScenarioBaseline,
};

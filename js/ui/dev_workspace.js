import { state } from "../core/state.js";
import * as mapRenderer from "../core/map_renderer.js";
import { getFeatureOwnerCode, markLegacyColorStateDirty } from "../core/sovereignty_manager.js";
import {
  filterEditableOwnershipFeatureIds,
  summarizeOwnershipForFeatureIds,
} from "../core/scenario_ownership_editor.js";
import { buildScenarioReleasableIndex, rebuildPresetState } from "../core/releasable_manager.js";
import { getScenarioCountryDisplayName } from "../core/scenario_country_display.js";
import { flushRenderBoundary } from "../core/render_boundary.js";
import { syncScenarioLocalizationState } from "../core/scenario_localization_state.js";
import { applyDeclarativeTranslations, buildTooltipModel, t } from "./i18n.js";
import { showToast } from "./toast.js";
import { createScenarioTagCreatorController } from "./dev_workspace/scenario_tag_creator_controller.js";
import { createSelectionOwnershipController } from "./dev_workspace/selection_ownership_controller.js";
import { createScenarioTextEditorsController } from "./dev_workspace/scenario_text_editors_controller.js";
import { createDistrictEditorController } from "./dev_workspace/district_editor_controller.js";

const DEV_WORKSPACE_STORAGE_KEY = "mapcreator_dev_workspace_expanded";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

function ui(key) {
  return t(key, "ui");
}

function flushDevWorkspaceRender(reason = "dev-workspace") {
  return flushRenderBoundary(reason);
}

function formatUi(key, replacements = {}) {
  let text = ui(key);
  Object.entries(replacements).forEach(([token, value]) => {
    text = text.split(`{${token}}`).join(String(value));
  });
  return text;
}

function localizeSelectionSummary(count) {
  return formatUi("{count} features selected.", { count });
}

function isLocalHost() {
  const host = String(globalThis.location?.hostname || "").trim().toLowerCase();
  return LOCAL_HOSTS.has(host);
}

function readStoredExpanded() {
  try {
    return localStorage.getItem(DEV_WORKSPACE_STORAGE_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

function writeStoredExpanded(nextValue) {
  try {
    localStorage.setItem(DEV_WORKSPACE_STORAGE_KEY, nextValue ? "1" : "0");
  } catch (_error) {
    // Ignore storage failures in dev-only UI state.
  }
}

function normalizeDevWorkspaceCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "scenario" || normalized === "runtime") {
    return normalized;
  }
  return "selection";
}

function resolveFeatureFromHit(hit) {
  if (!hit?.id) return null;
  if (hit.targetType === "special") return state.specialRegionsById?.get(hit.id) || null;
  if (hit.targetType === "water") return state.waterRegionsById?.get(hit.id) || null;
  return state.landIndex?.get(hit.id) || null;
}

function resolveFeatureName(feature, fallbackId = "") {
  const model = buildTooltipModel(feature);
  return String(model.regionName || model.lines?.[0] || fallbackId || "").trim();
}

function resolveNeighborCount(featureId) {
  const index = state.runtimeFeatureIndexById?.get(featureId);
  if (!Number.isInteger(index)) return "";
  const neighbors = state.runtimeNeighborGraph?.[index];
  return Array.isArray(neighbors) ? String(neighbors.filter((value) => Number.isInteger(value)).length) : "";
}

function sanitizeSelectionState() {
  const rawIds = Array.isArray(state.devSelectionOrder)
    ? state.devSelectionOrder.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const nextIds = [];
  const seen = new Set();
  rawIds.forEach((id) => {
    if (!id || seen.has(id)) return;
    const feature = state.landIndex?.get(id);
    if (!feature) return;
    seen.add(id);
    nextIds.push(id);
  });
  const changed = rawIds.length !== nextIds.length || rawIds.some((id, index) => id !== nextIds[index]);
  if (changed) {
    state.devSelectionOrder = nextIds;
    state.devSelectionFeatureIds = new Set(nextIds);
    state.devClipboardFallbackText = "";
    state.devSelectionOverlayDirty = true;
  } else if (!(state.devSelectionFeatureIds instanceof Set)) {
    state.devSelectionFeatureIds = new Set(nextIds);
  }
  return nextIds;
}

function resolveSelectionEntries() {
  return sanitizeSelectionState()
    .map((featureId, index) => {
      const feature = state.landIndex?.get(featureId);
      if (!feature) return null;
      return {
        id: featureId,
        index,
        name: resolveFeatureName(feature, featureId) || featureId,
      };
    })
    .filter(Boolean);
}

function sortSelectionEntries(entries = []) {
  const nextEntries = [...entries];
  if (state.devSelectionSortMode === "name") {
    nextEntries.sort((a, b) => {
      const nameDelta = a.name.localeCompare(b.name);
      if (nameDelta !== 0) return nameDelta;
      return a.id.localeCompare(b.id);
    });
  }
  return nextEntries;
}

function buildClipboardText(format = "names_with_ids") {
  const entries = sortSelectionEntries(resolveSelectionEntries());
  if (!entries.length) return "";
  if (format === "names") {
    return entries.map((entry) => entry.name).join("\n");
  }
  if (format === "ids") {
    return entries.map((entry) => entry.id).join("\n");
  }
  return entries.map((entry) => `${entry.name} | ${entry.id}`).join("\n");
}

function normalizeOwnerInput(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeScenarioTagInput(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeScenarioNameInput(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeScenarioColorInput(value) {
  const text = String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!text) return "";
  return text.startsWith("#") ? text : `#${text}`;
}

function sanitizeScenarioColorList(values = [], limit = 10) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeScenarioColorInput(value))
      .filter((color) => /^#[0-9A-F]{6}$/.test(color))
  )).slice(0, limit);
}

function resolveOwnershipTargetIds() {
  const selectedIds = filterEditableOwnershipFeatureIds(sanitizeSelectionState()).matchedIds;
  if (selectedIds.length > 0) {
    return selectedIds;
  }
  const selectedId = state.devSelectedHit?.targetType === "land"
    ? String(state.devSelectedHit.id || "").trim()
    : "";
  return filterEditableOwnershipFeatureIds(selectedId ? [selectedId] : []).matchedIds;
}

function resolveOwnershipEditorModel() {
  const targetIds = resolveOwnershipTargetIds();
  const summary = summarizeOwnershipForFeatureIds(targetIds);
  const singleFeatureId = targetIds.length === 1 ? targetIds[0] : "";
  const singleFeature = singleFeatureId ? state.landIndex?.get(singleFeatureId) || null : null;
  const currentOwnerCode = singleFeatureId ? normalizeOwnerInput(getFeatureOwnerCode(singleFeatureId)) : "";
  const currentControllerCode = singleFeatureId
    ? normalizeOwnerInput(state.scenarioControllersByFeatureId?.[singleFeatureId] || currentOwnerCode)
    : "";
  return {
    targetIds,
    selectionCount: targetIds.length,
    singleFeatureId,
    singleFeature,
    currentOwnerCode,
    currentControllerCode,
    ownerCodes: summary.ownerCodes,
    isMixedOwner: summary.isMixed,
  };
}

function buildOwnershipMetaRows(model) {
  if (!model.selectionCount) return [];
  if (model.singleFeatureId) {
    return [
      ["ID", model.singleFeatureId],
      [ui("Name"), resolveFeatureName(model.singleFeature, model.singleFeatureId)],
      [ui("Owner"), model.currentOwnerCode],
      [ui("Controller"), model.currentControllerCode],
    ].filter(([, value]) => String(value || "").trim());
  }
  return [
    [ui("Selected"), String(model.selectionCount)],
    [
      ui("Owner"),
      model.isMixedOwner
        ? `${ui("Mixed")} (${model.ownerCodes.join(", ")})`
        : (model.ownerCodes[0] || ui("Unknown")),
    ],
  ];
}

function resolveOwnershipEditorHint(model) {
  if (!state.activeScenarioId) {
    return ui("Activate a scenario to edit and save political ownership.");
  }
  if (!model.selectionCount) {
    return ui("Select one or more land features to edit political ownership.");
  }
  if (model.singleFeatureId) {
    return ui("Apply a new owner tag to the selected feature or reset it to the active scenario baseline.");
  }
  return ui("Apply one owner tag across the current selection or reset those features to the active scenario baseline.");
}

function collectScenarioCountryOptions({ includeReleasable = true } = {}) {
  return Object.entries(state.scenarioCountriesByTag || {})
    .map(([rawTag, rawEntry]) => {
      const tag = normalizeScenarioTagInput(rawTag || rawEntry?.tag);
      if (!tag || !rawEntry || typeof rawEntry !== "object") return null;
      const releasable = !!rawEntry.releasable || String(rawEntry.entry_kind || "").trim() === "releasable";
      if (!includeReleasable && releasable) return null;
      const displayName = getScenarioCountryDisplayName(rawEntry, state.countryNames?.[tag] || tag) || tag;
      const nameEn = normalizeScenarioNameInput(rawEntry.display_name_en || rawEntry.display_name || displayName || tag);
      const nameZh = normalizeScenarioNameInput(rawEntry.display_name_zh);
      const featureCount = Number(rawEntry.feature_count ?? rawEntry.controller_feature_count ?? 0) || 0;
      return {
        tag,
        entry: rawEntry,
        releasable,
        displayName,
        nameEn,
        nameZh,
        featureCount,
        label: `${displayName} (${tag})`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.tag.localeCompare(b.tag));
}

function resolvePreferredScenarioTagCode(...candidateValues) {
  const availableTags = new Set(collectScenarioCountryOptions().map((entry) => entry.tag));
  const ownershipModel = resolveOwnershipEditorModel();
  const inferredSelectionTag = ownershipModel.selectionCount > 0 && !ownershipModel.isMixedOwner
    ? normalizeScenarioTagInput(ownershipModel.currentOwnerCode || ownershipModel.ownerCodes?.[0])
    : "";
  const candidates = [
    ...candidateValues,
    inferredSelectionTag,
    normalizeScenarioTagInput(state.selectedInspectorCountryCode),
    normalizeScenarioTagInput(state.activeSovereignCode),
  ];
  return candidates
    .map((value) => normalizeScenarioTagInput(value))
    .find((value) => value && availableTags.has(value)) || "";
}

function resolveSingleSelectionScenarioTag(availableTags = null) {
  const tagSet = availableTags instanceof Set
    ? availableTags
    : new Set(
      (Array.isArray(availableTags) ? availableTags : collectScenarioCountryOptions())
        .map((entry) => normalizeScenarioTagInput(entry?.tag))
        .filter(Boolean)
    );
  const ownershipModel = resolveOwnershipEditorModel();
  if (ownershipModel.selectionCount <= 0 || ownershipModel.isMixedOwner) {
    return "";
  }
  const inferredSelectionTag = normalizeScenarioTagInput(
    ownershipModel.currentOwnerCode || ownershipModel.ownerCodes?.[0]
  );
  return inferredSelectionTag && tagSet.has(inferredSelectionTag) ? inferredSelectionTag : "";
}

function getActiveScenarioBundle() {
  const scenarioId = String(state.activeScenarioId || "").trim();
  if (!scenarioId || !state.scenarioBundleCacheById || typeof state.scenarioBundleCacheById !== "object") {
    return null;
  }
  return state.scenarioBundleCacheById[scenarioId] || null;
}

function syncActiveScenarioManifestUrl(field, nextValue) {
  const normalizedValue = String(nextValue || "").trim();
  if (!normalizedValue) return;
  state.activeScenarioManifest = {
    ...(state.activeScenarioManifest || {}),
    [field]: normalizedValue,
  };
  const bundle = getActiveScenarioBundle();
  if (bundle) {
    bundle.manifest = {
      ...(bundle.manifest || {}),
      [field]: normalizedValue,
    };
  }
}

function syncActiveScenarioBundleCountryEntry(tag, entry) {
  const bundle = getActiveScenarioBundle();
  if (!bundle || !tag || !entry) return;
  const priorCountriesPayload = bundle.countriesPayload && typeof bundle.countriesPayload === "object"
    ? bundle.countriesPayload
    : { countries: {} };
  const priorCountries = priorCountriesPayload.countries && typeof priorCountriesPayload.countries === "object"
    ? priorCountriesPayload.countries
    : {};
  bundle.countriesPayload = {
    ...priorCountriesPayload,
    countries: {
      ...priorCountries,
      [tag]: entry,
    },
  };
}

function syncActiveScenarioBundleAssignments(targetIds = [], ownerCode = "") {
  const bundle = getActiveScenarioBundle();
  const normalizedOwnerCode = normalizeScenarioTagInput(ownerCode);
  if (!bundle || !normalizedOwnerCode || !Array.isArray(targetIds) || !targetIds.length) return;
  const nextOwners = {
    ...((bundle.ownersPayload && typeof bundle.ownersPayload === "object" && bundle.ownersPayload.owners && typeof bundle.ownersPayload.owners === "object")
      ? bundle.ownersPayload.owners
      : {}),
  };
  targetIds.forEach((featureId) => {
    const id = String(featureId || "").trim();
    if (!id) return;
    nextOwners[id] = normalizedOwnerCode;
  });
  bundle.ownersPayload = {
    ...(bundle.ownersPayload || {}),
    owners: nextOwners,
  };
  if (bundle.controllersPayload && typeof bundle.controllersPayload === "object") {
    const nextControllers = {
      ...((bundle.controllersPayload.controllers && typeof bundle.controllersPayload.controllers === "object")
        ? bundle.controllersPayload.controllers
        : {}),
    };
    targetIds.forEach((featureId) => {
      const id = String(featureId || "").trim();
      if (!id) return;
      nextControllers[id] = normalizedOwnerCode;
    });
    bundle.controllersPayload = {
      ...bundle.controllersPayload,
      controllers: nextControllers,
    };
  }
  if (bundle.coresPayload && typeof bundle.coresPayload === "object") {
    const nextCores = {
      ...((bundle.coresPayload.cores && typeof bundle.coresPayload.cores === "object")
        ? bundle.coresPayload.cores
        : {}),
    };
    targetIds.forEach((featureId) => {
      const id = String(featureId || "").trim();
      if (!id) return;
      nextCores[id] = [normalizedOwnerCode];
    });
    bundle.coresPayload = {
      ...bundle.coresPayload,
      cores: nextCores,
    };
  }
}

function upsertRuntimeReleasableCatalogEntry(entry) {
  const normalizedTag = normalizeScenarioTagInput(entry?.tag);
  if (!normalizedTag || !entry || typeof entry !== "object") return;
  const replaceEntry = (catalog) => {
    const priorCatalog = catalog && typeof catalog === "object"
      ? catalog
      : { version: 1, entries: [] };
    const priorEntries = Array.isArray(priorCatalog.entries) ? priorCatalog.entries : [];
    return {
      ...priorCatalog,
      entries: [
        ...priorEntries.filter((item) => normalizeScenarioTagInput(item?.tag) !== normalizedTag),
        { ...entry, tag: normalizedTag },
      ],
    };
  };
  state.releasableCatalog = replaceEntry(state.releasableCatalog);
  const bundle = getActiveScenarioBundle();
  if (bundle) {
    bundle.releasableCatalog = replaceEntry(bundle.releasableCatalog);
  }
  state.scenarioReleasableIndex = buildScenarioReleasableIndex(state.activeScenarioId, {
    excludeTags: Object.keys(state.scenarioCountriesByTag || {}),
  });
  rebuildPresetState();
}

function upsertScenarioCountryRuntimeEntry(tag, entry) {
  const normalizedTag = normalizeScenarioTagInput(tag || entry?.tag);
  if (!normalizedTag || !entry || typeof entry !== "object") return null;
  const priorEntry = state.scenarioCountriesByTag?.[normalizedTag] && typeof state.scenarioCountriesByTag[normalizedTag] === "object"
    ? state.scenarioCountriesByTag[normalizedTag]
    : {};
  const nextEntry = {
    ...priorEntry,
    ...entry,
    tag: normalizedTag,
  };
  state.scenarioCountriesByTag = {
    ...(state.scenarioCountriesByTag || {}),
    [normalizedTag]: nextEntry,
  };
  const englishName = normalizeScenarioNameInput(
    nextEntry.display_name_en
    || nextEntry.display_name
    || state.countryNames?.[normalizedTag]
    || normalizedTag
  );
  if (englishName) {
    state.countryNames = {
      ...(state.countryNames || {}),
      [normalizedTag]: englishName,
    };
  }
  const colorHex = normalizeScenarioColorInput(nextEntry.color_hex);
  if (/^#[0-9A-F]{6}$/.test(colorHex)) {
    state.scenarioFixedOwnerColors = {
      ...(state.scenarioFixedOwnerColors || {}),
      [normalizedTag]: colorHex,
    };
    state.sovereignBaseColors = {
      ...(state.sovereignBaseColors || {}),
      [normalizedTag]: colorHex,
    };
    state.countryBaseColors = {
      ...(state.countryBaseColors || {}),
      [normalizedTag]: colorHex,
    };
    markLegacyColorStateDirty();
  }
  syncActiveScenarioBundleCountryEntry(normalizedTag, nextEntry);
  return nextEntry;
}

function syncRuntimeScenarioCityOverrides(payload) {
  if (!payload || typeof payload !== "object") return;
  state.scenarioCityOverridesData = payload;
  const bundle = getActiveScenarioBundle();
  if (bundle) {
    bundle.cityOverridesPayload = payload;
  }
  syncScenarioLocalizationState({
    cityOverridesPayload: payload,
    geoLocalePatchPayload: state.scenarioGeoLocalePatchData,
  });
}

function buildLowFeatureTagInspectorRows(threshold = 3) {
  const normalizedThreshold = Math.max(0, Number.parseInt(threshold, 10) || 0);
  const counts = new Map();
  state.landIndex?.forEach((_feature, featureId) => {
    const ownerCode = normalizeScenarioTagInput(getFeatureOwnerCode(featureId));
    if (!ownerCode) return;
    counts.set(ownerCode, (counts.get(ownerCode) || 0) + 1);
  });
  return collectScenarioCountryOptions({ includeReleasable: true })
    .filter((entry) => !entry.releasable)
    .map((entry) => ({
      ...entry,
      featureCountLive: counts.get(entry.tag) || 0,
      isHighlighted: normalizeScenarioTagInput(state.inspectorHighlightCountryCode) === entry.tag,
    }))
    .filter((entry) => entry.featureCountLive <= normalizedThreshold)
    .sort((a, b) => (a.featureCountLive - b.featureCountLive) || a.displayName.localeCompare(b.displayName) || a.tag.localeCompare(b.tag));
}

function renderScenarioTagInspectorDetails(container, row = null) {
  if (!container) return;
  if (!row) {
    container.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "dev-workspace-empty";
    empty.textContent = ui("No data yet.");
    container.appendChild(empty);
    return;
  }
  renderMetaRows(container, [
    [ui("Tag"), row.tag],
    [ui("Name"), row.displayName || row.nameEn || row.tag],
    [ui("Feature Count"), String(Number(row.featureCountLive || 0) || 0)],
  ]);
}

function renderCapitalEditorSearchResults(container, matches = [], query = "") {
  if (!container) return;
  container.replaceChildren();
  if (!matches.length) {
    if (normalizeScenarioNameInput(query)) {
      const empty = document.createElement("div");
      empty.className = "dev-workspace-empty";
      empty.textContent = ui("No matching countries.");
      container.appendChild(empty);
    }
    return;
  }
  matches.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.dataset.devCapitalSearchTag = entry.tag;
    button.style.display = "flex";
    button.style.width = "100%";
    button.style.justifyContent = "space-between";
    button.style.alignItems = "center";
    button.style.marginBottom = "0.35rem";

    const label = document.createElement("span");
    label.textContent = `${entry.tag} | ${entry.displayName || entry.nameEn || entry.nameZh || entry.tag}`;

    const meta = document.createElement("span");
    meta.textContent = entry.releasable ? ui("Releasable") : ui("Scenario Country");

    button.append(label, meta);
    container.appendChild(button);
  });
}

function selectScenarioCapitalEditorTag(tag, { clearSearch = false } = {}) {
  state.devScenarioCapitalEditor = {
    ...(state.devScenarioCapitalEditor || {}),
    tag: normalizeScenarioTagInput(tag),
    searchQuery: clearSearch ? "" : normalizeScenarioNameInput(state.devScenarioCapitalEditor?.searchQuery),
    lastSaveMessage: "",
    lastSaveTone: "",
  };
}

function normalizeLocaleInput(value) {
  return String(value || "").trim();
}

function getScenarioGeoLocaleEntry(featureId) {
  const normalizedFeatureId = String(featureId || "").trim();
  const baseEntry = normalizedFeatureId
    ? (state.baseGeoLocales?.[normalizedFeatureId] && typeof state.baseGeoLocales[normalizedFeatureId] === "object"
      ? state.baseGeoLocales[normalizedFeatureId]
      : null)
    : null;
  const patchEntry = normalizedFeatureId
    ? (state.scenarioGeoLocalePatchData?.geo?.[normalizedFeatureId]
      && typeof state.scenarioGeoLocalePatchData.geo[normalizedFeatureId] === "object"
      ? state.scenarioGeoLocalePatchData.geo[normalizedFeatureId]
      : null)
    : null;
  const effectiveEntry = normalizedFeatureId
    ? (state.locales?.geo?.[normalizedFeatureId] && typeof state.locales.geo[normalizedFeatureId] === "object"
      ? state.locales.geo[normalizedFeatureId]
      : null)
    : null;
  return {
    baseEntry,
    patchEntry,
    effectiveEntry,
    mergedEntry: {
      en: normalizeLocaleInput(effectiveEntry?.en || patchEntry?.en || baseEntry?.en || ""),
      zh: normalizeLocaleInput(effectiveEntry?.zh || patchEntry?.zh || baseEntry?.zh || ""),
    },
  };
}

function resolveInspectorRows() {
  const hit = state.devSelectedHit?.id ? state.devSelectedHit : state.devHoverHit;
  if (!hit?.id) {
    return {
      title: "No active feature",
      hint: ui("Hover a region or click one to inspect live debug metadata."),
      rows: [],
    };
  }

  const feature = resolveFeatureFromHit(hit);
  const tooltipModel = buildTooltipModel(feature);
  const detailTier = String(feature?.properties?.detail_tier || "").trim();
  const parentGroup =
    hit.targetType === "land" ? String(state.parentGroupByFeatureId?.get(hit.id) || "").trim() : "";
  const source = String(
    feature?.properties?.__source
      || (hit.targetType === "special" ? "scenario" : hit.targetType === "water" ? "context" : "primary")
  ).trim();
  const ownerCode = hit.targetType === "land"
    ? String(getFeatureOwnerCode(hit.id) || tooltipModel.countryCode || hit.countryCode || "").trim().toUpperCase()
    : "";
  const controllerCode = hit.targetType === "land"
    ? String(state.scenarioControllersByFeatureId?.[hit.id] || "").trim().toUpperCase()
    : "";

  const rows = [
    [ui("Target"), String(hit.targetType || "land")],
    [ui("Name"), resolveFeatureName(feature, hit.id)],
    ["ID", String(hit.id || "")],
    [ui("Country"), tooltipModel.countryCode ? `${tooltipModel.countryDisplayName || ""} (${tooltipModel.countryCode})` : ""],
    [ui("Parent Group"), parentGroup],
    [ui("Detail Tier"), detailTier],
    [ui("Owner"), ownerCode],
    [ui("Controller"), controllerCode],
    [ui("Scenario View"), String(state.scenarioViewMode || "ownership")],
    [ui("Hit Source"), String(hit.hitSource || "spatial")],
    [ui("Snap"), hit.viaSnap ? ui("Snap hit") : hit.strict ? ui("Strict hit") : ui("No")],
    [ui("Source Topology"), source],
    [ui("Neighbors"), resolveNeighborCount(hit.id)],
  ].filter(([, value]) => String(value || "").trim());

  return {
    title: resolveFeatureName(feature, hit.id),
    hint: tooltipModel.countryDisplayName || tooltipModel.countryCode || "",
    rows,
  };
}

function resolveRenderRows() {
  const renderPerf = state.renderPerfMetrics || {};
  const cache = state.renderPassCache || {};
  const frame = cache.lastFrame || {};
  const timings = frame.timings || {};
  const counters = cache.counters || {};
  const contextScenarioCacheReason = String(cache.reasons?.contextScenario || "");
  const contextScenarioPerfReason = String(renderPerf.contextScenarioExactRefresh?.reason || renderPerf.contextScenarioReuseSkipped?.reason || "");
  const contextScenarioReason = contextScenarioCacheReason || contextScenarioPerfReason;
  return [
    [ui("Render Profile"), String(state.renderProfile || "auto")],
    [ui("Bundle Mode"), String(state.topologyBundleMode || "single")],
    [ui("Detail Deferred"), state.detailDeferred ? ui("Yes") : ui("No")],
    [ui("Detail Source"), String(state.detailSourceRequested || "")],
    [ui("Phase"), String(state.renderPhase || "idle")],
    [ui("Last Frame"), Number.isFinite(Number(frame.totalMs)) ? `${Number(frame.totalMs).toFixed(1)}ms` : ""],
    [ui("Last Action"), String(cache.lastAction || "")],
    [ui("Action Time"), Number.isFinite(Number(cache.lastActionDurationMs)) ? `${Number(cache.lastActionDurationMs).toFixed(1)}ms` : ""],
    ["setMapData", Number.isFinite(Number(renderPerf.setMapData?.durationMs)) ? `${Number(renderPerf.setMapData.durationMs).toFixed(1)}ms` : ""],
    [ui("Spatial Index"), Number.isFinite(Number(renderPerf.buildSpatialIndex?.durationMs)) ? `${Number(renderPerf.buildSpatialIndex.durationMs).toFixed(1)}ms` : ""],
    [ui("Static Meshes"), Number.isFinite(Number(renderPerf.rebuildStaticMeshes?.durationMs)) ? `${Number(renderPerf.rebuildStaticMeshes.durationMs).toFixed(1)}ms` : ""],
    [ui("Hit Canvas"), Number.isFinite(Number(renderPerf.buildHitCanvas?.durationMs)) ? `${Number(renderPerf.buildHitCanvas.durationMs).toFixed(1)}ms` : ""],
    [ui("Dynamic Borders"), Number.isFinite(Number(renderPerf.rebuildDynamicBorders?.durationMs)) ? `${Number(renderPerf.rebuildDynamicBorders.durationMs).toFixed(1)}ms` : ""],
    [ui("Border Reason"), String(state.dynamicBordersDirtyReason || "")],
    [ui("Political Pass"), Number.isFinite(Number(timings.political)) ? `${Number(timings.political).toFixed(1)}ms` : ""],
    [ui("Borders Pass"), Number.isFinite(Number(timings.borders)) ? `${Number(timings.borders).toFixed(1)}ms` : ""],
    [ui("Context Scenario Reuse"), Number(counters.contextScenarioReuseCount || 0)],
    [ui("Context Scenario Exact"), Number(counters.contextScenarioExactRefreshCount || 0)],
    [ui("Context Scenario Reason"), contextScenarioReason],
    [ui("Context Scenario Cache Reason"), contextScenarioCacheReason],
    [ui("Context Scenario Perf Reason"), contextScenarioPerfReason],
    [ui("Context Scenario Reason Warnings"), Number(counters.contextScenarioReasonMismatchWarnings || 0)],
    [ui("Water Adaptive State Resets"), Number(counters.waterAdaptiveStateResetCount || 0)],
  ].filter(([, value]) => String(value || "").trim());
}

function resolveRuntimeRows() {
  const runtimeMeta = state.devRuntimeMeta;
  if (!runtimeMeta || typeof runtimeMeta !== "object") {
    return {
      title: "Runtime metadata unavailable",
      hint: isLocalHost()
        ? (state.devRuntimeMetaError || ui("Runtime metadata not available yet."))
        : ui("Runtime metadata is only available on the local dev server."),
      rows: [],
    };
  }
  return {
    title: String(runtimeMeta.url || "Local runtime"),
    hint: String(runtimeMeta.open_path || "/"),
    rows: [
      ["URL", String(runtimeMeta.url || "")],
      [ui("Port"), String(runtimeMeta.port || "")],
      ["PID", String(runtimeMeta.pid || "")],
      [ui("Started"), String(runtimeMeta.started_at || "")],
      [ui("Open Path"), String(runtimeMeta.open_path || "")],
      ["CWD", String(runtimeMeta.cwd || "")],
      [ui("Render Profile"), String(runtimeMeta.render_profile_default || "")],
      [ui("Topology Variant"), String(runtimeMeta.topology_variant || "")],
    ].filter(([, value]) => String(value || "").trim()),
  };
}

function renderMetaRows(container, rows) {
  if (!container) return;
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "dev-workspace-empty";
    empty.textContent = ui("No data yet.");
    container.appendChild(empty);
    return;
  }
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "dev-workspace-meta-row";

    const labelEl = document.createElement("div");
    labelEl.className = "dev-workspace-meta-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "dev-workspace-meta-value";
    valueEl.textContent = String(value || "");

    row.append(labelEl, valueEl);
    container.appendChild(row);
  });
}

function syncSelectOptions(select, options, { placeholderLabel = "", placeholderValue = "" } = {}) {
  if (!select) return;
  const normalizedOptions = [];
  if (placeholderLabel !== null) {
    normalizedOptions.push({
      value: String(placeholderValue ?? ""),
      label: String(placeholderLabel || ""),
    });
  }
  (Array.isArray(options) ? options : []).forEach((option) => {
    normalizedOptions.push({
      value: String(option?.value ?? ""),
      label: String(option?.label ?? option?.value ?? ""),
    });
  });
  const signature = normalizedOptions
    .map((option) => `${option.value}\u241f${option.label}`)
    .join("\u241e");
  if (select.dataset.optionSignature === signature) {
    return;
  }
  const fragment = document.createDocumentFragment();
  normalizedOptions.forEach((option) => {
    fragment.appendChild(new Option(option.label, option.value));
  });
  select.replaceChildren(fragment);
  select.dataset.optionSignature = signature;
}

async function loadRuntimeMeta() {
  if (!isLocalHost()) {
    state.devRuntimeMeta = null;
    state.devRuntimeMetaError = ui("Runtime metadata is only available on localhost.");
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  try {
    const url = new URL("/.runtime/dev/active_server.json", globalThis.location?.origin || globalThis.location?.href);
    url.searchParams.set("ts", String(Date.now()));
    const response = await fetch(url.href, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.devRuntimeMeta = await response.json();
    state.devRuntimeMetaError = "";
  } catch (error) {
    state.devRuntimeMeta = null;
    state.devRuntimeMetaError = String(error?.message || ui("Unable to fetch runtime metadata."));
  }
  state.updateDevWorkspaceUIFn?.();
}

function createDevWorkspacePanel(bottomDock) {
  let section = document.getElementById("devWorkspacePanel");
  if (section || !bottomDock) return section;

  section = document.createElement("section");
  section.id = "devWorkspacePanel";
  section.className = "dev-workspace-dock is-hidden";
  section.innerHTML = `
    <div class="dev-workspace-category-strip">
      <div class="dev-workspace-category-tabs" role="tablist" aria-label="Development workspace sections" data-i18n-aria-label="Development workspace sections">
        <button id="devWorkspaceTabSelection" type="button" class="dev-workspace-category-tab is-active" data-dev-workspace-category="selection" role="tab" aria-selected="true" data-i18n="Selection & Ownership">
          Selection &amp; Ownership
        </button>
        <button id="devWorkspaceTabScenario" type="button" class="dev-workspace-category-tab" data-dev-workspace-category="scenario" role="tab" aria-selected="false" data-i18n="Scenario Data">
          Scenario Data
        </button>
        <button id="devWorkspaceTabRuntime" type="button" class="dev-workspace-category-tab" data-dev-workspace-category="runtime" role="tab" aria-selected="false" data-i18n="Diagnostics & Runtime">
          Diagnostics &amp; Runtime
        </button>
      </div>
    </div>
    <div class="dev-workspace-grid">
      <div id="devScenarioOwnershipPanel" class="dev-workspace-panel hidden" data-dev-category="selection">
        <div id="devScenarioOwnershipLabel" class="dev-workspace-panel-title" data-i18n="Scenario Ownership Editor"></div>
        <div id="devScenarioOwnershipTitle" class="section-header-block"></div>
        <p id="devScenarioOwnershipHint" class="dev-workspace-note"></p>
        <div id="devScenarioOwnershipMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioOwnerInputLabel" class="dev-workspace-note" for="devScenarioOwnerInput" data-i18n="Target Owner Tag"></label>
        <input id="devScenarioOwnerInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="8" placeholder="GER" />
        <div class="dev-workspace-actions">
          <button id="devScenarioApplyOwnerBtn" type="button" class="btn-primary" data-i18n="Apply to Selection"></button>
          <button id="devScenarioResetOwnerBtn" type="button" class="btn-secondary" data-i18n="Reset Selection"></button>
          <button id="devScenarioSaveOwnersBtn" type="button" class="btn-secondary" data-i18n="Save Owners File"></button>
        </div>
        <div id="devScenarioOwnershipStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioTagCreatorPanel" class="dev-workspace-panel dev-workspace-panel-wide hidden" data-dev-category="scenario">
        <div id="devScenarioTagCreatorLabel" class="dev-workspace-panel-title" data-i18n="Scenario Tag Creator"></div>
        <div id="devScenarioTagCreatorTitle" class="section-header-block"></div>
        <p id="devScenarioTagCreatorHint" class="dev-workspace-note"></p>
        <div id="devScenarioTagCreatorMeta" class="dev-workspace-meta"></div>
        <div class="dev-workspace-form-grid">
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagLabel" class="dev-workspace-note" for="devScenarioTagInput" data-i18n="Tag"></label>
            <input id="devScenarioTagInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="4" placeholder="ABC" />
            <div id="devScenarioTagFieldStatus" class="dev-workspace-field-status"></div>
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagParentLabel" class="dev-workspace-note" for="devScenarioTagParentInput" data-i18n="Parent Owner Tag"></label>
            <input id="devScenarioTagParentInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="4" placeholder="GER" />
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagGroupSelectLabel" class="dev-workspace-note" for="devScenarioTagGroupSelect" data-i18n="Inspector Group"></label>
            <select id="devScenarioTagGroupSelect" class="select-input dev-workspace-select">
              <option value="" data-i18n="No Inspector Group"></option>
            </select>
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagNameEnLabel" class="dev-workspace-note" for="devScenarioTagNameEnInput" data-i18n="English Name"></label>
            <input id="devScenarioTagNameEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="New Country" />
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagNameZhLabel" class="dev-workspace-note" for="devScenarioTagNameZhInput" data-i18n="Chinese Name"></label>
            <input id="devScenarioTagNameZhInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="New Country" />
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagGroupIdLabel" class="dev-workspace-note" for="devScenarioTagGroupIdInput" data-i18n="New Group ID"></label>
            <input id="devScenarioTagGroupIdInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" placeholder="scenario_group_europe" />
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagGroupLabelLabel" class="dev-workspace-note" for="devScenarioTagGroupLabelInput" data-i18n="New Group Label"></label>
            <input id="devScenarioTagGroupLabelInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="Europe" />
          </div>
          <div class="dev-workspace-form-field dev-workspace-form-field-span-2">
            <label id="devScenarioTagGroupAnchorLabel" class="dev-workspace-note" for="devScenarioTagGroupAnchorSelect" data-i18n="Anchor Region"></label>
            <select id="devScenarioTagGroupAnchorSelect" class="select-input dev-workspace-select">
              <option value="" data-i18n="Select anchor region"></option>
            </select>
          </div>
          <div class="dev-workspace-form-field dev-workspace-form-field-span-2">
            <div class="dev-workspace-inline-row">
              <label id="devScenarioTagColorPaletteLabel" class="dev-workspace-note" for="devScenarioTagColorPreviewBtn" data-i18n="Color Palette"></label>
              <button id="devScenarioTagColorPreviewBtn" type="button" class="dev-workspace-color-preview-button">
                <span id="devScenarioTagColorPreview" class="dev-workspace-color-preview">#5D7CBA</span>
              </button>
            </div>
            <div id="devScenarioTagPalette" class="dev-workspace-swatch-grid" role="listbox" data-i18n-aria-label="Scenario tag color palette"></div>
            <div id="devScenarioTagRecentWrap" class="dev-workspace-form-field hidden">
              <label id="devScenarioTagRecentLabel" class="dev-workspace-note" for="devScenarioTagRecentColors" data-i18n="Recent Colors"></label>
              <div id="devScenarioTagRecentColors" class="dev-workspace-swatch-row" role="listbox" data-i18n-aria-label="Recent scenario tag colors"></div>
            </div>
            <div id="devScenarioTagColorPopoverAnchor" class="dev-workspace-color-popover-anchor">
              <div id="devScenarioTagColorPopover" class="dev-workspace-color-popover hidden" role="dialog" aria-modal="false">
                <div id="devScenarioTagColorPopoverLabel" class="dev-workspace-note" data-i18n="Custom Color"></div>
                <div class="dev-workspace-actions">
                  <button id="devScenarioTagColorSampleBtn" type="button" class="btn-secondary" data-i18n="Sample Selected"></button>
                  <button id="devScenarioTagColorCustomBtn" type="button" class="btn-secondary" data-i18n="Custom..."></button>
                </div>
              </div>
            </div>
            <input id="devScenarioTagColorInput" class="dev-workspace-native-color-input" type="color" value="#5d7cba" tabindex="-1" aria-hidden="true" />
          </div>
        </div>
        <div class="dev-workspace-actions">
          <button id="devScenarioClearTagSelectionBtn" type="button" class="btn-secondary" data-i18n="Clear Selection"></button>
          <button id="devScenarioClearTagBtn" type="button" class="btn-secondary" data-i18n="Clear"></button>
          <button id="devScenarioCreateTagBtn" type="button" class="btn-primary" data-i18n="Create Tag"></button>
        </div>
        <div id="devScenarioTagCreatorStatus" class="dev-workspace-note"></div>
      </div>
      <div class="dev-workspace-panel" data-dev-category="selection">
        <div id="devSelectionClipboardLabel" class="dev-workspace-panel-title" data-i18n="Selection Clipboard"></div>
        <div class="dev-workspace-actions">
          <button id="devSelectionAddHoveredBtn" type="button" class="btn-secondary" data-i18n="Add Hovered"></button>
          <button id="devSelectionToggleSelectedBtn" type="button" class="btn-secondary" data-i18n="Toggle Selected"></button>
          <button id="devSelectionRemoveLastBtn" type="button" class="btn-secondary" data-i18n="Remove Last"></button>
          <button id="devSelectionClearBtn" type="button" class="btn-secondary" data-i18n="Clear Selection"></button>
        </div>
        <div class="dev-workspace-actions">
          <label id="devSelectionSortLabel" class="dev-workspace-note" for="devSelectionSortMode" data-i18n="Sort"></label>
          <select id="devSelectionSortMode" class="select-input dev-workspace-select">
            <option value="selection" data-i18n="Selection Order"></option>
            <option value="name" data-i18n="Name"></option>
          </select>
        </div>
        <div class="dev-workspace-actions">
          <button id="devCopyNamesBtn" type="button" class="btn-primary" data-i18n="Copy Names"></button>
          <button id="devCopyNamesIdsBtn" type="button" class="btn-primary" data-i18n="Copy Names + ID"></button>
          <button id="devCopyIdsBtn" type="button" class="btn-primary" data-i18n="Copy ID"></button>
        </div>
        <div id="devSelectionSummary" class="dev-workspace-note"></div>
        <textarea id="devSelectionPreview" class="dev-selection-preview" readonly data-i18n-aria-label="Development selection preview"></textarea>
      </div>
      <div class="dev-workspace-panel" data-dev-category="selection">
        <div id="devFeatureInspectorLabel" class="dev-workspace-panel-title" data-i18n="Feature Inspector"></div>
        <div id="devFeatureInspectorTitle" class="section-header-block" data-i18n="No active feature"></div>
        <p id="devFeatureInspectorHint" class="dev-workspace-note" data-i18n="Hover a region or click one to inspect live debug metadata."></p>
        <div id="devFeatureInspectorMeta" class="dev-workspace-meta"></div>
      </div>
      <div id="devScenarioTagInspectorPanel" class="dev-workspace-panel hidden" data-dev-category="selection">
        <div id="devScenarioTagInspectorLabel" class="dev-workspace-panel-title" data-i18n="Tag Inspector"></div>
        <div id="devScenarioTagInspectorTitle" class="section-header-block"></div>
        <p id="devScenarioTagInspectorHint" class="dev-workspace-note"></p>
        <div id="devScenarioTagInspectorMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioTagInspectorThresholdLabel" class="dev-workspace-note" for="devScenarioTagInspectorThresholdInput" data-i18n="Low Feature Threshold"></label>
        <input id="devScenarioTagInspectorThresholdInput" class="input dev-workspace-input" type="number" min="0" max="999" step="1" />
        <label class="dev-workspace-note" for="devScenarioTagInspectorSelect">${ui("Scenario Tag")}</label>
        <select id="devScenarioTagInspectorSelect" class="select-input dev-workspace-select">
          <option value="">${ui("Select country")}</option>
        </select>
        <div class="dev-workspace-actions">
          <button id="devScenarioTagInspectorClearHighlightBtn" type="button" class="btn-secondary" data-i18n="Clear Highlight"></button>
        </div>
        <div id="devScenarioTagInspectorDetails" class="dev-workspace-meta"></div>
        <div id="devScenarioTagInspectorStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioCountryPanel" class="dev-workspace-panel hidden" data-dev-category="scenario">
        <div id="devScenarioCountryLabel" class="dev-workspace-panel-title" data-i18n="Country Name Editor"></div>
        <div id="devScenarioCountryTitle" class="section-header-block"></div>
        <p id="devScenarioCountryHint" class="dev-workspace-note"></p>
        <div id="devScenarioCountryMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioCountrySelectLabel" class="dev-workspace-note" for="devScenarioCountrySelect" data-i18n="Scenario Tag"></label>
        <select id="devScenarioCountrySelect" class="select-input dev-workspace-select">
          <option value="" data-i18n="Select country"></option>
        </select>
        <label id="devScenarioCountryNameEnLabel" class="dev-workspace-note" for="devScenarioCountryNameEnInput" data-i18n="English Name"></label>
        <input id="devScenarioCountryNameEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" />
        <label id="devScenarioCountryNameZhLabel" class="dev-workspace-note" for="devScenarioCountryNameZhInput" data-i18n="Chinese Name"></label>
        <input id="devScenarioCountryNameZhInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" />
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveCountryBtn" type="button" class="btn-primary" data-i18n="Save Country Names"></button>
        </div>
        <div id="devScenarioCountryStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioCapitalPanel" class="dev-workspace-panel hidden" data-dev-category="scenario">
        <div id="devScenarioCapitalLabel" class="dev-workspace-panel-title" data-i18n="Capital Editor"></div>
        <div id="devScenarioCapitalTitle" class="section-header-block"></div>
        <p id="devScenarioCapitalHint" class="dev-workspace-note"></p>
        <div id="devScenarioCapitalMeta" class="dev-workspace-meta"></div>
        <label class="dev-workspace-note" for="devScenarioCapitalSearchInput">${ui("Search country")}</label>
        <input id="devScenarioCapitalSearchInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" />
        <div id="devScenarioCapitalSearchResults" class="dev-workspace-meta"></div>
        <label id="devScenarioCapitalSelectLabel" class="dev-workspace-note" for="devScenarioCapitalSelect" data-i18n="Scenario Tag"></label>
        <select id="devScenarioCapitalSelect" class="select-input dev-workspace-select">
          <option value="" data-i18n="Select country"></option>
        </select>
        <div id="devScenarioCapitalCandidate" class="dev-workspace-note"></div>
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveCapitalBtn" type="button" class="btn-primary" data-i18n="Save Capital"></button>
        </div>
        <div id="devScenarioCapitalStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioDistrictPanel" class="dev-workspace-panel hidden" data-dev-category="scenario">
        <div id="devScenarioDistrictLabel" class="dev-workspace-panel-title" data-i18n="Scenario District Editor"></div>
        <div id="devScenarioDistrictTitle" class="section-header-block"></div>
        <p id="devScenarioDistrictHint" class="dev-workspace-note"></p>
        <div id="devScenarioDistrictMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioDistrictTagLabel" class="dev-workspace-note" for="devScenarioDistrictTagInput" data-i18n="Scenario Tag"></label>
        <input id="devScenarioDistrictTagInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="4" placeholder="FRA" />
        <div id="devScenarioDistrictTagModeNote" class="dev-workspace-note"></div>
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictUseSelectionBtn" type="button" class="btn-secondary" data-i18n="Use Selection Tag"></button>
          <button id="devScenarioDistrictClearBtn" type="button" class="btn-secondary" data-i18n="Clear"></button>
        </div>
        <label id="devScenarioDistrictSelectLabel" class="dev-workspace-note" for="devScenarioDistrictSelect" data-i18n="District"></label>
        <select id="devScenarioDistrictSelect" class="select-input dev-workspace-select">
          <option value="" data-i18n="Select district"></option>
        </select>
        <label id="devScenarioDistrictIdLabel" class="dev-workspace-note" for="devScenarioDistrictIdInput" data-i18n="District ID"></label>
        <input id="devScenarioDistrictIdInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="64" placeholder="berlin" />
        <label id="devScenarioDistrictNameEnLabel" class="dev-workspace-note" for="devScenarioDistrictNameEnInput" data-i18n="English Name"></label>
        <input id="devScenarioDistrictNameEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="Berlin" />
        <label id="devScenarioDistrictNameZhLabel" class="dev-workspace-note" for="devScenarioDistrictNameZhInput" data-i18n="Chinese Name"></label>
        <input id="devScenarioDistrictNameZhInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="Berlin" />
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictUpsertBtn" type="button" class="btn-secondary" data-i18n="Upsert District"></button>
          <button id="devScenarioDistrictAssignBtn" type="button" class="btn-secondary" data-i18n="Assign Selection"></button>
          <button id="devScenarioDistrictRemoveBtn" type="button" class="btn-secondary" data-i18n="Remove Selection"></button>
        </div>
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictDeleteBtn" type="button" class="btn-secondary" data-i18n="Delete Empty District"></button>
          <button id="devScenarioDistrictSaveBtn" type="button" class="btn-primary" data-i18n="Save Districts File"></button>
        </div>
        <label id="devScenarioDistrictTemplateLabel" class="dev-workspace-note" for="devScenarioDistrictTemplateTagInput" data-i18n="Shared Template Tag"></label>
        <input id="devScenarioDistrictTemplateTagInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="4" placeholder="FRA" />
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictPromoteBtn" type="button" class="btn-secondary" data-i18n="Promote To Shared Template"></button>
          <button id="devScenarioDistrictApplyTemplateBtn" type="button" class="btn-secondary" data-i18n="Apply Shared Template"></button>
        </div>
        <div id="devScenarioDistrictStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioLocalePanel" class="dev-workspace-panel hidden" data-dev-category="scenario">
        <div id="devScenarioLocaleLabel" class="dev-workspace-panel-title" data-i18n="Scenario Locale Editor"></div>
        <div id="devScenarioLocaleTitle" class="section-header-block"></div>
        <p id="devScenarioLocaleHint" class="dev-workspace-note"></p>
        <div id="devScenarioLocaleMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioLocaleEnLabel" class="dev-workspace-note" for="devScenarioLocaleEnInput" data-i18n="Localized EN"></label>
        <input id="devScenarioLocaleEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="Badghis" />
        <label id="devScenarioLocaleZhLabel" class="dev-workspace-note" for="devScenarioLocaleZhInput" data-i18n="Localized ZH"></label>
        <textarea id="devScenarioLocaleZhInput" class="input dev-workspace-input dev-workspace-textarea" rows="2" spellcheck="false" data-i18n-placeholder="Localized name"></textarea>
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveLocaleBtn" type="button" class="btn-secondary" data-i18n="Save Localized Names"></button>
        </div>
        <div id="devScenarioLocaleStatus" class="dev-workspace-note"></div>
      </div>
      <div class="dev-workspace-panel" data-dev-category="runtime">
        <div id="devRenderStatusLabel" class="dev-workspace-panel-title" data-i18n="Render Status"></div>
        <div id="devRenderStatusMeta" class="dev-workspace-meta"></div>
      </div>
      <div class="dev-workspace-panel" data-dev-category="runtime">
        <div id="devPaintMacrosLabel" class="dev-workspace-panel-title" data-i18n="Paint Macros"></div>
        <p id="devPaintMacrosHint" class="dev-workspace-note" data-i18n="These actions reuse the current tool mode and selected color or owner."></p>
        <div class="dev-workspace-actions">
          <button id="devMacroCountryBtn" type="button" class="btn-secondary" data-i18n="Fill Country"></button>
          <button id="devMacroParentBtn" type="button" class="btn-secondary" data-i18n="Fill Parent Group"></button>
          <button id="devMacroOwnerBtn" type="button" class="btn-secondary" data-i18n="Fill Owner Scope"></button>
          <button id="devMacroSelectionBtn" type="button" class="btn-secondary" data-i18n="Fill Multi-Selection"></button>
        </div>
      </div>
      <div class="dev-workspace-panel" data-dev-category="runtime">
        <div id="devLocalRuntimeLabel" class="dev-workspace-panel-title" data-i18n="Local Runtime"></div>
        <div id="devRuntimeTitle" class="section-header-block" data-i18n="Runtime metadata unavailable"></div>
        <p id="devRuntimeHint" class="dev-workspace-note"></p>
        <div id="devRuntimeMeta" class="dev-workspace-meta"></div>
      </div>
    </div>
  `;

  const dockPrimary = bottomDock.querySelector(".bottom-dock-primary");
  bottomDock.insertBefore(section, dockPrimary || null);
  applyDeclarativeTranslations(section);
  return section;
}

function createDevWorkspaceQuickbar(bottomDock) {
  let quickbar = document.getElementById("devWorkspaceQuickbar");
  if (quickbar || !bottomDock) return quickbar;

  quickbar = document.createElement("div");
  quickbar.id = "devWorkspaceQuickbar";
  quickbar.className = "dev-workspace-quickbar";
  quickbar.innerHTML = `
    <span class="dev-quickbar-badge" aria-hidden="true">DEV</span>
    <div class="dev-workspace-quick-meta">
      <div class="dev-quick-meta">
        <span class="dev-quick-label" data-i18n="Current Selection"></span>
        <span id="devQuickSelectionValue" class="dev-quick-value">0</span>
      </div>
      <div class="dev-quick-meta">
        <span class="dev-quick-label" data-i18n="Tag"></span>
        <span id="devQuickTagValue" class="dev-quick-value">--</span>
      </div>
      <div class="dev-quick-meta">
        <span class="dev-quick-label" data-i18n="Owner"></span>
        <span id="devQuickOwnerValue" class="dev-quick-value">--</span>
      </div>
      <div class="dev-quick-meta">
        <span class="dev-quick-label" data-i18n="Controller"></span>
        <span id="devQuickControllerValue" class="dev-quick-value">--</span>
      </div>
    </div>
    <div class="dev-workspace-quick-owner">
      <span class="dev-quick-label" data-i18n="Owner Tag"></span>
      <div class="dev-workspace-quick-owner-row">
        <input
          id="devQuickOwnerInput"
          class="input dev-workspace-input dev-workspace-quick-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="8"
          placeholder="GER"
          data-i18n-title="Enter owner tag (e.g. GER, FRA, BRA)"
        />
        <button id="devQuickUseTagBtn" type="button" class="btn-secondary" data-i18n="Use Selection Tag" data-i18n-title="Copy the selected feature's tag into the owner input"></button>
      </div>
    </div>
    <div class="dev-workspace-quick-actions" role="toolbar" aria-label="Development quick actions" data-i18n-aria-label="Development quick actions">
      <button id="devQuickApplyOwnerBtn" type="button" class="btn-primary" data-i18n="Apply to Selection" data-i18n-title="Set the owner tag for all selected features"></button>
      <button id="devQuickResetOwnerBtn" type="button" class="btn-secondary" data-i18n="Reset Selection" data-i18n-title="Clear owner assignment from selected features"></button>
    </div>
    <div class="dev-workspace-quick-secondary" role="toolbar" aria-label="Development utility actions" data-i18n-aria-label="Development utility actions">
      <button id="devQuickRebuildBordersBtn" type="button" class="btn-secondary" data-i18n="Recalculate Borders" data-i18n-title="Rebuild political borders based on current ownership"></button>
      <button id="devQuickSaveOwnersBtn" type="button" class="btn-secondary" data-i18n="Save Owners File" data-i18n-title="Export ownership data to a downloadable JSON file"></button>
    </div>
  `;

  const dockPrimary = bottomDock.querySelector(".bottom-dock-primary");
  bottomDock.insertBefore(quickbar, dockPrimary || null);
  applyDeclarativeTranslations(quickbar);
  return quickbar;
}

function bindButtonAction(button, action) {
  if (!button || button.dataset.bound === "true") return;
  button.addEventListener("click", action);
  button.dataset.bound = "true";
}

function updateToggleButton(toggleBtn) {
  if (!toggleBtn) return;
  const expanded = !!state.ui.devWorkspaceExpanded;
  toggleBtn.classList.toggle("is-active", expanded);
  toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-label", expanded ? ui("Hide development workspace") : ui("Show development workspace"));
  toggleBtn.setAttribute("title", expanded ? ui("Hide development workspace") : ui("Show development workspace"));
  toggleBtn.textContent = ui("Dev");
}

function syncDockState(bottomDock, expanded) {
  if (!bottomDock) return;
  bottomDock.classList.toggle("dev-workspace-mode", expanded);
  if (!expanded) return;

  state.ui.dockCollapsed = false;
  bottomDock.classList.remove("is-collapsed");
  const dockCollapseBtn = document.getElementById("dockCollapseBtn");
  if (dockCollapseBtn) {
    dockCollapseBtn.setAttribute("aria-pressed", "false");
    dockCollapseBtn.setAttribute("aria-label", t("Collapse quick dock", "ui"));
    dockCollapseBtn.setAttribute("title", t("Collapse", "ui"));
  }
}

function setExpandedState(nextValue, { bottomDock, panel, toggleBtn, persist = true } = {}) {
  const expanded = !!nextValue;
  state.ui.devWorkspaceExpanded = expanded;
  state.devSelectionModeEnabled = expanded;
  panel?.classList.toggle("is-hidden", !expanded);
  syncDockState(bottomDock, expanded);
  updateToggleButton(toggleBtn);
  state.updateDockCollapsedUiFn?.();
  if (persist) {
    writeStoredExpanded(expanded);
  }
  state.updateDevWorkspaceUIFn?.();
}

function copySelectionToClipboard(format, previewEl) {
  const text = buildClipboardText(format);
  state.devClipboardPreviewFormat = format;
  if (!text) {
    showToast(ui("No selected regions to copy."), {
      title: ui("Selection Clipboard"),
      tone: "warning",
    });
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  state.devClipboardFallbackText = text;
  if (!globalThis.navigator?.clipboard?.writeText) {
    previewEl?.focus();
    previewEl?.select();
    showToast(ui("Clipboard API unavailable. The preview text is selected for manual copy."), {
      title: ui("Selection Clipboard"),
      tone: "warning",
      duration: 4200,
    });
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  globalThis.navigator.clipboard.writeText(text)
    .then(() => {
      const entryCount = sortSelectionEntries(resolveSelectionEntries()).length;
      showToast(formatUi("Copied {count} region entries to the clipboard.", { count: entryCount }), {
        title: ui("Selection copied"),
        tone: "success",
      });
      state.updateDevWorkspaceUIFn?.();
    })
    .catch(() => {
      previewEl?.focus();
      previewEl?.select();
      showToast(ui("Clipboard write failed. The preview text is selected for manual copy."), {
        title: ui("Selection Clipboard"),
        tone: "warning",
        duration: 4200,
      });
      state.updateDevWorkspaceUIFn?.();
    });
}

function initDevWorkspace() {
  const bottomDock = document.getElementById("bottomDock");
  const toggleBtn = document.getElementById("devWorkspaceToggleBtn");
  if (!bottomDock) return;

  const quickbar = createDevWorkspaceQuickbar(bottomDock);
  const panel = createDevWorkspacePanel(bottomDock);
  if (!panel || !quickbar) return;
  const categoryTabButtons = Array.from(panel.querySelectorAll("[data-dev-workspace-category]"));

  const featureInspectorTitle = panel.querySelector("#devFeatureInspectorTitle");
  const featureInspectorHint = panel.querySelector("#devFeatureInspectorHint");
  const featureInspectorMeta = panel.querySelector("#devFeatureInspectorMeta");
  const scenarioTagCreatorPanel = panel.querySelector("#devScenarioTagCreatorPanel");
  const scenarioTagInspectorPanel = panel.querySelector("#devScenarioTagInspectorPanel");
  const scenarioTagInspectorTitle = panel.querySelector("#devScenarioTagInspectorTitle");
  const scenarioTagInspectorHint = panel.querySelector("#devScenarioTagInspectorHint");
  const scenarioTagInspectorMeta = panel.querySelector("#devScenarioTagInspectorMeta");
  const scenarioTagInspectorThresholdInput = panel.querySelector("#devScenarioTagInspectorThresholdInput");
  const scenarioTagInspectorSelect = panel.querySelector("#devScenarioTagInspectorSelect");
  const scenarioTagInspectorDetails = panel.querySelector("#devScenarioTagInspectorDetails");
  const scenarioTagInspectorStatus = panel.querySelector("#devScenarioTagInspectorStatus");
  const scenarioCountryPanel = panel.querySelector("#devScenarioCountryPanel");
  const scenarioCapitalPanel = panel.querySelector("#devScenarioCapitalPanel");
  const scenarioDistrictPanel = panel.querySelector("#devScenarioDistrictPanel");
  const scenarioLocalePanel = panel.querySelector("#devScenarioLocalePanel");
  const scenarioOwnershipPanel = panel.querySelector("#devScenarioOwnershipPanel");
  const devQuickRebuildBordersBtn = quickbar.querySelector("#devQuickRebuildBordersBtn");
  const renderStatusMeta = panel.querySelector("#devRenderStatusMeta");
  const runtimeTitle = panel.querySelector("#devRuntimeTitle");
  const runtimeHint = panel.querySelector("#devRuntimeHint");
  const runtimeMeta = panel.querySelector("#devRuntimeMeta");
  const selectionSummary = panel.querySelector("#devSelectionSummary");
  const selectionPreview = panel.querySelector("#devSelectionPreview");
  const selectionSortMode = panel.querySelector("#devSelectionSortMode");
  let scenarioTagCreatorController = null;
  let selectionOwnershipController = null;
  let scenarioTextEditorsController = null;
  let districtEditorController = null;
  if (!state.ui || typeof state.ui !== "object") {
    state.ui = {};
  }
  state.ui.devWorkspaceCategory = normalizeDevWorkspaceCategory(state.ui.devWorkspaceCategory);

  const renderWorkspace = () => {
    let activeDevCategory = normalizeDevWorkspaceCategory(state.ui.devWorkspaceCategory);
    state.ui.devWorkspaceCategory = activeDevCategory;

    const inspector = resolveInspectorRows();
    if (featureInspectorTitle) {
      featureInspectorTitle.textContent = inspector.title;
    }
    if (featureInspectorHint) {
      featureInspectorHint.textContent = inspector.hint || ui("Hover a region or click one to inspect live debug metadata.");
    }
    renderMetaRows(featureInspectorMeta, inspector.rows);

    const hasActiveScenario = !!String(state.activeScenarioId || "").trim();
    if (activeDevCategory === "scenario" && !hasActiveScenario) {
      activeDevCategory = "selection";
      state.ui.devWorkspaceCategory = activeDevCategory;
    }
    categoryTabButtons.forEach((button) => {
      const tabCategory = normalizeDevWorkspaceCategory(button.dataset.devWorkspaceCategory);
      const isActive = tabCategory === activeDevCategory;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    scenarioTagCreatorController?.render({ hasActiveScenario });

    scenarioTextEditorsController?.render({ hasActiveScenario });
    districtEditorController?.render({ hasActiveScenario });

    selectionOwnershipController?.render({ hasActiveScenario });
    if (devQuickRebuildBordersBtn) {
      devQuickRebuildBordersBtn.disabled = !state.dynamicBordersDirty;
    }

    const syncCategoryPanel = (panelElement, category, isAvailable = true) => {
      if (!panelElement) return;
      const isVisible = !!isAvailable && activeDevCategory === category;
      panelElement.classList.toggle("hidden", !isVisible);
    };
    syncCategoryPanel(scenarioOwnershipPanel, "selection", hasActiveScenario);
    syncCategoryPanel(scenarioTagInspectorPanel, "selection", hasActiveScenario);
    syncCategoryPanel(scenarioTagCreatorPanel, "scenario", hasActiveScenario);
    syncCategoryPanel(scenarioCountryPanel, "scenario", hasActiveScenario);
    syncCategoryPanel(scenarioCapitalPanel, "scenario", hasActiveScenario);
    syncCategoryPanel(scenarioDistrictPanel, "scenario", hasActiveScenario);
    syncCategoryPanel(scenarioLocalePanel, "scenario", hasActiveScenario);
    panel.querySelectorAll('.dev-workspace-panel[data-dev-category="selection"]:not(#devScenarioOwnershipPanel):not(#devScenarioTagInspectorPanel)').forEach((section) => {
      syncCategoryPanel(section, "selection", true);
    });
    panel.querySelectorAll('.dev-workspace-panel[data-dev-category="runtime"]').forEach((section) => {
      syncCategoryPanel(section, "runtime", true);
    });

    renderMetaRows(renderStatusMeta, resolveRenderRows());

    const runtime = resolveRuntimeRows();
    if (runtimeTitle) {
      runtimeTitle.textContent = runtime.title;
    }
    if (runtimeHint) {
      runtimeHint.textContent = runtime.hint;
    }
    renderMetaRows(runtimeMeta, runtime.rows);

    if (selectionSortMode && selectionSortMode.value !== state.devSelectionSortMode) {
      selectionSortMode.value = state.devSelectionSortMode;
    }

    const entries = sortSelectionEntries(resolveSelectionEntries());
    const entryCount = entries.length;
    if (selectionSummary) {
      selectionSummary.textContent = localizeSelectionSummary(entryCount);
    }
    if (selectionPreview) {
      selectionPreview.value = buildClipboardText(state.devClipboardPreviewFormat || "names_with_ids")
        || state.devClipboardFallbackText
        || "";
    }
    const hoveredSelectionId = state.devHoverHit?.targetType === "land"
      ? String(state.devHoverHit.id || "").trim()
      : "";
    const addHoveredBtn = panel.querySelector("#devSelectionAddHoveredBtn");
    if (addHoveredBtn) {
      addHoveredBtn.disabled = !hoveredSelectionId || !state.landIndex?.get(hoveredSelectionId);
    }

    [
      panel.querySelector("#devCopyNamesBtn"),
      panel.querySelector("#devCopyNamesIdsBtn"),
      panel.querySelector("#devCopyIdsBtn"),
      panel.querySelector("#devSelectionRemoveLastBtn"),
      panel.querySelector("#devSelectionClearBtn"),
      panel.querySelector("#devMacroSelectionBtn"),
    ].forEach((button) => {
      if (button) {
        button.disabled = entryCount === 0;
      }
    });
  };

  scenarioTagCreatorController = createScenarioTagCreatorController({
    panel,
    renderWorkspace,
    renderMetaRows,
    syncSelectOptions,
    normalizeOwnerInput,
    normalizeScenarioTagInput,
    normalizeScenarioNameInput,
    normalizeScenarioColorInput,
    sanitizeScenarioColorList,
    resolveFeatureName,
    sanitizeSelectionState,
    resolveOwnershipTargetIds,
    resolveOwnershipEditorModel,
    buildOwnershipMetaRows,
    flushDevWorkspaceRender,
    upsertScenarioCountryRuntimeEntry,
    syncActiveScenarioBundleAssignments,
    syncActiveScenarioManifestUrl,
    upsertRuntimeReleasableCatalogEntry,
  });
  selectionOwnershipController = createSelectionOwnershipController({
    panel,
    quickbar,
    renderWorkspace,
    renderMetaRows,
    normalizeOwnerInput,
    localizeSelectionSummary,
    resolveOwnershipTargetIds,
    resolveOwnershipEditorModel,
    resolveOwnershipEditorHint,
    buildOwnershipMetaRows,
  });
  scenarioTextEditorsController = createScenarioTextEditorsController({
    panel,
    renderWorkspace,
    renderMetaRows,
    syncSelectOptions,
    normalizeScenarioTagInput,
    normalizeScenarioNameInput,
    resolveFeatureName,
    resolveOwnershipTargetIds,
    collectScenarioCountryOptions,
    resolvePreferredScenarioTagCode,
    resolveSingleSelectionScenarioTag,
    upsertScenarioCountryRuntimeEntry,
    upsertRuntimeReleasableCatalogEntry,
    syncActiveScenarioManifestUrl,
    syncRuntimeScenarioCityOverrides,
    getScenarioGeoLocaleEntry,
    flushDevWorkspaceRender,
  });
  districtEditorController = createDistrictEditorController({
    panel,
    renderWorkspace,
    renderMetaRows,
    syncSelectOptions,
    normalizeScenarioNameInput,
    resolveOwnershipTargetIds,
    flushDevWorkspaceRender,
  });

  state.updateDevWorkspaceUIFn = renderWorkspace;
  state.setDevWorkspaceExpandedFn = (nextValue) => {
    setExpandedState(nextValue, { bottomDock, panel, toggleBtn });
  };

  bindButtonAction(toggleBtn, () => {
    const next = !state.ui.devWorkspaceExpanded;
    setExpandedState(next, { bottomDock, panel, toggleBtn });
    if (next) {
      loadRuntimeMeta();
      panel.scrollTop = 0;
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
  categoryTabButtons.forEach((button) => {
    bindButtonAction(button, () => {
      state.ui.devWorkspaceCategory = normalizeDevWorkspaceCategory(button.dataset.devWorkspaceCategory);
      panel.scrollTop = 0;
      renderWorkspace();
    });
  });

  bindButtonAction(panel.querySelector("#devSelectionAddHoveredBtn"), () => {
    const hoveredId = state.devHoverHit?.targetType === "land"
      ? String(state.devHoverHit.id || "").trim()
      : "";
    if (!hoveredId) {
      return;
    }
    mapRenderer.addFeatureToDevSelection(hoveredId);
  });
  bindButtonAction(panel.querySelector("#devSelectionToggleSelectedBtn"), () => {
    const selectedId = state.devSelectedHit?.targetType === "land" ? state.devSelectedHit.id : "";
    mapRenderer.toggleFeatureInDevSelection(selectedId);
  });
  bindButtonAction(panel.querySelector("#devSelectionRemoveLastBtn"), () => {
    mapRenderer.removeLastDevSelection();
  });
  bindButtonAction(panel.querySelector("#devSelectionClearBtn"), () => {
    mapRenderer.clearDevSelection();
  });

  bindButtonAction(panel.querySelector("#devMacroCountryBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentCountry();
  });
  bindButtonAction(panel.querySelector("#devMacroParentBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentParentGroup();
  });
  bindButtonAction(panel.querySelector("#devMacroOwnerBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentOwnerScope();
  });
  bindButtonAction(panel.querySelector("#devMacroSelectionBtn"), () => {
    mapRenderer.applyDevSelectionFill();
  });
  scenarioTagCreatorController.bindEvents();
  selectionOwnershipController.bindEvents();
  scenarioTextEditorsController.bindEvents();
  districtEditorController.bindEvents();
  bindButtonAction(devQuickRebuildBordersBtn, () => {
    const toolbarRebuildBtn = document.getElementById("recalculateBordersBtn");
    if (toolbarRebuildBtn instanceof HTMLButtonElement) {
      toolbarRebuildBtn.click();
    }
  });
  bindButtonAction(panel.querySelector("#devCopyNamesBtn"), () => {
    copySelectionToClipboard("names", selectionPreview);
  });
  bindButtonAction(panel.querySelector("#devCopyNamesIdsBtn"), () => {
    copySelectionToClipboard("names_with_ids", selectionPreview);
  });
  bindButtonAction(panel.querySelector("#devCopyIdsBtn"), () => {
    copySelectionToClipboard("ids", selectionPreview);
  });

  bindButtonAction(panel.querySelector("#devScenarioTagInspectorClearHighlightBtn"), () => {
    state.inspectorHighlightCountryCode = "";
    flushDevWorkspaceRender("dev-workspace-tag-inspector-clear-highlight");
    renderWorkspace();
  });

  if (scenarioTagInspectorThresholdInput && scenarioTagInspectorThresholdInput.dataset.bound !== "true") {
    scenarioTagInspectorThresholdInput.addEventListener("input", (event) => {
      state.devScenarioTagInspector = {
        ...(state.devScenarioTagInspector || {}),
        threshold: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
      };
      renderWorkspace();
    });
    scenarioTagInspectorThresholdInput.dataset.bound = "true";
  }

  if (scenarioTagInspectorSelect && scenarioTagInspectorSelect.dataset.bound !== "true") {
    scenarioTagInspectorSelect.addEventListener("change", (event) => {
      const tag = normalizeScenarioTagInput(event.target.value);
      if (!tag) return;
      state.devScenarioTagInspector = {
        ...(state.devScenarioTagInspector || {}),
        selectedTag: tag,
      };
      state.selectedInspectorCountryCode = tag;
      state.inspectorHighlightCountryCode = tag;
      flushDevWorkspaceRender("dev-workspace-tag-inspector-select");
      renderWorkspace();
    });
    scenarioTagInspectorSelect.dataset.bound = "true";
  }

  if (selectionSortMode && selectionSortMode.dataset.bound !== "true") {
    selectionSortMode.addEventListener("change", (event) => {
      state.devSelectionSortMode = String(event.target.value || "selection") === "name" ? "name" : "selection";
      renderWorkspace();
    });
    selectionSortMode.dataset.bound = "true";
  }

  const initialExpanded = !!state.ui.developerMode;
  setExpandedState(initialExpanded, {
    bottomDock,
    panel,
    toggleBtn,
    persist: false,
  });
  renderWorkspace();
  loadRuntimeMeta();
}

export { getScenarioGeoLocaleEntry, initDevWorkspace };

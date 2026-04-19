import { state } from "../core/state.js";
import * as mapRenderer from "../core/map_renderer.js";
import { getFeatureOwnerCode, markLegacyColorStateDirty } from "../core/sovereignty_manager.js";
import {
  applyOwnerToFeatureIds,
  buildScenarioOwnershipSavePayload,
  filterEditableOwnershipFeatureIds,
  resetOwnersToScenarioBaselineForFeatureIds,
  summarizeOwnershipForFeatureIds,
} from "../core/scenario_ownership_editor.js";
import { buildScenarioReleasableIndex, rebuildPresetState } from "../core/releasable_manager.js";
import {
  buildScenarioDistrictGroupByFeatureId,
  getScenarioDistrictTagRecord,
  normalizeScenarioDistrictGroupsPayload,
  normalizeScenarioDistrictTag,
} from "../core/scenario_districts.js";
import { getScenarioCountryDisplayName } from "../core/scenario_country_display.js";
import { flushRenderBoundary } from "../core/render_boundary.js";
import { syncScenarioLocalizationState } from "../core/scenario_localization_state.js";
import { applyDeclarativeTranslations, buildTooltipModel, t } from "./i18n.js";
import { showToast } from "./toast.js";
import { createScenarioTagCreatorController } from "./dev_workspace/scenario_tag_creator_controller.js";

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

function resolveCountryEditorModel() {
  const options = collectScenarioCountryOptions({ includeReleasable: true });
  const availableTags = new Set(options.map((entry) => entry.tag));
  const explicitTag = normalizeScenarioTagInput(state.devScenarioCountryEditor?.tag);
  const selectionTag = resolveSingleSelectionScenarioTag(availableTags);
  const fallbackTag = options.some((entry) => entry.tag === explicitTag)
    ? explicitTag
    : resolvePreferredScenarioTagCode(explicitTag);
  const tag = selectionTag || fallbackTag;
  const option = options.find((entry) => entry.tag === tag) || null;
  const entry = option?.entry || null;
  return {
    tag,
    option,
    entry,
    options,
    defaultNameEn: normalizeScenarioNameInput(entry?.display_name_en || entry?.display_name || ""),
    defaultNameZh: normalizeScenarioNameInput(entry?.display_name_zh),
  };
}

function buildCountryEditorMetaRows(model) {
  return [
    [ui("Tag"), model.tag],
    [ui("Name"), model.option?.displayName || ""],
    [ui("Feature Count"), String(Number(model.entry?.feature_count || 0) || 0)],
    [ui("Kind"), model.option?.releasable ? ui("Releasable") : ui("Scenario Country")],
    [ui("Parent"), normalizeScenarioTagInput(model.entry?.parent_owner_tag)],
  ].filter(([, value]) => String(value || "").trim());
}

function resolveCountryEditorHint(model) {
  if (!state.activeScenarioId) {
    return ui("Activate a scenario to edit country names.");
  }
  if (!model.tag) {
    return ui("Choose a scenario country tag to edit country names.");
  }
  return ui("Edit EN and CH for the selected country tag, then save the scenario country record.");
}

function resolveCapitalCandidateForFeature(featureId, tag) {
  const normalizedFeatureId = String(featureId || "").trim();
  const normalizedTag = normalizeScenarioTagInput(tag);
  if (!normalizedFeatureId || !normalizedTag) return null;
  const cityCollection = mapRenderer.getEffectiveCityCollection();
  const candidates = Array.isArray(cityCollection?.features)
    ? cityCollection.features.filter((feature) => String(feature?.properties?.__city_host_feature_id || "").trim() === normalizedFeatureId)
    : [];
  if (!candidates.length) return null;
  const priorHint = state.scenarioCityOverridesData?.capital_city_hints?.[normalizedTag] || null;
  const scoreCandidate = (feature) => {
    const props = feature?.properties || {};
    const cityId = String(props.__city_id || feature?.id || "").trim();
    const population = Math.max(0, Number(props.__city_population || 0));
    const label = String(
      props.label_en
      || props.name_en
      || props.label
      || props.name
      || cityId
    ).trim();
    return (
      (cityId && cityId === String(priorHint?.city_id || "").trim() ? 9_000_000_000_000 : 0)
      + (props.__city_is_country_capital ? 6_000_000_000_000 : 0)
      + (props.__city_is_capital ? 3_000_000_000_000 : 0)
      + population
      - (label ? label.charCodeAt(0) / 10_000 : 0)
    );
  };
  const sortedCandidates = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const feature = sortedCandidates[0];
  const props = feature?.properties || {};
  return {
    feature,
    cityId: String(props.__city_id || feature?.id || "").trim(),
    stableKey: String(props.__city_stable_key || props.stable_key || `id::${String(props.__city_id || feature?.id || "").trim()}`).trim(),
    cityName: String(props.label_en || props.name_en || props.label || props.name || feature?.id || "").trim(),
    nameAscii: String(props.name_en || props.label_en || props.label || props.name || "").trim(),
    countryCode: String(props.__city_country_code || props.country_code || "").trim().toUpperCase(),
    capitalKind: String(props.__city_capital_kind || props.__city_capital_type || "").trim(),
    population: Math.max(0, Number(props.__city_population || 0)) || 0,
    urbanMatchId: String(props.__city_urban_match_id || "").trim(),
    baseTier: String(props.__city_base_tier || "").trim(),
    lon: Array.isArray(feature?.geometry?.coordinates) ? Number(feature.geometry.coordinates[0]) : null,
    lat: Array.isArray(feature?.geometry?.coordinates) ? Number(feature.geometry.coordinates[1]) : null,
    capitalStateId: priorHint?.capital_state_id ?? state.scenarioCountriesByTag?.[normalizedTag]?.capital_state_id ?? null,
  };
}

function resolveCapitalEditorModel() {
  const options = collectScenarioCountryOptions({ includeReleasable: true });
  const explicitTag = normalizeScenarioTagInput(state.devScenarioCapitalEditor?.tag);
  const tag = options.some((entry) => entry.tag === explicitTag)
    ? explicitTag
    : resolvePreferredScenarioTagCode(explicitTag);
  const option = options.find((entry) => entry.tag === tag) || null;
  const entry = option?.entry || null;
  const targetIds = resolveOwnershipTargetIds();
  const featureId = targetIds.length === 1 ? targetIds[0] : "";
  const feature = featureId ? state.landIndex?.get(featureId) || null : null;
  const ownerCode = featureId ? normalizeScenarioTagInput(getFeatureOwnerCode(featureId)) : "";
  const ownerMatches = !!(featureId && tag && ownerCode === tag);
  const candidate = ownerMatches ? resolveCapitalCandidateForFeature(featureId, tag) : null;
  return {
    tag,
    option,
    entry,
    options,
    targetIds,
    selectionCount: targetIds.length,
    featureId,
    feature,
    ownerCode,
    ownerMatches,
    candidate,
  };
}

function buildCapitalEditorSearchMatches(query, options = []) {
  const normalizedQuery = normalizeScenarioNameInput(query);
  const queryLower = normalizedQuery.toLowerCase();
  const tagQuery = normalizeScenarioTagInput(query);
  if (!normalizedQuery) {
    return [];
  }
  return options
    .map((entry) => {
      const displayName = normalizeScenarioNameInput(entry?.displayName || "");
      const nameEn = normalizeScenarioNameInput(entry?.nameEn || displayName);
      const nameZh = normalizeScenarioNameInput(entry?.nameZh);
      const tag = normalizeScenarioTagInput(entry?.tag);
      const tagLower = tag.toLowerCase();
      const displayLower = displayName.toLowerCase();
      const nameEnLower = nameEn.toLowerCase();
      const nameZhLower = nameZh.toLowerCase();
      let score = 0;
      if (tagQuery && tag === tagQuery) {
        score = 500;
      } else if (tagQuery && tag.startsWith(tagQuery)) {
        score = 400;
      } else if (
        (displayLower && displayLower.startsWith(queryLower))
        || (nameEnLower && nameEnLower.startsWith(queryLower))
        || (nameZhLower && nameZhLower.startsWith(queryLower))
      ) {
        score = 300;
      } else if (tagQuery && tagLower.includes(tagQuery.toLowerCase())) {
        score = 200;
      } else if (
        (displayLower && displayLower.includes(queryLower))
        || (nameEnLower && nameEnLower.includes(queryLower))
        || (nameZhLower && nameZhLower.includes(queryLower))
      ) {
        score = 100;
      }
      if (!score) return null;
      return {
        ...entry,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (
      b.score - a.score
      || a.displayName.localeCompare(b.displayName)
      || a.tag.localeCompare(b.tag)
    ))
    .slice(0, 8);
}

function buildCapitalEditorMetaRows(model) {
  return [
    [ui("Tag"), model.tag],
    [ui("Feature"), model.featureId ? resolveFeatureName(model.feature, model.featureId) : ""],
    [ui("Owner"), model.ownerCode],
    [ui("Candidate"), model.candidate?.cityName || ""],
    [ui("Current Capital State"), String(model.entry?.capital_state_id ?? "")],
  ].filter(([, value]) => String(value || "").trim());
}

function resolveCapitalEditorHint(model) {
  if (!state.activeScenarioId) {
    return ui("Activate a scenario to edit capitals.");
  }
  if (model.selectionCount !== 1) {
    return ui("Select exactly one land feature to assign a capital.");
  }
  if (!model.tag) {
    return ui("Choose a country tag before assigning a capital.");
  }
  if (!model.ownerMatches) {
    return ui("The selected feature must be owned by the chosen country tag.");
  }
  if (!model.candidate?.cityId) {
    return ui("No city candidate was found on the selected feature.");
  }
  return ui("Save to move the selected country's capital to the chosen feature's best city candidate.");
}

function buildScenarioCountrySavePayload() {
  const model = resolveCountryEditorModel();
  const editorState = state.devScenarioCountryEditor || {};
  const nameEn = normalizeScenarioNameInput(editorState.nameEn);
  const nameZh = normalizeScenarioNameInput(editorState.nameZh);
  if (!state.activeScenarioId) {
    return { ok: false, message: ui("Activate a scenario to edit country names.") };
  }
  if (!model.tag) {
    return { ok: false, message: ui("Choose a scenario country tag first.") };
  }
  if (!nameEn || !nameZh) {
    return { ok: false, message: ui("Both English and Chinese country names are required.") };
  }
  return {
    ok: true,
    payload: {
      scenarioId: String(state.activeScenarioId || "").trim(),
      tag: model.tag,
      nameEn,
      nameZh,
    },
  };
}

function buildScenarioCapitalSavePayload() {
  const model = resolveCapitalEditorModel();
  if (!state.activeScenarioId) {
    return { ok: false, message: ui("Activate a scenario to edit capitals.") };
  }
  if (model.selectionCount !== 1 || !model.featureId) {
    return { ok: false, message: ui("Select exactly one land feature before saving a capital.") };
  }
  if (!model.tag) {
    return { ok: false, message: ui("Choose a scenario country tag before saving a capital.") };
  }
  if (!model.ownerMatches) {
    return { ok: false, message: ui("The selected feature is not owned by the chosen country tag.") };
  }
  if (!model.candidate?.cityId) {
    return { ok: false, message: ui("No city candidate was found for the selected feature.") };
  }
  return {
    ok: true,
    payload: {
      scenarioId: String(state.activeScenarioId || "").trim(),
      tag: model.tag,
      featureId: model.featureId,
      cityId: model.candidate.cityId,
      capitalStateId: model.candidate.capitalStateId,
      cityName: model.candidate.cityName,
      stableKey: model.candidate.stableKey,
      countryCode: model.candidate.countryCode,
      lookupIso2: String(model.entry?.lookup_iso2 || model.entry?.release_lookup_iso2 || model.tag || "").trim().toUpperCase(),
      baseIso2: String(model.entry?.base_iso2 || model.tag || "").trim().toUpperCase(),
      capitalKind: model.candidate.capitalKind,
      population: model.candidate.population,
      lon: model.candidate.lon,
      lat: model.candidate.lat,
      urbanMatchId: model.candidate.urbanMatchId,
      baseTier: model.candidate.baseTier,
      nameAscii: model.candidate.nameAscii,
    },
  };
}

function applyScenarioCountrySaveSuccess(response, payload) {
  const normalizedTag = normalizeScenarioTagInput(payload?.tag);
  if (!normalizedTag) return;
  const nextEntry = upsertScenarioCountryRuntimeEntry(normalizedTag, response?.countryEntry || {
    tag: normalizedTag,
    display_name: payload.nameEn,
    display_name_en: payload.nameEn,
    display_name_zh: payload.nameZh,
  });
  if (response?.catalogEntry && typeof response.catalogEntry === "object") {
    upsertRuntimeReleasableCatalogEntry(response.catalogEntry);
  }
  if (response?.catalogPath) {
    syncActiveScenarioManifestUrl("releasable_catalog_url", response.catalogPath);
  }
  state.devScenarioCountryEditor = {
    ...(state.devScenarioCountryEditor || {}),
    tag: normalizedTag,
    nameEn: normalizeScenarioNameInput(nextEntry?.display_name_en || payload.nameEn),
    nameZh: normalizeScenarioNameInput(nextEntry?.display_name_zh || payload.nameZh),
    lastSavedAt: String(response?.savedAt || ""),
    lastSavedPath: String(response?.filePath || response?.catalogPath || ""),
    lastSaveMessage: `${ui("Saved")}: ${String(response?.filePath || response?.catalogPath || normalizedTag)}`,
    lastSaveTone: "success",
  };
}

function applyScenarioCapitalSaveSuccess(response, payload) {
  const normalizedTag = normalizeScenarioTagInput(payload?.tag);
  if (!normalizedTag) return;
  const nextEntry = upsertScenarioCountryRuntimeEntry(normalizedTag, response?.countryEntry || {
    tag: normalizedTag,
    capital_state_id: payload.capitalStateId ?? null,
  });
  if (response?.catalogEntry && typeof response.catalogEntry === "object") {
    upsertRuntimeReleasableCatalogEntry(response.catalogEntry);
  }
  if (response?.catalogPath) {
    syncActiveScenarioManifestUrl("releasable_catalog_url", response.catalogPath);
  }
  const priorOverrides = state.scenarioCityOverridesData && typeof state.scenarioCityOverridesData === "object"
    ? state.scenarioCityOverridesData
    : {
      version: 1,
      scenario_id: String(state.activeScenarioId || "").trim(),
      generated_at: "",
      cities: {},
      capitals_by_tag: {},
      capital_city_hints: {},
    };
  const nextOverrides = {
    ...priorOverrides,
    scenario_id: String(state.activeScenarioId || "").trim(),
    generated_at: String(response?.savedAt || priorOverrides.generated_at || ""),
    capitals_by_tag: {
      ...(priorOverrides.capitals_by_tag || {}),
      [normalizedTag]: String(response?.cityOverrideEntry?.city_id || payload.cityId || "").trim(),
    },
    capital_city_hints: {
      ...(priorOverrides.capital_city_hints || {}),
      [normalizedTag]: response?.cityOverrideEntry || {
        tag: normalizedTag,
        city_id: String(payload.cityId || "").trim(),
        host_feature_id: String(payload.featureId || "").trim(),
        capital_state_id: payload.capitalStateId ?? nextEntry?.capital_state_id ?? null,
      },
    },
  };
  syncRuntimeScenarioCityOverrides(nextOverrides);
  if (response?.cityOverridesPath) {
    syncActiveScenarioManifestUrl("city_overrides_url", response.cityOverridesPath);
  }
  state.devScenarioCapitalEditor = {
    ...(state.devScenarioCapitalEditor || {}),
    tag: normalizedTag,
    lastSavedAt: String(response?.savedAt || ""),
    lastSavedPath: String(response?.cityOverridesPath || response?.filePath || ""),
    lastSaveMessage: `${ui("Saved")}: ${String(response?.cityOverridesPath || response?.filePath || normalizedTag)}`,
    lastSaveTone: "success",
  };
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

function updateDistrictEditorState(nextPartial = {}) {
  const current = state.devScenarioDistrictEditor || {};
  state.devScenarioDistrictEditor = {
    tagMode: "auto",
    manualTag: "",
    inferredTag: "",
    templateTag: "",
    ...current,
    ...nextPartial,
  };
}

function clearDistrictEditorForm({ preserveStatus = false } = {}) {
  const current = state.devScenarioDistrictEditor || {};
  updateDistrictEditorState({
    ...current,
    tag: "",
    tagMode: "auto",
    manualTag: "",
    inferredTag: "",
    templateTag: "",
    selectedDistrictId: "",
    nameEn: "",
    nameZh: "",
    loadedScenarioId: "",
    loadedTag: "",
    draftTag: null,
    isSaving: false,
    isTemplateSaving: false,
    isTemplateApplying: false,
    ...(preserveStatus
      ? {}
      : {
        lastSavedAt: "",
        lastSavedPath: "",
        lastSaveMessage: "",
        lastSaveTone: "",
      }),
  });
}

function setDistrictDraftTag(tag = "", draftTag = null, nextOverrides = {}) {
  const normalizedTag = normalizeScenarioDistrictTag(tag);
  const nextDraftTag = cloneDistrictTagRecord(normalizedTag, draftTag);
  const districtIds = Object.keys(nextDraftTag.districts || {});
  const requestedDistrictId = normalizeScenarioDistrictId(
    nextOverrides.selectedDistrictId ?? state.devScenarioDistrictEditor?.selectedDistrictId
  );
  const selectedDistrictId = districtIds.includes(requestedDistrictId)
    ? requestedDistrictId
    : (requestedDistrictId === "" ? "" : (districtIds[0] || ""));
  const selectedDistrict = selectedDistrictId ? nextDraftTag.districts?.[selectedDistrictId] || null : null;
  updateDistrictEditorState({
    tag: normalizedTag,
    loadedScenarioId: String(state.activeScenarioId || ""),
    loadedTag: normalizedTag,
    draftTag: nextDraftTag,
    selectedDistrictId,
    nameEn: normalizeScenarioNameInput(nextOverrides.nameEn ?? selectedDistrict?.name_en ?? ""),
    nameZh: normalizeScenarioNameInput(nextOverrides.nameZh ?? selectedDistrict?.name_zh ?? ""),
    templateTag: normalizeScenarioDistrictTag(nextOverrides.templateTag ?? state.devScenarioDistrictEditor?.templateTag ?? normalizedTag),
    ...nextOverrides,
  });
}

function syncScenarioDistrictState(tag = "", tagPayload = null) {
  const normalizedTag = normalizeScenarioDistrictTag(tag);
  const nextPayload = normalizeScenarioDistrictGroupsPayload(
    {
      ...(state.scenarioDistrictGroupsData || {}),
      scenario_id: String(state.activeScenarioId || ""),
      tags: {
        ...((state.scenarioDistrictGroupsData && state.scenarioDistrictGroupsData.tags) || {}),
        [normalizedTag]: tagPayload,
      },
    },
    state.activeScenarioId
  );
  state.scenarioDistrictGroupsData = nextPayload;
  state.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(nextPayload);
}

function normalizeScenarioDistrictId(value) {
  return String(value || "").trim().replace(/\s+/g, "_");
}

function cloneDistrictTagRecord(tag = "", record = null) {
  const normalizedTag = normalizeScenarioDistrictTag(tag);
  const districts = {};
  const sourceDistricts = record?.districts && typeof record.districts === "object" ? record.districts : {};
  Object.entries(sourceDistricts).forEach(([districtId, rawDistrict]) => {
    const normalizedDistrictId = normalizeScenarioDistrictId(rawDistrict?.id || rawDistrict?.district_id || districtId);
    if (!normalizedDistrictId) return;
    districts[normalizedDistrictId] = {
      id: normalizedDistrictId,
      name_en: normalizeScenarioNameInput(rawDistrict?.name_en || rawDistrict?.nameEn || ""),
      name_zh: normalizeScenarioNameInput(rawDistrict?.name_zh || rawDistrict?.nameZh || ""),
      feature_ids: Array.from(new Set(
        (Array.isArray(rawDistrict?.feature_ids) ? rawDistrict.feature_ids : [])
          .map((featureId) => String(featureId || "").trim())
          .filter(Boolean)
      )).sort((left, right) => left.localeCompare(right)),
    };
  });
  return {
    tag: normalizedTag,
    districts,
  };
}

function resolveSelectionScenarioTags(targetIds = []) {
  return Array.from(new Set(
    (Array.isArray(targetIds) ? targetIds : [])
      .map((featureId) => normalizeScenarioDistrictTag(state.sovereigntyByFeatureId?.[featureId]))
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function ensureDistrictDraftForTag(tag = "") {
  const normalizedTag = normalizeScenarioDistrictTag(tag);
  const priorState = state.devScenarioDistrictEditor || {};
  if (!normalizedTag || !state.activeScenarioId) {
    return {
      ...priorState,
      draftTag: null,
    };
  }
  const needsReload =
    String(priorState.loadedScenarioId || "") !== String(state.activeScenarioId || "")
    || normalizeScenarioDistrictTag(priorState.loadedTag) !== normalizedTag
    || !priorState.draftTag;
  if (!needsReload) {
    return priorState;
  }
  const savedTag = cloneDistrictTagRecord(
    normalizedTag,
    getScenarioDistrictTagRecord(state.scenarioDistrictGroupsData, normalizedTag)
  );
  const districtIds = Object.keys(savedTag.districts);
  const normalizedSelectedDistrictId = normalizeScenarioDistrictId(priorState.selectedDistrictId);
  const nextSelectedDistrictId = districtIds.includes(normalizedSelectedDistrictId)
    ? normalizedSelectedDistrictId
    : (normalizedSelectedDistrictId === "" ? "" : (districtIds[0] || ""));
  const selectedDistrict = nextSelectedDistrictId ? savedTag.districts[nextSelectedDistrictId] || null : null;
  const nextState = {
    ...priorState,
    tag: normalizedTag,
    loadedScenarioId: String(state.activeScenarioId || ""),
    loadedTag: normalizedTag,
    draftTag: savedTag,
    selectedDistrictId: nextSelectedDistrictId,
    nameEn: normalizeScenarioNameInput(selectedDistrict?.name_en || ""),
    nameZh: normalizeScenarioNameInput(selectedDistrict?.name_zh || ""),
    templateTag: normalizeScenarioDistrictTag(priorState.templateTag) || normalizedTag,
  };
  state.devScenarioDistrictEditor = nextState;
  return nextState;
}

function resetDistrictEditorForm({ clearStatus = true } = {}) {
  updateDistrictEditorState({
    tag: "",
    tagMode: "auto",
    manualTag: "",
    inferredTag: "",
    templateTag: "",
    selectedDistrictId: "",
    nameEn: "",
    nameZh: "",
    draftTag: null,
    loadedTag: "",
    loadedScenarioId: String(state.activeScenarioId || ""),
    ...(clearStatus
      ? {
        lastSaveMessage: "",
        lastSaveTone: "",
      }
      : {}),
  });
}

function resolveDistrictEditorModel() {
  const targetIds = resolveOwnershipTargetIds();
  const selectionTags = resolveSelectionScenarioTags(targetIds);
  const inferredTag = selectionTags.length === 1 ? selectionTags[0] : "";
  const editorBaseState = state.devScenarioDistrictEditor || {};
  const manualTag = normalizeScenarioDistrictTag(editorBaseState.manualTag);
  const isManualMode = editorBaseState.tagMode === "manual" && !!manualTag;
  const tagMode = isManualMode ? "manual" : "auto";
  const tag = tagMode === "manual" ? manualTag : inferredTag;
  const normalizedDistrictPayload = normalizeScenarioDistrictGroupsPayload(state.scenarioDistrictGroupsData, state.activeScenarioId);
  const legacyCountryCodes = Object.keys(normalizedDistrictPayload.legacy_countries || {});
  if (
    editorBaseState.inferredTag !== inferredTag
    || editorBaseState.tagMode !== tagMode
    || editorBaseState.tag !== tag
  ) {
    updateDistrictEditorState({
      inferredTag,
      tagMode,
      tag,
    });
  }
  const editorState = ensureDistrictDraftForTag(tag);
  const draftTag = editorState?.draftTag
    ? cloneDistrictTagRecord(tag, editorState.draftTag)
    : cloneDistrictTagRecord(tag, null);
  const districtEntries = Object.values(draftTag?.districts || {}).sort((left, right) => {
    const leftName = normalizeScenarioNameInput(left?.name_en || left?.name_zh || left?.id || "");
    const rightName = normalizeScenarioNameInput(right?.name_en || right?.name_zh || right?.id || "");
    return leftName.localeCompare(rightName) || String(left?.id || "").localeCompare(String(right?.id || ""));
  });
  const selectedDistrictId = normalizeScenarioDistrictId(editorState?.selectedDistrictId);
  const selectedDistrict = selectedDistrictId ? draftTag?.districts?.[selectedDistrictId] || null : null;
  return {
    targetIds,
    selectionCount: targetIds.length,
    selectionTags,
    tagMode,
    manualTag,
    inferredTag,
    tag,
    draftTag,
    districtEntries,
    selectedDistrictId,
    selectedDistrict,
    canInferTag: selectionTags.length === 1,
    canUseSelectionTag: !!inferredTag,
    hasEffectiveTag: !!tag,
    isAutoMode: tagMode === "auto",
    hasLegacyGeoCountryData: normalizedDistrictPayload.has_legacy_geo_countries,
    legacyCountryCodes,
    effectiveTemplateTag: normalizeScenarioDistrictTag(editorState?.templateTag) || tag,
  };
}

function buildDistrictMetaRows(model) {
  const rows = [];
  rows.push([ui("Mode"), model.isAutoMode ? ui("Auto") : ui("Manual")]);
  if (model.tag) {
    rows.push([ui("Scenario Tag"), model.tag]);
  }
  if (model.selectionTags.length > 1) {
    rows.push([ui("Selection Tags"), model.selectionTags.join(", ")]);
  }
  if (model.selectionCount) {
    rows.push([ui("Selected"), String(model.selectionCount)]);
  }
  if (model.hasLegacyGeoCountryData) {
    rows.push([ui("Legacy"), model.legacyCountryCodes.join(", ") || ui("Detected")]);
  }
  if (model.selectedDistrict) {
    rows.push([ui("District"), model.selectedDistrict.name_en || model.selectedDistrict.name_zh || model.selectedDistrict.id]);
    rows.push([ui("Feature Count"), String((model.selectedDistrict.feature_ids || []).length)]);
  } else if (model.districtEntries.length) {
    rows.push([ui("District Count"), String(model.districtEntries.length)]);
  }
  return rows.filter(([, value]) => String(value || "").trim());
}

function resolveDistrictEditorHint(model) {
  if (!state.activeScenarioId) {
    return ui("Activate a scenario to edit district groups.");
  }
  if (model.hasLegacyGeoCountryData) {
    return ui("Legacy geo-country districts detected. Migrate them before editing scenario-tag districts.");
  }
  if (!model.tag && model.isAutoMode) {
    return ui("Select land features owned by one scenario tag or type a tag manually to edit districts.");
  }
  if (!model.tag && !model.isAutoMode) {
    return ui("Type a scenario tag manually or switch back to the current selection tag.");
  }
  if (model.selectionTags.length > 1) {
    return ui("The current selection spans multiple scenario tags. District assignment only uses features owned by the active tag.");
  }
  if (!model.isAutoMode) {
    return ui("Manual scenario tag override is active. District assignment only uses features owned by the typed tag.");
  }
  return ui("Create or update a district, assign the current selection, then save the full scenario-tag payload.");
}

function buildDistrictSavePayload(model) {
  const districts = Object.values(model?.draftTag?.districts || {}).map((district) => ({
    districtId: normalizeScenarioDistrictId(district?.id),
    nameEn: normalizeScenarioNameInput(district?.name_en),
    nameZh: normalizeScenarioNameInput(district?.name_zh),
    featureIds: Array.from(new Set(
      (Array.isArray(district?.feature_ids) ? district.feature_ids : [])
        .map((featureId) => String(featureId || "").trim())
        .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right)),
  }));
  return {
    scenarioId: String(state.activeScenarioId || "").trim(),
    tag: normalizeScenarioDistrictTag(model?.tag),
    districts,
  };
}

function selectDistrictDraft(districtId = "") {
  const editorState = state.devScenarioDistrictEditor || {};
  const draftTag = cloneDistrictTagRecord(editorState.tag, editorState.draftTag);
  const normalizedDistrictId = normalizeScenarioDistrictId(districtId);
  const selectedDistrict = normalizedDistrictId ? draftTag.districts?.[normalizedDistrictId] || null : null;
  updateDistrictEditorState({
    draftTag,
    selectedDistrictId: normalizedDistrictId,
    nameEn: normalizeScenarioNameInput(selectedDistrict?.name_en || ""),
    nameZh: normalizeScenarioNameInput(selectedDistrict?.name_zh || ""),
  });
}

function upsertDistrictDraft(model) {
  const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
  const nameEn = normalizeScenarioNameInput(state.devScenarioDistrictEditor?.nameEn);
  const nameZh = normalizeScenarioNameInput(state.devScenarioDistrictEditor?.nameZh);
  if (!model.tag || !districtId || !nameEn || !nameZh) {
    return {
      ok: false,
      message: ui("Scenario tag, district id, English name, and Chinese name are required."),
    };
  }
  const nextDraftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
  const duplicateDistrict = Object.values(nextDraftTag.districts || {}).find((district) => {
    if (!district || String(district.id || "") === districtId) return false;
    return String(district.name_en || "").trim().toLowerCase() === nameEn.toLowerCase()
      || String(district.name_zh || "").trim().toLowerCase() === nameZh.toLowerCase();
  });
  if (duplicateDistrict) {
    return {
      ok: false,
      message: ui("District names must be unique within the selected scenario tag."),
    };
  }
  const priorDistrict = nextDraftTag.districts?.[districtId] || null;
  nextDraftTag.districts[districtId] = {
    id: districtId,
    name_en: nameEn,
    name_zh: nameZh,
    feature_ids: Array.isArray(priorDistrict?.feature_ids) ? [...priorDistrict.feature_ids] : [],
  };
  setDistrictDraftTag(model.tag, nextDraftTag, {
    selectedDistrictId: districtId,
    nameEn,
    nameZh,
  });
  updateDistrictEditorState({
    lastSaveMessage: priorDistrict ? ui("District draft updated.") : ui("District draft created."),
    lastSaveTone: "info",
  });
  return { ok: true };
}

function assignSelectionToDistrictDraft(model) {
  const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
  if (!model.tag || !districtId) {
    return {
      ok: false,
      message: ui("Select a scenario tag and district before assigning features."),
    };
  }
  const selectionIds = model.targetIds.filter((featureId) => {
    return normalizeScenarioDistrictTag(state.sovereigntyByFeatureId?.[featureId]) === model.tag;
  });
  if (!selectionIds.length) {
    return {
      ok: false,
      message: ui("Select one or more land features owned by the chosen scenario tag."),
    };
  }
  const nextDraftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
  const district = nextDraftTag.districts?.[districtId];
  if (!district) {
    return {
      ok: false,
      message: ui("Create the district before assigning features."),
    };
  }
  Object.values(nextDraftTag.districts || {}).forEach((entry) => {
    entry.feature_ids = (Array.isArray(entry.feature_ids) ? entry.feature_ids : []).filter(
      (featureId) => !selectionIds.includes(featureId)
    );
  });
  district.feature_ids = Array.from(new Set([
    ...(Array.isArray(district.feature_ids) ? district.feature_ids : []),
    ...selectionIds,
  ])).sort((left, right) => left.localeCompare(right));
  setDistrictDraftTag(model.tag, nextDraftTag, {
    selectedDistrictId: districtId,
  });
  updateDistrictEditorState({
    lastSaveMessage: ui("Selection assigned to the district draft."),
    lastSaveTone: "info",
  });
  return { ok: true, count: selectionIds.length };
}

function removeSelectionFromDistrictDraft(model) {
  const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
  if (!model.tag || !districtId) {
    return {
      ok: false,
      message: ui("Select a scenario tag and district before removing features."),
    };
  }
  const selectionIds = model.targetIds.filter((featureId) => {
    return normalizeScenarioDistrictTag(state.sovereigntyByFeatureId?.[featureId]) === model.tag;
  });
  if (!selectionIds.length) {
    return {
      ok: false,
      message: ui("Select one or more land features owned by the chosen scenario tag."),
    };
  }
  const nextDraftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
  const district = nextDraftTag.districts?.[districtId];
  if (!district) {
    return {
      ok: false,
      message: ui("Select a district before removing features."),
    };
  }
  const beforeCount = Array.isArray(district.feature_ids) ? district.feature_ids.length : 0;
  district.feature_ids = (Array.isArray(district.feature_ids) ? district.feature_ids : []).filter(
    (featureId) => !selectionIds.includes(featureId)
  );
  const removedCount = Math.max(beforeCount - district.feature_ids.length, 0);
  setDistrictDraftTag(model.tag, nextDraftTag, {
    selectedDistrictId: districtId,
  });
  updateDistrictEditorState({
    lastSaveMessage: removedCount > 0
      ? ui("Selection removed from the district draft.")
      : ui("Selected features were not assigned to the current district draft."),
    lastSaveTone: "info",
  });
  return { ok: true, changed: removedCount > 0, count: removedCount };
}

function deleteDistrictDraft(model) {
  const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
  if (!model.tag || !districtId) {
    return {
      ok: false,
      message: ui("Select a district before deleting it."),
    };
  }
  const nextDraftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
  const district = nextDraftTag.districts?.[districtId];
  if (!district) {
    return {
      ok: false,
      message: ui("Select a district before deleting it."),
    };
  }
  if (Array.isArray(district.feature_ids) && district.feature_ids.length > 0) {
    return {
      ok: false,
      message: ui("Remove all assigned features before deleting a district."),
    };
  }
  delete nextDraftTag.districts[districtId];
  setDistrictDraftTag(model.tag, nextDraftTag, {
    selectedDistrictId: "",
    nameEn: "",
    nameZh: "",
  });
  updateDistrictEditorState({
    lastSaveMessage: ui("District draft deleted."),
    lastSaveTone: "info",
  });
  return { ok: true };
}

function buildDistrictTemplatePayload(model, templateTag = "") {
  return {
    scenarioId: String(state.activeScenarioId || "").trim(),
    tag: normalizeScenarioDistrictTag(model?.tag),
    templateTag: normalizeScenarioDistrictTag(templateTag),
    districts: Object.values(model?.draftTag?.districts || {}).map((district) => ({
      districtId: normalizeScenarioDistrictId(district?.id),
      nameEn: normalizeScenarioNameInput(district?.name_en),
      nameZh: normalizeScenarioNameInput(district?.name_zh),
      featureIds: Array.from(new Set(
        (Array.isArray(district?.feature_ids) ? district.feature_ids : [])
          .map((featureId) => String(featureId || "").trim())
          .filter(Boolean)
      )).sort((left, right) => left.localeCompare(right)),
    })),
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

function resolveLocaleEditorModel() {
  const targetIds = resolveOwnershipTargetIds();
  const featureId = targetIds.length === 1 ? String(targetIds[0] || "").trim() : "";
  const feature = featureId ? state.landIndex?.get(featureId) || null : null;
  const localeEntry = getScenarioGeoLocaleEntry(featureId);
  return {
    featureId,
    feature,
    selectionCount: targetIds.length,
    hasScenario: !!String(state.activeScenarioId || "").trim(),
    hasGeoLocalePatch: !!String(state.activeScenarioManifest?.geo_locale_patch_url || "").trim(),
    ...localeEntry,
  };
}

function buildLocaleMetaRows(model) {
  if (!model.featureId || !model.feature) return [];
  const rows = [
    ["ID", model.featureId],
    [ui("Name"), resolveFeatureName(model.feature, model.featureId)],
    [ui("Current EN"), model.mergedEntry.en],
    [ui("Current ZH"), model.mergedEntry.zh],
  ];
  return rows.filter(([, value]) => String(value || "").trim());
}

function resolveLocaleEditorHint(model) {
  if (!model.hasScenario) {
    return ui("Activate a scenario to edit localized geo names.");
  }
  if (!model.hasGeoLocalePatch) {
    return ui("The active scenario does not declare a geo locale patch target.");
  }
  if (model.selectionCount !== 1 || !model.featureId) {
    return ui("Select exactly one land feature to edit localized geo names.");
  }
  return ui("Edit EN and ZH for the selected feature, then save to rebuild the active scenario locale patch.");
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
  const scenarioCountryPanel = panel.querySelector("#devScenarioCountryPanel");
  const scenarioCountryTitle = panel.querySelector("#devScenarioCountryTitle");
  const scenarioCountryHint = panel.querySelector("#devScenarioCountryHint");
  const scenarioCountryMeta = panel.querySelector("#devScenarioCountryMeta");
  const scenarioCountrySelect = panel.querySelector("#devScenarioCountrySelect");
  const scenarioCountryNameEnInput = panel.querySelector("#devScenarioCountryNameEnInput");
  const scenarioCountryNameZhInput = panel.querySelector("#devScenarioCountryNameZhInput");
  const scenarioCountryStatus = panel.querySelector("#devScenarioCountryStatus");
  const scenarioTagInspectorPanel = panel.querySelector("#devScenarioTagInspectorPanel");
  const scenarioTagInspectorTitle = panel.querySelector("#devScenarioTagInspectorTitle");
  const scenarioTagInspectorHint = panel.querySelector("#devScenarioTagInspectorHint");
  const scenarioTagInspectorMeta = panel.querySelector("#devScenarioTagInspectorMeta");
  const scenarioTagInspectorThresholdInput = panel.querySelector("#devScenarioTagInspectorThresholdInput");
  const scenarioTagInspectorSelect = panel.querySelector("#devScenarioTagInspectorSelect");
  const scenarioTagInspectorDetails = panel.querySelector("#devScenarioTagInspectorDetails");
  const scenarioTagInspectorStatus = panel.querySelector("#devScenarioTagInspectorStatus");
  const scenarioCapitalPanel = panel.querySelector("#devScenarioCapitalPanel");
  const scenarioCapitalTitle = panel.querySelector("#devScenarioCapitalTitle");
  const scenarioCapitalHint = panel.querySelector("#devScenarioCapitalHint");
  const scenarioCapitalMeta = panel.querySelector("#devScenarioCapitalMeta");
  const scenarioCapitalSearchInput = panel.querySelector("#devScenarioCapitalSearchInput");
  const scenarioCapitalSearchResults = panel.querySelector("#devScenarioCapitalSearchResults");
  const scenarioCapitalSelect = panel.querySelector("#devScenarioCapitalSelect");
  const scenarioCapitalCandidate = panel.querySelector("#devScenarioCapitalCandidate");
  const scenarioCapitalStatus = panel.querySelector("#devScenarioCapitalStatus");
  const scenarioDistrictPanel = panel.querySelector("#devScenarioDistrictPanel");
  const scenarioDistrictTitle = panel.querySelector("#devScenarioDistrictTitle");
  const scenarioDistrictHint = panel.querySelector("#devScenarioDistrictHint");
  const scenarioDistrictMeta = panel.querySelector("#devScenarioDistrictMeta");
  const scenarioDistrictTagInput = panel.querySelector("#devScenarioDistrictTagInput");
  const scenarioDistrictTagModeNote = panel.querySelector("#devScenarioDistrictTagModeNote");
  const scenarioDistrictUseSelectionBtn = panel.querySelector("#devScenarioDistrictUseSelectionBtn");
  const scenarioDistrictClearBtn = panel.querySelector("#devScenarioDistrictClearBtn");
  const scenarioDistrictSelect = panel.querySelector("#devScenarioDistrictSelect");
  const scenarioDistrictIdInput = panel.querySelector("#devScenarioDistrictIdInput");
  const scenarioDistrictNameEnInput = panel.querySelector("#devScenarioDistrictNameEnInput");
  const scenarioDistrictNameZhInput = panel.querySelector("#devScenarioDistrictNameZhInput");
  const scenarioDistrictTemplateTagInput = panel.querySelector("#devScenarioDistrictTemplateTagInput");
  const scenarioDistrictPromoteBtn = panel.querySelector("#devScenarioDistrictPromoteBtn");
  const scenarioDistrictApplyTemplateBtn = panel.querySelector("#devScenarioDistrictApplyTemplateBtn");
  const scenarioDistrictStatus = panel.querySelector("#devScenarioDistrictStatus");
  const scenarioLocalePanel = panel.querySelector("#devScenarioLocalePanel");
  const scenarioLocaleTitle = panel.querySelector("#devScenarioLocaleTitle");
  const scenarioLocaleHint = panel.querySelector("#devScenarioLocaleHint");
  const scenarioLocaleMeta = panel.querySelector("#devScenarioLocaleMeta");
  const scenarioLocaleEnInput = panel.querySelector("#devScenarioLocaleEnInput");
  const scenarioLocaleZhInput = panel.querySelector("#devScenarioLocaleZhInput");
  const scenarioLocaleStatus = panel.querySelector("#devScenarioLocaleStatus");
  const scenarioOwnershipPanel = panel.querySelector("#devScenarioOwnershipPanel");
  const scenarioOwnershipTitle = panel.querySelector("#devScenarioOwnershipTitle");
  const scenarioOwnershipHint = panel.querySelector("#devScenarioOwnershipHint");
  const scenarioOwnershipMeta = panel.querySelector("#devScenarioOwnershipMeta");
  const scenarioOwnerInput = panel.querySelector("#devScenarioOwnerInput");
  const devQuickSelectionValue = quickbar.querySelector("#devQuickSelectionValue");
  const devQuickTagValue = quickbar.querySelector("#devQuickTagValue");
  const devQuickOwnerValue = quickbar.querySelector("#devQuickOwnerValue");
  const devQuickControllerValue = quickbar.querySelector("#devQuickControllerValue");
  const devQuickOwnerInput = quickbar.querySelector("#devQuickOwnerInput");
  const devQuickUseTagBtn = quickbar.querySelector("#devQuickUseTagBtn");
  const devQuickApplyOwnerBtn = quickbar.querySelector("#devQuickApplyOwnerBtn");
  const devQuickResetOwnerBtn = quickbar.querySelector("#devQuickResetOwnerBtn");
  const devQuickRebuildBordersBtn = quickbar.querySelector("#devQuickRebuildBordersBtn");
  const devQuickSaveOwnersBtn = quickbar.querySelector("#devQuickSaveOwnersBtn");
  const scenarioOwnershipStatus = panel.querySelector("#devScenarioOwnershipStatus");
  const renderStatusMeta = panel.querySelector("#devRenderStatusMeta");
  const runtimeTitle = panel.querySelector("#devRuntimeTitle");
  const runtimeHint = panel.querySelector("#devRuntimeHint");
  const runtimeMeta = panel.querySelector("#devRuntimeMeta");
  const selectionSummary = panel.querySelector("#devSelectionSummary");
  const selectionPreview = panel.querySelector("#devSelectionPreview");
  const selectionSortMode = panel.querySelector("#devSelectionSortMode");
  let scenarioTagCreatorController = null;
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

    const priorCountryEditorState = state.devScenarioCountryEditor || {};
    const countryModel = resolveCountryEditorModel();
    const currentCountryTag = normalizeScenarioTagInput(priorCountryEditorState.tag);
    const hasValidCountryTag = !!currentCountryTag && countryModel.options.some((entry) => entry.tag === currentCountryTag);
    const needsCountryPrefill = !!countryModel.tag && (!hasValidCountryTag || currentCountryTag !== countryModel.tag);
    const countryEditorState = needsCountryPrefill
      ? {
        ...priorCountryEditorState,
        tag: countryModel.tag,
        nameEn: countryModel.defaultNameEn,
        nameZh: countryModel.defaultNameZh,
      }
      : priorCountryEditorState;
    if (needsCountryPrefill) {
      state.devScenarioCountryEditor = countryEditorState;
    }
    scenarioCountryPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioCountryTitle) {
      scenarioCountryTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioCountryHint) {
      scenarioCountryHint.textContent = resolveCountryEditorHint(countryModel);
    }
    renderMetaRows(scenarioCountryMeta, buildCountryEditorMetaRows(countryModel));
    if (scenarioCountrySelect) {
      syncSelectOptions(
        scenarioCountrySelect,
        countryModel.options.map((entry) => ({ value: entry.tag, label: entry.label })),
        { placeholderLabel: ui("Select country") }
      );
      if (scenarioCountrySelect.value !== (countryEditorState.tag || "")) {
        scenarioCountrySelect.value = countryEditorState.tag || "";
      }
      scenarioCountrySelect.disabled = !hasActiveScenario || !!countryEditorState.isSaving;
    }
    if (scenarioCountryNameEnInput && scenarioCountryNameEnInput.value !== normalizeScenarioNameInput(countryEditorState.nameEn)) {
      scenarioCountryNameEnInput.value = normalizeScenarioNameInput(countryEditorState.nameEn);
    }
    if (scenarioCountryNameZhInput && scenarioCountryNameZhInput.value !== normalizeScenarioNameInput(countryEditorState.nameZh)) {
      scenarioCountryNameZhInput.value = normalizeScenarioNameInput(countryEditorState.nameZh);
    }
    if (scenarioCountryNameEnInput) {
      scenarioCountryNameEnInput.disabled = !hasActiveScenario || !!countryEditorState.isSaving || !countryModel.tag;
      scenarioCountryNameEnInput.placeholder = countryModel.defaultNameEn || ui("New Country");
    }
    if (scenarioCountryNameZhInput) {
      scenarioCountryNameZhInput.disabled = !hasActiveScenario || !!countryEditorState.isSaving || !countryModel.tag;
      scenarioCountryNameZhInput.placeholder = countryModel.defaultNameZh || ui("New Country");
    }
    const saveCountryBtn = panel.querySelector("#devScenarioSaveCountryBtn");
    const canSaveCountry = hasActiveScenario
      && !!countryModel.tag
      && !!normalizeScenarioNameInput(countryEditorState.nameEn)
      && !!normalizeScenarioNameInput(countryEditorState.nameZh)
      && !countryEditorState.isSaving;
    if (saveCountryBtn) {
      saveCountryBtn.textContent = countryEditorState.isSaving ? ui("Saving...") : ui("Save Country Names");
      saveCountryBtn.disabled = !canSaveCountry;
    }
    if (scenarioCountryStatus) {
      const countryStatusBits = [];
      if (countryEditorState.lastSaveMessage) {
        countryStatusBits.push(countryEditorState.lastSaveMessage);
      } else if (countryEditorState.lastSavedAt) {
        countryStatusBits.push(`${ui("Last Saved")}: ${countryEditorState.lastSavedAt}`);
      }
      scenarioCountryStatus.textContent = countryStatusBits.join(" | ");
    }

    const tagInspectorState = state.devScenarioTagInspector || {};
    const tagInspectorThreshold = Math.max(0, Number.parseInt(tagInspectorState.threshold, 10) || 0);
    const tagInspectorRows = buildLowFeatureTagInspectorRows(tagInspectorThreshold);
    const currentTagInspectorTag = normalizeScenarioTagInput(tagInspectorState.selectedTag);
    const selectedTagInspectorRow = tagInspectorRows.find((entry) => entry.tag === currentTagInspectorTag) || tagInspectorRows[0] || null;
    if (selectedTagInspectorRow?.tag !== currentTagInspectorTag) {
      state.devScenarioTagInspector = {
        ...tagInspectorState,
        threshold: tagInspectorThreshold,
        selectedTag: selectedTagInspectorRow?.tag || "",
      };
    }
    scenarioTagInspectorPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioTagInspectorTitle) {
      scenarioTagInspectorTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioTagInspectorHint) {
      scenarioTagInspectorHint.textContent = hasActiveScenario
        ? ui("Inspect small non-releasable countries, then choose one to highlight its territories.")
        : ui("Activate a scenario to inspect small country tags.");
    }
    renderMetaRows(scenarioTagInspectorMeta, [
      [ui("Threshold"), String(tagInspectorThreshold)],
      [ui("Matches"), String(tagInspectorRows.length)],
      [ui("Highlighted"), normalizeScenarioTagInput(state.inspectorHighlightCountryCode)],
    ].filter(([, value]) => String(value || "").trim()));
    if (scenarioTagInspectorThresholdInput) {
      const renderedThreshold = String(tagInspectorThreshold);
      if (scenarioTagInspectorThresholdInput.value !== renderedThreshold) {
        scenarioTagInspectorThresholdInput.value = renderedThreshold;
      }
      scenarioTagInspectorThresholdInput.disabled = !hasActiveScenario;
    }
    if (scenarioTagInspectorSelect) {
      syncSelectOptions(
        scenarioTagInspectorSelect,
        tagInspectorRows.map((entry) => ({
          value: entry.tag,
          label: `${entry.tag} | ${entry.displayName || entry.nameEn || entry.tag} | ${entry.featureCountLive}`,
        })),
        { placeholderLabel: ui("Select country") }
      );
      if (scenarioTagInspectorSelect.value !== (selectedTagInspectorRow?.tag || "")) {
        scenarioTagInspectorSelect.value = selectedTagInspectorRow?.tag || "";
      }
      scenarioTagInspectorSelect.disabled = !hasActiveScenario || !tagInspectorRows.length;
    }
    renderScenarioTagInspectorDetails(scenarioTagInspectorDetails, selectedTagInspectorRow);
    const clearTagInspectorHighlightBtn = panel.querySelector("#devScenarioTagInspectorClearHighlightBtn");
    if (clearTagInspectorHighlightBtn) {
      clearTagInspectorHighlightBtn.disabled = !hasActiveScenario || !normalizeScenarioTagInput(state.inspectorHighlightCountryCode);
    }
    if (scenarioTagInspectorStatus) {
      const statusBits = [];
      if (selectedTagInspectorRow?.tag) {
        statusBits.push(`${ui("Selected")}: ${selectedTagInspectorRow.tag}`);
      }
      if (normalizeScenarioTagInput(state.inspectorHighlightCountryCode)) {
        statusBits.push(`${ui("Highlighted")}: ${normalizeScenarioTagInput(state.inspectorHighlightCountryCode)}`);
      }
      scenarioTagInspectorStatus.textContent = statusBits.join(" | ");
    }

    const priorCapitalEditorState = state.devScenarioCapitalEditor || {};
    const capitalModel = resolveCapitalEditorModel();
    const capitalSearchQuery = normalizeScenarioNameInput(priorCapitalEditorState.searchQuery);
    const capitalSearchMatches = buildCapitalEditorSearchMatches(capitalSearchQuery, capitalModel.options);
    const currentCapitalTag = normalizeScenarioTagInput(priorCapitalEditorState.tag);
    const hasValidCapitalTag = !!currentCapitalTag && capitalModel.options.some((entry) => entry.tag === currentCapitalTag);
    const needsCapitalPrefill = !hasValidCapitalTag && !!capitalModel.tag;
    const capitalEditorState = needsCapitalPrefill
      ? {
        ...priorCapitalEditorState,
        tag: capitalModel.tag,
        searchQuery: capitalSearchQuery,
      }
      : priorCapitalEditorState;
    if (needsCapitalPrefill) {
      state.devScenarioCapitalEditor = capitalEditorState;
    }
    scenarioCapitalPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioCapitalTitle) {
      scenarioCapitalTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioCapitalHint) {
      scenarioCapitalHint.textContent = resolveCapitalEditorHint(capitalModel);
    }
    renderMetaRows(scenarioCapitalMeta, buildCapitalEditorMetaRows(capitalModel));
    if (scenarioCapitalSearchInput) {
      if (scenarioCapitalSearchInput.value !== capitalSearchQuery) {
        scenarioCapitalSearchInput.value = capitalSearchQuery;
      }
      scenarioCapitalSearchInput.disabled = !hasActiveScenario || !!capitalEditorState.isSaving;
      scenarioCapitalSearchInput.placeholder = ui("Search country");
    }
    renderCapitalEditorSearchResults(scenarioCapitalSearchResults, capitalSearchMatches, capitalSearchQuery);
    if (scenarioCapitalSelect) {
      syncSelectOptions(
        scenarioCapitalSelect,
        capitalModel.options.map((entry) => ({ value: entry.tag, label: entry.label })),
        { placeholderLabel: ui("Select country") }
      );
      if (scenarioCapitalSelect.value !== (capitalEditorState.tag || "")) {
        scenarioCapitalSelect.value = capitalEditorState.tag || "";
      }
      scenarioCapitalSelect.disabled = !hasActiveScenario || !!capitalEditorState.isSaving;
    }
    if (scenarioCapitalCandidate) {
      scenarioCapitalCandidate.textContent = capitalModel.candidate?.cityId
        ? `${ui("Candidate")}: ${capitalModel.candidate.cityName || capitalModel.candidate.cityId} (${capitalModel.candidate.cityId})`
        : ui("No capital city candidate resolved for the current selection.");
    }
    const saveCapitalBtn = panel.querySelector("#devScenarioSaveCapitalBtn");
    const canSaveCapital = hasActiveScenario
      && capitalModel.selectionCount === 1
      && !!capitalModel.tag
      && capitalModel.ownerMatches
      && !!capitalModel.candidate?.cityId
      && !capitalEditorState.isSaving;
    if (saveCapitalBtn) {
      saveCapitalBtn.textContent = capitalEditorState.isSaving ? ui("Saving...") : ui("Save Capital");
      saveCapitalBtn.disabled = !canSaveCapital;
    }
    if (scenarioCapitalStatus) {
      const capitalStatusBits = [];
      if (capitalEditorState.lastSaveMessage) {
        capitalStatusBits.push(capitalEditorState.lastSaveMessage);
      } else if (capitalEditorState.lastSavedAt) {
        capitalStatusBits.push(`${ui("Last Saved")}: ${capitalEditorState.lastSavedAt}`);
      }
      scenarioCapitalStatus.textContent = capitalStatusBits.join(" | ");
    }

    const districtModel = resolveDistrictEditorModel();
    const districtState = state.devScenarioDistrictEditor || {};
    scenarioDistrictPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioDistrictTitle) {
      scenarioDistrictTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioDistrictHint) {
      scenarioDistrictHint.textContent = resolveDistrictEditorHint(districtModel);
    }
    renderMetaRows(scenarioDistrictMeta, buildDistrictMetaRows(districtModel));
    const renderedDistrictTagValue = districtModel.isAutoMode
      ? districtModel.inferredTag
      : districtModel.manualTag;
    if (scenarioDistrictTagInput && scenarioDistrictTagInput.value !== renderedDistrictTagValue) {
      scenarioDistrictTagInput.value = renderedDistrictTagValue;
    }
    if (scenarioDistrictTagInput) {
      scenarioDistrictTagInput.placeholder = districtModel.isAutoMode
        ? (districtModel.inferredTag || ui("Auto from selection"))
        : "FRA";
      scenarioDistrictTagInput.disabled = !hasActiveScenario || !!districtState.isSaving || !!districtState.isTemplateApplying;
    }
    if (scenarioDistrictTagModeNote) {
      scenarioDistrictTagModeNote.textContent = districtModel.isAutoMode
        ? (districtModel.inferredTag
          ? `${ui("Auto")}: ${districtModel.inferredTag}`
          : ui("Auto from selection"))
        : `${ui("Manual")}: ${districtModel.manualTag || ui("Type a scenario tag.")}`;
    }
    if (scenarioDistrictUseSelectionBtn) {
      scenarioDistrictUseSelectionBtn.disabled = !hasActiveScenario || !!districtState.isSaving || !!districtState.isTemplateApplying || !districtModel.canUseSelectionTag;
    }
    if (scenarioDistrictClearBtn) {
      scenarioDistrictClearBtn.disabled = !hasActiveScenario || !!districtState.isSaving || !!districtState.isTemplateApplying || !(
        districtModel.manualTag
        || districtModel.selectedDistrictId
        || normalizeScenarioNameInput(districtState.nameEn)
        || normalizeScenarioNameInput(districtState.nameZh)
        || normalizeScenarioDistrictTag(districtState.templateTag)
      );
    }
    if (scenarioDistrictSelect) {
      syncSelectOptions(
        scenarioDistrictSelect,
        districtModel.districtEntries.map((district) => ({
          value: district.id,
          label: district.name_en || district.name_zh || district.id,
        })),
        { placeholderLabel: ui("Select district") }
      );
      const selectedDistrictId = districtModel.selectedDistrictId || "";
      if (scenarioDistrictSelect.value !== selectedDistrictId) {
        scenarioDistrictSelect.value = selectedDistrictId;
      }
      scenarioDistrictSelect.disabled = !hasActiveScenario || !districtModel.hasEffectiveTag || !!districtState.isSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }
    if (scenarioDistrictIdInput && scenarioDistrictIdInput.value !== districtModel.selectedDistrictId) {
      scenarioDistrictIdInput.value = districtModel.selectedDistrictId;
    }
    if (scenarioDistrictIdInput) {
      scenarioDistrictIdInput.placeholder = "berlin";
      scenarioDistrictIdInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveTag || !!districtState.isSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }
    const districtNameEn = normalizeScenarioNameInput(districtState.nameEn ?? districtModel.selectedDistrict?.name_en ?? "");
    const districtNameZh = normalizeScenarioNameInput(districtState.nameZh ?? districtModel.selectedDistrict?.name_zh ?? "");
    if (scenarioDistrictNameEnInput && scenarioDistrictNameEnInput.value !== districtNameEn) {
      scenarioDistrictNameEnInput.value = districtNameEn;
    }
    if (scenarioDistrictNameZhInput && scenarioDistrictNameZhInput.value !== districtNameZh) {
      scenarioDistrictNameZhInput.value = districtNameZh;
    }
    if (scenarioDistrictNameEnInput) {
      scenarioDistrictNameEnInput.placeholder = districtModel.selectedDistrict?.name_en || "Berlin";
      scenarioDistrictNameEnInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveTag || !!districtState.isSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }
    if (scenarioDistrictNameZhInput) {
      scenarioDistrictNameZhInput.placeholder = districtModel.selectedDistrict?.name_zh || "Berlin";
      scenarioDistrictNameZhInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveTag || !!districtState.isSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }
    if (scenarioDistrictTemplateTagInput) {
      const renderedTemplateTag = districtModel.effectiveTemplateTag || districtModel.tag || "";
      if (scenarioDistrictTemplateTagInput.value !== renderedTemplateTag) {
        scenarioDistrictTemplateTagInput.value = renderedTemplateTag;
      }
      scenarioDistrictTemplateTagInput.placeholder = districtModel.tag || "FRA";
      scenarioDistrictTemplateTagInput.disabled = !hasActiveScenario || !!districtState.isSaving || !!districtState.isTemplateSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }
    const selectedDistrictFeatureIds = new Set(districtModel.selectedDistrict?.feature_ids || []);
    const matchingSelectionIds = districtModel.targetIds.filter((featureId) => {
      return normalizeScenarioDistrictTag(state.sovereigntyByFeatureId?.[featureId]) === districtModel.tag;
    });
    const removableSelectionIds = matchingSelectionIds.filter((featureId) => selectedDistrictFeatureIds.has(featureId));
    const districtIdValue = normalizeScenarioDistrictId(scenarioDistrictIdInput?.value || districtState.selectedDistrictId);
    const canUpsertDistrict = hasActiveScenario
      && !!districtModel.tag
      && !!districtIdValue
      && !!districtNameEn
      && !!districtNameZh
      && !districtState.isSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canAssignDistrict = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.selectedDistrictId
      && matchingSelectionIds.length > 0
      && !districtState.isSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canRemoveDistrictSelection = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.selectedDistrictId
      && matchingSelectionIds.length > 0
      && !districtState.isSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canDeleteDistrict = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.selectedDistrictId
      && (districtModel.selectedDistrict?.feature_ids || []).length === 0
      && !districtState.isSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canSaveDistricts = hasActiveScenario && !!districtModel.tag && !districtState.isSaving && !districtState.isTemplateApplying && !districtModel.hasLegacyGeoCountryData;
    const canPromoteTemplate = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.effectiveTemplateTag
      && !districtState.isSaving
      && !districtState.isTemplateSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canApplyTemplate = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.effectiveTemplateTag
      && !districtState.isSaving
      && !districtState.isTemplateSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const districtUpsertBtn = panel.querySelector("#devScenarioDistrictUpsertBtn");
    const districtAssignBtn = panel.querySelector("#devScenarioDistrictAssignBtn");
    const districtRemoveBtn = panel.querySelector("#devScenarioDistrictRemoveBtn");
    const districtDeleteBtn = panel.querySelector("#devScenarioDistrictDeleteBtn");
    const districtSaveBtn = panel.querySelector("#devScenarioDistrictSaveBtn");
    if (districtUpsertBtn) {
      districtUpsertBtn.textContent = ui("Upsert District");
      districtUpsertBtn.disabled = !canUpsertDistrict;
    }
    if (districtAssignBtn) {
      districtAssignBtn.textContent = ui("Assign Selection");
      districtAssignBtn.disabled = !canAssignDistrict;
    }
    if (districtRemoveBtn) {
      districtRemoveBtn.textContent = ui("Remove Selection");
      districtRemoveBtn.disabled = !canRemoveDistrictSelection;
    }
    if (districtDeleteBtn) {
      districtDeleteBtn.textContent = ui("Delete Empty District");
      districtDeleteBtn.disabled = !canDeleteDistrict;
    }
    if (districtSaveBtn) {
      districtSaveBtn.textContent = districtState.isSaving ? ui("Saving...") : ui("Save Districts File");
      districtSaveBtn.disabled = !canSaveDistricts;
    }
    if (scenarioDistrictPromoteBtn) {
      scenarioDistrictPromoteBtn.textContent = districtState.isTemplateSaving ? ui("Saving...") : ui("Promote To Shared Template");
      scenarioDistrictPromoteBtn.disabled = !canPromoteTemplate;
    }
    if (scenarioDistrictApplyTemplateBtn) {
      scenarioDistrictApplyTemplateBtn.textContent = districtState.isTemplateApplying ? ui("Applying...") : ui("Apply Shared Template");
      scenarioDistrictApplyTemplateBtn.disabled = !canApplyTemplate;
    }
    if (scenarioDistrictStatus) {
      const districtStatusBits = [];
      if (districtState.lastSaveMessage) {
        districtStatusBits.push(districtState.lastSaveMessage);
      } else if (districtModel.hasLegacyGeoCountryData) {
        districtStatusBits.push(ui("Legacy geo-country districts detected."));
      } else if (districtState.lastSavedAt) {
        districtStatusBits.push(`${ui("Last Saved")}: ${districtState.lastSavedAt}`);
      }
      scenarioDistrictStatus.textContent = districtStatusBits.join(" | ");
    }

    const localeModel = resolveLocaleEditorModel();
    const priorLocaleEditorState = state.devLocaleEditor || {};
    const localeFeatureChanged = String(priorLocaleEditorState.featureId || "") !== String(localeModel.featureId || "");
    const localeEditorState = localeFeatureChanged
      ? {
        ...priorLocaleEditorState,
        featureId: localeModel.featureId,
        en: localeModel.mergedEntry.en,
        zh: localeModel.mergedEntry.zh,
      }
      : priorLocaleEditorState;
    if (localeFeatureChanged) {
      state.devLocaleEditor = localeEditorState;
    }
    scenarioLocalePanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioLocaleTitle) {
      scenarioLocaleTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioLocaleHint) {
      scenarioLocaleHint.textContent = resolveLocaleEditorHint(localeModel);
    }
    renderMetaRows(scenarioLocaleMeta, buildLocaleMetaRows(localeModel));
    if (scenarioLocaleEnInput && scenarioLocaleEnInput.value !== normalizeLocaleInput(localeEditorState.en)) {
      scenarioLocaleEnInput.value = normalizeLocaleInput(localeEditorState.en);
    }
    if (scenarioLocaleZhInput && scenarioLocaleZhInput.value !== normalizeLocaleInput(localeEditorState.zh)) {
      scenarioLocaleZhInput.value = normalizeLocaleInput(localeEditorState.zh);
    }
    const canEditLocale = hasActiveScenario && localeModel.selectionCount === 1 && !!localeModel.featureId && !localeEditorState.isSaving;
    if (scenarioLocaleEnInput) {
      scenarioLocaleEnInput.disabled = !canEditLocale;
      scenarioLocaleEnInput.placeholder = localeModel.baseEntry?.en || resolveFeatureName(localeModel.feature, localeModel.featureId) || "Badghis";
    }
    if (scenarioLocaleZhInput) {
      scenarioLocaleZhInput.disabled = !canEditLocale;
      scenarioLocaleZhInput.placeholder = localeModel.baseEntry?.zh || "";
    }
    const saveLocaleBtn = panel.querySelector("#devScenarioSaveLocaleBtn");
    if (saveLocaleBtn) {
      saveLocaleBtn.textContent = localeEditorState.isSaving ? ui("Saving...") : ui("Save Localized Names");
      saveLocaleBtn.disabled = !(hasActiveScenario && localeModel.hasGeoLocalePatch && localeModel.selectionCount === 1 && !!localeModel.featureId) || !!localeEditorState.isSaving;
    }
    if (scenarioLocaleStatus) {
      const localeStatusBits = [];
      if (localeEditorState.lastSaveMessage) {
        localeStatusBits.push(localeEditorState.lastSaveMessage);
      } else if (localeEditorState.lastSavedAt) {
        localeStatusBits.push(`${ui("Last Saved")}: ${localeEditorState.lastSavedAt}`);
      }
      scenarioLocaleStatus.textContent = localeStatusBits.join(" | ");
    }

    const ownershipModel = resolveOwnershipEditorModel();
    const editorState = state.devScenarioEditor || {};
    const requestedOwnerCode = normalizeOwnerInput(editorState.targetOwnerCode);
    const fallbackOwnerCode = normalizeOwnerInput(state.activeSovereignCode);
    const effectiveOwnerCode = requestedOwnerCode || fallbackOwnerCode;
    scenarioOwnershipPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioOwnershipTitle) {
      scenarioOwnershipTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioOwnershipHint) {
      scenarioOwnershipHint.textContent = resolveOwnershipEditorHint(ownershipModel);
    }
    renderMetaRows(scenarioOwnershipMeta, buildOwnershipMetaRows(ownershipModel));
    if (scenarioOwnerInput && scenarioOwnerInput.value !== requestedOwnerCode) {
      scenarioOwnerInput.value = requestedOwnerCode;
    }
    if (scenarioOwnerInput) {
      scenarioOwnerInput.placeholder = fallbackOwnerCode || "GER";
      scenarioOwnerInput.disabled = !hasActiveScenario || !!editorState.isSaving;
    }
    const statusBits = [];
    if (fallbackOwnerCode && !requestedOwnerCode) {
      statusBits.push(`${ui("Active Owner")}: ${fallbackOwnerCode}`);
    }
    if (editorState.lastSaveMessage) {
      statusBits.push(editorState.lastSaveMessage);
    } else if (editorState.lastSavedAt) {
      statusBits.push(`${ui("Last Saved")}: ${editorState.lastSavedAt}`);
    }
    if (scenarioOwnershipStatus) {
      scenarioOwnershipStatus.textContent = statusBits.join(" | ");
    }
    const canApplyOwner = hasActiveScenario && ownershipModel.selectionCount > 0 && !!effectiveOwnerCode && !editorState.isSaving;
    const canResetOwner = hasActiveScenario && ownershipModel.selectionCount > 0 && !editorState.isSaving;
    const canSaveOwners = hasActiveScenario && !editorState.isSaving;
    const selectionTagValue = ownershipModel.selectionCount <= 0
      ? ui("No selection")
      : ownershipModel.isMixedOwner
        ? ownershipModel.ownerCodes.join(", ")
        : (ownershipModel.currentOwnerCode || ownershipModel.ownerCodes?.[0] || "--");
    const ownerValue = ownershipModel.selectionCount <= 0
      ? "--"
      : (ownershipModel.isMixedOwner ? ownershipModel.ownerCodes.join(", ") : (ownershipModel.currentOwnerCode || "--"));
    const controllerValue = ownershipModel.selectionCount <= 0
      ? "--"
      : (ownershipModel.currentControllerCode || ownerValue || "--");
    const applyOwnerBtn = panel.querySelector("#devScenarioApplyOwnerBtn");
    const resetOwnerBtn = panel.querySelector("#devScenarioResetOwnerBtn");
    const saveOwnersBtn = panel.querySelector("#devScenarioSaveOwnersBtn");
    if (applyOwnerBtn) {
      applyOwnerBtn.textContent = ui("Apply to Selection");
      applyOwnerBtn.disabled = !canApplyOwner;
    }
    if (resetOwnerBtn) {
      resetOwnerBtn.textContent = ui("Reset Selection");
      resetOwnerBtn.disabled = !canResetOwner;
    }
    if (saveOwnersBtn) {
      const savingNow = !!editorState.isSaving;
      if (saveOwnersBtn.dataset.saving !== String(savingNow)) {
        saveOwnersBtn.dataset.saving = savingNow;
        saveOwnersBtn.textContent = savingNow ? ui("Saving...") : ui("Save Owners File");
      }
      saveOwnersBtn.disabled = !canSaveOwners;
    }
    if (devQuickSelectionValue) {
      devQuickSelectionValue.textContent = localizeSelectionSummary(ownershipModel.selectionCount || 0);
    }
    if (devQuickTagValue) {
      devQuickTagValue.textContent = selectionTagValue;
    }
    if (devQuickOwnerValue) {
      devQuickOwnerValue.textContent = ownerValue;
    }
    if (devQuickControllerValue) {
      devQuickControllerValue.textContent = controllerValue;
    }
    if (devQuickOwnerInput && devQuickOwnerInput.value !== requestedOwnerCode) {
      devQuickOwnerInput.value = requestedOwnerCode;
    }
    if (devQuickOwnerInput) {
      devQuickOwnerInput.placeholder = fallbackOwnerCode || "GER";
      devQuickOwnerInput.disabled = !hasActiveScenario || !!editorState.isSaving;
    }
    if (devQuickUseTagBtn) {
      devQuickUseTagBtn.disabled = !hasActiveScenario || ownershipModel.selectionCount <= 0;
    }
    if (devQuickApplyOwnerBtn) {
      devQuickApplyOwnerBtn.disabled = !canApplyOwner;
    }
    if (devQuickResetOwnerBtn) {
      devQuickResetOwnerBtn.disabled = !canResetOwner;
    }
    if (devQuickSaveOwnersBtn) {
      const savingNow = !!editorState.isSaving;
      if (devQuickSaveOwnersBtn.dataset.saving !== String(savingNow)) {
        devQuickSaveOwnersBtn.dataset.saving = savingNow;
        devQuickSaveOwnersBtn.textContent = savingNow ? ui("Saving...") : ui("Save Owners File");
      }
      devQuickSaveOwnersBtn.disabled = !canSaveOwners;
    }
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

  bindButtonAction(panel.querySelector("#devScenarioSaveCountryBtn"), async () => {
    const built = buildScenarioCountrySavePayload();
    if (!built.ok || !built.payload) {
      showToast(built.message || ui("Choose a country tag and fill both names before saving."), {
        title: ui("Country Name Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    state.devScenarioCountryEditor = {
      ...(state.devScenarioCountryEditor || {}),
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/country/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(built.payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      applyScenarioCountrySaveSuccess(result, built.payload);
      flushDevWorkspaceRender("dev-workspace-country-save");
      if (typeof state.updateScenarioUIFn === "function") {
        state.updateScenarioUIFn();
      }
      showToast(ui("Country names saved."), {
        title: ui("Country Name Editor"),
        tone: "success",
      });
    } catch (error) {
      state.devScenarioCountryEditor = {
        ...(state.devScenarioCountryEditor || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save country names.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to save country names.")), {
        title: ui("Country Name Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    state.devScenarioCountryEditor = {
      ...(state.devScenarioCountryEditor || {}),
      isSaving: false,
    };
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioTagInspectorClearHighlightBtn"), () => {
    state.inspectorHighlightCountryCode = "";
    flushDevWorkspaceRender("dev-workspace-tag-inspector-clear-highlight");
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioSaveCapitalBtn"), async () => {
    const built = buildScenarioCapitalSavePayload();
    if (!built.ok || !built.payload) {
      showToast(built.message || ui("Select one feature and a matching country tag before saving a capital."), {
        title: ui("Capital Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    state.devScenarioCapitalEditor = {
      ...(state.devScenarioCapitalEditor || {}),
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/capital/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(built.payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      applyScenarioCapitalSaveSuccess(result, built.payload);
      flushDevWorkspaceRender("dev-workspace-capital-save");
      if (typeof state.updateScenarioUIFn === "function") {
        state.updateScenarioUIFn();
      }
      showToast(ui("Scenario capital saved."), {
        title: ui("Capital Editor"),
        tone: "success",
      });
    } catch (error) {
      state.devScenarioCapitalEditor = {
        ...(state.devScenarioCapitalEditor || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save capital.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to save capital.")), {
        title: ui("Capital Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    state.devScenarioCapitalEditor = {
      ...(state.devScenarioCapitalEditor || {}),
      isSaving: false,
    };
    renderWorkspace();
  });

  bindButtonAction(scenarioDistrictUseSelectionBtn, () => {
    const model = resolveDistrictEditorModel();
    if (!model.canUseSelectionTag) {
      showToast(ui("Select land features owned by exactly one scenario tag first."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    resetDistrictEditorForm();
    updateDistrictEditorState({
      inferredTag: model.inferredTag,
      tag: model.inferredTag,
      templateTag: model.inferredTag,
    });
    renderWorkspace();
  });

  bindButtonAction(scenarioDistrictClearBtn, () => {
    resetDistrictEditorForm();
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictUpsertBtn"), () => {
    const model = resolveDistrictEditorModel();
    if (model.hasLegacyGeoCountryData) {
      showToast(ui("Legacy geo-country districts detected. Migrate them before editing scenario-tag districts."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    if (!state.activeScenarioId || !model.tag) {
      showToast(ui("Choose a scenario tag before editing districts."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const result = upsertDistrictDraft(model);
    if (!result.ok) {
      showToast(result.message || ui("Unable to update the district draft."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(state.devScenarioDistrictEditor?.lastSaveMessage || ui("District draft updated."), {
      title: ui("Scenario District Editor"),
      tone: "success",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictAssignBtn"), () => {
    const model = resolveDistrictEditorModel();
    const result = assignSelectionToDistrictDraft(model);
    if (!result.ok) {
      showToast(result.message || ui("Unable to assign the current selection."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(ui("Assigned selection to district."), {
      title: ui("Scenario District Editor"),
      tone: "success",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictRemoveBtn"), () => {
    const model = resolveDistrictEditorModel();
    const result = removeSelectionFromDistrictDraft(model);
    if (!result.ok) {
      showToast(
        state.devScenarioDistrictEditor?.lastSaveMessage || result.message || ui("Unable to remove the current selection."),
        {
          title: ui("Scenario District Editor"),
          tone: result.count === 0 ? "info" : "warning",
        }
      );
      renderWorkspace();
      return;
    }
    showToast(result.changed === false
      ? (
        state.devScenarioDistrictEditor?.lastSaveMessage
        || ui("Selected features were not assigned to the current district draft.")
      )
      : ui("Removed selection from district."), {
      title: ui("Scenario District Editor"),
      tone: result.changed === false ? "info" : "success",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictDeleteBtn"), () => {
    const model = resolveDistrictEditorModel();
    const result = deleteDistrictDraft(model);
    if (!result.ok) {
      showToast(result.message || ui("Unable to delete the district draft."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(ui("District removed from draft."), {
      title: ui("Scenario District Editor"),
      tone: "success",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictSaveBtn"), async () => {
    const model = resolveDistrictEditorModel();
    if (model.hasLegacyGeoCountryData) {
      showToast(ui("Legacy geo-country districts detected. Migrate them before saving scenario-tag districts."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    if (!state.activeScenarioId || !model.tag) {
      showToast(ui("Choose a scenario tag before saving districts."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const draftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
    updateDistrictEditorState({
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    });
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/districts/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildDistrictSavePayload({
          ...model,
          draftTag,
        })),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      if (result?.tagRecord && typeof result.tagRecord === "object") {
        syncScenarioDistrictState(model.tag, result.tagRecord);
        setDistrictDraftTag(model.tag, result.tagRecord, {
          lastSavedAt: String(result.savedAt || ""),
          lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
          lastSaveTone: "success",
          isSaving: false,
        });
      } else {
        updateDistrictEditorState({
          isSaving: false,
          lastSavedAt: String(result.savedAt || ""),
          lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
          lastSaveTone: "success",
        });
      }
      state.activeScenarioManifest = {
        ...(state.activeScenarioManifest || {}),
        district_groups_url: String(result.districtGroupsUrl || state.activeScenarioManifest?.district_groups_url || ""),
      };
      mapRenderer.rebuildStaticMeshes();
      flushDevWorkspaceRender("dev-workspace-district-save");
      showToast(ui("Scenario districts file saved."), {
        title: ui("Scenario District Editor"),
        tone: "success",
      });
    } catch (error) {
      updateDistrictEditorState({
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save districts file.")),
        lastSaveTone: "critical",
      });
      showToast(String(error?.message || ui("Unable to save districts file.")), {
        title: ui("Scenario District Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(scenarioDistrictPromoteBtn, async () => {
    const model = resolveDistrictEditorModel();
    const templateTag = normalizeScenarioDistrictTag(state.devScenarioDistrictEditor?.templateTag) || model.tag;
    if (model.hasLegacyGeoCountryData) {
      showToast(ui("Legacy geo-country districts detected. Migrate them before promoting shared templates."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    if (!state.activeScenarioId || !model.tag || !templateTag) {
      showToast(ui("Choose a scenario tag and template tag before promoting a shared template."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    updateDistrictEditorState({
      isTemplateSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    });
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/district-templates/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildDistrictTemplatePayload(model, templateTag)),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      updateDistrictEditorState({
        isTemplateSaving: false,
        templateTag,
        lastSavedAt: String(result.savedAt || ""),
        lastSavedPath: String(result.filePath || ""),
        lastSaveMessage: `${ui("Shared template saved")}: ${String(result.filePath || "")}`,
        lastSaveTone: "success",
      });
      showToast(ui("Shared district template saved."), {
        title: ui("Scenario District Editor"),
        tone: "success",
      });
    } catch (error) {
      updateDistrictEditorState({
        isTemplateSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save shared district template.")),
        lastSaveTone: "critical",
      });
      showToast(String(error?.message || ui("Unable to save shared district template.")), {
        title: ui("Scenario District Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(scenarioDistrictApplyTemplateBtn, async () => {
    const model = resolveDistrictEditorModel();
    const templateTag = normalizeScenarioDistrictTag(state.devScenarioDistrictEditor?.templateTag) || model.tag;
    if (model.hasLegacyGeoCountryData) {
      showToast(ui("Legacy geo-country districts detected. Migrate them before applying shared templates."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    if (!state.activeScenarioId || !model.tag || !templateTag) {
      showToast(ui("Choose a scenario tag and template tag before applying a shared template."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    updateDistrictEditorState({
      isTemplateApplying: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    });
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/district-templates/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: String(state.activeScenarioId || "").trim(),
          tag: model.tag,
          templateTag,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      if (result?.tagRecord && typeof result.tagRecord === "object") {
        syncScenarioDistrictState(model.tag, result.tagRecord);
        setDistrictDraftTag(model.tag, result.tagRecord, {
          templateTag,
          isTemplateApplying: false,
          lastSavedAt: String(result.savedAt || ""),
          lastSavedPath: String(result.filePath || ""),
          lastSaveMessage: `${ui("Applied shared template")}: ${templateTag}`,
          lastSaveTone: "success",
        });
      } else {
        updateDistrictEditorState({
          isTemplateApplying: false,
          templateTag,
          lastSavedAt: String(result.savedAt || ""),
          lastSavedPath: String(result.filePath || ""),
          lastSaveMessage: `${ui("Applied shared template")}: ${templateTag}`,
          lastSaveTone: "success",
        });
      }
      showToast(ui("Shared district template applied."), {
        title: ui("Scenario District Editor"),
        tone: "success",
      });
    } catch (error) {
      updateDistrictEditorState({
        isTemplateApplying: false,
        lastSaveMessage: String(error?.message || ui("Unable to apply shared district template.")),
        lastSaveTone: "critical",
      });
      showToast(String(error?.message || ui("Unable to apply shared district template.")), {
        title: ui("Scenario District Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioSaveLocaleBtn"), async () => {
    const localeModel = resolveLocaleEditorModel();
    if (!state.activeScenarioId || !localeModel.featureId) {
      showToast(ui("Select exactly one land feature before saving localized names."), {
        title: ui("Scenario Locale Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const geoLocalePatchUrl = String(state.activeScenarioManifest?.geo_locale_patch_url || "").trim();
    if (!geoLocalePatchUrl) {
      showToast(ui("The active scenario does not declare a geo locale patch target."), {
        title: ui("Scenario Locale Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const localeEditorState = state.devLocaleEditor || {};
    state.devLocaleEditor = {
      ...localeEditorState,
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/geo-locale/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: state.activeScenarioId,
          featureId: localeModel.featureId,
          en: normalizeLocaleInput(state.devLocaleEditor?.en),
          zh: normalizeLocaleInput(state.devLocaleEditor?.zh),
          mode: "manual_override",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      const patchUrl = new URL(geoLocalePatchUrl, globalThis.location?.origin || globalThis.location?.href);
      patchUrl.searchParams.set("_t", String(Date.now()));
      const patchResponse = await fetch(patchUrl.href, { cache: "no-store" });
      if (!patchResponse.ok) {
        throw new Error(`Unable to reload geo locale patch (HTTP ${patchResponse.status}).`);
      }
      const patchPayload = await patchResponse.json();
      syncScenarioLocalizationState({
        cityOverridesPayload: state.scenarioCityOverridesData,
        geoLocalePatchPayload: patchPayload,
      });
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        isSaving: false,
        featureId: localeModel.featureId,
        en: normalizeLocaleInput(state.devLocaleEditor?.en),
        zh: normalizeLocaleInput(state.devLocaleEditor?.zh),
        lastSavedAt: String(result.savedAt || ""),
        lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
        lastSaveTone: "success",
      };
      flushDevWorkspaceRender("dev-workspace-locale-save");
      showToast(ui("Scenario localized names saved."), {
        title: ui("Scenario Locale Editor"),
        tone: "success",
      });
    } catch (error) {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save localized names.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to save localized names.")), {
        title: ui("Scenario Locale Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioApplyOwnerBtn"), () => {
    const targetIds = resolveOwnershipTargetIds();
    const requestedOwnerCode = normalizeOwnerInput(state.devScenarioEditor?.targetOwnerCode);
    const ownerCode = requestedOwnerCode || normalizeOwnerInput(state.activeSovereignCode);
    const result = applyOwnerToFeatureIds(targetIds, ownerCode, {
      historyKind: "dev-workspace-ownership-apply",
      dirtyReason: "dev-workspace-ownership-apply",
      recomputeReason: "dev-workspace-ownership-apply",
    });
    if (!result.applied) {
      const message = result.reason === "missing-owner"
        ? ui("Enter a target owner tag or choose an active owner first.")
        : ui("Select one or more land features before applying ownership.");
      showToast(message, {
        title: ui("Scenario Ownership Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const changedLabel = result.changed === 1 ? ui("feature") : ui("features");
    showToast(`${ui("Applied ownership to")} ${result.changed} ${changedLabel}.`, {
      title: ui("Scenario Ownership Editor"),
      tone: result.changed > 0 ? "success" : "info",
    });
    renderWorkspace();
  });

  bindButtonAction(devQuickApplyOwnerBtn, () => {
    panel.querySelector("#devScenarioApplyOwnerBtn")?.click();
  });

  bindButtonAction(panel.querySelector("#devScenarioResetOwnerBtn"), () => {
    const result = resetOwnersToScenarioBaselineForFeatureIds(resolveOwnershipTargetIds(), {
      historyKind: "dev-workspace-ownership-reset",
      dirtyReason: "dev-workspace-ownership-reset",
      recomputeReason: "dev-workspace-ownership-reset",
    });
    if (!result.applied) {
      showToast(ui("Select one or more land features with scenario ownership before resetting."), {
        title: ui("Scenario Ownership Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(
      result.changed > 0
        ? `${ui("Reset ownership for")} ${result.changed} ${result.changed === 1 ? ui("feature") : ui("features")}.`
        : ui("Selected features already match the active scenario baseline."),
      {
        title: ui("Scenario Ownership Editor"),
        tone: result.changed > 0 ? "success" : "info",
      }
    );
    renderWorkspace();
  });

  bindButtonAction(devQuickResetOwnerBtn, () => {
    panel.querySelector("#devScenarioResetOwnerBtn")?.click();
  });

  bindButtonAction(panel.querySelector("#devScenarioSaveOwnersBtn"), async () => {
    if (!state.activeScenarioId || state.devScenarioEditor?.isSaving) return;
    const payload = buildScenarioOwnershipSavePayload();
    state.devScenarioEditor = {
      ...(state.devScenarioEditor || {}),
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/ownership/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: payload.scenarioId,
          baselineHash: payload.baselineHash,
          owners: payload.owners,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        isSaving: false,
        lastSavedAt: String(result.savedAt || ""),
        lastSavedPath: String(result.filePath || ""),
        lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
        lastSaveTone: "success",
      };
      showToast(ui("Scenario ownership file saved."), {
        title: ui("Scenario Ownership Editor"),
        tone: "success",
      });
    } catch (error) {
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save ownership file.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to save ownership file.")), {
        title: ui("Scenario Ownership Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(devQuickSaveOwnersBtn, () => {
    panel.querySelector("#devScenarioSaveOwnersBtn")?.click();
  });

  bindButtonAction(devQuickUseTagBtn, () => {
    const ownershipModel = resolveOwnershipEditorModel();
    const inferredTag = ownershipModel.isMixedOwner
      ? ""
      : normalizeOwnerInput(ownershipModel.currentOwnerCode || ownershipModel.ownerCodes?.[0] || "");
    state.devScenarioEditor = {
      ...(state.devScenarioEditor || {}),
      targetOwnerCode: inferredTag,
    };
    renderWorkspace();
  });

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

  if (selectionSortMode && selectionSortMode.dataset.bound !== "true") {
    selectionSortMode.addEventListener("change", (event) => {
      state.devSelectionSortMode = String(event.target.value || "selection") === "name" ? "name" : "selection";
      renderWorkspace();
    });
    selectionSortMode.dataset.bound = "true";
  }

  if (scenarioOwnerInput && scenarioOwnerInput.dataset.bound !== "true") {
    scenarioOwnerInput.addEventListener("input", (event) => {
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        targetOwnerCode: normalizeOwnerInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioOwnerInput.dataset.bound = "true";
  }

  if (devQuickOwnerInput && devQuickOwnerInput.dataset.bound !== "true") {
    devQuickOwnerInput.addEventListener("input", (event) => {
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        targetOwnerCode: normalizeOwnerInput(event.target.value),
      };
      renderWorkspace();
    });
    devQuickOwnerInput.dataset.bound = "true";
  }

  if (scenarioCountrySelect && scenarioCountrySelect.dataset.bound !== "true") {
    scenarioCountrySelect.addEventListener("change", (event) => {
      const tag = normalizeScenarioTagInput(event.target.value);
      const entry = state.scenarioCountriesByTag?.[tag] || {};
      state.devScenarioCountryEditor = {
        ...(state.devScenarioCountryEditor || {}),
        tag,
        nameEn: normalizeScenarioNameInput(entry.display_name_en || entry.display_name || ""),
        nameZh: normalizeScenarioNameInput(entry.display_name_zh),
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
    });
    scenarioCountrySelect.dataset.bound = "true";
  }

  if (scenarioCountryNameEnInput && scenarioCountryNameEnInput.dataset.bound !== "true") {
    scenarioCountryNameEnInput.addEventListener("input", (event) => {
      state.devScenarioCountryEditor = {
        ...(state.devScenarioCountryEditor || {}),
        nameEn: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
    });
    scenarioCountryNameEnInput.dataset.bound = "true";
  }

  if (scenarioCountryNameZhInput && scenarioCountryNameZhInput.dataset.bound !== "true") {
    scenarioCountryNameZhInput.addEventListener("input", (event) => {
      state.devScenarioCountryEditor = {
        ...(state.devScenarioCountryEditor || {}),
        nameZh: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
    });
    scenarioCountryNameZhInput.dataset.bound = "true";
  }

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

  if (scenarioCapitalSelect && scenarioCapitalSelect.dataset.bound !== "true") {
    scenarioCapitalSelect.addEventListener("change", (event) => {
      selectScenarioCapitalEditorTag(event.target.value, { clearSearch: true });
      renderWorkspace();
    });
    scenarioCapitalSelect.dataset.bound = "true";
  }

  if (scenarioCapitalSearchInput && scenarioCapitalSearchInput.dataset.bound !== "true") {
    scenarioCapitalSearchInput.addEventListener("input", (event) => {
      state.devScenarioCapitalEditor = {
        ...(state.devScenarioCapitalEditor || {}),
        searchQuery: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
    });
    scenarioCapitalSearchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const matches = buildCapitalEditorSearchMatches(
        normalizeScenarioNameInput(event.target.value),
        collectScenarioCountryOptions({ includeReleasable: true })
      );
      if (!matches.length) return;
      event.preventDefault();
      selectScenarioCapitalEditorTag(matches[0].tag, { clearSearch: true });
      renderWorkspace();
    });
    scenarioCapitalSearchInput.dataset.bound = "true";
  }

  if (scenarioCapitalSearchResults && scenarioCapitalSearchResults.dataset.bound !== "true") {
    scenarioCapitalSearchResults.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-dev-capital-search-tag]");
      if (!button) return;
      const tag = normalizeScenarioTagInput(button.dataset.devCapitalSearchTag);
      if (!tag) return;
      selectScenarioCapitalEditorTag(tag, { clearSearch: true });
      renderWorkspace();
    });
    scenarioCapitalSearchResults.dataset.bound = "true";
  }

  if (scenarioDistrictTagInput && scenarioDistrictTagInput.dataset.bound !== "true") {
    scenarioDistrictTagInput.addEventListener("input", (event) => {
      const nextTag = normalizeScenarioDistrictTag(event.target.value);
      updateDistrictEditorState({
        tagMode: nextTag ? "manual" : "auto",
        manualTag: nextTag,
        tag: nextTag,
        selectedDistrictId: "",
        nameEn: "",
        nameZh: "",
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictTagInput.dataset.bound = "true";
  }

  if (scenarioDistrictSelect && scenarioDistrictSelect.dataset.bound !== "true") {
    scenarioDistrictSelect.addEventListener("change", (event) => {
      const districtId = normalizeScenarioDistrictId(event.target.value);
      selectDistrictDraft(districtId);
      updateDistrictEditorState({
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictSelect.dataset.bound = "true";
  }

  if (scenarioDistrictIdInput && scenarioDistrictIdInput.dataset.bound !== "true") {
    scenarioDistrictIdInput.addEventListener("input", (event) => {
      updateDistrictEditorState({
        selectedDistrictId: normalizeScenarioDistrictId(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictIdInput.dataset.bound = "true";
  }

  if (scenarioDistrictNameEnInput && scenarioDistrictNameEnInput.dataset.bound !== "true") {
    scenarioDistrictNameEnInput.addEventListener("input", (event) => {
      updateDistrictEditorState({
        nameEn: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictNameEnInput.dataset.bound = "true";
  }

  if (scenarioDistrictNameZhInput && scenarioDistrictNameZhInput.dataset.bound !== "true") {
    scenarioDistrictNameZhInput.addEventListener("input", (event) => {
      updateDistrictEditorState({
        nameZh: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictNameZhInput.dataset.bound = "true";
  }

  if (scenarioDistrictTemplateTagInput && scenarioDistrictTemplateTagInput.dataset.bound !== "true") {
    scenarioDistrictTemplateTagInput.addEventListener("input", (event) => {
      updateDistrictEditorState({
        templateTag: normalizeScenarioDistrictTag(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictTemplateTagInput.dataset.bound = "true";
  }

  if (scenarioLocaleEnInput && scenarioLocaleEnInput.dataset.bound !== "true") {
    scenarioLocaleEnInput.addEventListener("input", (event) => {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        en: normalizeLocaleInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioLocaleEnInput.dataset.bound = "true";
  }

  if (scenarioLocaleZhInput && scenarioLocaleZhInput.dataset.bound !== "true") {
    scenarioLocaleZhInput.addEventListener("input", (event) => {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        zh: normalizeLocaleInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioLocaleZhInput.dataset.bound = "true";
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

// Sidebar UI (Phase 13)
import {
  state,
  countryNames,
  PRESET_STORAGE_KEY,
  defaultCountryPalette,
  normalizeDayNightStyleConfig,
  normalizeLakeStyleConfig,
  normalizePhysicalStyleConfig,
} from "../core/state.js";
import { ColorManager } from "../core/color_manager.js";
import * as mapRenderer from "../core/map_renderer.js";
import { applyCountryColor, resetCountryColors } from "../core/logic.js";
import { FileManager } from "../core/file_manager.js";
import { captureHistoryState, clearHistory, pushHistoryEntry } from "../core/history_manager.js";
import { LegendManager } from "../core/legend_manager.js";
import {
  applyScenarioById,
  clearActiveScenario,
  loadScenarioAuditPayload,
  recalculateScenarioOwnerControllerDiffCount,
  refreshScenarioShellOverlays,
  setScenarioViewMode,
  validateImportedScenarioBaseline,
} from "../core/scenario_manager.js";
import { t } from "./i18n.js";
import { showToast } from "./toast.js";
import {
  setFeatureOwnerCodes,
  ensureSovereigntyState,
  migrateFeatureScopedProjectDataToCurrentTopology,
} from "../core/sovereignty_manager.js";
import { markDirty } from "../core/dirty_state.js";
import {
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
  getResolvedReleasableBoundaryVariant,
  normalizeCountryCode,
  normalizePresetName,
  resolveCompanionActionFeatureIds,
  resolveFeatureIdsFromPresetSource,
  rebuildPresetState,
  setReleasableBoundaryVariant,
} from "../core/releasable_manager.js";

function extractCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return normalizeCountryCode(prefix);
  }
  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return normalizeCountryCode(alphaPrefix ? alphaPrefix[0] : "");
}

function getCountryCodeFromProps(props = {}, fallbackId = "") {
  return normalizeCountryCode(
    props.cntr_code ||
      props.CNTR_CODE ||
      props.iso_a2 ||
      props.ISO_A2 ||
      props.iso_a2_eh ||
      props.ISO_A2_EH ||
      props.adm0_a2 ||
      props.ADM0_A2 ||
      extractCountryCodeFromId(props.id || props.NUTS_ID || fallbackId)
  );
}

function getCountryNameFromProps(props = {}) {
  const candidate =
    props.name_en ||
    props.name ||
    props.NAME_EN ||
    props.NAME ||
    props.admin ||
    props.ADMIN ||
    "";
  return String(candidate || "").trim();
}

function collectCountryNameByCode() {
  const nameByCode = new Map();

  const primaryGeometries = state.topologyPrimary?.objects?.political?.geometries;
  if (Array.isArray(primaryGeometries)) {
    primaryGeometries.forEach((geometry) => {
      const props = geometry?.properties || {};
      const code = getCountryCodeFromProps(props, geometry?.id);
      if (!code || nameByCode.has(code)) return;
      const name = getCountryNameFromProps(props);
      if (name) {
        nameByCode.set(code, name);
      }
    });
  }

  if (Array.isArray(state.landData?.features)) {
    state.landData.features.forEach((feature) => {
      const props = feature?.properties || {};
      const code = getCountryCodeFromProps(props, feature?.id);
      if (!code || nameByCode.has(code)) return;
      const name = getCountryNameFromProps(props);
      if (name) {
        nameByCode.set(code, name);
      }
    });
  }

  return nameByCode;
}

function getDynamicCountryEntries() {
  if (state.activeScenarioId && state.scenarioCountriesByTag && typeof state.scenarioCountriesByTag === "object") {
    const scenarioEntries = Object.entries(state.scenarioCountriesByTag)
      .map(([rawCode, scenarioCountry]) => {
        const code = normalizeCountryCode(rawCode);
        if (!code) return null;
        const name = String(scenarioCountry?.display_name || state.countryNames?.[code] || code).trim() || code;
        const displayName = t(name, "geo") || name || code;
        return {
          code,
          name,
          displayName,
          featureCount: Number(scenarioCountry?.feature_count || 0),
          quality: String(scenarioCountry?.quality || "").trim(),
          baseIso2: String(scenarioCountry?.base_iso2 || "").trim().toUpperCase(),
          lookupIso2: String(
            scenarioCountry?.lookup_iso2
            || scenarioCountry?.release_lookup_iso2
            || scenarioCountry?.base_iso2
            || ""
          ).trim().toUpperCase(),
          releaseLookupIso2: String(scenarioCountry?.release_lookup_iso2 || "").trim().toUpperCase(),
          scenarioOnly: !!scenarioCountry?.scenario_only,
          releasable: !!scenarioCountry?.releasable || String(scenarioCountry?.entry_kind || "").trim() === "releasable",
          scenarioSubject: String(scenarioCountry?.entry_kind || "").trim() === "scenario_subject",
          entryKind: String(scenarioCountry?.entry_kind || "").trim(),
          subjectKind: String(scenarioCountry?.subject_kind || "").trim().toLowerCase(),
          presetLookupCode: String(scenarioCountry?.preset_lookup_code || "").trim().toUpperCase(),
          parentOwnerTag: String(scenarioCountry?.parent_owner_tag || "").trim().toUpperCase(),
          parentOwnerTags: Array.isArray(scenarioCountry?.parent_owner_tags)
            ? scenarioCountry.parent_owner_tags.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
            : [],
          continentId: String(scenarioCountry?.continent_id || "").trim(),
          continentLabel: String(scenarioCountry?.continent_label || "").trim(),
          subregionId: String(scenarioCountry?.subregion_id || "").trim(),
          subregionLabel: String(scenarioCountry?.subregion_label || "").trim(),
          syntheticOwner: !!scenarioCountry?.synthetic_owner,
          hiddenFromCountryList: !!scenarioCountry?.hidden_from_country_list,
          featured: !!scenarioCountry?.featured,
          catalogOrder: Number(scenarioCountry?.catalog_order ?? Number.MAX_SAFE_INTEGER),
        };
      })
      .filter(Boolean);
    return scenarioEntries.sort((a, b) => {
      const getRank = (entry) => {
        if (entry?.releasable) return 2;
        if (entry?.scenarioOnly) return 1;
        return 0;
      };
      const rankDelta = getRank(a) - getRank(b);
      if (rankDelta !== 0) return rankDelta;
      if ((b.featureCount || 0) !== (a.featureCount || 0)) return (b.featureCount || 0) - (a.featureCount || 0);
      return a.displayName.localeCompare(b.displayName);
    });
  }

  const codes = new Set();

  if (state.countryToFeatureIds instanceof Map && state.countryToFeatureIds.size > 0) {
    state.countryToFeatureIds.forEach((_ids, rawCode) => {
      const code = normalizeCountryCode(rawCode);
      if (code) codes.add(code);
    });
  } else if (Array.isArray(state.landData?.features)) {
    state.landData.features.forEach((feature) => {
      const code = getCountryCodeFromProps(feature?.properties || {}, feature?.id);
      if (code) codes.add(code);
    });
  }

  if (!codes.size) {
    Object.keys(countryNames || {}).forEach((rawCode) => {
      const code = normalizeCountryCode(rawCode);
      if (code) codes.add(code);
    });
  }

  const nameByCode = collectCountryNameByCode();
  return Array.from(codes)
    .map((code) => {
      const name = nameByCode.get(code) || state.countryNames?.[code] || countryNames[code] || code;
      const displayName = t(name, "geo") || code;
      return { code, name, displayName };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function buildInspectorTopLevelCountryEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter(
    (entry) => !entry?.releasable && !entry?.scenarioSubject && !entry?.hiddenFromCountryList
  );
}

function ensureCountryPaletteColor(code, fallbackIndex = 0) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return "#cccccc";

  const existing = state.countryPalette?.[normalizedCode] || defaultCountryPalette[normalizedCode];
  if (existing) {
    state.countryPalette[normalizedCode] = existing;
    return existing;
  }

  const generated =
    ColorManager.getPoliticalFallbackColor(normalizedCode, fallbackIndex) || "#cccccc";
  state.countryPalette[normalizedCode] = generated;
  return generated;
}

function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Unable to load custom presets:", error);
    return {};
  }
}

function initPresetState() {
  state.customPresets = loadCustomPresets();
  rebuildPresetState();
}

function getScenarioCountryMeta(entryOrCode) {
  const rawCode = typeof entryOrCode === "object" && entryOrCode
    ? entryOrCode.code
    : entryOrCode;
  const normalizedCode = normalizeCountryCode(rawCode);
  if (!normalizedCode || !state.activeScenarioId) return null;
  const entry = state.scenarioCountriesByTag?.[normalizedCode];
  if (!entry || typeof entry !== "object") return null;
  return entry;
}

function resolveScenarioLookupCode(entryOrCode) {
  const fallbackCode = normalizeCountryCode(
    typeof entryOrCode === "object" && entryOrCode
      ? entryOrCode.code
      : entryOrCode
  );
  if (!state.activeScenarioId) {
    return fallbackCode;
  }

  const scenarioMeta = getScenarioCountryMeta(entryOrCode);
  const entry = typeof entryOrCode === "object" && entryOrCode ? entryOrCode : null;
  const candidates = [
    scenarioMeta?.preset_lookup_code,
    scenarioMeta?.presetLookupCode,
    entry?.preset_lookup_code,
    entry?.presetLookupCode,
    scenarioMeta?.lookup_iso2,
    scenarioMeta?.lookupIso2,
    entry?.lookup_iso2,
    entry?.lookupIso2,
    scenarioMeta?.base_iso2,
    scenarioMeta?.baseIso2,
    entry?.base_iso2,
    entry?.baseIso2,
    fallbackCode,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCountryCode(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return fallbackCode;
}

function resolveInspectorDataCode(entryOrCode) {
  const fallbackCode = normalizeCountryCode(
    typeof entryOrCode === "object" && entryOrCode
      ? entryOrCode.code
      : entryOrCode
  );
  if (!state.activeScenarioId) {
    return fallbackCode;
  }

  const scenarioMeta = getScenarioCountryMeta(entryOrCode);
  const entry = typeof entryOrCode === "object" && entryOrCode ? entryOrCode : null;
  const candidates = [
    scenarioMeta?.release_lookup_iso2,
    scenarioMeta?.releaseLookupIso2,
    entry?.release_lookup_iso2,
    entry?.releaseLookupIso2,
    scenarioMeta?.lookup_iso2,
    scenarioMeta?.lookupIso2,
    entry?.lookup_iso2,
    entry?.lookupIso2,
    scenarioMeta?.base_iso2,
    scenarioMeta?.baseIso2,
    entry?.base_iso2,
    entry?.baseIso2,
    fallbackCode,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCountryCode(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return fallbackCode;
}

function resolveCountryGroupingCode(entryOrCode) {
  return resolveInspectorDataCode(entryOrCode);
}

function getHierarchyGroupsForCode(code) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return [];
  if (state.hierarchyGroupsByCode.size > 0) {
    return state.hierarchyGroupsByCode.get(normalizedCode) || [];
  }
  if (!state.hierarchyData || !state.hierarchyData.groups) return [];
  const labels = state.hierarchyData.labels || {};
  const groups = [];
  Object.entries(state.hierarchyData.groups).forEach(([groupId, children]) => {
    if (!groupId.startsWith(`${normalizedCode}_`)) return;
    const label = labels[groupId] || groupId.replace(`${normalizedCode}_`, "").replace(/_/g, " ");
    groups.push({
      id: groupId,
      label,
      children: Array.isArray(children) ? children : [],
    });
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

function getCountryGroupingMeta(entryOrCode) {
  const normalizedCode = resolveCountryGroupingCode(entryOrCode);
  if (!normalizedCode || !(state.countryGroupMetaByCode instanceof Map)) return null;
  return state.countryGroupMetaByCode.get(normalizedCode) || null;
}

function getPriorityCountryOrderMap() {
  const priorityByContinent = state.countryGroupsData?.priority_by_continent || {};
  const priorityOrderMap = new Map();

  Object.entries(priorityByContinent).forEach(([continentId, rawCodes]) => {
    const continentOrder = new Map();
    (Array.isArray(rawCodes) ? rawCodes : []).forEach((rawCode, index) => {
      const code = normalizeCountryCode(rawCode);
      if (code && !continentOrder.has(code)) {
        continentOrder.set(code, index);
      }
    });
    priorityOrderMap.set(continentId, continentOrder);
  });

  return priorityOrderMap;
}

function getCountryPriorityRank(countryState, priorityOrderMap = getPriorityCountryOrderMap()) {
  const priorityCode = normalizeCountryCode(
    countryState?.groupingCode || countryState?.lookupIso2 || countryState?.code
  );
  if (!countryState?.continentId || !priorityCode) return Number.MAX_SAFE_INTEGER;
  const continentOrder = priorityOrderMap.get(countryState.continentId);
  if (!continentOrder || !continentOrder.has(priorityCode)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return continentOrder.get(priorityCode);
}

function compareInspectorCountries(a, b, priorityOrderMap = getPriorityCountryOrderMap()) {
  const featuredDelta = Number(!!b?.featured) - Number(!!a?.featured);
  if (featuredDelta !== 0) return featuredDelta;

  const priorityDelta =
    getCountryPriorityRank(a, priorityOrderMap) - getCountryPriorityRank(b, priorityOrderMap);
  if (priorityDelta !== 0) return priorityDelta;

  const featureDelta = Number(b?.featureCount || 0) - Number(a?.featureCount || 0);
  if (featureDelta !== 0) return featureDelta;

  const scenarioOnlyDelta = Number(!!a?.scenarioOnly) - Number(!!b?.scenarioOnly);
  if (scenarioOnlyDelta !== 0) return scenarioOnlyDelta;

  return String(a?.displayName || "").localeCompare(String(b?.displayName || ""));
}

function sortCountriesWithinContinent(entries, priorityOrderMap = getPriorityCountryOrderMap()) {
  return [...entries].sort((a, b) => compareInspectorCountries(a, b, priorityOrderMap));
}

function buildCountryColorTree(entries) {
  const tree = new Map();
  const continentOrder = new Map();
  const configuredContinents = Array.isArray(state.countryGroupsData?.continents)
    ? state.countryGroupsData.continents
    : [];
  const priorityOrderMap = getPriorityCountryOrderMap();

  configuredContinents.forEach((continent, continentIndex) => {
    const continentId = String(continent?.id || "").trim();
    if (!continentId) return;
    continentOrder.set(continentId, continentIndex);
  });

  entries.forEach((entry) => {
    const meta = getCountryGroupingMeta(entry);
    const continentId = meta?.continentId || "continent_other";
    const continentLabel = meta?.continentLabel || "Other";

    if (!tree.has(continentId)) {
      tree.set(continentId, {
        id: continentId,
        label: continentLabel,
        displayLabel: t(continentLabel, "geo") || continentLabel,
        sortIndex: continentOrder.has(continentId) ? continentOrder.get(continentId) : Number.MAX_SAFE_INTEGER,
        countries: [],
      });
    }

    tree.get(continentId).countries.push(entry);
  });

  return Array.from(tree.values())
    .map((continentNode) => ({
      ...continentNode,
      countries: sortCountriesWithinContinent(continentNode.countries, priorityOrderMap),
    }))
    .sort((a, b) => {
      if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
      return a.displayLabel.localeCompare(b.displayLabel);
    });
}

function getDefaultExpandedContinentId(groupedEntries = []) {
  const selectedCode = normalizeCountryCode(state.selectedInspectorCountryCode);
  const selectedContinentId = getCountryGroupingMeta(selectedCode)?.continentId;
  if (selectedContinentId) return selectedContinentId;

  const activeCode = normalizeCountryCode(state.activeSovereignCode);
  const activeContinentId = getCountryGroupingMeta(activeCode)?.continentId;
  if (activeContinentId) return activeContinentId;

  const europeNode = groupedEntries.find((entry) => entry.id === "continent_europe");
  if (europeNode) return europeNode.id;

  return groupedEntries[0]?.id || "";
}

function ensureInitialInspectorExpansion(groupedEntries = []) {
  if (state.inspectorExpansionInitialized || !groupedEntries.length) return;
  if (!(state.expandedInspectorContinents instanceof Set)) {
    state.expandedInspectorContinents = new Set();
  }

  if (state.expandedInspectorContinents.size > 0) {
    state.inspectorExpansionInitialized = true;
    return;
  }

  const defaultContinentId = getDefaultExpandedContinentId(groupedEntries);
  if (defaultContinentId) {
    state.expandedInspectorContinents.add(`continent::${defaultContinentId}`);
  }
  state.inspectorExpansionInitialized = true;
}

function normalizeActionMode(mode = "auto") {
  if (mode === "ownership" || mode === "visual") return mode;
  return String(state.paintMode || "visual") === "sovereignty" ? "ownership" : "visual";
}

function applyVisualOverridesToFeatureIds(
  targetIds = [],
  color,
  {
    render,
    historyKind = "feature-apply-color",
    dirtyReason = "feature-apply-color",
    addToRecent = true,
  } = {}
) {
  const normalizedTargetIds = Array.from(new Set((targetIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedTargetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "visual",
    };
  }

  const colorToApply = color || state.selectedColor;
  const before = captureHistoryState({
    featureIds: normalizedTargetIds,
  });
  normalizedTargetIds.forEach((id) => {
    state.visualOverrides[id] = colorToApply;
    state.featureOverrides[id] = colorToApply;
  });
  mapRenderer.refreshResolvedColorsForFeatures(normalizedTargetIds, { renderNow: false });
  if (render) render();
  if (addToRecent) {
    addRecentColor(colorToApply);
  }
  markDirty(dirtyReason);
  pushHistoryEntry({
    kind: historyKind,
    before,
    after: captureHistoryState({
      featureIds: normalizedTargetIds,
    }),
    meta: {
      affectsSovereignty: false,
    },
  });
  return {
    applied: true,
    changed: normalizedTargetIds.length,
    matchedCount: normalizedTargetIds.length,
    requestedCount: normalizedTargetIds.length,
    missingCount: 0,
    reason: "",
    mode: "visual",
  };
}

function clearVisualOverridesForFeatureIds(
  targetIds = [],
  {
    render,
    historyKind = "feature-clear-color",
    dirtyReason = "feature-clear-color",
  } = {}
) {
  const normalizedTargetIds = Array.from(new Set((targetIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedTargetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "visual",
    };
  }

  const changedIds = normalizedTargetIds.filter((id) => (
    Object.prototype.hasOwnProperty.call(state.visualOverrides || {}, id)
    || Object.prototype.hasOwnProperty.call(state.featureOverrides || {}, id)
  ));
  if (!changedIds.length) {
    return {
      applied: true,
      changed: 0,
      matchedCount: normalizedTargetIds.length,
      requestedCount: normalizedTargetIds.length,
      missingCount: 0,
      reason: "",
      mode: "visual",
    };
  }

  const before = captureHistoryState({
    featureIds: changedIds,
  });
  changedIds.forEach((id) => {
    delete state.visualOverrides[id];
    delete state.featureOverrides[id];
  });
  mapRenderer.refreshResolvedColorsForFeatures(changedIds, { renderNow: false });
  if (render) render();
  markDirty(dirtyReason);
  pushHistoryEntry({
    kind: historyKind,
    before,
    after: captureHistoryState({
      featureIds: changedIds,
    }),
    meta: {
      affectsSovereignty: false,
    },
  });
  return {
    applied: true,
    changed: changedIds.length,
    matchedCount: normalizedTargetIds.length,
    requestedCount: normalizedTargetIds.length,
    missingCount: 0,
    reason: "",
    mode: "visual",
  };
}

function applyOwnershipToFeatureIds(
  targetIds = [],
  ownerCode,
  {
    render,
    historyKind = "feature-apply-ownership",
    dirtyReason = "feature-apply-ownership",
    recomputeReason = "sidebar-ownership-batch",
  } = {}
) {
  const normalizedTargetIds = Array.from(new Set((targetIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const normalizedOwnerCode = normalizeCountryCode(ownerCode);
  if (!normalizedTargetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "ownership",
    };
  }
  if (!normalizedOwnerCode) {
    return {
      applied: false,
      changed: 0,
      matchedCount: normalizedTargetIds.length,
      requestedCount: normalizedTargetIds.length,
      missingCount: 0,
      reason: "missing-active-owner",
      mode: "ownership",
    };
  }

  const before = captureHistoryState({
    sovereigntyFeatureIds: normalizedTargetIds,
  });
  const changed = setFeatureOwnerCodes(normalizedTargetIds, normalizedOwnerCode);
  mapRenderer.refreshResolvedColorsForFeatures(normalizedTargetIds, { renderNow: false });
  if (changed > 0) {
    mapRenderer.scheduleDynamicBorderRecompute(recomputeReason, 90);
    markDirty(dirtyReason);
    pushHistoryEntry({
      kind: historyKind,
      before,
      after: captureHistoryState({
        sovereigntyFeatureIds: normalizedTargetIds,
      }),
      meta: {
        affectsSovereignty: true,
      },
    });
  }
  if (render) render();
  return {
    applied: true,
    changed,
    matchedCount: normalizedTargetIds.length,
    requestedCount: normalizedTargetIds.length,
    missingCount: 0,
    reason: "",
    mode: "ownership",
  };
}

function applyScenarioOwnerControllerAssignments(
  assignmentsByFeatureId = {},
  {
    render,
    historyKind = "scenario-owner-controller-apply",
    dirtyReason = "scenario-owner-controller-apply",
    recomputeReason = "scenario-owner-controller-apply",
  } = {}
) {
  const entries = Object.entries(assignmentsByFeatureId || {})
    .map(([featureId, assignment]) => {
      const normalizedId = String(featureId || "").trim();
      if (!normalizedId || !assignment || typeof assignment !== "object") return null;
      const ownerCode = normalizeCountryCode(assignment.ownerCode);
      const controllerCode = normalizeCountryCode(assignment.controllerCode || assignment.ownerCode);
      if (!ownerCode || !controllerCode) return null;
      return {
        featureId: normalizedId,
        ownerCode,
        controllerCode,
      };
    })
    .filter(Boolean);

  if (!entries.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "ownership",
    };
  }

  const targetIds = entries.map((entry) => entry.featureId);
  const before = captureHistoryState({
    sovereigntyFeatureIds: targetIds,
    scenarioControllerFeatureIds: targetIds,
  });

  state.scenarioControllersByFeatureId = state.scenarioControllersByFeatureId || {};
  const ownerFeatureIdsByCode = new Map();
  const changedFeatureIds = new Set();

  entries.forEach(({ featureId, ownerCode, controllerCode }) => {
    const currentOwnerCode = normalizeCountryCode(state.sovereigntyByFeatureId?.[featureId]);
    const currentControllerCode = normalizeCountryCode(
      state.scenarioControllersByFeatureId?.[featureId] || currentOwnerCode
    );
    if (currentOwnerCode !== ownerCode) {
      if (!ownerFeatureIdsByCode.has(ownerCode)) {
        ownerFeatureIdsByCode.set(ownerCode, []);
      }
      ownerFeatureIdsByCode.get(ownerCode).push(featureId);
      changedFeatureIds.add(featureId);
    }
    if (currentControllerCode !== controllerCode) {
      state.scenarioControllersByFeatureId[featureId] = controllerCode;
      changedFeatureIds.add(featureId);
    }
  });

  let ownerChanged = 0;
  ownerFeatureIdsByCode.forEach((featureIds, ownerCode) => {
    ownerChanged += setFeatureOwnerCodes(featureIds, ownerCode);
  });
  if (changedFeatureIds.size) {
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
    recalculateScenarioOwnerControllerDiffCount();
    mapRenderer.refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
    mapRenderer.scheduleDynamicBorderRecompute(recomputeReason, 90);
    markDirty(dirtyReason);
    pushHistoryEntry({
      kind: historyKind,
      before,
      after: captureHistoryState({
        sovereigntyFeatureIds: targetIds,
        scenarioControllerFeatureIds: targetIds,
      }),
      meta: {
        affectsSovereignty: true,
      },
    });
  }
  if (render) render();
  return {
    applied: true,
    changed: changedFeatureIds.size,
    matchedCount: targetIds.length,
    requestedCount: targetIds.length,
    missingCount: 0,
    reason: "",
    mode: "ownership",
  };
}

function getScenarioBoundaryVariantUnionFeatureIds(countryState, targetIds = []) {
  const scenarioMeta = getScenarioCountryMeta(countryState?.code) || countryState || {};
  const lookupEntry = {
    tag: scenarioMeta?.code || countryState?.code || "",
    release_lookup_iso2:
      scenarioMeta?.release_lookup_iso2
      || scenarioMeta?.releaseLookupIso2
      || scenarioMeta?.lookup_iso2
      || scenarioMeta?.lookupIso2
      || scenarioMeta?.base_iso2
      || scenarioMeta?.baseIso2
      || "",
    lookup_iso2:
      scenarioMeta?.lookup_iso2
      || scenarioMeta?.lookupIso2
      || scenarioMeta?.release_lookup_iso2
      || scenarioMeta?.releaseLookupIso2
      || scenarioMeta?.base_iso2
      || scenarioMeta?.baseIso2
      || "",
    base_iso2: scenarioMeta?.base_iso2 || scenarioMeta?.baseIso2 || scenarioMeta?.lookup_iso2 || scenarioMeta?.lookupIso2 || "",
  };
  const featureIds = new Set((targetIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const variants = Array.isArray(scenarioMeta?.boundary_variants)
    ? scenarioMeta.boundary_variants
    : Array.isArray(scenarioMeta?.boundaryVariants)
      ? scenarioMeta.boundaryVariants
      : [];
  variants.forEach((variant) => {
    resolveFeatureIdsFromPresetSource(variant?.preset_source, lookupEntry).forEach((featureId) => {
      const normalizedId = String(featureId || "").trim();
      if (normalizedId) {
        featureIds.add(normalizedId);
      }
    });
  });
  return Array.from(featureIds);
}

function applyHierarchyGroupWithMode(
  group,
  {
    mode = "auto",
    color,
    ownerCode,
    render,
    ownershipHistoryKind = "hierarchy-apply-sovereignty",
    ownershipDirtyReason = "hierarchy-apply-sovereignty",
    visualHistoryKind = "hierarchy-apply-color",
    visualDirtyReason = "hierarchy-apply-color",
  } = {}
) {
  if (!group || !group.children) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "missing-group",
      mode: normalizeActionMode(mode),
    };
  }
  const targetIds = Array.isArray(group.children)
    ? Array.from(new Set(group.children.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  const resolvedMode = normalizeActionMode(mode);
  if (resolvedMode === "ownership") {
    return applyOwnershipToFeatureIds(targetIds, ownerCode || state.activeSovereignCode, {
      render,
      historyKind: ownershipHistoryKind,
      dirtyReason: ownershipDirtyReason,
      recomputeReason: "sidebar-hierarchy-batch",
    });
  }
  return applyVisualOverridesToFeatureIds(targetIds, color || state.selectedColor, {
    render,
    historyKind: visualHistoryKind,
    dirtyReason: visualDirtyReason,
  });
}

function applyHierarchyGroup(group, color, render) {
  return applyHierarchyGroupWithMode(group, {
    mode: "auto",
    color,
    render,
  });
}

function addRecentColor(color) {
  if (!color) return;
  state.recentColors = state.recentColors.filter((value) => value !== color);
  state.recentColors.unshift(color);
  if (state.recentColors.length > 10) {
    state.recentColors = state.recentColors.slice(0, 10);
  }
  if (typeof state.updateRecentUI === "function") {
    state.updateRecentUI();
  }
}

function filterToVisibleFeatureIds(featureIds = []) {
  const requestedIds = Array.isArray(featureIds)
    ? Array.from(new Set(featureIds.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  if (!requestedIds.length) {
    return {
      requestedIds: [],
      matchedIds: [],
      missingIds: [],
    };
  }
  const landIndex = state.landIndex instanceof Map ? state.landIndex : null;
  if (!landIndex || landIndex.size === 0) {
    return {
      requestedIds,
      matchedIds: requestedIds,
      missingIds: [],
    };
  }
  const matchedIds = [];
  const missingIds = [];
  requestedIds.forEach((id) => {
    if (landIndex.has(id)) {
      matchedIds.push(id);
      return;
    }
    missingIds.push(id);
  });
  return {
    requestedIds,
    matchedIds,
    missingIds,
  };
}

function getOwnedVisibleFeatureIds(ownerCode) {
  const normalizedOwnerCode = normalizeCountryCode(ownerCode);
  if (!normalizedOwnerCode) {
    return {
      requestedIds: [],
      matchedIds: [],
      missingIds: [],
    };
  }

  let requestedIds = [];
  if (state.sovereigntyByFeatureId && typeof state.sovereigntyByFeatureId === "object") {
    requestedIds = Object.entries(state.sovereigntyByFeatureId)
      .filter(([, rawOwnerCode]) => normalizeCountryCode(rawOwnerCode) === normalizedOwnerCode)
      .map(([featureId]) => featureId);
  }

  if (!requestedIds.length && state.countryToFeatureIds instanceof Map) {
    requestedIds = Array.isArray(state.countryToFeatureIds?.get(normalizedOwnerCode))
      ? state.countryToFeatureIds.get(normalizedOwnerCode)
      : [];
  }

  return filterToVisibleFeatureIds(requestedIds);
}

function applyPresetWithMode(
  countryCode,
  presetIndex,
  {
    mode = "auto",
    color,
    ownerCode,
    render,
    ownershipHistoryKind = "preset-apply-sovereignty",
    ownershipDirtyReason = "preset-apply-sovereignty",
    visualHistoryKind = "preset-apply-color",
    visualDirtyReason = "preset-apply-color",
  } = {}
) {
  const presetLookupCode = resolveScenarioLookupCode(countryCode);
  const presets = state.presetsState[presetLookupCode];
  if (!presets || !presets[presetIndex]) {
    console.warn(`Preset not found: ${presetLookupCode}[${presetIndex}]`);
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "missing-preset",
    };
  }

  const preset = presets[presetIndex];
  const requestedFeatureIds = Array.isArray(preset.ids)
    ? preset.ids
    : [];
  const {
    requestedIds,
    matchedIds: targetIds,
    missingIds,
  } = filterToVisibleFeatureIds(requestedFeatureIds);
  if (!requestedIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-preset",
    };
  }
  if (!targetIds.length) {
    showToast(
      t("Current map does not include this preset's detail features. Load detail topology and try again.", "ui"),
      {
        title: t("Preset not applied", "ui"),
        tone: "warning",
        duration: 4200,
      }
    );
    console.warn("[scenario] Preset apply skipped because no visible feature ids matched.", {
      countryCode,
      presetLookupCode,
      presetName: preset.name,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
    });
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "no-visible-features",
    };
  }

  const resolvedMode = normalizeActionMode(mode);
  if (resolvedMode === "ownership") {
    const result = applyOwnershipToFeatureIds(targetIds, ownerCode || state.activeSovereignCode, {
      render,
      historyKind: ownershipHistoryKind,
      dirtyReason: ownershipDirtyReason,
      recomputeReason: "sidebar-preset-batch",
    });
    return {
      ...result,
      matchedCount: targetIds.length,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
    };
  }

  const result = applyVisualOverridesToFeatureIds(targetIds, color || state.selectedColor, {
    render,
    historyKind: visualHistoryKind,
    dirtyReason: visualDirtyReason,
  });
  console.log(`Applied preset "${preset.name}" with ${targetIds.length} visible regions`);
  return {
    ...result,
    matchedCount: targetIds.length,
    requestedCount: requestedIds.length,
    missingCount: missingIds.length,
  };
}

function applyPreset(countryCode, presetIndex, color, render) {
  return applyPresetWithMode(countryCode, presetIndex, {
    mode: "auto",
    color,
    render,
  });
}

function applyExplicitOwnershipTransfer(
  requestedFeatureIds,
  targetOwnerCode,
  {
    render,
    historyKind = "scenario-companion-transfer",
    dirtyReason = "scenario-companion-transfer",
    recomputeReason = "sidebar-companion-transfer",
  } = {}
) {
  const {
    requestedIds,
    matchedIds: targetIds,
    missingIds,
  } = filterToVisibleFeatureIds(requestedFeatureIds);
  if (!requestedIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "ownership",
    };
  }
  if (!targetIds.length) {
    showToast(
      t("Current map does not include this action's detail features. Load detail topology and try again.", "ui"),
      {
        title: t("Transfer not applied", "ui"),
        tone: "warning",
        duration: 4200,
      }
    );
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "no-visible-features",
      mode: "ownership",
    };
  }
  const assignmentsByFeatureId = Object.fromEntries(
    targetIds.map((featureId) => [
      featureId,
      {
        ownerCode: targetOwnerCode,
        controllerCode: targetOwnerCode,
      },
    ])
  );
  const result = applyScenarioOwnerControllerAssignments(assignmentsByFeatureId, {
    render,
    historyKind,
    dirtyReason,
    recomputeReason,
  });
  return {
    ...result,
    matchedCount: targetIds.length,
    requestedCount: requestedIds.length,
    missingCount: missingIds.length,
  };
}

function initSidebar({ render } = {}) {
  const list = document.getElementById("countryList");
  if (!list) return;
  const presetTree = document.getElementById("presetTree");
  const searchInput = document.getElementById("countrySearch");
  const resetBtn = document.getElementById("resetCountryColors");
  const sidebar = document.getElementById("rightSidebar");
  const projectLegendStack = document.getElementById("projectLegendStack");
  const diagnosticStack = document.getElementById("diagnosticStack");

  let projectSection = document.getElementById("projectManagement");
  if (!projectSection && projectLegendStack) {
    projectSection = document.createElement("div");
    projectSection.id = "projectManagement";
    projectSection.className = "inspector-tool-card";

    const title = document.createElement("div");
    title.id = "lblProjectManagement";
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Project Management", "ui");

    const hint = document.createElement("p");
    hint.id = "lblProjectHint";
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Save or load your map state as a project file.", "ui");

    const actions = document.createElement("div");
    actions.className = "mt-3 flex flex-col gap-2";

    const downloadBtn = document.createElement("button");
    downloadBtn.id = "downloadProjectBtn";
    downloadBtn.type = "button";
    downloadBtn.className = "btn-primary";
    downloadBtn.textContent = t("Download Project", "ui");

    const uploadBtn = document.createElement("button");
    uploadBtn.id = "uploadProjectBtn";
    uploadBtn.type = "button";
    uploadBtn.className = "btn-secondary";
    uploadBtn.textContent = t("Load Project", "ui");

    const fileInput = document.createElement("input");
    fileInput.id = "projectFileInput";
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.className = "hidden";

    const fileMeta = document.createElement("div");
    fileMeta.id = "projectFileMeta";
    fileMeta.className = "project-file-meta";

    const fileMetaLabel = document.createElement("span");
    fileMetaLabel.id = "lblProjectFile";
    fileMetaLabel.className = "section-header";
    fileMetaLabel.textContent = t("Selected File", "ui");

    const fileName = document.createElement("span");
    fileName.id = "projectFileName";
    fileName.className = "project-file-name";
    fileName.textContent = t("No file selected", "ui");

    fileMeta.appendChild(fileMetaLabel);
    fileMeta.appendChild(fileName);

    actions.appendChild(downloadBtn);
    actions.appendChild(uploadBtn);
    actions.appendChild(fileMeta);
    actions.appendChild(fileInput);

    projectSection.appendChild(title);
    projectSection.appendChild(hint);
    projectSection.appendChild(actions);
    projectLegendStack.appendChild(projectSection);
  }

  let legendSection = document.getElementById("legendEditor");
  if (!legendSection && projectLegendStack) {
    legendSection = document.createElement("div");
    legendSection.id = "legendEditor";
    legendSection.className = "inspector-tool-card";

    const title = document.createElement("div");
    title.id = "lblLegendEditor";
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Legend Editor", "ui");

    const hint = document.createElement("p");
    hint.id = "lblLegendHint";
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Paint regions to generate a legend.", "ui");

    const list = document.createElement("div");
    list.id = "legendEditorList";
    list.className = "mt-3";

    legendSection.appendChild(title);
    legendSection.appendChild(hint);
    legendSection.appendChild(list);
    projectLegendStack.appendChild(legendSection);
  }

  let scenarioAuditSection = document.getElementById("scenarioAuditPanel");
  if (!scenarioAuditSection && diagnosticStack) {
    scenarioAuditSection = document.createElement("div");
    scenarioAuditSection.id = "scenarioAuditPanel";
    scenarioAuditSection.className = "inspector-tool-card";
    diagnosticStack.appendChild(scenarioAuditSection);
  }

  let debugViewSection = document.getElementById("debugViewControl");
  if (!debugViewSection && diagnosticStack) {
    debugViewSection = document.createElement("div");
    debugViewSection.id = "debugViewControl";
    debugViewSection.className = "inspector-tool-card sidebar-tool-card-debug";

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Debug Mode", "ui");

    const hint = document.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Use diagnostics to inspect geometry and artifact behavior.", "ui");

    const group = document.createElement("div");
    group.className = "control-group mt-3";

    const label = document.createElement("label");
    label.setAttribute("for", "debug-mode-select");
    label.textContent = t("View", "ui");

    const select = document.createElement("select");
    select.id = "debug-mode-select";
    select.className = "select-input debug-select";

    [
      ["PROD", "Normal View"],
      ["GEOMETRY", "1. Geometry Check (Pink/Green)"],
      ["ARTIFACTS", "2. Artifact Hunter (Red Giants)"],
      ["ISLANDS", "3. Island Detector (Orange)"],
      ["ID_HASH", "4. ID Stability"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.id = `debugOption${value}`;
      option.textContent = t(label, "ui");
      select.appendChild(option);
    });

    group.appendChild(label);
    group.appendChild(select);
    debugViewSection.appendChild(title);
    debugViewSection.appendChild(hint);
    debugViewSection.appendChild(group);
    diagnosticStack.appendChild(debugViewSection);
  }

  const downloadProjectBtn = document.getElementById("downloadProjectBtn");
  const uploadProjectBtn = document.getElementById("uploadProjectBtn");
  const projectFileInput = document.getElementById("projectFileInput");
  const projectFileName = document.getElementById("projectFileName");
  const legendList = document.getElementById("legendEditorList");
  const debugModeSelect = document.getElementById("debug-mode-select");
  const countryInspectorEmpty = document.getElementById("countryInspectorEmpty");
  const countryInspectorSelected = document.getElementById("countryInspectorSelected");
  const countryInspectorSetActive = document.getElementById("countryInspectorSetActive");
  const countryInspectorDetailHint = document.getElementById("countryInspectorDetailHint");
  const countryInspectorColorRow = document.getElementById("countryInspectorColorRow");
  const countryInspectorColorLabel = document.getElementById("countryInspectorColorLabel");
  const countryInspectorColorSwatch = document.getElementById("countryInspectorColorSwatch");
  const countryInspectorColorValue = document.getElementById("countryInspectorColorValue");
  const countryInspectorColorInput = document.getElementById("countryInspectorColorInput");
  const countryInspectorOrderingHint = document.getElementById("countryInspectorOrderingHint");
  const countryInspectorSection = document.getElementById("countryInspectorSection");
  const waterInspectorSection = document.getElementById("waterInspectorSection");
  const waterInspectorOpenOceanToggle = document.getElementById("waterInspectorOpenOceanToggle");
  const waterInspectorOpenOceanHint = document.getElementById("waterInspectorOpenOceanHint");
  const waterSearchInput = document.getElementById("waterRegionSearch");
  const waterRegionList = document.getElementById("waterRegionList");
  const waterLegendList = document.getElementById("waterLegendList");
  const waterInspectorEmpty = document.getElementById("waterInspectorEmpty");
  const waterInspectorSelected = document.getElementById("waterInspectorSelected");
  const waterInspectorDetailHint = document.getElementById("waterInspectorDetailHint");
  const waterInspectorColorRow = document.getElementById("waterInspectorColorRow");
  const waterInspectorColorLabel = document.getElementById("waterInspectorColorLabel");
  const waterInspectorColorSwatch = document.getElementById("waterInspectorColorSwatch");
  const waterInspectorColorValue = document.getElementById("waterInspectorColorValue");
  const waterInspectorColorInput = document.getElementById("waterInspectorColorInput");
  const clearWaterRegionColorBtn = document.getElementById("clearWaterRegionColorBtn");
  const specialRegionInspectorSection = document.getElementById("specialRegionInspectorSection");
  const scenarioSpecialRegionVisibilityToggle = document.getElementById("scenarioSpecialRegionVisibilityToggle");
  const scenarioSpecialRegionVisibilityHint = document.getElementById("scenarioSpecialRegionVisibilityHint");
  const scenarioReliefOverlayVisibilityToggle = document.getElementById("scenarioReliefOverlayVisibilityToggle");
  const scenarioReliefOverlayVisibilityHint = document.getElementById("scenarioReliefOverlayVisibilityHint");
  const specialRegionSearchInput = document.getElementById("specialRegionSearch");
  const specialRegionList = document.getElementById("specialRegionList");
  const specialRegionLegendList = document.getElementById("specialRegionLegendList");
  const specialRegionInspectorEmpty = document.getElementById("specialRegionInspectorEmpty");
  const specialRegionInspectorSelected = document.getElementById("specialRegionInspectorSelected");
  const specialRegionInspectorDetailHint = document.getElementById("specialRegionInspectorDetailHint");
  const specialRegionColorRow = document.getElementById("specialRegionColorRow");
  const specialRegionColorLabel = document.getElementById("specialRegionColorLabel");
  const specialRegionColorSwatch = document.getElementById("specialRegionColorSwatch");
  const specialRegionColorValue = document.getElementById("specialRegionColorValue");
  const specialRegionColorInput = document.getElementById("specialRegionColorInput");
  const clearSpecialRegionColorBtn = document.getElementById("clearSpecialRegionColorBtn");
  const selectedCountryActionsSection = document.getElementById("selectedCountryActionsSection");
  const projectLegendSection = document.getElementById("lblProjectLegend")?.closest("details");
  const diagnosticsSection = document.getElementById("lblDiagnostics")?.closest("details");
  const selectedCountryActionsTitle = document.getElementById("lblHistoricalPresets");
  const selectedCountryActionHint = document.getElementById("selectedCountryActionHint");

  const updateScenarioInspectorLayout = () => {
    const isScenarioMode = !!state.activeScenarioId;
    projectLegendSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    diagnosticsSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    if (countryInspectorOrderingHint) {
      countryInspectorOrderingHint.classList.toggle("hidden", isScenarioMode);
    }
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.classList.remove("hidden");
      selectedCountryActionsSection.setAttribute("aria-hidden", "false");
      if (isScenarioMode) {
        selectedCountryActionsSection.open = true;
      }
    }
    if (countryInspectorSection && isScenarioMode) {
      countryInspectorSection.open = true;
    }
    if (projectLegendSection && diagnosticsSection && isScenarioMode) {
      projectLegendSection.open = false;
      diagnosticsSection.open = false;
    }
    if (selectedCountryActionsTitle) {
      selectedCountryActionsTitle.textContent = isScenarioMode
        ? t("Scenario Actions", "ui")
        : t("Selected Country Actions", "ui");
    }
    if (selectedCountryActionHint) {
      selectedCountryActionHint.classList.toggle("hidden", isScenarioMode);
      selectedCountryActionHint.textContent = isScenarioMode
        ? t(
          "Scenario Actions below change political ownership first. Open Visual Adjustments only for color-only edits.",
          "ui"
        )
        : t("Choose a country above to inspect territories, presets, and releasables.", "ui");
    }
  };

  const INSPECTOR_VH_BASELINE = {
    countryList: 26,
    presetTree: 28,
    countryListCap: 52,
    presetTreeCap: 56,
  };
  const INSPECTOR_PX_BASELINE = {
    actionList: 120,
    actionListCap: 240,
    presetBody: 216,
    presetBodyCap: 432,
  };
  let adaptiveInspectorHeightFrame = 0;
  let countryInspectorColorPickerOpen = false;
  let waterInspectorColorPickerOpen = false;
  let specialRegionColorPickerOpen = false;

  const clampInspectorHeight = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const toViewportPixels = (vh) => (window.innerHeight * vh) / 100;

  const applyAdaptiveInspectorHeight = (element, minimum, maximum) => {
    if (!element) return;
    const scrollHeight = Number(element.scrollHeight || 0);
    const nextHeight = clampInspectorHeight(scrollHeight, minimum, maximum);
    element.style.height = `${Math.round(nextHeight)}px`;
    element.style.maxHeight = `${Math.round(nextHeight)}px`;
  };

  const syncAdaptiveInspectorHeights = () => {
    adaptiveInspectorHeightFrame = 0;
    applyAdaptiveInspectorHeight(
      list,
      toViewportPixels(INSPECTOR_VH_BASELINE.countryList),
      toViewportPixels(INSPECTOR_VH_BASELINE.countryListCap)
    );
    applyAdaptiveInspectorHeight(
      waterRegionList,
      toViewportPixels(18),
      toViewportPixels(34)
    );
    applyAdaptiveInspectorHeight(
      waterLegendList,
      96,
      220
    );
    applyAdaptiveInspectorHeight(
      specialRegionList,
      toViewportPixels(16),
      toViewportPixels(30)
    );
    applyAdaptiveInspectorHeight(
      specialRegionLegendList,
      96,
      220
    );
    applyAdaptiveInspectorHeight(
      presetTree,
      toViewportPixels(INSPECTOR_VH_BASELINE.presetTree),
      toViewportPixels(INSPECTOR_VH_BASELINE.presetTreeCap)
    );
    sidebar?.querySelectorAll(".inspector-action-list").forEach((element) => {
      applyAdaptiveInspectorHeight(
        element,
        INSPECTOR_PX_BASELINE.actionList,
        INSPECTOR_PX_BASELINE.actionListCap
      );
    });
    sidebar?.querySelectorAll(".preset-country-body").forEach((element) => {
      applyAdaptiveInspectorHeight(
        element,
        INSPECTOR_PX_BASELINE.presetBody,
        INSPECTOR_PX_BASELINE.presetBodyCap
      );
    });
  };

  const scheduleAdaptiveInspectorHeights = () => {
    if (adaptiveInspectorHeightFrame) {
      globalThis.cancelAnimationFrame(adaptiveInspectorHeightFrame);
    }
    adaptiveInspectorHeightFrame = globalThis.requestAnimationFrame(syncAdaptiveInspectorHeights);
  };

  const positionCountryInspectorColorAnchor = () => {
    if (!countryInspectorColorInput || !countryInspectorColorSwatch) return;
    const rect = countryInspectorColorSwatch.getBoundingClientRect();
    countryInspectorColorInput.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    countryInspectorColorInput.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
  };

  const closeCountryInspectorColorPicker = () => {
    if (!countryInspectorColorInput) return;
    countryInspectorColorPickerOpen = false;
    countryInspectorColorInput.blur();
  };

  const closeWaterInspectorColorPicker = () => {
    if (!waterInspectorColorInput) return;
    waterInspectorColorPickerOpen = false;
    waterInspectorColorInput.blur();
  };

  const closeSpecialRegionColorPicker = () => {
    if (!specialRegionColorInput) return;
    specialRegionColorPickerOpen = false;
    specialRegionColorInput.blur();
  };

  if (projectFileName && !projectFileName.textContent.trim()) {
    projectFileName.textContent = t("No file selected", "ui");
  }

  if (!(state.expandedInspectorContinents instanceof Set)) {
    state.expandedInspectorContinents = new Set();
  }
  if (!(state.expandedInspectorReleaseParents instanceof Set)) {
    state.expandedInspectorReleaseParents = new Set();
  }
  if (typeof state.selectedInspectorCountryCode !== "string") {
    state.selectedInspectorCountryCode = "";
  }
  if (typeof state.ui?.scenarioVisualAdjustmentsOpen !== "boolean") {
    state.ui.scenarioVisualAdjustmentsOpen = false;
  }
  if (typeof state.ui?.politicalEditingExpanded !== "boolean") {
    state.ui.politicalEditingExpanded = false;
  }
  if (typeof state.inspectorExpansionInitialized !== "boolean") {
    state.inspectorExpansionInitialized = false;
  }

  let latestCountryStatesByCode = new Map();
  const waterRowRefsById = new Map();
  const specialRegionRowRefsById = new Map();
  const countryRowRefsByCode = new Map();
  const getSearchTerm = () => (searchInput?.value || "").trim().toLowerCase();
  const matchesTerm = (value, term) => String(value || "").toLowerCase().includes(term);
  const incrementSidebarCounter = (counterName, amount = 1) => {
    if (!state.sidebarPerf || typeof state.sidebarPerf !== "object") {
      state.sidebarPerf = {};
    }
    if (!state.sidebarPerf.counters || typeof state.sidebarPerf.counters !== "object") {
      state.sidebarPerf.counters = {};
    }
    state.sidebarPerf.counters[counterName] = (Number(state.sidebarPerf.counters[counterName]) || 0) + Number(amount || 0);
  };
  const registerCountryRowRef = (countryCode, ref) => {
    const normalized = normalizeCountryCode(countryCode);
    if (!normalized || !ref) return;
    const refs = countryRowRefsByCode.get(normalized) || [];
    refs.push(ref);
    countryRowRefsByCode.set(normalized, refs);
  };

  const getInspectorCountryDisplayName = (code) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return "";
    const inspectorState = latestCountryStatesByCode.get(normalized);
    if (inspectorState?.displayName) {
      return inspectorState.displayName;
    }
    const scenarioCountry = state.scenarioCountriesByTag?.[normalized];
    const scenarioName = String(scenarioCountry?.display_name || "").trim();
    if (scenarioName) {
      return t(scenarioName, "geo") || scenarioName;
    }
    const fallbackName = String(state.countryNames?.[normalized] || countryNames[normalized] || normalized).trim();
    return t(fallbackName, "geo") || fallbackName || normalized;
  };

  const formatReleasableParentLabel = (countryState, { conjunction = false } = {}) => {
    const parentCodes = Array.isArray(countryState?.parentOwnerTags) && countryState.parentOwnerTags.length
      ? countryState.parentOwnerTags
      : (countryState?.parentOwnerTag ? [countryState.parentOwnerTag] : []);
    const labels = parentCodes
      .map((parentCode) => getInspectorCountryDisplayName(parentCode))
      .filter(Boolean);
    if (!conjunction || labels.length <= 1) {
      return labels.join(", ");
    }
    if (labels.length === 2) {
      return `${labels[0]} ${t("and", "ui")} ${labels[1]}`;
    }
    return `${labels.slice(0, -1).join(", ")} ${t("and", "ui")} ${labels[labels.length - 1]}`;
  };

  const getScenarioSubjectKindLabel = (countryState) => {
    const normalizedKind = String(countryState?.subjectKind || countryState?.subject_kind || "").trim().toLowerCase();
    if (!normalizedKind) return "";
    const labels = {
      raj: t("Raj", "ui"),
      dominion: t("Dominion", "ui"),
      mandate: t("Mandate", "ui"),
      protectorate: t("Protectorate", "ui"),
      client_state: t("Client State", "ui"),
      condominium: t("Condominium", "ui"),
      colony: t("Colony", "ui"),
      commonwealth: t("Commonwealth", "ui"),
      colonial_government: t("Colonial Government", "ui"),
      colonial_federation: t("Colonial Federation", "ui"),
    };
    return labels[normalizedKind] || normalizedKind.replace(/_/g, " ");
  };

  const buildCountryRowMetaText = (countryState, { showRelationMeta = false } = {}) => {
    const metaBits = [countryState?.subregionDisplayLabel].filter(Boolean);
    if (countryState?.releasable && showRelationMeta) {
      const parentLabel = formatReleasableParentLabel(countryState);
      metaBits.push(
        parentLabel
          ? `${t("Releasable from", "ui")} ${parentLabel}`
          : t("Releasable", "ui")
      );
    } else if (countryState?.scenarioSubject && showRelationMeta) {
      const isCondominium = String(countryState?.subjectKind || countryState?.subject_kind || "").trim().toLowerCase() === "condominium";
      const parentLabel = formatReleasableParentLabel(countryState, { conjunction: isCondominium });
      const subjectLabel = getScenarioSubjectKindLabel(countryState);
      metaBits.push(
        parentLabel
          ? `${subjectLabel || t("Subject", "ui")} ${t("of", "ui")} ${parentLabel}`
          : (subjectLabel || t("Subject", "ui"))
      );
    }
    return metaBits.join(" · ");
  };

  const syncCountryRowVisuals = (ref, countryState) => {
    if (!ref || !countryState) return;
    const isSelected = state.selectedInspectorCountryCode === countryState.code;
    const isActiveOwner = state.activeSovereignCode === countryState.code;
    ref.row?.classList.toggle("is-selected", isSelected);
    ref.row?.classList.toggle("is-active-owner", isActiveOwner);
    ref.wrapper?.classList.toggle("is-selected", isSelected);
    ref.wrapper?.classList.toggle("is-active-owner", isActiveOwner);
    if (ref.main) {
      ref.main.setAttribute("aria-pressed", String(isSelected));
    }
    if (ref.swatch) {
      ref.swatch.style.backgroundColor = getResolvedCountryColor(countryState);
    }
    if (ref.title) {
      ref.title.textContent = `${countryState.displayName} (${countryState.code})`;
    }
    if (ref.meta) {
      ref.meta.textContent = buildCountryRowMetaText(countryState, {
        showRelationMeta: !!ref.showRelationMeta,
      });
    }
  };

  const createCountryInspectorState = (entry, fallbackIndex = 0) => {
    const inlineReleasableMeta = !!(entry?.releasable || String(entry?.entry_kind || entry?.entryKind || "").trim() === "releasable");
    const scenarioMeta = inlineReleasableMeta
      ? (entry || getScenarioCountryMeta(entry.code) || {})
      : (getScenarioCountryMeta(entry.code) || entry || {});
    const lookupIso2 = resolveScenarioLookupCode(entry);
    const inspectorDataCode = resolveInspectorDataCode(entry);
    const presetLookupCode = resolveScenarioLookupCode(entry);
    const groupLookupCode = resolveCountryGroupingCode(entry);
    const groupingMeta = getCountryGroupingMeta(entry) || {};
    const continentLabel =
      String(scenarioMeta.continent_label || scenarioMeta.continentLabel || groupingMeta.continentLabel || "Other");
    const subregionLabel =
      String(scenarioMeta.subregion_label || scenarioMeta.subregionLabel || groupingMeta.subregionLabel || "Unclassified");
    return {
      ...entry,
      fallbackIndex,
      lookupIso2,
      inspectorDataCode,
      presetLookupCode,
      groupingCode: groupLookupCode,
      presets: state.presetsState[presetLookupCode] || [],
      hierarchyGroups: scenarioMeta.releasable ? [] : getHierarchyGroupsForCode(groupLookupCode),
      continentId:
        String(scenarioMeta.continent_id || scenarioMeta.continentId || groupingMeta.continentId || "continent_other"),
      continentLabel,
      continentDisplayLabel: t(continentLabel, "geo") || continentLabel,
      subregionId:
        String(scenarioMeta.subregion_id || scenarioMeta.subregionId || groupingMeta.subregionId || "subregion_unclassified"),
      subregionLabel,
      subregionDisplayLabel: t(subregionLabel, "geo") || subregionLabel,
      quality: String(scenarioMeta.quality || entry.quality || "").trim(),
      featureCount: Number(scenarioMeta.feature_count || entry.featureCount || 0),
      baseIso2: String(scenarioMeta.base_iso2 || entry.baseIso2 || "").trim().toUpperCase(),
      releaseLookupIso2: String(
        scenarioMeta.release_lookup_iso2
        || entry.releaseLookupIso2
        || ""
      ).trim().toUpperCase(),
      scenarioOnly: !!(scenarioMeta.scenario_only ?? entry.scenarioOnly),
      releasable: !!(scenarioMeta.releasable ?? entry.releasable),
      scenarioSubject: String(scenarioMeta.entry_kind || entry.entryKind || "").trim() === "scenario_subject",
      entryKind: String(scenarioMeta.entry_kind || entry.entryKind || "").trim(),
      subjectKind: String(scenarioMeta.subject_kind || entry.subjectKind || "").trim().toLowerCase(),
      parentOwnerTag: String(scenarioMeta.parent_owner_tag || entry.parentOwnerTag || "").trim().toUpperCase(),
      parentOwnerTags: Array.isArray(scenarioMeta.parent_owner_tags)
        ? scenarioMeta.parent_owner_tags.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
        : Array.isArray(entry.parentOwnerTags)
          ? entry.parentOwnerTags
          : [],
      disabledRegionalPresetNames: (
        Array.isArray(scenarioMeta.disabled_regional_preset_names)
          ? scenarioMeta.disabled_regional_preset_names
          : Array.isArray(entry.disabledRegionalPresetNames)
            ? entry.disabledRegionalPresetNames
            : []
      )
        .map((value) => normalizePresetName(value))
        .filter(Boolean),
      disabledRegionalPresetReason: String(
        scenarioMeta.disabled_regional_preset_reason
        || entry.disabledRegionalPresetReason
        || ""
      ).trim(),
      syntheticOwner: !!(scenarioMeta.synthetic_owner ?? entry.syntheticOwner),
      hiddenFromCountryList: !!(scenarioMeta.hidden_from_country_list ?? entry.hiddenFromCountryList),
      featured: !!(scenarioMeta.featured ?? entry.featured),
      catalogOrder: Number(scenarioMeta.catalog_order ?? entry.catalogOrder ?? Number.MAX_SAFE_INTEGER),
      notes: String(scenarioMeta.notes || entry.notes || "").trim(),
      defaultBoundaryVariantId: String(
        scenarioMeta.default_boundary_variant_id
        || entry.defaultBoundaryVariantId
        || ""
      ).trim().toLowerCase(),
      selectedBoundaryVariantId: String(
        scenarioMeta.selected_boundary_variant_id
        || entry.selectedBoundaryVariantId
        || ""
      ).trim().toLowerCase(),
      selectedBoundaryVariantLabel: String(
        scenarioMeta.selected_boundary_variant_label
        || entry.selectedBoundaryVariantLabel
        || ""
      ).trim(),
      selectedBoundaryVariantDescription: String(
        scenarioMeta.selected_boundary_variant_description
        || entry.selectedBoundaryVariantDescription
        || ""
      ).trim(),
      boundaryVariants: Array.isArray(scenarioMeta.boundary_variants)
        ? scenarioMeta.boundary_variants
        : Array.isArray(entry.boundaryVariants)
          ? entry.boundaryVariants
          : [],
      companionActions: Array.isArray(scenarioMeta.companion_actions)
        ? scenarioMeta.companion_actions
        : Array.isArray(entry.companionActions)
          ? entry.companionActions
          : [],
    };
  };

  const compareRelatedCountryStates = (a, b) => {
    const catalogOrderDelta = Number(a?.catalogOrder ?? Number.MAX_SAFE_INTEGER)
      - Number(b?.catalogOrder ?? Number.MAX_SAFE_INTEGER);
    if (catalogOrderDelta !== 0) return catalogOrderDelta;
    const featureDelta = Number(b?.featureCount || 0) - Number(a?.featureCount || 0);
    if (featureDelta !== 0) return featureDelta;
    return String(a?.displayName || "").localeCompare(String(b?.displayName || ""));
  };

  const getScenarioSubjectChildrenForParent = (parentTag) => {
    const normalizedParent = normalizeCountryCode(parentTag);
    if (!normalizedParent) return [];
    return Array.from(latestCountryStatesByCode.values())
      .filter((countryState) => {
        if (!countryState?.scenarioSubject || countryState?.releasable) return false;
        const parentTags = Array.isArray(countryState.parentOwnerTags) && countryState.parentOwnerTags.length
          ? countryState.parentOwnerTags
          : (countryState.parentOwnerTag ? [countryState.parentOwnerTag] : []);
        return parentTags.includes(normalizedParent);
      })
      .sort(compareRelatedCountryStates);
  };

  const getReleasableChildrenForParent = (parentTag) => {
    const normalizedParent = normalizeCountryCode(parentTag);
    if (!normalizedParent) return [];
    const childTags = Array.isArray(state.scenarioReleasableIndex?.childTagsByParent?.[normalizedParent])
      ? state.scenarioReleasableIndex.childTagsByParent[normalizedParent]
      : [];
    return childTags
      .map((childTag, childIndex) => {
        const normalizedChild = normalizeCountryCode(childTag);
        const existingState = latestCountryStatesByCode.get(normalizedChild);
        const existingParentTags = Array.isArray(existingState?.parentOwnerTags) && existingState.parentOwnerTags.length
          ? existingState.parentOwnerTags
          : (existingState?.parentOwnerTag ? [existingState.parentOwnerTag] : []);
        if (existingState?.scenarioSubject && existingParentTags.includes(normalizedParent)) {
          return null;
        }
        const releasableEntry = state.scenarioReleasableIndex?.byTag?.[normalizedChild];
        if (releasableEntry && typeof releasableEntry === "object") {
          return createCountryInspectorState({
            code: normalizedChild,
            display_name: releasableEntry.display_name,
            color_hex: releasableEntry.color_hex,
            feature_count: Number(releasableEntry.resolved_feature_count_hint || 0),
            release_lookup_iso2: releasableEntry.release_lookup_iso2,
            releasable: true,
            entry_kind: "releasable",
            scenario_only: true,
            parent_owner_tag: releasableEntry.parent_owner_tag,
            parent_owner_tags: Array.isArray(releasableEntry.parent_owner_tags)
              ? releasableEntry.parent_owner_tags
              : [],
            capital_state_id: Number(releasableEntry.capital_state_id || 0) || 0,
            core_state_ids: Array.isArray(releasableEntry.core_state_ids)
              ? releasableEntry.core_state_ids
              : [],
            default_boundary_variant_id: releasableEntry.default_boundary_variant_id,
            boundary_variants: Array.isArray(releasableEntry.boundary_variants)
              ? releasableEntry.boundary_variants
              : [],
            companion_actions: Array.isArray(releasableEntry.companion_actions)
              ? releasableEntry.companion_actions
              : [],
            notes: String(releasableEntry.notes || "").trim(),
            continent_id: releasableEntry.continent_id,
            continent_label: releasableEntry.continent_label,
            subregion_id: releasableEntry.subregion_id,
            subregion_label: releasableEntry.subregion_label,
            catalog_order: Number(releasableEntry.catalog_order ?? childIndex),
          }, childIndex);
        }
        return latestCountryStatesByCode.get(normalizedChild);
      })
      .filter(Boolean)
      .sort(compareRelatedCountryStates);
  };

  const getCountryChildSectionsForParent = (parentTag, { matchedChildCodes = null } = {}) => {
    const matchSet = matchedChildCodes instanceof Set ? matchedChildCodes : null;
    const filterMatched = (states) => (
      matchSet
        ? states.filter((countryState) => matchSet.has(countryState.code))
        : states
    );
    const sections = [];
    const scenarioSubjects = filterMatched(getScenarioSubjectChildrenForParent(parentTag));
    if (scenarioSubjects.length) {
      sections.push({
        id: "scenario-subjects",
        label: t("Subject Governments", "ui"),
        states: scenarioSubjects,
      });
    }
    const releasables = filterMatched(getReleasableChildrenForParent(parentTag));
    if (releasables.length) {
      sections.push({
        id: "releasables",
        label: t("Releasable Countries", "ui"),
        states: releasables,
      });
    }
    return sections;
  };

  const getResolvedCountryColor = (countryState) => {
    if (!countryState?.code) return "#cccccc";
    const fallbackColor = ensureCountryPaletteColor(countryState.code, countryState.fallbackIndex || 0);
    return (
      state.sovereignBaseColors?.[countryState.code] ||
      state.countryBaseColors?.[countryState.code] ||
      state.countryPalette?.[countryState.code] ||
      fallbackColor
    );
  };

  const getDisplayCountryColor = (countryState) =>
    ColorManager.normalizeHexColor(getResolvedCountryColor(countryState)) || "#cccccc";

  const syncSelectedColorFromCountry = (countryState) => {
    const resolvedColor = getDisplayCountryColor(countryState);
    state.selectedColor = resolvedColor;
    if (typeof state.updateSwatchUIFn === "function") {
      state.updateSwatchUIFn();
    }
  };

  const setScenarioVisualAdjustmentsOpen = (nextOpen, { scrollIntoView = false } = {}) => {
    state.ui.scenarioVisualAdjustmentsOpen = !!nextOpen;
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.open = true;
      if (scrollIntoView) {
        selectedCountryActionsSection.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
    if (typeof state.renderPresetTreeFn === "function") {
      state.renderPresetTreeFn();
    }
  };

  state.openScenarioVisualAdjustmentsFn = ({ scrollIntoView = false } = {}) => {
    setScenarioVisualAdjustmentsOpen(true, { scrollIntoView });
  };

  const setScenarioMapPaintMode = (nextMode) => {
    const normalizedMode = nextMode === "ownership" ? "sovereignty" : "visual";
    state.paintMode = normalizedMode;
    if (normalizedMode === "sovereignty") {
      state.interactionGranularity = "subdivision";
    }
    if (typeof state.updatePaintModeUIFn === "function") {
      state.updatePaintModeUIFn();
    }
    if (typeof state.renderNowFn === "function") {
      state.renderNowFn();
    }
  };

  const applyVisualColorToOwnedRegions = (countryState, { renderNow = render, color = null } = {}) => {
    const { requestedIds, matchedIds } = getOwnedVisibleFeatureIds(countryState?.code);
    if (!requestedIds.length || !matchedIds.length) {
      return {
        applied: false,
        changed: 0,
        matchedCount: matchedIds.length,
        requestedCount: requestedIds.length,
        missingCount: 0,
        reason: "no-owned-features",
      };
    }
    return applyVisualOverridesToFeatureIds(
      matchedIds,
      color || getResolvedCountryColor(countryState),
      {
        render: renderNow,
        historyKind: "scenario-country-visual-fill",
        dirtyReason: "scenario-country-visual-fill",
      }
    );
  };

  const clearCountryVisualOverrides = (countryState, { renderNow = render } = {}) => {
    const { requestedIds, matchedIds } = getOwnedVisibleFeatureIds(countryState?.code);
    if (!requestedIds.length || !matchedIds.length) {
      return {
        applied: false,
        changed: 0,
        matchedCount: matchedIds.length,
        requestedCount: requestedIds.length,
        missingCount: 0,
        reason: "no-owned-features",
      };
    }
    return clearVisualOverridesForFeatureIds(matchedIds, {
      render: renderNow,
      historyKind: "scenario-country-visual-clear",
      dirtyReason: "scenario-country-visual-clear",
    });
  };

  const createEmptyNote = (text) => {
    const note = document.createElement("div");
    note.className = "inspector-empty-note";
    note.textContent = text;
    return note;
  };

  const createInspectorActionButton = (label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inspector-item-btn";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };

  const resolveAuditNumber = (...values) => {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    return 0;
  };

  const getScenarioAuditSummary = (auditPayload) => (
    auditPayload?.summary && typeof auditPayload.summary === "object" ? auditPayload.summary : {}
  );

  const getScenarioAuditBlockerCount = (summary = {}) => {
    const flattened = Number(summary.blocker_count);
    if (Number.isFinite(flattened)) {
      return flattened;
    }
    return (
      Number(summary.geometry_blocker_count || 0)
      + Number(summary.topology_blocker_count || 0)
      + Number(summary.scenario_rule_blocker_count || 0)
    );
  };

  const createAuditValueRow = (label, value) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-3";

    const left = document.createElement("span");
    left.className = "inspector-mini-label";
    left.textContent = label;

    const right = document.createElement("span");
    right.className = "country-row-title";
    right.textContent = String(value);

    row.appendChild(left);
    row.appendChild(right);
    return row;
  };

  const createAuditList = (items = [], renderItem) => {
    const list = document.createElement("div");
    list.className = "mt-2 flex flex-col gap-2";
    if (!items.length) {
      list.appendChild(createEmptyNote(t("None", "ui")));
      return list;
    }
    items.forEach((item, index) => {
      const node = renderItem(item, index);
      if (node) {
        list.appendChild(node);
      }
    });
    return list;
  };

  const renderScenarioAuditSummary = (auditPayload, manifestSummary = {}) => {
    const summary = getScenarioAuditSummary(auditPayload);
    const container = document.createElement("div");
    container.className = "mt-3 flex flex-col gap-2";
    container.appendChild(createAuditValueRow(
      t("Owners", "ui"),
      resolveAuditNumber(summary.owner_count, manifestSummary.owner_count)
    ));
    container.appendChild(createAuditValueRow(
      t("Features", "ui"),
      resolveAuditNumber(summary.feature_count, manifestSummary.feature_count)
    ));
    container.appendChild(createAuditValueRow(
      t("Approximate", "ui"),
      resolveAuditNumber(
        summary.approximate_count,
        summary.quality_counts?.approx_existing_geometry,
        manifestSummary.approximate_count,
        manifestSummary.quality_counts?.approx_existing_geometry
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Manual-reviewed", "ui"),
      resolveAuditNumber(
        summary.manual_reviewed_feature_count,
        summary.quality_counts?.manual_reviewed,
        manifestSummary.manual_reviewed_feature_count,
        manifestSummary.quality_counts?.manual_reviewed
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Synthetic", "ui"),
      resolveAuditNumber(
        summary.synthetic_count,
        summary.synthetic_owner_feature_count,
        manifestSummary.synthetic_count,
        manifestSummary.synthetic_owner_feature_count
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Blockers", "ui"),
      getScenarioAuditBlockerCount(Object.keys(summary).length ? summary : manifestSummary)
    ));
    container.appendChild(createAuditValueRow(
      t("Critical checks", "ui"),
      resolveAuditNumber(
        summary.critical_region_check_count,
        summary.manual_reviewed_region_count,
        manifestSummary.critical_region_check_count,
        manifestSummary.manual_reviewed_region_count
      )
    ));
    return container;
  };

  const renderScenarioCriticalChecks = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4";

    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = t("Critical checks", "ui");
    section.appendChild(title);

    const criticalRegions = Array.isArray(auditPayload?.critical_regions)
      ? auditPayload.critical_regions
      : [];
    const regionChecks = auditPayload?.region_checks && typeof auditPayload.region_checks === "object"
      ? auditPayload.region_checks
      : {};

    const items = criticalRegions.length
      ? criticalRegions.map((item) => ({
        regionId: String(item?.region_id || "").trim(),
        status: String(item?.status || regionChecks?.[item?.region_id]?.status || "unknown").trim(),
        notes: String(regionChecks?.[item?.region_id]?.notes || "").trim(),
      }))
      : Object.entries(regionChecks).map(([regionId, payload]) => ({
        regionId: String(regionId || "").trim(),
        status: String(payload?.status || "unknown").trim(),
        notes: String(payload?.notes || "").trim(),
      }));

    section.appendChild(createAuditList(items, ({ regionId, status, notes }) => {
      if (notes) {
        const details = document.createElement("details");
        details.className = "inspector-preset-details";

        const summary = document.createElement("summary");
        summary.className = "inspector-accordion-btn";
        summary.textContent = `${regionId} · ${status}`;

        const body = document.createElement("div");
        body.className = "preset-country-body";
        body.textContent = notes;

        details.appendChild(summary);
        details.appendChild(body);
        return details;
      }

      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-3";
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "body-text",
        textContent: regionId,
      }));
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "inspector-mini-label",
        textContent: status,
      }));
      return row;
    }));

    return section;
  };

  const renderScenarioAuditBlockers = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4 flex flex-col gap-4";

    const topologyWrapper = document.createElement("div");
    const topologyTitle = document.createElement("div");
    topologyTitle.className = "section-header-block";
    topologyTitle.textContent = t("Topology blockers", "ui");
    topologyWrapper.appendChild(topologyTitle);
    topologyWrapper.appendChild(createAuditList(
      Array.isArray(auditPayload?.topology_blockers) ? auditPayload.topology_blockers : [],
      (item) => {
        const row = document.createElement("div");
        row.className = "flex flex-col gap-1";
        row.appendChild(Object.assign(document.createElement("span"), {
          className: "body-text",
          textContent: String(item?.blocker_id || item?.id || "unknown"),
        }));
        if (item?.notes) {
          row.appendChild(Object.assign(document.createElement("span"), {
            className: "inspector-mini-label",
            textContent: String(item.notes),
          }));
        }
        return row;
      }
    ));

    const ruleWrapper = document.createElement("div");
    const ruleTitle = document.createElement("div");
    ruleTitle.className = "section-header-block";
    ruleTitle.textContent = t("Scenario rule blockers", "ui");
    ruleWrapper.appendChild(ruleTitle);
    ruleWrapper.appendChild(createAuditList(
      Array.isArray(auditPayload?.scenario_rule_blockers) ? auditPayload.scenario_rule_blockers : [],
      (item) => {
        const row = document.createElement("div");
        row.className = "flex flex-col gap-1";
        row.appendChild(Object.assign(document.createElement("span"), {
          className: "body-text",
          textContent: String(item?.rule_id || item?.blocker_id || "unknown"),
        }));
        if (item?.notes) {
          row.appendChild(Object.assign(document.createElement("span"), {
            className: "inspector-mini-label",
            textContent: String(item.notes),
          }));
        }
        return row;
      }
    ));

    section.appendChild(topologyWrapper);
    section.appendChild(ruleWrapper);
    return section;
  };

  const renderScenarioAuditTopologySummary = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4";

    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = t("Topology Summary", "ui");
    section.appendChild(title);

    const belarusHybrid = auditPayload?.topology_summaries?.belarus_hybrid || {};
    const rows = [
      [t("Total features", "ui"), belarusHybrid.total_feature_count],
      [t("Border rayons kept", "ui"), belarusHybrid.border_rayons_kept],
      [t("Historical composites built", "ui"), belarusHybrid.historical_composites_built],
      [t("Interior groups built", "ui"), belarusHybrid.interior_groups_built],
    ].filter(([, value]) => Number.isFinite(Number(value)));

    if (!rows.length) {
      section.appendChild(createEmptyNote(t("None", "ui")));
      return section;
    }

    const subtitle = document.createElement("div");
    subtitle.className = "inspector-mini-label mt-2";
    subtitle.textContent = t("Belarus hybrid", "ui");
    section.appendChild(subtitle);

    const list = document.createElement("div");
    list.className = "mt-2 flex flex-col gap-2";
    rows.forEach(([label, value]) => {
      list.appendChild(createAuditValueRow(label, value));
    });
    section.appendChild(list);
    return section;
  };

  const renderScenarioAuditPanel = () => {
    if (!scenarioAuditSection) return;

    const activeScenarioId = String(state.activeScenarioId || "").trim();
    const auditUi = state.scenarioAuditUi || {};
    const activeAuditLoaded =
      !!activeScenarioId &&
      auditUi.loadedForScenarioId === activeScenarioId &&
      state.scenarioAudit &&
      typeof state.scenarioAudit === "object";
    const manifestSummary =
      state.activeScenarioManifest?.summary && typeof state.activeScenarioManifest.summary === "object"
        ? state.activeScenarioManifest.summary
        : {};

    scenarioAuditSection.replaceChildren();

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Scenario Audit", "ui");

    const hint = document.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.textContent = t(
      "Inspect critical checks, blockers, and source quality for the active scenario.",
      "ui"
    );

    scenarioAuditSection.appendChild(title);
    scenarioAuditSection.appendChild(hint);

    if (!activeScenarioId) {
      scenarioAuditSection.appendChild(createEmptyNote(t("No scenario active", "ui")));
      return;
    }

    const actions = document.createElement("div");
    actions.className = "mt-3 flex flex-col gap-2";

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = activeAuditLoaded ? "btn-secondary" : "btn-primary";
    loadButton.disabled = !!auditUi.loading;
    loadButton.textContent = t(activeAuditLoaded ? "Reload Audit" : "Load Audit Details", "ui");
    loadButton.addEventListener("click", async () => {
      try {
        await loadScenarioAuditPayload(activeScenarioId, {
          forceReload: activeAuditLoaded,
        });
      } catch (error) {
        console.error("Failed to load scenario audit:", error);
      }
    });
    actions.appendChild(loadButton);

    if (!activeAuditLoaded) {
      if (auditUi.loading) {
        scenarioAuditSection.appendChild(createEmptyNote(t("Loading audit details…", "ui")));
      } else if (auditUi.errorMessage) {
        const errorNote = createEmptyNote(t("Unable to load audit details", "ui"));
        scenarioAuditSection.appendChild(errorNote);

        const detail = document.createElement("div");
        detail.className = "inspector-mini-label mt-2";
        detail.textContent = auditUi.errorMessage;
        scenarioAuditSection.appendChild(detail);
      }
      scenarioAuditSection.appendChild(actions);
      return;
    }

    if (auditUi.loading) {
      scenarioAuditSection.appendChild(createEmptyNote(t("Loading audit details…", "ui")));
    } else if (auditUi.errorMessage) {
      const errorDetail = document.createElement("div");
      errorDetail.className = "inspector-mini-label mt-3";
      errorDetail.textContent = `${t("Unable to load audit details", "ui")}: ${auditUi.errorMessage}`;
      scenarioAuditSection.appendChild(errorDetail);
    }

    scenarioAuditSection.appendChild(renderScenarioAuditSummary(state.scenarioAudit, manifestSummary));
    scenarioAuditSection.appendChild(renderScenarioCriticalChecks(state.scenarioAudit));
    scenarioAuditSection.appendChild(renderScenarioAuditBlockers(state.scenarioAudit));
    scenarioAuditSection.appendChild(renderScenarioAuditTopologySummary(state.scenarioAudit));
    scenarioAuditSection.appendChild(actions);
  };

  const ensureSelectedInspectorCountry = () => {
    const normalized = normalizeCountryCode(state.selectedInspectorCountryCode);
    const activeNormalized = normalizeCountryCode(state.activeSovereignCode);
    const fallbackCode = activeNormalized && latestCountryStatesByCode.has(activeNormalized)
      ? activeNormalized
      : "";
    const resolved = normalized && latestCountryStatesByCode.has(normalized)
      ? normalized
      : fallbackCode;

    state.selectedInspectorCountryCode = resolved;
    state.inspectorHighlightCountryCode = resolved;
    return resolved;
  };

  const selectInspectorCountry = (code) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return;
    const countryState = latestCountryStatesByCode.get(normalized);
    if (countryState?.continentId) {
      state.expandedInspectorContinents.add(`continent::${countryState.continentId}`);
    }
    if (countryState?.releasable && countryState.parentOwnerTag && state.expandedInspectorReleaseParents instanceof Set) {
      state.expandedInspectorReleaseParents.add(countryState.parentOwnerTag);
    }
    state.selectedInspectorCountryCode = normalized;
    state.inspectorHighlightCountryCode = normalized;
    if (typeof state.updatePaintModeUIFn === "function") {
      state.updatePaintModeUIFn();
    }
    if (typeof state.renderNowFn === "function") {
      state.renderNowFn();
    }
    renderList();
  };

  const getPrimaryReleasablePresetRef = (countryState, { warnOnMissing = true } = {}) => {
    const presetLookupCode = countryState?.presetLookupCode || countryState?.code;
    const presets = Array.isArray(state.presetsState?.[presetLookupCode]) ? state.presetsState[presetLookupCode] : [];
    const presetIndex = presets.findIndex((preset) => String(preset?.preset_kind || "").trim() === "releasable_core");
    if (presetIndex >= 0) {
      return {
        presetLookupCode,
        presetIndex,
        preset: presets[presetIndex],
      };
    }

    const scenarioMeta = getScenarioCountryMeta(countryState?.code) || countryState || {};
    const boundaryVariants = Array.isArray(scenarioMeta?.boundary_variants)
      ? scenarioMeta.boundary_variants
      : Array.isArray(countryState?.boundaryVariants)
        ? countryState.boundaryVariants
        : [];
    if (!boundaryVariants.length) {
      if (warnOnMissing) {
        console.warn("[scenario] Missing releasable core preset for selected country.", {
          code: countryState?.code || "",
          presetLookupCode,
        });
      }
      return null;
    }

    const selectedVariantId = String(
      scenarioMeta?.selected_boundary_variant_id
      || countryState?.selectedBoundaryVariantId
      || scenarioMeta?.default_boundary_variant_id
      || countryState?.defaultBoundaryVariantId
      || ""
    ).trim().toLowerCase();
    const selectedVariant = boundaryVariants.find(
      (variant) => String(variant?.id || "").trim().toLowerCase() === selectedVariantId
    ) || boundaryVariants[0];
    const presetSourceLookup = {
      tag: scenarioMeta?.tag || countryState?.code || "",
      release_lookup_iso2:
        scenarioMeta?.release_lookup_iso2
        || scenarioMeta?.releaseLookupIso2
        || scenarioMeta?.lookup_iso2
        || scenarioMeta?.lookupIso2
        || scenarioMeta?.base_iso2
        || scenarioMeta?.baseIso2
        || "",
      lookup_iso2:
        scenarioMeta?.lookup_iso2
        || scenarioMeta?.lookupIso2
        || scenarioMeta?.release_lookup_iso2
        || scenarioMeta?.releaseLookupIso2
        || scenarioMeta?.base_iso2
        || scenarioMeta?.baseIso2
        || "",
      base_iso2:
        scenarioMeta?.base_iso2
        || scenarioMeta?.baseIso2
        || "",
    };
    const featureIds = resolveFeatureIdsFromPresetSource(selectedVariant?.preset_source, presetSourceLookup);
    if (!featureIds.length) {
      if (warnOnMissing) {
        console.warn("[scenario] Boundary variant exists but resolved zero feature ids.", {
          code: countryState?.code || "",
          presetLookupCode,
          variantId: selectedVariant?.id || "",
        });
      }
      return null;
    }
    return {
      presetLookupCode,
      presetIndex: -1,
      preset: {
        name: t("Core Territory", "ui"),
        ids: featureIds,
        generated: true,
        locked: true,
        preset_kind: "releasable_core",
        releasable_tag: countryState?.code || "",
        boundary_variant_id: String(selectedVariant?.id || "").trim(),
      },
    };
  };

  const hasScenarioCoreTerritoryActions = (countryState) => {
    if (!countryState) return false;
    if (countryState.releasable) return true;
    if (Array.isArray(countryState?.boundaryVariants) && countryState.boundaryVariants.length > 1) {
      return true;
    }
    return !!getPrimaryReleasablePresetRef(countryState, { warnOnMissing: false });
  };

  const applyScenarioReleasableCoreTerritory = (
    countryState,
    { source = "scenario-actions", forceSovereignty = false, actionMode = "ownership" } = {}
  ) => {
    const presetRef = getPrimaryReleasablePresetRef(countryState);
    if (!presetRef) {
      console.warn("[scenario] Missing releasable core preset.", {
        source,
        code: countryState?.code || "",
      });
      return false;
    }

    if (actionMode === "ownership") {
      if (forceSovereignty && String(state.paintMode || "visual") !== "sovereignty") {
        setScenarioMapPaintMode("ownership");
      }
      state.activeSovereignCode = countryState.code;
      if (typeof state.updateActiveSovereignUIFn === "function") {
        state.updateActiveSovereignUIFn();
      }
      const requestedTargetIds = Array.isArray(presetRef.preset?.ids) ? presetRef.preset.ids : [];
      const {
        requestedIds,
        matchedIds: targetIds,
        missingIds,
      } = filterToVisibleFeatureIds(requestedTargetIds);
      if (!requestedIds.length) {
        renderList();
        return false;
      }
      if (!targetIds.length) {
        showToast(
          t("Current map does not include this preset's detail features. Load detail topology and try again.", "ui"),
          {
            title: t("Core territory was not applied.", "ui"),
            tone: "warning",
            duration: 4200,
          }
        );
        console.warn("[scenario] Core territory apply skipped because no visible feature ids matched.", {
          source,
          code: countryState?.code || "",
          requestedCount: requestedIds.length,
          missingCount: missingIds.length,
        });
        renderList();
        return false;
      }
      const unionRequestedIds = getScenarioBoundaryVariantUnionFeatureIds(countryState, targetIds);
      const { matchedIds: variantUnionIds } = filterToVisibleFeatureIds(unionRequestedIds);
      const assignmentsByFeatureId = {};
      const targetIdSet = new Set(targetIds.map((featureId) => String(featureId || "").trim()).filter(Boolean));
      variantUnionIds.forEach((featureId) => {
        const normalizedId = String(featureId || "").trim();
        if (!normalizedId) return;
        if (targetIdSet.has(normalizedId)) {
          assignmentsByFeatureId[normalizedId] = {
            ownerCode: countryState.code,
            controllerCode: countryState.code,
          };
          return;
        }
        const baselineOwnerCode = normalizeCountryCode(
          state.scenarioBaselineOwnersByFeatureId?.[normalizedId]
            || state.runtimeCanonicalCountryByFeatureId?.[normalizedId]
            || ""
        );
        const baselineControllerCode = normalizeCountryCode(
          state.scenarioBaselineControllersByFeatureId?.[normalizedId]
            || baselineOwnerCode
            || ""
        );
        if (!baselineOwnerCode || !baselineControllerCode) return;
        assignmentsByFeatureId[normalizedId] = {
          ownerCode: baselineOwnerCode,
          controllerCode: baselineControllerCode,
        };
      });
      const result = applyScenarioOwnerControllerAssignments(assignmentsByFeatureId, {
        render,
        historyKind: "scenario-core-apply-ownership",
        dirtyReason: "scenario-core-apply-ownership",
        recomputeReason: "scenario-core-apply-ownership",
      });
      if (!result?.applied) {
        if (result?.reason !== "no-visible-features") {
          showToast(t("Core territory was not applied.", "ui"), {
            title: t("Apply failed", "ui"),
            tone: "warning",
            duration: 3200,
          });
        }
        renderList();
        return false;
      }
      if (result.changed > 0) {
        showToast(
          `${t("Applied", "ui")} ${result.changed}/${result.matchedCount} ${t("features", "ui")}`,
          {
            title: t("Political ownership updated", "ui"),
            tone: "success",
            duration: 3200,
          }
        );
      } else {
        showToast(t("Core territory already matches current ownership.", "ui"), {
          title: t("No changes", "ui"),
          tone: "info",
          duration: 2800,
        });
      }
      applyScenarioAutoCompanionActions(countryState);
      refreshScenarioShellOverlays({
        renderNow: false,
        borderReason: `scenario-shells:core-apply:${countryState.code}`,
      });
    } else {
      const resolvedColor = getResolvedCountryColor(latestCountryStatesByCode.get(countryState.code) || countryState);
      const result = applyPresetWithMode(presetRef.presetLookupCode, presetRef.presetIndex, {
        mode: "visual",
        color: resolvedColor,
        render,
        visualHistoryKind: "scenario-core-apply-visual",
        visualDirtyReason: "scenario-core-apply-visual",
      });
      if (!result?.applied) {
        if (result?.reason !== "no-visible-features") {
          showToast(t("Core territory was not applied.", "ui"), {
            title: t("Apply failed", "ui"),
            tone: "warning",
            duration: 3200,
          });
        }
        renderList();
        return false;
      }
      showToast(
        `${t("Applied", "ui")} ${result.matchedCount}/${result.requestedCount} ${t("features", "ui")}`,
        {
          title: t("Visual color applied", "ui"),
          tone: "success",
          duration: 3200,
        }
      );
    }

    renderList();
    return true;
  };

  const applyScenarioCompanionAction = (
    countryState,
    action,
    { silent = false, suppressRenderList = false, recomputeShells = true } = {}
  ) => {
    if (!countryState || !action) return false;
    const targetOwnerCode = normalizeCountryCode(action.target_owner_tag);
    if (!targetOwnerCode) {
      if (!silent) {
        showToast(t("Historical transfer target is missing.", "ui"), {
          title: t("Transfer not applied", "ui"),
          tone: "warning",
          duration: 3200,
        });
      }
      return false;
    }
    const featureIds = resolveCompanionActionFeatureIds(action, getScenarioCountryMeta(countryState.code) || countryState);
    const result = applyExplicitOwnershipTransfer(featureIds, targetOwnerCode, {
      render,
      historyKind: `scenario-companion-transfer:${countryState.code}:${action.id || "action"}`,
      dirtyReason: "scenario-companion-transfer",
      recomputeReason: "sidebar-companion-transfer",
    });
    if (!result?.applied) {
      if (!silent && result?.reason !== "no-visible-features") {
        showToast(t("Historical transfer was not applied.", "ui"), {
          title: t("Transfer not applied", "ui"),
          tone: "warning",
          duration: 3200,
        });
      }
      if (!suppressRenderList) {
        renderList();
      }
      return false;
    }
    if (!silent && result.changed > 0) {
      showToast(
        `${t("Applied", "ui")} ${result.changed}/${result.matchedCount} ${t("features", "ui")}`,
        {
          title: action.label || t("Historical transfer applied", "ui"),
          tone: "success",
          duration: 3200,
        }
      );
    } else if (!silent) {
      showToast(t("Historical transfer already matches current ownership.", "ui"), {
        title: t("No changes", "ui"),
        tone: "info",
        duration: 2800,
      });
    }
    if (recomputeShells) {
      refreshScenarioShellOverlays({
        renderNow: false,
        borderReason: `scenario-shells:companion-action:${countryState.code}:${action.id || "action"}`,
      });
    }
    if (!suppressRenderList) {
      renderList();
    }
    return true;
  };

  const applyScenarioAutoCompanionActions = (countryState) => {
    const actions = Array.isArray(countryState?.companionActions) ? countryState.companionActions : [];
    let appliedAny = false;
    actions.forEach((action) => {
      if (!action?.auto_apply_on_core_territory) return;
      const applied = applyScenarioCompanionAction(countryState, action, {
        silent: true,
        suppressRenderList: true,
        recomputeShells: false,
      });
      appliedAny = applied || appliedAny;
    });
    return appliedAny;
  };

  const applyReleasableBoundaryVariantSelection = (countryState, variant) => {
    if (!countryState?.code || !variant?.id) return false;
    const result = setReleasableBoundaryVariant(countryState.code, variant.id);
    if (!result) {
      showToast(t("Boundary variant could not be selected.", "ui"), {
        title: t("Variant not applied", "ui"),
        tone: "warning",
        duration: 3200,
      });
      return false;
    }

    const refreshedCountryState = latestCountryStatesByCode.get(countryState.code) || countryState;
    applyScenarioReleasableCoreTerritory(refreshedCountryState, {
      source: "scenario-boundary-variant",
      actionMode: "ownership",
    });
    return true;
  };

  const getCountrySearchRank = (countryState, term, upperTerm) => {
    const code = String(countryState.code || "").toUpperCase();
    const name = String(countryState.name || "").toLowerCase();
    const displayName = String(countryState.displayName || "").toLowerCase();
    const subregion = String(countryState.subregionDisplayLabel || "").toLowerCase();
    const continent = String(countryState.continentDisplayLabel || "").toLowerCase();
    const countryMatch =
      code.includes(upperTerm) ||
      matchesTerm(name, term) ||
      matchesTerm(displayName, term) ||
      matchesTerm(subregion, term) ||
      matchesTerm(continent, term);

    if (!countryMatch) {
      return null;
    }
    if (code === upperTerm) return 0;
    if (displayName === term || name === term) return 1;
    if (displayName.startsWith(term) || name.startsWith(term)) return 2;
    if (code.startsWith(upperTerm)) return 3;
    if (subregion.startsWith(term) || continent.startsWith(term)) return 4;
    return 5;
  };

  const renderCountrySelectRow = (
    parent,
    countryState,
    {
      childStates = [],
      childSections = null,
      forceExpanded = false,
      hideExpandToggle = false,
      showRelationMeta = false,
    } = {}
  ) => {
    const normalizedChildSections = Array.isArray(childSections)
      ? childSections
      : (Array.isArray(childStates) && childStates.length
        ? [{ id: "children", label: "", states: childStates }]
        : []);
    const childCount = normalizedChildSections.reduce(
      (sum, section) => sum + (Array.isArray(section?.states) ? section.states.length : 0),
      0
    );
    const hasChildren = childCount > 0;
    const isActiveOwner = state.activeSovereignCode === countryState.code;
    const hasReleasableActivateAction = !!(
      state.activeScenarioId &&
      countryState.releasable &&
      getPrimaryReleasablePresetRef(countryState)
    );
    const isExpanded = hasChildren && (
      forceExpanded ||
      state.expandedInspectorReleaseParents.has(countryState.code)
    );

    const row = document.createElement("div");
    row.className = "country-select-row";
    row.dataset.countryCode = countryState.code;
    const isSelected = state.selectedInspectorCountryCode === countryState.code;
    row.classList.toggle("is-selected", isSelected);
    row.classList.toggle("is-active-owner", isActiveOwner);

    const main = document.createElement("button");
    main.type = "button";
    main.className = "country-select-main country-select-main-btn";
    main.setAttribute("aria-pressed", String(isSelected));
    main.addEventListener("click", () => {
      selectInspectorCountry(countryState.code);
    });

    const title = document.createElement("div");
    title.className = "country-select-title";
    title.textContent = `${countryState.displayName} (${countryState.code})`;

    const meta = document.createElement("div");
    meta.className = "country-select-meta";
    meta.textContent = buildCountryRowMetaText(countryState, { showRelationMeta });

    const side = document.createElement("div");
    side.className = "country-select-side";

    if (hasChildren && !hideExpandToggle) {
      const countBadge = document.createElement("span");
      countBadge.className = "country-children-count";
      countBadge.textContent = String(childCount);
      side.appendChild(countBadge);
    }

    const swatch = document.createElement("span");
    swatch.className = "country-select-swatch";
    swatch.style.backgroundColor = getResolvedCountryColor(countryState);

    main.appendChild(title);
    main.appendChild(meta);
    row.appendChild(main);

    if (hasChildren && !hideExpandToggle) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "country-action-btn";
      toggleBtn.textContent = isExpanded ? "v" : ">";
      toggleBtn.setAttribute("aria-label", `${childCount} ${t("Related Countries", "ui")}`);
      toggleBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.expandedInspectorReleaseParents.has(countryState.code)) {
          state.expandedInspectorReleaseParents.delete(countryState.code);
        } else {
          state.expandedInspectorReleaseParents.add(countryState.code);
        }
        renderList();
      });
      side.appendChild(toggleBtn);
    }

    side.appendChild(swatch);
    row.appendChild(side);

    if (!hasChildren && !hasReleasableActivateAction) {
      registerCountryRowRef(countryState.code, {
        row,
        wrapper: null,
        main,
        swatch,
        title,
        meta,
        showRelationMeta,
      });
      parent.appendChild(row);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "country-explorer-group country-select-card";
    wrapper.dataset.countryCode = countryState.code;
    if (hasReleasableActivateAction) {
      wrapper.classList.add("has-subaction");
    }
    wrapper.classList.toggle("is-active-owner", isActiveOwner);
    wrapper.classList.toggle("is-selected", isSelected);
    wrapper.appendChild(row);

    if (hasReleasableActivateAction) {
      const activateStrip = document.createElement("button");
      activateStrip.type = "button";
      activateStrip.className = "country-select-subaction";
      activateStrip.textContent = t("Activate Releasable", "ui");
      activateStrip.title = t("Apply this releasable's political ownership and make it active.", "ui");
      activateStrip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyScenarioReleasableCoreTerritory(countryState, {
          source: "scenario-row-activate",
          forceSovereignty: true,
        });
      });
      wrapper.appendChild(activateStrip);
    }

    if (isExpanded) {
      const childList = document.createElement("div");
      childList.className = "country-children";
      normalizedChildSections.forEach((section) => {
        if (section?.label) {
          const sectionLabel = document.createElement("div");
          sectionLabel.className = "inspector-mini-label";
          sectionLabel.textContent = section.label;
          childList.appendChild(sectionLabel);
        }
        (Array.isArray(section?.states) ? section.states : []).forEach((childState) => {
          renderCountrySelectRow(childList, childState, {
            showRelationMeta: true,
          });
        });
      });
      wrapper.appendChild(childList);
    }
    registerCountryRowRef(countryState.code, {
      row,
      wrapper,
      main,
      swatch,
      title,
      meta,
      showRelationMeta,
    });
    parent.appendChild(wrapper);
  };

  const buildInspectorSearchGroups = (countryStates, term, priorityOrderMap) => {
    const upperTerm = String(term || "").trim().toUpperCase();
    const groupsByParentCode = new Map();

    const ensureSearchGroup = (parentState) => {
      const parentCode = normalizeCountryCode(parentState?.code);
      if (!parentCode) return null;
      if (!groupsByParentCode.has(parentCode)) {
        groupsByParentCode.set(parentCode, {
          parentState,
          parentMatched: false,
          parentSearchRank: null,
          matchedChildCodes: new Set(),
          bestRank: Number.MAX_SAFE_INTEGER,
        });
      }
      return groupsByParentCode.get(parentCode);
    };

    countryStates.forEach((countryState) => {
      const searchRank = getCountrySearchRank(countryState, term, upperTerm);
      if (searchRank === null) return;

      if (!countryState.releasable) {
        const group = ensureSearchGroup(countryState);
        if (!group) return;
        group.parentMatched = true;
        group.parentSearchRank = searchRank;
        group.bestRank = Math.min(group.bestRank, searchRank);
        return;
      }

      const parentState = (countryState.releasable || countryState.scenarioSubject) && countryState.parentOwnerTag
        ? latestCountryStatesByCode.get(countryState.parentOwnerTag)
        : null;
      if (!parentState) {
        const fallbackGroup = ensureSearchGroup(countryState);
        if (!fallbackGroup) return;
        fallbackGroup.parentMatched = true;
        fallbackGroup.parentSearchRank = searchRank;
        fallbackGroup.bestRank = Math.min(fallbackGroup.bestRank, searchRank);
        return;
      }

      const group = ensureSearchGroup(parentState);
      if (!group) return;
      group.matchedChildCodes.add(countryState.code);
      group.bestRank = Math.min(group.bestRank, searchRank);
    });

    return Array.from(groupsByParentCode.values())
      .map((group) => ({
        parentState: group.parentState,
        parentMatched: group.parentMatched,
        parentSearchRank: group.parentSearchRank,
        childSections: group.parentState?.releasable
          ? []
          : getCountryChildSectionsForParent(group.parentState.code, {
            matchedChildCodes: group.matchedChildCodes,
          }),
        bestRank: Number.isFinite(group.bestRank) ? group.bestRank : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => {
        if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
        return compareInspectorCountries(a.parentState, b.parentState, priorityOrderMap);
      });
  };

  const renderCountryInspectorDetail = () => {
    if (!countryInspectorEmpty || !countryInspectorSelected) return;
    incrementSidebarCounter("inspectorRenders");

    updateScenarioInspectorLayout();

    const selectedCode = ensureSelectedInspectorCountry();
    const countryState = selectedCode ? latestCountryStatesByCode.get(selectedCode) : null;
    const isEmpty = !countryState;

    countryInspectorEmpty.classList.toggle("hidden", !isEmpty);
    countryInspectorSelected.classList.toggle("hidden", isEmpty);

    if (!countryState) {
      if (countryInspectorSetActive) {
        countryInspectorSetActive.disabled = true;
        countryInspectorSetActive.classList.remove("is-active");
        countryInspectorSetActive.classList.remove("hidden");
        countryInspectorSetActive.textContent = t("Use as Active Owner", "ui");
        countryInspectorSetActive.setAttribute("aria-pressed", "false");
      }
      if (countryInspectorDetailHint) {
        countryInspectorDetailHint.classList.add("hidden");
        countryInspectorDetailHint.textContent = "";
      }
      if (countryInspectorColorRow) {
        countryInspectorColorRow.classList.add("hidden");
      }
      if (countryInspectorColorInput) {
        countryInspectorColorInput.disabled = true;
        countryInspectorColorInput.style.removeProperty("left");
        countryInspectorColorInput.style.removeProperty("top");
      }
      countryInspectorColorPickerOpen = false;
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const isScenarioReleasable = !!state.activeScenarioId && !!countryState.releasable;
    if (countryInspectorSetActive) {
      const isActive = state.activeSovereignCode === countryState.code;
      countryInspectorSetActive.disabled = false;
      countryInspectorSetActive.classList.toggle("hidden", isScenarioReleasable);
      countryInspectorSetActive.classList.toggle("is-active", !isScenarioReleasable && isActive);
      countryInspectorSetActive.textContent = isActive
        ? t("Stop Using as Active Owner", "ui")
        : t("Use as Active Owner", "ui");
      countryInspectorSetActive.setAttribute("aria-pressed", String(!isScenarioReleasable && isActive));
    }
    if (countryInspectorDetailHint) {
      if (isScenarioReleasable) {
        countryInspectorDetailHint.classList.remove("hidden");
        countryInspectorDetailHint.textContent = t(
          "Use Activate Releasable or Reapply Core Territory in Scenario Actions.",
          "ui"
        );
      } else {
        countryInspectorDetailHint.classList.add("hidden");
        countryInspectorDetailHint.textContent = "";
      }
    }

    if (countryInspectorColorRow) {
      const resolvedColor = getDisplayCountryColor(countryState);
      countryInspectorColorRow.classList.remove("hidden");
      if (countryInspectorColorLabel) {
        countryInspectorColorLabel.textContent = t("Country Color", "ui");
      }
      if (countryInspectorColorSwatch) {
        countryInspectorColorSwatch.style.backgroundColor = resolvedColor;
        countryInspectorColorSwatch.title = `${t("Edit country color", "ui")}: ${countryState.displayName} (${resolvedColor.toUpperCase()})`;
        countryInspectorColorSwatch.setAttribute(
          "aria-label",
          `${t("Edit country color", "ui")}: ${countryState.displayName} (${resolvedColor.toUpperCase()})`
        );
      }
      if (countryInspectorColorValue) {
        countryInspectorColorValue.textContent = resolvedColor.toUpperCase();
      }
      if (countryInspectorColorInput) {
        countryInspectorColorInput.disabled = false;
        countryInspectorColorInput.value = resolvedColor;
        positionCountryInspectorColorAnchor();
      }
    }
    scheduleAdaptiveInspectorHeights();
  };

  const getWaterSearchTerm = () => (waterSearchInput?.value || "").trim().toLowerCase();

  const getWaterFeatureDisplayName = (feature) => {
    const rawName =
      feature?.properties?.label ||
      feature?.properties?.name ||
      feature?.properties?.name_en ||
      feature?.properties?.NAME ||
      feature?.id ||
      "Water Region";
    return t(rawName, "geo") || String(rawName || "").trim() || "Water Region";
  };

  const getWaterFeatureMeta = (feature) => {
    const waterType = String(feature?.properties?.water_type || "water_region")
      .replace(/_/g, " ")
      .trim();
    const regionGroup = String(feature?.properties?.region_group || "").replace(/_/g, " ").trim();
    return [waterType, regionGroup].filter(Boolean).join(" · ");
  };

  const isOpenOceanWaterFeature = (feature) =>
    String(feature?.properties?.water_type || "").trim().toLowerCase() === "ocean";

  const isWaterFeatureVisibleInInspector = (feature) => {
    if (!feature) return false;
    if (isOpenOceanWaterFeature(feature)) {
      return !!state.showOpenOceanRegions;
    }
    return feature?.properties?.interactive !== false;
  };

  const getWaterFeatureColor = (featureId) => {
    const resolvedId = String(featureId || "").trim();
    return ColorManager.normalizeHexColor(mapRenderer.getWaterRegionColor(resolvedId)) || "#aadaff";
  };

  const ensureSelectedWaterRegion = () => {
    const current = String(state.selectedWaterRegionId || "").trim();
    if (current && state.waterRegionsById?.has(current)) {
      const feature = state.waterRegionsById.get(current);
      if (isWaterFeatureVisibleInInspector(feature)) {
        return current;
      }
    }
    state.selectedWaterRegionId = "";
    return "";
  };

  const getVisibleWaterFeatures = () =>
    Array.from(state.waterRegionsById?.values() || [])
      .filter((feature) => isWaterFeatureVisibleInInspector(feature))
      .sort((a, b) => getWaterFeatureDisplayName(a).localeCompare(getWaterFeatureDisplayName(b)));

  const renderWaterInteractionUi = () => {
    if (waterInspectorOpenOceanToggle) {
      waterInspectorOpenOceanToggle.checked = !!state.showOpenOceanRegions;
    }
    if (waterInspectorOpenOceanHint) {
      waterInspectorOpenOceanHint.textContent = state.showOpenOceanRegions
        ? t("Macro ocean regions are currently included in hover, click, and paint.", "ui")
        : t("When off, macro ocean regions are ignored for hover, click, and paint.", "ui");
    }
  };

  const renderWaterLegend = () => {
    if (!waterLegendList) return;
    waterLegendList.replaceChildren();
    const overrideEntries = Object.entries(state.waterRegionOverrides || {})
      .map(([featureId, color]) => {
        const feature = state.waterRegionsById?.get(featureId);
        if (!feature || !isWaterFeatureVisibleInInspector(feature)) return null;
        return {
          featureId,
          feature,
          color: ColorManager.normalizeHexColor(color) || getWaterFeatureColor(featureId),
        };
      })
      .filter(Boolean)
      .sort((a, b) => getWaterFeatureDisplayName(a.feature).localeCompare(getWaterFeatureDisplayName(b.feature)));

    if (!overrideEntries.length) {
      waterLegendList.appendChild(createEmptyNote(t("Paint water regions to create an override list.", "ui")));
      return;
    }

    overrideEntries.forEach(({ featureId, feature, color }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "scenario-action-card";
      row.addEventListener("click", () => {
        state.selectedWaterRegionId = featureId;
        if (typeof state.renderWaterRegionListFn === "function") {
          state.renderWaterRegionListFn();
        }
      });

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = getWaterFeatureDisplayName(feature);

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      meta.textContent = color.toUpperCase();

      copy.appendChild(title);
      copy.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "country-row-actions";

      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = color;
      actions.appendChild(swatch);

      row.appendChild(copy);
      row.appendChild(actions);
      waterLegendList.appendChild(row);
    });
  };

  const renderWaterInspectorDetail = () => {
    if (!waterInspectorEmpty || !waterInspectorSelected) return;
    const selectedId = ensureSelectedWaterRegion();
    const feature = selectedId ? state.waterRegionsById?.get(selectedId) : null;
    const isEmpty = !feature;

    waterInspectorEmpty.classList.toggle("hidden", !isEmpty);
    waterInspectorSelected.classList.toggle("hidden", isEmpty);

    if (!feature) {
      if (waterInspectorColorRow) {
        waterInspectorColorRow.classList.add("hidden");
      }
      if (waterInspectorDetailHint) {
        waterInspectorDetailHint.classList.add("hidden");
        waterInspectorDetailHint.textContent = "";
      }
      if (waterInspectorColorInput) {
        waterInspectorColorInput.disabled = true;
      }
      waterInspectorColorPickerOpen = false;
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const featureColor = getWaterFeatureColor(selectedId);
    if (waterInspectorDetailHint) {
      const meta = getWaterFeatureMeta(feature);
      waterInspectorDetailHint.classList.toggle("hidden", !meta);
      waterInspectorDetailHint.textContent = meta;
    }
    if (waterInspectorColorRow) {
      waterInspectorColorRow.classList.remove("hidden");
    }
    if (waterInspectorColorLabel) {
      waterInspectorColorLabel.textContent = t("Water Color", "ui");
    }
    if (waterInspectorColorSwatch) {
      waterInspectorColorSwatch.style.backgroundColor = featureColor;
      waterInspectorColorSwatch.title = `${t("Edit water region color", "ui")}: ${getWaterFeatureDisplayName(feature)} (${featureColor.toUpperCase()})`;
    }
    if (waterInspectorColorValue) {
      waterInspectorColorValue.textContent = featureColor.toUpperCase();
    }
    if (waterInspectorColorInput) {
      waterInspectorColorInput.disabled = false;
      waterInspectorColorInput.value = featureColor;
    }
    scheduleAdaptiveInspectorHeights();
  };

  const renderWaterRegionList = () => {
    if (!waterRegionList) return;
    const term = getWaterSearchTerm();
    const features = getVisibleWaterFeatures();

    waterRowRefsById.clear();
    waterRegionList.replaceChildren();

    const filteredFeatures = term
      ? features.filter((feature) => {
        const name = getWaterFeatureDisplayName(feature).toLowerCase();
        const rawId = String(feature?.properties?.id || feature?.id || "").toLowerCase();
        const meta = getWaterFeatureMeta(feature).toLowerCase();
        return name.includes(term) || rawId.includes(term) || meta.includes(term);
      })
      : features;

    if (!filteredFeatures.length) {
      waterRegionList.appendChild(createEmptyNote(t("No matching water regions", "ui")));
      renderWaterInspectorDetail();
      renderWaterLegend();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    filteredFeatures.forEach((feature) => {
      const featureId = String(feature?.properties?.id || feature?.id || "").trim();
      if (!featureId) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inspector-item-btn";
      button.classList.toggle("is-active", featureId === state.selectedWaterRegionId);
      button.addEventListener("click", () => {
        state.selectedWaterRegionId = featureId;
        renderWaterRegionList();
      });

      const name = document.createElement("div");
      name.className = "country-row-title";
      name.textContent = getWaterFeatureDisplayName(feature);

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      meta.textContent = getWaterFeatureMeta(feature);

      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = getWaterFeatureColor(featureId);

      const actions = document.createElement("div");
      actions.className = "country-row-actions";
      actions.appendChild(swatch);

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";
      copy.appendChild(name);
      copy.appendChild(meta);

      button.appendChild(copy);
      button.appendChild(actions);
      waterRegionList.appendChild(button);
      waterRowRefsById.set(featureId, button);
    });

    renderWaterInspectorDetail();
    renderWaterLegend();
    scheduleAdaptiveInspectorHeights();
  };

  const getSpecialFeatureDisplayName = (feature) => {
    const rawName =
      feature?.properties?.label ||
      feature?.properties?.name ||
      feature?.properties?.name_en ||
      feature?.properties?.NAME ||
      feature?.id ||
      "Special Region";
    return t(rawName, "geo") || String(rawName || "").trim() || "Special Region";
  };

  const getSpecialFeatureMeta = (feature) => {
    const specialType = String(feature?.properties?.special_type || "special_region")
      .replace(/_/g, " ")
      .trim();
    const regionGroup = String(feature?.properties?.region_group || "").replace(/_/g, " ").trim();
    return [specialType, regionGroup].filter(Boolean).join(" · ");
  };

  const getSpecialFeatureFallbackColor = (feature) => {
    const specialType = String(feature?.properties?.special_type || "").trim().toLowerCase();
    if (specialType === "salt_flat") return "#d7c6a3";
    if (specialType === "wasteland") return "#bf8f74";
    return "#d6c19a";
  };

  const isSpecialFeatureVisibleInInspector = (feature) =>
    !!feature && !!state.activeScenarioId && !!state.showScenarioSpecialRegions && feature?.properties?.interactive !== false;

  const getSpecialFeatureColor = (featureId, feature = null) => {
    const resolvedId = String(featureId || "").trim();
    return (
      ColorManager.normalizeHexColor(state.specialRegionOverrides?.[resolvedId]) ||
      getSpecialFeatureFallbackColor(feature || state.specialRegionsById?.get(resolvedId))
    );
  };

  const ensureSelectedSpecialRegion = () => {
    const current = String(state.selectedSpecialRegionId || "").trim();
    if (current && state.specialRegionsById?.has(current)) {
      const feature = state.specialRegionsById.get(current);
      if (isSpecialFeatureVisibleInInspector(feature)) {
        return current;
      }
    }
    state.selectedSpecialRegionId = "";
    return "";
  };

  const getVisibleSpecialFeatures = () =>
    Array.from(state.specialRegionsById?.values() || [])
      .filter((feature) => isSpecialFeatureVisibleInInspector(feature))
      .sort((a, b) => getSpecialFeatureDisplayName(a).localeCompare(getSpecialFeatureDisplayName(b)));

  const renderSpecialRegionInspectorUi = () => {
    const hasScenarioSpecialRegions = !!state.activeScenarioId && (state.specialRegionsById?.size || 0) > 0;
    const hasScenarioReliefOverlays =
      !!state.activeScenarioId &&
      (Array.isArray(state.scenarioReliefOverlaysData?.features) ? state.scenarioReliefOverlaysData.features.length : 0) > 0;
    const hasScenarioInspectorContent = hasScenarioSpecialRegions || hasScenarioReliefOverlays;
    if (specialRegionInspectorSection) {
      specialRegionInspectorSection.classList.toggle("hidden", !hasScenarioInspectorContent);
      if (hasScenarioInspectorContent) {
        specialRegionInspectorSection.open = true;
      }
    }
    if (scenarioSpecialRegionVisibilityToggle) {
      scenarioSpecialRegionVisibilityToggle.checked = !!state.showScenarioSpecialRegions;
    }
    if (scenarioSpecialRegionVisibilityHint) {
      scenarioSpecialRegionVisibilityHint.textContent = state.showScenarioSpecialRegions
        ? t("Scenario special regions are currently visible and interactive.", "ui")
        : t("When off, scenario special regions are hidden and ignore hover, click, and paint.", "ui");
    }
    if (scenarioReliefOverlayVisibilityToggle) {
      scenarioReliefOverlayVisibilityToggle.checked = !!state.showScenarioReliefOverlays;
    }
    if (scenarioReliefOverlayVisibilityHint) {
      scenarioReliefOverlayVisibilityHint.textContent = state.showScenarioReliefOverlays
        ? t(
          "Scenario relief overlays are currently visible. During pan and zoom they redraw only after the view settles.",
          "ui"
        )
        : t("When off, shoreline, basin contour, and texture overlays are hidden for the active scenario.", "ui");
    }
  };

  const renderSpecialRegionLegend = () => {
    if (!specialRegionLegendList) return;
    specialRegionLegendList.replaceChildren();
    const overrideEntries = Object.entries(state.specialRegionOverrides || {})
      .map(([featureId, color]) => {
        const feature = state.specialRegionsById?.get(featureId);
        if (!feature || !isSpecialFeatureVisibleInInspector(feature)) return null;
        return {
          featureId,
          feature,
          color: ColorManager.normalizeHexColor(color) || getSpecialFeatureColor(featureId, feature),
        };
      })
      .filter(Boolean)
      .sort((a, b) => getSpecialFeatureDisplayName(a.feature).localeCompare(getSpecialFeatureDisplayName(b.feature)));

    if (!overrideEntries.length) {
      specialRegionLegendList.appendChild(
        createEmptyNote(t("Paint special regions to create an override list.", "ui"))
      );
      return;
    }

    overrideEntries.forEach(({ featureId, feature, color }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "scenario-action-card";
      row.addEventListener("click", () => {
        state.selectedSpecialRegionId = featureId;
        renderSpecialRegionList();
      });

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = getSpecialFeatureDisplayName(feature);

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      meta.textContent = color.toUpperCase();

      copy.appendChild(title);
      copy.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "country-row-actions";

      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = color;
      actions.appendChild(swatch);

      row.appendChild(copy);
      row.appendChild(actions);
      specialRegionLegendList.appendChild(row);
    });
  };

  const renderSpecialRegionInspectorDetail = () => {
    if (!specialRegionInspectorEmpty || !specialRegionInspectorSelected) return;
    const selectedId = ensureSelectedSpecialRegion();
    const feature = selectedId ? state.specialRegionsById?.get(selectedId) : null;
    const isEmpty = !feature;

    specialRegionInspectorEmpty.classList.toggle("hidden", !isEmpty);
    specialRegionInspectorSelected.classList.toggle("hidden", isEmpty);

    if (!feature) {
      if (specialRegionColorRow) specialRegionColorRow.classList.add("hidden");
      if (specialRegionInspectorDetailHint) {
        specialRegionInspectorDetailHint.classList.add("hidden");
        specialRegionInspectorDetailHint.textContent = "";
      }
      if (specialRegionColorInput) {
        specialRegionColorInput.disabled = true;
      }
      specialRegionColorPickerOpen = false;
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const featureColor = getSpecialFeatureColor(selectedId, feature);
    if (specialRegionInspectorDetailHint) {
      const meta = getSpecialFeatureMeta(feature);
      specialRegionInspectorDetailHint.classList.toggle("hidden", !meta);
      specialRegionInspectorDetailHint.textContent = meta;
    }
    if (specialRegionColorRow) {
      specialRegionColorRow.classList.remove("hidden");
    }
    if (specialRegionColorLabel) {
      specialRegionColorLabel.textContent = t("Special Region Color", "ui");
    }
    if (specialRegionColorSwatch) {
      specialRegionColorSwatch.style.backgroundColor = featureColor;
      specialRegionColorSwatch.title =
        `${t("Edit special region color", "ui")}: ${getSpecialFeatureDisplayName(feature)} (${featureColor.toUpperCase()})`;
    }
    if (specialRegionColorValue) {
      specialRegionColorValue.textContent = featureColor.toUpperCase();
    }
    if (specialRegionColorInput) {
      specialRegionColorInput.disabled = false;
      specialRegionColorInput.value = featureColor;
    }
    scheduleAdaptiveInspectorHeights();
  };

  const renderSpecialRegionList = () => {
    if (!specialRegionList) return;
    renderSpecialRegionInspectorUi();
    specialRegionRowRefsById.clear();
    specialRegionList.replaceChildren();

    const term = (specialRegionSearchInput?.value || "").trim().toLowerCase();
    const features = getVisibleSpecialFeatures();

    if (!features.length) {
      specialRegionList.appendChild(createEmptyNote(t("No special regions available", "ui")));
      renderSpecialRegionInspectorDetail();
      renderSpecialRegionLegend();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const filteredFeatures = term
      ? features.filter((feature) => {
        const name = getSpecialFeatureDisplayName(feature).toLowerCase();
        const rawId = String(feature?.properties?.id || feature?.id || "").toLowerCase();
        const meta = getSpecialFeatureMeta(feature).toLowerCase();
        return name.includes(term) || rawId.includes(term) || meta.includes(term);
      })
      : features;

    if (!filteredFeatures.length) {
      specialRegionList.appendChild(createEmptyNote(t("No matching special regions", "ui")));
      renderSpecialRegionInspectorDetail();
      renderSpecialRegionLegend();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    filteredFeatures.forEach((feature) => {
      const featureId = String(feature?.properties?.id || feature?.id || "").trim();
      if (!featureId) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inspector-item-btn";
      button.classList.toggle("is-active", featureId === state.selectedSpecialRegionId);
      button.addEventListener("click", () => {
        state.selectedSpecialRegionId = featureId;
        renderSpecialRegionList();
      });

      const name = document.createElement("div");
      name.className = "country-row-title";
      name.textContent = getSpecialFeatureDisplayName(feature);

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      meta.textContent = getSpecialFeatureMeta(feature);

      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = getSpecialFeatureColor(featureId, feature);

      const actions = document.createElement("div");
      actions.className = "country-row-actions";
      actions.appendChild(swatch);

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";
      copy.appendChild(name);
      copy.appendChild(meta);

      button.appendChild(copy);
      button.appendChild(actions);
      specialRegionList.appendChild(button);
      specialRegionRowRefsById.set(featureId, button);
    });

    renderSpecialRegionInspectorDetail();
    renderSpecialRegionLegend();
    scheduleAdaptiveInspectorHeights();
  };

  const renderCountrySearchResults = (countryStates, term, priorityOrderMap) => {
    const searchGroups = buildInspectorSearchGroups(countryStates, term, priorityOrderMap);
    if (!searchGroups.length) {
      list.appendChild(createEmptyNote(t("No matching countries", "ui")));
      return;
    }

    searchGroups.forEach((group) => {
      renderCountrySelectRow(list, group.parentState, {
        childSections: group.childSections,
        forceExpanded: group.childSections.some((section) => Array.isArray(section?.states) && section.states.length > 0),
        hideExpandToggle: group.childSections.some((section) => Array.isArray(section?.states) && section.states.length > 0),
        showRelationMeta: !!group.parentState?.releasable,
      });
    });
  };

  const renderGroupedCountryExplorer = (countryStates) => {
    const hasCountryGrouping =
      Array.isArray(state.countryGroupsData?.continents) &&
      state.countryGroupsData.continents.length > 0;

    if (!hasCountryGrouping) {
      countryStates.forEach((countryState) => {
        renderCountrySelectRow(list, countryState, {
          childSections: getCountryChildSectionsForParent(countryState.code),
        });
      });
      return;
    }

    const groupedEntries = buildCountryColorTree(countryStates);
    ensureInitialInspectorExpansion(groupedEntries);
    const fragment = document.createDocumentFragment();

    groupedEntries.forEach((continent) => {
      const countries = continent.countries
        .map((entry) => latestCountryStatesByCode.get(entry.code))
        .filter(Boolean);

      if (!countries.length) return;

      const continentKey = `continent::${continent.id}`;
      const isOpen = state.expandedInspectorContinents.has(continentKey);

      const group = document.createElement("div");
      group.className = "country-explorer-group";

      const header = document.createElement("button");
      header.type = "button";
      header.className = "inspector-accordion-btn country-explorer-header";
      header.setAttribute("aria-expanded", String(isOpen));
      header.addEventListener("click", () => {
        if (state.expandedInspectorContinents.has(continentKey)) {
          state.expandedInspectorContinents.delete(continentKey);
        } else {
          state.expandedInspectorContinents.add(continentKey);
        }
        renderList();
      });

      const heading = document.createElement("div");
      heading.className = "country-explorer-heading";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = `${continent.displayLabel} (${countries.length})`;

      const chevron = document.createElement("span");
      chevron.className = "inspector-mini-label";
      chevron.textContent = isOpen ? "v" : ">";

      heading.appendChild(title);
      header.appendChild(heading);
      header.appendChild(chevron);
      group.appendChild(header);

      if (isOpen) {
        const groupList = document.createElement("div");
        groupList.className = "country-explorer-list";
        countries.forEach((countryState) => {
          renderCountrySelectRow(groupList, countryState, {
            childSections: getCountryChildSectionsForParent(countryState.code),
          });
        });
        group.appendChild(groupList);
      }

      fragment.appendChild(group);
    });

    list.appendChild(fragment);
  };

  const renderList = () => {
    incrementSidebarCounter("fullListRenders");
    updateScenarioInspectorLayout();
    const term = getSearchTerm();
    const entries = getDynamicCountryEntries();
    const countryStates = entries.map((entry, entryIndex) => createCountryInspectorState(entry, entryIndex));
    const visibleCountryStates = countryStates.filter((countryState) => !countryState?.hiddenFromCountryList);
    const topLevelCountryStates = buildInspectorTopLevelCountryEntries(visibleCountryStates);
    const priorityOrderMap = getPriorityCountryOrderMap();
    latestCountryStatesByCode = new Map(countryStates.map((countryState) => [countryState.code, countryState]));
    countryRowRefsByCode.clear();
    ensureSelectedInspectorCountry();
    list.replaceChildren();

    if (!visibleCountryStates.length) {
      list.appendChild(createEmptyNote(t("No countries available", "ui")));
      renderCountryInspectorDetail();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    if (term) {
      renderCountrySearchResults(visibleCountryStates, term, priorityOrderMap);
    } else {
      renderGroupedCountryExplorer(topLevelCountryStates);
    }

    renderCountryInspectorDetail();
    if (typeof state.renderPresetTreeFn === "function") {
      state.renderPresetTreeFn();
    }
    scheduleAdaptiveInspectorHeights();
  };

  const refreshCountryRows = ({
    countryCodes = [],
    refreshInspector = true,
    refreshPresetTree = false,
    forceAll = false,
  } = {}) => {
    const normalizedCodes = Array.from(new Set(
      (Array.isArray(countryCodes) ? countryCodes : [])
        .map((code) => normalizeCountryCode(code))
        .filter(Boolean)
    ));
    const selectedCode = normalizeCountryCode(state.selectedInspectorCountryCode);
    const activeCode = normalizeCountryCode(state.activeSovereignCode);
    if (selectedCode) normalizedCodes.push(selectedCode);
    if (activeCode) normalizedCodes.push(activeCode);
    const targetCodes = forceAll || !normalizedCodes.length
      ? Array.from(countryRowRefsByCode.keys())
      : Array.from(new Set(normalizedCodes));

    targetCodes.forEach((countryCode) => {
      const refs = countryRowRefsByCode.get(countryCode) || [];
      const countryState = latestCountryStatesByCode.get(countryCode);
      if (!countryState || !refs.length) return;
      refs.forEach((ref) => syncCountryRowVisuals(ref, countryState));
    });

    incrementSidebarCounter("rowRefreshes", targetCodes.length || 1);
    if (refreshInspector) {
      renderCountryInspectorDetail();
    }
    if (refreshPresetTree && typeof state.renderPresetTreeFn === "function") {
      state.renderPresetTreeFn();
    }
    scheduleAdaptiveInspectorHeights();
  };

  if (countryInspectorSetActive && !countryInspectorSetActive.dataset.bound) {
    countryInspectorSetActive.addEventListener("click", () => {
      const selectedCode = ensureSelectedInspectorCountry();
      if (!selectedCode) return;
      const countryState = latestCountryStatesByCode.get(selectedCode);
      if (state.activeScenarioId && countryState?.releasable) {
        return;
      }
      const isCurrentlyActive = state.activeSovereignCode === selectedCode;
      const previousActiveCode = state.activeSovereignCode;
      state.activeSovereignCode = isCurrentlyActive ? "" : selectedCode;
      markDirty(isCurrentlyActive ? "set-inactive-sovereign" : "set-active-sovereign");
      if (typeof state.updateActiveSovereignUIFn === "function") {
        state.updateActiveSovereignUIFn();
      }
      if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
      }
      refreshCountryRows({
        countryCodes: [previousActiveCode, selectedCode],
        refreshInspector: true,
      });
      if (!isCurrentlyActive) {
        showToast(
          t("Political ownership editing now targets the selected country.", "ui"),
          {
            title: t("Active owner updated", "ui"),
            tone: "info",
            duration: 3200,
          }
        );
      }
    });
    countryInspectorSetActive.dataset.bound = "true";
  }

  if (countryInspectorColorSwatch && countryInspectorColorInput && !countryInspectorColorSwatch.dataset.bound) {
    countryInspectorColorSwatch.addEventListener("click", () => {
      positionCountryInspectorColorAnchor();
      countryInspectorColorInput.focus({ preventScroll: true });
      countryInspectorColorPickerOpen = true;
      if (typeof countryInspectorColorInput.showPicker === "function") {
        countryInspectorColorInput.showPicker();
      } else {
        countryInspectorColorInput.click();
      }
    });
    countryInspectorColorSwatch.dataset.bound = "true";
  }

  if (countryInspectorColorInput && !countryInspectorColorInput.dataset.bound) {
    countryInspectorColorInput.addEventListener("change", (event) => {
      const selectedCode = ensureSelectedInspectorCountry();
      if (!selectedCode) return;
      const countryState = latestCountryStatesByCode.get(selectedCode);
      if (!countryState) return;
      const nextColor = ColorManager.normalizeHexColor(event.target.value);
      const currentColor = getDisplayCountryColor(countryState);
      if (!nextColor || nextColor === currentColor) {
        closeCountryInspectorColorPicker();
        renderCountryInspectorDetail();
        return;
      }
      applyCountryColor(selectedCode, nextColor);
      closeCountryInspectorColorPicker();
      markDirty("inspector-country-color");
      renderList();
    });
    countryInspectorColorInput.addEventListener("blur", () => {
      countryInspectorColorPickerOpen = false;
    });
    countryInspectorColorInput.dataset.bound = "true";
  }

  state.renderCountryListFn = renderList;
  state.renderWaterRegionListFn = renderWaterRegionList;
  state.updateWaterInteractionUIFn = renderWaterInteractionUi;
  state.renderSpecialRegionListFn = renderSpecialRegionList;
  state.updateScenarioSpecialRegionUIFn = renderSpecialRegionInspectorUi;
  state.updateScenarioReliefOverlayUIFn = renderSpecialRegionInspectorUi;

  if (waterInspectorOpenOceanToggle && !waterInspectorOpenOceanToggle.dataset.bound) {
    waterInspectorOpenOceanToggle.addEventListener("change", (event) => {
      state.showOpenOceanRegions = !!event.target.checked;
      if (!state.showOpenOceanRegions) {
        state.hoveredWaterRegionId = null;
      }
      markDirty("toggle-open-ocean-regions");
      renderWaterInteractionUi();
      renderWaterRegionList();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      if (render) render();
    });
    waterInspectorOpenOceanToggle.dataset.bound = "true";
  }

  if (scenarioSpecialRegionVisibilityToggle && !scenarioSpecialRegionVisibilityToggle.dataset.bound) {
    scenarioSpecialRegionVisibilityToggle.addEventListener("change", (event) => {
      state.showScenarioSpecialRegions = !!event.target.checked;
      if (!state.showScenarioSpecialRegions) {
        state.hoveredSpecialRegionId = null;
      }
      markDirty("toggle-scenario-special-regions");
      renderSpecialRegionInspectorUi();
      renderSpecialRegionList();
      if (render) render();
    });
    scenarioSpecialRegionVisibilityToggle.dataset.bound = "true";
  }

  if (scenarioReliefOverlayVisibilityToggle && !scenarioReliefOverlayVisibilityToggle.dataset.bound) {
    scenarioReliefOverlayVisibilityToggle.addEventListener("change", (event) => {
      state.showScenarioReliefOverlays = !!event.target.checked;
      markDirty("toggle-scenario-relief-overlays");
      renderSpecialRegionInspectorUi();
      if (render) render();
    });
    scenarioReliefOverlayVisibilityToggle.dataset.bound = "true";
  }

  if (waterInspectorColorSwatch && waterInspectorColorInput && !waterInspectorColorSwatch.dataset.bound) {
    waterInspectorColorSwatch.addEventListener("click", () => {
      waterInspectorColorPickerOpen = true;
      waterInspectorColorInput.focus({ preventScroll: true });
      if (typeof waterInspectorColorInput.showPicker === "function") {
        waterInspectorColorInput.showPicker();
      } else {
        waterInspectorColorInput.click();
      }
    });
    waterInspectorColorSwatch.dataset.bound = "true";
  }

  if (waterInspectorColorInput && !waterInspectorColorInput.dataset.bound) {
    waterInspectorColorInput.addEventListener("change", (event) => {
      const selectedId = ensureSelectedWaterRegion();
      if (!selectedId) return;
      const nextColor = ColorManager.normalizeHexColor(event.target.value);
      const currentColor = getWaterFeatureColor(selectedId);
      if (!nextColor || nextColor === currentColor) {
        closeWaterInspectorColorPicker();
        renderWaterRegionList();
        return;
      }
      const historyBefore = captureHistoryState({ waterRegionIds: [selectedId] });
      state.waterRegionOverrides[selectedId] = nextColor;
      pushHistoryEntry({
        kind: "inspector-water-region-color",
        before: historyBefore,
        after: captureHistoryState({ waterRegionIds: [selectedId] }),
      });
      markDirty("inspector-water-region-color");
      if (render) render();
      closeWaterInspectorColorPicker();
      renderWaterRegionList();
    });
    waterInspectorColorInput.addEventListener("blur", () => {
      waterInspectorColorPickerOpen = false;
    });
    waterInspectorColorInput.dataset.bound = "true";
  }

  if (clearWaterRegionColorBtn && !clearWaterRegionColorBtn.dataset.bound) {
    clearWaterRegionColorBtn.addEventListener("click", () => {
      const selectedId = ensureSelectedWaterRegion();
      if (!selectedId) return;
      if (!Object.prototype.hasOwnProperty.call(state.waterRegionOverrides || {}, selectedId)) {
        return;
      }
      const historyBefore = captureHistoryState({ waterRegionIds: [selectedId] });
      delete state.waterRegionOverrides[selectedId];
      pushHistoryEntry({
        kind: "clear-water-region-color",
        before: historyBefore,
        after: captureHistoryState({ waterRegionIds: [selectedId] }),
      });
      markDirty("clear-water-region-color");
      if (render) render();
      renderWaterRegionList();
    });
    clearWaterRegionColorBtn.dataset.bound = "true";
  }

  if (specialRegionSearchInput && !specialRegionSearchInput.dataset.bound) {
    specialRegionSearchInput.addEventListener("input", () => {
      renderSpecialRegionList();
    });
    specialRegionSearchInput.dataset.bound = "true";
  }

  if (specialRegionColorSwatch && specialRegionColorInput && !specialRegionColorSwatch.dataset.bound) {
    specialRegionColorSwatch.addEventListener("click", () => {
      specialRegionColorPickerOpen = true;
      specialRegionColorInput.focus({ preventScroll: true });
      if (typeof specialRegionColorInput.showPicker === "function") {
        specialRegionColorInput.showPicker();
      } else {
        specialRegionColorInput.click();
      }
    });
    specialRegionColorSwatch.dataset.bound = "true";
  }

  if (specialRegionColorInput && !specialRegionColorInput.dataset.bound) {
    specialRegionColorInput.addEventListener("change", (event) => {
      const selectedId = ensureSelectedSpecialRegion();
      if (!selectedId) return;
      const nextColor = ColorManager.normalizeHexColor(event.target.value);
      const currentColor = getSpecialFeatureColor(selectedId);
      if (!nextColor || nextColor === currentColor) {
        closeSpecialRegionColorPicker();
        renderSpecialRegionList();
        return;
      }
      const historyBefore = captureHistoryState({ specialRegionIds: [selectedId] });
      state.specialRegionOverrides[selectedId] = nextColor;
      pushHistoryEntry({
        kind: "inspector-special-region-color",
        before: historyBefore,
        after: captureHistoryState({ specialRegionIds: [selectedId] }),
      });
      markDirty("inspector-special-region-color");
      if (render) render();
      closeSpecialRegionColorPicker();
      renderSpecialRegionList();
    });
    specialRegionColorInput.addEventListener("blur", () => {
      specialRegionColorPickerOpen = false;
    });
    specialRegionColorInput.dataset.bound = "true";
  }

  if (clearSpecialRegionColorBtn && !clearSpecialRegionColorBtn.dataset.bound) {
    clearSpecialRegionColorBtn.addEventListener("click", () => {
      const selectedId = ensureSelectedSpecialRegion();
      if (!selectedId) return;
      if (!Object.prototype.hasOwnProperty.call(state.specialRegionOverrides || {}, selectedId)) {
        return;
      }
      const historyBefore = captureHistoryState({ specialRegionIds: [selectedId] });
      delete state.specialRegionOverrides[selectedId];
      pushHistoryEntry({
        kind: "clear-special-region-color",
        before: historyBefore,
        after: captureHistoryState({ specialRegionIds: [selectedId] }),
      });
      markDirty("clear-special-region-color");
      if (render) render();
      renderSpecialRegionList();
    });
    clearSpecialRegionColorBtn.dataset.bound = "true";
  }

  const appendActionSection = (container, titleText) => {
    const section = document.createElement("div");
    section.className = "inspector-detail-section mt-3";
    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = titleText;
    const body = document.createElement("div");
    body.className = "inspector-action-list mt-2";
    section.appendChild(title);
    section.appendChild(body);
    container.appendChild(section);
    return body;
  };

  const buildPresetEntries = (presetLookupCode, predicate = null) => {
    const presets = Array.isArray(state.presetsState?.[presetLookupCode]) ? state.presetsState[presetLookupCode] : [];
    return presets
      .map((preset, presetIndex) => ({ preset, presetIndex }))
      .filter(({ preset }) => (typeof predicate === "function" ? predicate(preset) : true));
  };

  const renderPresetEntryRows = (
    container,
    presetLookupCode,
    presetEntries = [],
    emptyMessage,
    {
      onApply = null,
      disabled = false,
      disabledTitle = "",
      getDisabledInfo = null,
      requireActiveOwner = normalizeActionMode() === "ownership",
    } = {}
  ) => {
    if (!presetEntries.length) {
      container.appendChild(createEmptyNote(emptyMessage));
      return;
    }

    const disableForMissingActiveSovereign = (
      !!requireActiveOwner &&
      !normalizeCountryCode(state.activeSovereignCode)
    );

    presetEntries.forEach(({ preset, presetIndex }) => {
      const rowDisabledInfo = typeof getDisabledInfo === "function"
        ? getDisabledInfo({ preset, presetIndex, presetLookupCode })
        : null;
      const rowDisabled = !!rowDisabledInfo?.disabled;
      const rowDisabledTitle = String(rowDisabledInfo?.title || "").trim();
      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "inspector-item-btn";
      nameBtn.textContent = preset.name;
      nameBtn.disabled = disabled || rowDisabled || disableForMissingActiveSovereign;
      if (rowDisabledTitle && rowDisabled) {
        nameBtn.title = rowDisabledTitle;
      } else if (disabledTitle && (disabled || disableForMissingActiveSovereign)) {
        nameBtn.title = disabledTitle;
      } else if (disableForMissingActiveSovereign) {
        nameBtn.title = t("Choose an active owner before changing political ownership or borders.", "ui");
      }
      nameBtn.addEventListener("click", () => {
        if (typeof onApply === "function") {
          onApply({ preset, presetIndex, presetLookupCode });
          return;
        }
        applyPreset(presetLookupCode, presetIndex, state.selectedColor, render);
      });
      container.appendChild(nameBtn);
    });
  };

  const getCountryPresetDisabledInfo = (countryState, preset) => {
    if (!countryState || !preset) return null;
    const disabledNames = Array.isArray(countryState.disabledRegionalPresetNames)
      ? countryState.disabledRegionalPresetNames
      : [];
    if (!disabledNames.length) return null;
    const normalizedName = normalizePresetName(preset?.name);
    if (!normalizedName || !disabledNames.includes(normalizedName)) return null;
    return {
      disabled: true,
      title: countryState.disabledRegionalPresetReason || t("Already applied in scenario baseline", "ui"),
    };
  };

  const renderNoActiveGuard = (container) => {
    const needsGuard = state.activeScenarioId
      ? !normalizeCountryCode(state.activeSovereignCode)
      : (
        String(state.paintMode || "visual") === "sovereignty" &&
        !normalizeCountryCode(state.activeSovereignCode)
      );
    if (!needsGuard) return false;
    container.appendChild(
      createEmptyNote(t("Choose an active owner before changing political ownership or borders.", "ui"))
    );
    return true;
  };

  const getFilteredRegionalPresets = (countryState) => {
    const presetLookupCode = countryState?.presetLookupCode || countryState?.code;
    const consumedPresetNames = state.activeScenarioId
      ? Array.isArray(state.scenarioReleasableIndex?.consumedPresetNamesByParentLookup?.[presetLookupCode])
        ? state.scenarioReleasableIndex.consumedPresetNamesByParentLookup[presetLookupCode]
        : []
      : [];
    return buildPresetEntries(presetLookupCode, (preset) => {
      if (!state.activeScenarioId) return true;
      return !consumedPresetNames.includes(normalizePresetName(preset?.name));
    });
  };

  const renderCountryColorSyncAffordance = (container, countryState) => {
    if (!container || !countryState) return;

    const resolvedColor = getDisplayCountryColor(countryState);
    const row = document.createElement("div");
    row.className = "inspector-color-sync-row";

    const copy = document.createElement("div");
    copy.className = "inspector-color-sync-copy";

    const swatch = document.createElement("span");
    swatch.className = "country-select-swatch inspector-color-sync-swatch";
    swatch.style.backgroundColor = resolvedColor;

    const textWrap = document.createElement("div");
    textWrap.className = "inspector-color-sync-text";

    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = t("Country Color", "ui");

    const note = document.createElement("div");
    note.className = "inspector-color-sync-note";
    note.textContent = `${countryState.displayName} · ${resolvedColor.toUpperCase()}`;

    textWrap.appendChild(title);
    textWrap.appendChild(note);
    copy.appendChild(swatch);
    copy.appendChild(textWrap);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.textContent = t("Use Country Color for Visual Actions", "ui");
    button.addEventListener("click", () => {
      syncSelectedColorFromCountry(countryState);
    });

    row.appendChild(copy);
    row.appendChild(button);
    container.appendChild(row);
  };

  const renderParentCountryActions = (container, countryState) => {
    renderCountryColorSyncAffordance(container, countryState);
    const actionGuarded = renderNoActiveGuard(container);
    const groupSection = appendActionSection(container, t("Hierarchy Groups", "ui"));
    if (countryState.hierarchyGroups.length > 0) {
      countryState.hierarchyGroups.forEach((group) => {
        const button = createInspectorActionButton(
          t(group.label, "geo") || group.label,
          () => applyHierarchyGroup(group, state.selectedColor, render)
        );
        button.disabled = actionGuarded;
        if (actionGuarded) {
          button.title = t("Choose an active owner before changing political ownership.", "ui");
        }
        groupSection.appendChild(button);
      });
    } else {
      groupSection.appendChild(createEmptyNote(t("No hierarchy groups", "ui")));
    }

    if (String(state.activeScenarioId || "").trim() === "tno_1962" && normalizeCountryCode(countryState?.code) === "GER") {
      return;
    }

    const presetSection = appendActionSection(container, t("Regional Presets", "ui"));
    const filteredPresetEntries = getFilteredRegionalPresets(countryState);
    if (filteredPresetEntries.length > 0) {
      renderPresetEntryRows(
        presetSection,
        countryState.presetLookupCode || countryState.code,
        filteredPresetEntries,
        t("No regional presets", "ui"),
        {
          getDisabledInfo: ({ preset }) => getCountryPresetDisabledInfo(countryState, preset),
        }
      );
    } else {
      presetSection.appendChild(createEmptyNote(t("No regional presets", "ui")));
    }
  };

  const renderScenarioActionStatus = (container) => {
    const intro = document.createElement("div");
    intro.className = "scenario-action-intro";
    intro.textContent = t(
      "Scenario Actions change political ownership and dynamic borders. Use Visual Adjustments for color-only edits.",
      "ui"
    );
    container.appendChild(intro);
  };

  const renderScenarioChildCountryList = (container, parentState, { title, childStates = [] } = {}) => {
    const children = Array.isArray(childStates) ? childStates : [];
    if (!children.length) return;

    const section = appendActionSection(container, title || t("Related Countries", "ui"));
    children.forEach((childState) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "scenario-action-card";
      card.addEventListener("click", () => {
        selectInspectorCountry(childState.code);
      });

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = childState.displayName;

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      const subjectLabel = childState.scenarioSubject ? getScenarioSubjectKindLabel(childState) : "";
      meta.textContent = subjectLabel
        ? `(${childState.code}) · ${subjectLabel}`
        : `(${childState.code})`;

      copy.appendChild(title);
      copy.appendChild(meta);

      const side = document.createElement("div");
      side.className = "country-row-actions";
      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = getResolvedCountryColor(childState);
      side.appendChild(swatch);

      card.appendChild(copy);
      card.appendChild(side);
      section.appendChild(card);
    });
  };

  const renderScenarioParentActions = (container, countryState) => {
    if (countryState?.scenarioSubject) {
      renderScenarioParentReturnAction(container, countryState);
    }
    renderScenarioChildCountryList(container, countryState, {
      title: t("Subject Governments", "ui"),
      childStates: getScenarioSubjectChildrenForParent(countryState?.code),
    });
    renderScenarioChildCountryList(container, countryState, {
      title: t("Releasable Countries", "ui"),
      childStates: getReleasableChildrenForParent(countryState?.code),
    });

    if (countryState.hierarchyGroups.length > 0) {
      const groupSection = appendActionSection(container, t("Hierarchy Groups", "ui"));
      countryState.hierarchyGroups.forEach((group) => {
        const button = createInspectorActionButton(
          t(group.label, "geo") || group.label,
          () => applyHierarchyGroupWithMode(group, {
            mode: "ownership",
            ownerCode: countryState.code,
            render,
            ownershipHistoryKind: "scenario-hierarchy-apply-ownership",
            ownershipDirtyReason: "scenario-hierarchy-apply-ownership",
          })
        );
        groupSection.appendChild(button);
      });
    } else {
      const groupSection = appendActionSection(container, t("Hierarchy Groups", "ui"));
      groupSection.appendChild(createEmptyNote(t("No hierarchy groups", "ui")));
    }

    const filteredPresetEntries = getFilteredRegionalPresets(countryState);
    const presetSection = appendActionSection(container, t("Regional Presets", "ui"));
    renderPresetEntryRows(
      presetSection,
      countryState.presetLookupCode || countryState.code,
      filteredPresetEntries,
      t("No regional presets", "ui"),
      {
        onApply: ({ presetIndex, presetLookupCode }) => {
          applyPresetWithMode(presetLookupCode, presetIndex, {
            mode: "ownership",
            ownerCode: countryState.code,
            render,
            ownershipHistoryKind: "scenario-preset-apply-ownership",
            ownershipDirtyReason: "scenario-preset-apply-ownership",
          });
        },
        getDisabledInfo: ({ preset }) => getCountryPresetDisabledInfo(countryState, preset),
        requireActiveOwner: false,
      }
    );
  };

  const renderScenarioParentReturnAction = (container, countryState) => {
    const parentCode = normalizeCountryCode(
      countryState?.parentOwnerTag
      || (Array.isArray(countryState?.parentOwnerTags) ? countryState.parentOwnerTags[0] : "")
    );
    if (!parentCode) return;
    const parentState = latestCountryStatesByCode.get(parentCode);
    if (!parentState) return;

    const section = appendActionSection(container, t("Navigation", "ui"));
    const returnBtn = createInspectorActionButton(
      `${t("Return to", "ui")} ${parentState.displayName} (${parentState.code})`,
      () => {
        selectInspectorCountry(parentState.code);
      }
    );
    returnBtn.classList.add("scenario-parent-return-btn");
    section.appendChild(returnBtn);
  };

  const renderScenarioBoundaryVariantActions = (container, countryState) => {
    const variants = Array.isArray(countryState?.boundaryVariants) ? countryState.boundaryVariants : [];
    if (variants.length <= 1) return;

    const section = appendActionSection(container, t("Boundary Variants", "ui"));
    const activeVariant = getResolvedReleasableBoundaryVariant(getScenarioCountryMeta(countryState.code) || countryState);
    if (activeVariant?.description) {
      const note = document.createElement("div");
      note.className = "inspector-empty-note";
      note.textContent = activeVariant.description;
      section.appendChild(note);
    }

    variants.forEach((variant) => {
      const button = createInspectorActionButton(variant.label || variant.id, () => {
        applyReleasableBoundaryVariantSelection(countryState, variant);
      });
      const isActive = String(activeVariant?.id || "").trim().toLowerCase() === String(variant?.id || "").trim().toLowerCase();
      button.disabled = isActive;
      if (isActive) {
        button.title = t("Already using this boundary variant.", "ui");
      }
      section.appendChild(button);
    });
  };

  const renderScenarioCoreTerritoryAction = (container, countryState) => {
    const section = appendActionSection(container, t("Core Territory", "ui"));
    const presetRef = getPrimaryReleasablePresetRef(countryState);
    if (!presetRef) {
      section.appendChild(createEmptyNote(t("No core territory defined", "ui")));
      return;
    }

    const card = document.createElement("div");
    card.className = "scenario-action-card scenario-core-action-card";

    const copy = document.createElement("div");
    copy.className = "scenario-action-card-copy";

    const title = document.createElement("div");
    title.className = "country-row-title";
    title.textContent = presetRef.preset?.name || t("Core Territory", "ui");

    const meta = document.createElement("div");
    meta.className = "country-select-meta";
    const metaBits = [`${presetRef.preset?.ids?.length || 0} ${t("features", "ui")}`];
    const selectedVariantLabel = String(countryState?.selectedBoundaryVariantLabel || "").trim();
    if (selectedVariantLabel && Array.isArray(countryState?.boundaryVariants) && countryState.boundaryVariants.length > 1) {
      metaBits.push(selectedVariantLabel);
    }
    meta.textContent = metaBits.join(" · ");

    copy.appendChild(title);
    copy.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "country-row-actions scenario-core-action-row";
    const isReleasable = !!countryState?.releasable;

    const activateBtn = document.createElement("button");
    activateBtn.type = "button";
    activateBtn.className = "btn-primary";
    activateBtn.textContent = isReleasable ? t("Activate Releasable", "ui") : t("Target This Country", "ui");
    activateBtn.addEventListener("click", () => {
      const normalizedCountryCode = normalizeCountryCode(countryState.code);
      const alreadyActive = normalizedCountryCode && normalizedCountryCode === normalizeCountryCode(state.activeSovereignCode);
      if (normalizedCountryCode) {
        state.activeSovereignCode = normalizedCountryCode;
      }
      setScenarioMapPaintMode("ownership");
      if (!alreadyActive) {
        markDirty("set-active-sovereign");
      }
      if (typeof state.updateActiveSovereignUIFn === "function") {
        state.updateActiveSovereignUIFn();
      }
      renderList();
      showToast(
        t(
          alreadyActive
            ? (isReleasable
              ? "Political ownership editing already targets this releasable."
              : "Political ownership editing already targets this country.")
            : (isReleasable
              ? "Political ownership editing now targets this releasable."
              : "Political ownership editing now targets this country."),
          "ui"
        ),
        {
          title: t("Active owner updated", "ui"),
          tone: alreadyActive ? "info" : "success",
          duration: 2800,
        }
      );
    });
    actions.appendChild(activateBtn);

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "btn-secondary";
    applyBtn.textContent = t("Reapply Core Territory", "ui");
    applyBtn.addEventListener("click", () => {
      applyScenarioReleasableCoreTerritory(countryState, {
        source: "scenario-actions",
        actionMode: "ownership",
      });
    });
    actions.appendChild(applyBtn);

    card.appendChild(copy);
    card.appendChild(actions);
    section.appendChild(card);
  };

  const renderScenarioHistoricalTransfers = (container, countryState) => {
    const actions = Array.isArray(countryState?.companionActions)
      ? countryState.companionActions.filter((action) => !action?.hidden_in_ui)
      : [];
    if (!actions.length) return;

    const section = appendActionSection(container, t("Historical Transfers", "ui"));
    actions.forEach((action) => {
      const button = createInspectorActionButton(action.label || action.id, () => {
        applyScenarioCompanionAction(countryState, action);
      });
      section.appendChild(button);
      if (action.description) {
        const note = document.createElement("div");
        note.className = "inspector-mini-label";
        note.textContent = action.description;
        section.appendChild(note);
      }
    });
  };

  const renderScenarioReleasableActions = (container, countryState) => {
    renderScenarioParentReturnAction(container, countryState);
    renderScenarioBoundaryVariantActions(container, countryState);
    renderScenarioCoreTerritoryAction(container, countryState);
    renderScenarioHistoricalTransfers(container, countryState);
    if (countryState.notes) {
      const notesSection = appendActionSection(container, t("Notes", "ui"));
      const notes = document.createElement("div");
      notes.className = "inspector-empty-note";
      notes.textContent = countryState.notes;
      notesSection.appendChild(notes);
      if (
        countryState.selectedBoundaryVariantDescription
        && Array.isArray(countryState?.boundaryVariants)
        && countryState.boundaryVariants.length > 1
      ) {
        const variantNote = document.createElement("div");
        variantNote.className = "inspector-mini-label mt-2";
        variantNote.textContent = countryState.selectedBoundaryVariantDescription;
        notesSection.appendChild(variantNote);
      }
    }
  };

  const renderScenarioVisualAdjustments = (container, countryState) => {
    const details = document.createElement("details");
    details.className = "scenario-visual-adjustments mt-3";
    details.open = !!state.ui?.scenarioVisualAdjustmentsOpen;
    details.addEventListener("toggle", () => {
      if (!state.ui || typeof state.ui !== "object") {
        state.ui = {};
      }
      state.ui.scenarioVisualAdjustmentsOpen = details.open;
      scheduleAdaptiveInspectorHeights();
    });

    const summary = document.createElement("summary");
    summary.className = "section-header";
    summary.textContent = t("Visual Adjustments", "ui");
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "scenario-visual-adjustments-body";

    const note = document.createElement("p");
    note.className = "scenario-action-hint";
    note.textContent = t(
      "These actions only change visual color. Ownership, controllers, and dynamic borders stay unchanged.",
      "ui"
    );
    body.appendChild(note);

    const brushSection = appendActionSection(body, t("Brush", "ui"));
    const isVisualBrush = String(state.paintMode || "visual") !== "sovereignty";
    const brushBtn = createInspectorActionButton(
      isVisualBrush
        ? t("Return to Political Ownership Brush", "ui")
        : t("Use Visual Color Brush", "ui"),
      () => {
        if (!state.ui || typeof state.ui !== "object") {
          state.ui = {};
        }
        state.ui.scenarioVisualAdjustmentsOpen = true;
        setScenarioMapPaintMode(isVisualBrush ? "ownership" : "visual");
      }
    );
    brushSection.appendChild(brushBtn);

    if (!countryState) {
      body.appendChild(
        createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui"))
      );
      details.appendChild(body);
      container.appendChild(details);
      return;
    }

    if (countryState.releasable) {
      const presetRef = getPrimaryReleasablePresetRef(countryState);
      const coreSection = appendActionSection(body, t("Core Territory Visuals", "ui"));

      const applyVisualBtn = createInspectorActionButton(
        t("Apply Visual Color to Core Territory", "ui"),
        () => {
          applyScenarioReleasableCoreTerritory(countryState, {
            source: "visual-adjustments",
            actionMode: "visual",
          });
          setScenarioVisualAdjustmentsOpen(true);
        }
      );
      applyVisualBtn.disabled = !presetRef;
      coreSection.appendChild(applyVisualBtn);

      const clearVisualBtn = createInspectorActionButton(
        t("Clear Core Territory Visual Overrides", "ui"),
        () => {
          if (!presetRef) return;
          const requestedFeatureIds = Array.isArray(presetRef.preset?.ids) ? presetRef.preset.ids : [];
          const { matchedIds } = filterToVisibleFeatureIds(requestedFeatureIds);
          const result = clearVisualOverridesForFeatureIds(matchedIds, {
            render,
            historyKind: "scenario-core-clear-visual",
            dirtyReason: "scenario-core-clear-visual",
          });
          if (result.changed > 0) {
            showToast(
              `${t("Cleared", "ui")} ${result.changed} ${t("features", "ui")}`,
              {
                title: t("Visual overrides cleared", "ui"),
                tone: "success",
                duration: 2800,
              }
            );
          } else {
            showToast(t("No visual overrides to clear.", "ui"), {
              title: t("No changes", "ui"),
              tone: "info",
              duration: 2600,
            });
          }
          setScenarioVisualAdjustmentsOpen(true);
        }
      );
      clearVisualBtn.disabled = !presetRef;
      coreSection.appendChild(clearVisualBtn);

      if (!presetRef) {
        coreSection.appendChild(createEmptyNote(t("No core territory defined", "ui")));
      }
    } else {
      const countrySection = appendActionSection(body, t("Country Visuals", "ui"));

      countrySection.appendChild(createInspectorActionButton(
        t("Paint Owned Regions With Country Color", "ui"),
        () => {
          const result = applyVisualColorToOwnedRegions(countryState);
          if (result.changed > 0) {
            showToast(
              `${t("Applied", "ui")} ${result.changed}/${result.matchedCount} ${t("features", "ui")}`,
              {
                title: t("Visual color applied", "ui"),
                tone: "success",
                duration: 2800,
              }
            );
          } else {
            showToast(t("No owned regions were recolored.", "ui"), {
              title: t("No changes", "ui"),
              tone: "info",
              duration: 2600,
            });
          }
          setScenarioVisualAdjustmentsOpen(true);
        }
      ));

      countrySection.appendChild(createInspectorActionButton(
        t("Clear Owned Region Visual Overrides", "ui"),
        () => {
          const result = clearCountryVisualOverrides(countryState);
          if (result.changed > 0) {
            showToast(
              `${t("Cleared", "ui")} ${result.changed} ${t("features", "ui")}`,
              {
                title: t("Visual overrides cleared", "ui"),
                tone: "success",
                duration: 2800,
              }
            );
          } else {
            showToast(t("No visual overrides to clear.", "ui"), {
              title: t("No changes", "ui"),
              tone: "info",
              duration: 2600,
            });
          }
          setScenarioVisualAdjustmentsOpen(true);
        }
      ));

      if (countryState.hierarchyGroups.length > 0) {
        const groupSection = appendActionSection(body, t("Hierarchy Groups (Visual Color)", "ui"));
        countryState.hierarchyGroups.forEach((group) => {
          groupSection.appendChild(createInspectorActionButton(
            t(group.label, "geo") || group.label,
            () => {
              applyHierarchyGroupWithMode(group, {
                mode: "visual",
                color: state.selectedColor,
                render,
                visualHistoryKind: "scenario-hierarchy-apply-visual",
                visualDirtyReason: "scenario-hierarchy-apply-visual",
              });
              setScenarioVisualAdjustmentsOpen(true);
            }
          ));
        });
      }

      const filteredPresetEntries = getFilteredRegionalPresets(countryState);
      if (filteredPresetEntries.length > 0) {
        const presetSection = appendActionSection(body, t("Regional Presets (Visual Color)", "ui"));
        renderPresetEntryRows(
          presetSection,
          countryState.presetLookupCode || countryState.code,
          filteredPresetEntries,
          t("No regional presets", "ui"),
          {
            onApply: ({ presetIndex, presetLookupCode }) => {
              applyPresetWithMode(presetLookupCode, presetIndex, {
                mode: "visual",
                color: state.selectedColor,
                render,
                visualHistoryKind: "scenario-preset-apply-visual",
                visualDirtyReason: "scenario-preset-apply-visual",
              });
              setScenarioVisualAdjustmentsOpen(true);
            },
            getDisabledInfo: ({ preset }) => getCountryPresetDisabledInfo(countryState, preset),
            requireActiveOwner: false,
          }
        );
      }
    }

    details.appendChild(body);
    container.appendChild(details);
  };

  const renderScenarioActionsPanel = (container, countryState) => {
    container.replaceChildren();
    renderScenarioActionStatus(container);
    if (countryState) {
      renderCountryColorSyncAffordance(container, countryState);
    }

    if (!countryState) {
      container.appendChild(
        createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui"))
      );
      renderScenarioVisualAdjustments(container, null);
      return;
    }

    if (hasScenarioCoreTerritoryActions(countryState)) {
      renderScenarioReleasableActions(container, countryState);
    } else {
      renderScenarioParentActions(container, countryState);
    }
    renderScenarioVisualAdjustments(container, countryState);
  };

  const renderPresetTree = () => {
    if (!presetTree) return;
    incrementSidebarCounter("presetTreeRenders");
    updateScenarioInspectorLayout();
    presetTree.innerHTML = "";

    const selectedCode = ensureSelectedInspectorCountry();
    const countryState = selectedCode ? latestCountryStatesByCode.get(selectedCode) : null;

    if (state.activeScenarioId) {
      renderScenarioActionsPanel(presetTree, countryState);
      scheduleAdaptiveInspectorHeights();
      return;
    }

    if (!countryState) {
      presetTree.appendChild(
        createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui"))
      );
      scheduleAdaptiveInspectorHeights();
      return;
    }

    renderParentCountryActions(presetTree, countryState);
    scheduleAdaptiveInspectorHeights();
  };

  state.renderPresetTreeFn = renderPresetTree;
  state.renderScenarioAuditPanelFn = renderScenarioAuditPanel;

  let lastLegendKey = null;
  const refreshLegendEditor = () => {
    if (!legendList) return;
    incrementSidebarCounter("legendRenders");
    const colors = LegendManager.getUniqueColors(state);
    const key = colors.join("|");
    if (key === lastLegendKey && legendList.dataset.ready === "true") return;
    lastLegendKey = key;
    legendList.dataset.ready = "true";
    legendList.innerHTML = "";

    if (!colors.length) {
      const empty = document.createElement("div");
      empty.className = "legend-empty-state";
      empty.textContent = t("Paint regions to generate a legend.", "ui");
      legendList.appendChild(empty);
      return;
    }

    colors.forEach((color, index) => {
      const row = document.createElement("div");
      row.className = "legend-row";

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = color;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "legend-input";
      input.placeholder = `Category ${index + 1}`;
      input.value = LegendManager.getLabel(color);
      input.addEventListener("input", (event) => {
        LegendManager.setLabel(color, event.target.value);
        mapRenderer.renderLegend(colors, LegendManager.getLabels());
      });

      row.appendChild(swatch);
      row.appendChild(input);
      legendList.appendChild(row);
    });
  };

  state.updateLegendUI = refreshLegendEditor;
  state.refreshCountryListRowsFn = refreshCountryRows;
  state.refreshCountryInspectorDetailFn = renderCountryInspectorDetail;

  if (sidebar && !sidebar.dataset.adaptiveInspectorBound) {
    globalThis.addEventListener("resize", scheduleAdaptiveInspectorHeights);
    countryInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
    waterInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
    specialRegionInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
    selectedCountryActionsSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
    sidebar.addEventListener("scroll", () => {
      if (countryInspectorColorPickerOpen) {
        closeCountryInspectorColorPicker();
      }
      if (waterInspectorColorPickerOpen) {
        closeWaterInspectorColorPicker();
      }
      if (specialRegionColorPickerOpen) {
        closeSpecialRegionColorPicker();
      }
    }, { passive: true });
    sidebar.addEventListener("wheel", () => {
      if (countryInspectorColorPickerOpen) {
        closeCountryInspectorColorPicker();
      }
      if (waterInspectorColorPickerOpen) {
        closeWaterInspectorColorPicker();
      }
      if (specialRegionColorPickerOpen) {
        closeSpecialRegionColorPicker();
      }
    }, { passive: true });
    sidebar.dataset.adaptiveInspectorBound = "true";
  }

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.addEventListener("input", () => {
      if (typeof state.renderCountryListFn === "function") {
        state.renderCountryListFn();
      }
      if (typeof state.renderPresetTreeFn === "function") {
        state.renderPresetTreeFn();
      }
      scheduleAdaptiveInspectorHeights();
    });
    searchInput.dataset.bound = "true";
  }

  if (waterSearchInput && !waterSearchInput.dataset.bound) {
    waterSearchInput.addEventListener("input", () => {
      renderWaterRegionList();
    });
    waterSearchInput.dataset.bound = "true";
  }

  if (resetBtn && !resetBtn.dataset.bound) {
    let resetConfirmTimer = null;
    resetBtn.addEventListener("click", () => {
      if (resetBtn.dataset.confirmState === "reset-country-colors") {
        resetBtn.dataset.confirmState = "";
        resetBtn.classList.remove("is-danger-confirm");
        resetBtn.textContent = t("Reset Country Colors", "ui");
        if (resetConfirmTimer) globalThis.clearTimeout(resetConfirmTimer);
      } else {
        resetBtn.dataset.confirmState = "reset-country-colors";
        resetBtn.classList.add("is-danger-confirm");
        resetBtn.textContent = t("Confirm Reset", "ui");
        resetConfirmTimer = globalThis.setTimeout(() => {
          resetBtn.dataset.confirmState = "";
          resetBtn.classList.remove("is-danger-confirm");
          resetBtn.textContent = t("Reset Country Colors", "ui");
        }, 3000);
        return;
      }
      resetCountryColors();
      markDirty("reset-country-colors");
      if (typeof state.renderCountryListFn === "function") {
        state.renderCountryListFn();
      }
      if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
      }
      scheduleAdaptiveInspectorHeights();
    });
    resetBtn.dataset.bound = "true";
  }

  if (downloadProjectBtn && !downloadProjectBtn.dataset.bound) {
    downloadProjectBtn.addEventListener("click", () => {
      FileManager.exportProject(state);
    });
    downloadProjectBtn.dataset.bound = "true";
  }

  if (uploadProjectBtn && projectFileInput && !uploadProjectBtn.dataset.bound) {
    uploadProjectBtn.addEventListener("click", () => {
      if (state.isDirty) {
        const shouldContinue = globalThis.confirm(
          t("You have unsaved changes. Loading a project will replace the current map.", "ui")
        );
        if (!shouldContinue) return;
      }
      projectFileInput.click();
    });
    uploadProjectBtn.dataset.bound = "true";
  }

  if (projectFileInput && !projectFileInput.dataset.bound) {
    projectFileInput.addEventListener("change", () => {
      const file = projectFileInput.files?.[0];
      if (!file) {
        if (projectFileName) {
          projectFileName.textContent = t("No file selected", "ui");
        }
        return;
      }
      if (projectFileName) {
        projectFileName.textContent = file.name;
      }
      FileManager.importProject(file, async (data) => {
        clearHistory();
        if (data.scenario?.id) {
          const validation = await validateImportedScenarioBaseline(data.scenario);
          if (!validation.ok) {
            const shouldContinue = validation.reason === "baseline_mismatch"
              ? globalThis.confirm(
                `${validation.message}\n\nContinue loading this project anyway?`
              )
              : false;
            if (!shouldContinue) {
              const error = new Error("Project import cancelled.");
              error.code = "IMPORT_ABORTED";
              error.toastTitle = t("Import cancelled", "ui");
              error.toastTone = validation.reason === "baseline_mismatch" ? "warning" : "error";
              error.userMessage = validation.reason === "missing_scenario"
                ? validation.message
                : t(
                  "Project import cancelled because the saved scenario baseline does not match the current assets.",
                  "ui"
                );
              throw error;
            }
          }
          await applyScenarioById(data.scenario.id, {
            renderNow: false,
            markDirtyReason: "",
            showToastOnComplete: false,
          });
          setScenarioViewMode(data.scenario.viewMode || "ownership", {
            renderNow: false,
            markDirtyReason: "",
          });
        } else if (state.activeScenarioId) {
          clearActiveScenario({
            renderNow: false,
            markDirtyReason: "",
            showToastOnComplete: false,
          });
        }
        data = await migrateFeatureScopedProjectDataToCurrentTopology(data, state.landData);
        state.sovereignBaseColors = data.sovereignBaseColors || data.countryBaseColors || {};
        state.countryBaseColors = { ...state.sovereignBaseColors };
        state.visualOverrides = data.visualOverrides || data.featureOverrides || {};
        state.featureOverrides = { ...state.visualOverrides };
        state.waterRegionOverrides = data.waterRegionOverrides || {};
        state.specialRegionOverrides = data.specialRegionOverrides || {};
        state.sovereigntyByFeatureId = data.sovereigntyByFeatureId || {};
        state.sovereigntyInitialized = false;
        state.paintMode = data.paintMode || "visual";
        state.activeSovereignCode = data.activeSovereignCode || "";
        state.selectedInspectorCountryCode = data.activeSovereignCode || state.selectedInspectorCountryCode || "";
        state.inspectorHighlightCountryCode = state.selectedInspectorCountryCode;
        state.releasableBoundaryVariantByTag =
          data.releasableBoundaryVariantByTag && typeof data.releasableBoundaryVariantByTag === "object"
            ? { ...data.releasableBoundaryVariantByTag }
            : {};
        if (state.activeScenarioId) {
          const existingTags = Object.keys(state.scenarioCountriesByTag || {});
          state.scenarioReleasableIndex = buildScenarioReleasableIndex(state.activeScenarioId);
          state.scenarioCountriesByTag = {
            ...(state.scenarioCountriesByTag || {}),
            ...getScenarioReleasableCountries(state.activeScenarioId, {
              excludeTags: existingTags,
            }),
          };
        }
        state.inspectorExpansionInitialized = false;
        if (state.expandedInspectorContinents instanceof Set) {
          state.expandedInspectorContinents.clear();
        }
        if (state.expandedInspectorReleaseParents instanceof Set) {
          state.expandedInspectorReleaseParents.clear();
        }
        state.dynamicBordersDirty = !!data.dynamicBordersDirty;
        state.dynamicBordersDirtyReason = data.dynamicBordersDirtyReason || "";
        ensureSovereigntyState({ force: true });
        state.specialZones = data.specialZones || {};
        state.manualSpecialZones =
          data.manualSpecialZones && data.manualSpecialZones.type === "FeatureCollection"
            ? data.manualSpecialZones
            : { type: "FeatureCollection", features: [] };
        const supportedCountries = Array.isArray(state.parentBorderSupportedCountries)
          ? state.parentBorderSupportedCountries
          : [];
        const importedParentEnabled =
          data.parentBorderEnabledByCountry && typeof data.parentBorderEnabledByCountry === "object"
            ? data.parentBorderEnabledByCountry
            : {};
        const normalizedParentEnabled = {};
        supportedCountries.forEach((countryCode) => {
          normalizedParentEnabled[countryCode] = !!importedParentEnabled[countryCode];
        });
        state.parentBorderEnabledByCountry = normalizedParentEnabled;
        if (
          data.styleConfig?.parentBorders &&
          typeof data.styleConfig.parentBorders === "object"
        ) {
          state.styleConfig.parentBorders = {
            ...(state.styleConfig.parentBorders || {}),
            ...data.styleConfig.parentBorders,
          };
        }
        if (data.styleConfig?.ocean && typeof data.styleConfig.ocean === "object") {
          state.styleConfig.ocean = {
            ...(state.styleConfig.ocean || {}),
            ...data.styleConfig.ocean,
          };
        }
        state.styleConfig.lakes = normalizeLakeStyleConfig(data.styleConfig?.lakes);
        if (data.styleConfig?.urban && typeof data.styleConfig.urban === "object") {
          state.styleConfig.urban = {
            ...(state.styleConfig.urban || {}),
            ...data.styleConfig.urban,
          };
        }
        if (data.styleConfig?.physical && typeof data.styleConfig.physical === "object") {
          state.styleConfig.physical = normalizePhysicalStyleConfig({
            ...(state.styleConfig.physical || {}),
            ...data.styleConfig.physical,
          });
        }
        if (data.styleConfig?.rivers && typeof data.styleConfig.rivers === "object") {
          state.styleConfig.rivers = {
            ...(state.styleConfig.rivers || {}),
            ...data.styleConfig.rivers,
          };
        }
        if (data.styleConfig?.specialZones && typeof data.styleConfig.specialZones === "object") {
          state.styleConfig.specialZones = {
            ...(state.styleConfig.specialZones || {}),
            ...data.styleConfig.specialZones,
          };
        }
        if (data.styleConfig?.texture && typeof data.styleConfig.texture === "object") {
          state.styleConfig.texture = {
            ...(state.styleConfig.texture || {}),
            ...data.styleConfig.texture,
            paper: {
              ...(state.styleConfig.texture?.paper || {}),
              ...(data.styleConfig.texture.paper || {}),
            },
            graticule: {
              ...(state.styleConfig.texture?.graticule || {}),
              ...(data.styleConfig.texture.graticule || {}),
            },
            draftGrid: {
              ...(state.styleConfig.texture?.draftGrid || {}),
              ...(data.styleConfig.texture.draftGrid || {}),
            },
          };
        }
        if (data.styleConfig?.dayNight && typeof data.styleConfig.dayNight === "object") {
          state.styleConfig.dayNight = normalizeDayNightStyleConfig({
            ...(state.styleConfig.dayNight || {}),
            ...data.styleConfig.dayNight,
          });
        }
        if (data.layerVisibility && typeof data.layerVisibility === "object") {
          state.showWaterRegions =
            data.layerVisibility.showWaterRegions === undefined
              ? true
              : !!data.layerVisibility.showWaterRegions;
          state.showOpenOceanRegions =
            data.layerVisibility.showOpenOceanRegions === undefined
              ? false
              : !!data.layerVisibility.showOpenOceanRegions;
          state.showScenarioSpecialRegions =
            data.layerVisibility.showScenarioSpecialRegions === undefined
              ? true
              : !!data.layerVisibility.showScenarioSpecialRegions;
          state.showScenarioReliefOverlays =
            data.layerVisibility.showScenarioReliefOverlays === undefined
              ? true
              : !!data.layerVisibility.showScenarioReliefOverlays;
          state.showUrban = !!data.layerVisibility.showUrban;
          state.showPhysical = !!data.layerVisibility.showPhysical;
          state.showRivers = !!data.layerVisibility.showRivers;
          state.showSpecialZones =
            data.layerVisibility.showSpecialZones === undefined
              ? true
              : !!data.layerVisibility.showSpecialZones;
        }
        if (typeof state.updateParentBorderCountryListFn === "function") {
          state.updateParentBorderCountryListFn();
        }
        if (typeof state.updateSpecialZoneEditorUIFn === "function") {
          state.updateSpecialZoneEditorUIFn();
        }
        if (typeof state.updateWaterInteractionUIFn === "function") {
          state.updateWaterInteractionUIFn();
        }
        if (typeof state.updateScenarioSpecialRegionUIFn === "function") {
          state.updateScenarioSpecialRegionUIFn();
        }
        if (typeof state.updateActiveSovereignUIFn === "function") {
          state.updateActiveSovereignUIFn();
        }
        if (typeof state.updatePaintModeUIFn === "function") {
          state.updatePaintModeUIFn();
        }
        if (typeof state.updateDynamicBorderStatusUIFn === "function") {
          state.updateDynamicBorderStatusUIFn();
        }
        if (typeof state.updateToolbarInputsFn === "function") {
          state.updateToolbarInputsFn();
        }
        rebuildPresetState();
        mapRenderer.refreshColorState({ renderNow: false });
        if (render) render();
        if (typeof state.renderCountryListFn === "function") {
          state.renderCountryListFn();
        }
        if (typeof state.renderWaterRegionListFn === "function") {
          state.renderWaterRegionListFn();
        }
        if (typeof state.renderSpecialRegionListFn === "function") {
          state.renderSpecialRegionListFn();
        }
        if (typeof state.renderPresetTreeFn === "function") {
          state.renderPresetTreeFn();
        }
        if (typeof state.updateLegendUI === "function") {
          state.updateLegendUI();
        }
        if (typeof state.renderScenarioAuditPanelFn === "function") {
          state.renderScenarioAuditPanelFn();
        }
      });
      projectFileInput.value = "";
    });
    projectFileInput.dataset.bound = "true";
  }

  if (debugModeSelect && !debugModeSelect.dataset.bound) {
    debugModeSelect.value = String(state.debugMode || "PROD").toUpperCase();
    debugModeSelect.addEventListener("change", (event) => {
      mapRenderer.setDebugMode(event.target.value);
    });
    debugModeSelect.dataset.bound = "true";
  }

  renderList();
  renderWaterInteractionUi();
  renderWaterRegionList();
  renderSpecialRegionInspectorUi();
  renderSpecialRegionList();
  renderPresetTree();
  refreshLegendEditor();
  renderScenarioAuditPanel();
  scheduleAdaptiveInspectorHeights();
}

export { initSidebar, initPresetState };

// Sidebar UI (Phase 13)
import {
  state,
  countryNames,
  PRESET_STORAGE_KEY,
  defaultCountryPalette,
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizeLakeStyleConfig,
  normalizeAnnotationView,
  normalizeMapSemanticMode,
  normalizePhysicalStyleConfig,
} from "../core/state.js";
import { ColorManager } from "../core/color_manager.js";
import * as mapRenderer from "../core/map_renderer.js";
import { applyCountryColor, resetCountryColors } from "../core/logic.js";
import { FileManager } from "../core/file_manager.js";
import { canUndoHistory, captureHistoryState, clearHistory, pushHistoryEntry, undoHistory } from "../core/history_manager.js";
import { LegendManager } from "../core/legend_manager.js";
import {
  applyScenarioById,
  clearActiveScenario,
  ensureActiveScenarioOptionalLayerLoaded,
  loadScenarioAuditPayload,
  recalculateScenarioOwnerControllerDiffCount,
  releaseScenarioAuditPayload,
  refreshScenarioShellOverlays,
  setScenarioViewMode,
  validateImportedScenarioBaseline,
} from "../core/scenario_manager.js";
import { getGeoFeatureDisplayLabel, t } from "./i18n.js";
import { showToast } from "./toast.js";
import { showAppDialog } from "./app_dialog.js";
import { initDevWorkspace } from "./dev_workspace.js";
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
import { getScenarioCountryDisplayName } from "../core/scenario_country_display.js";
import { setActivePaletteSource } from "../core/palette_manager.js";
import {
  DEFAULT_UNIT_COUNTER_PRESET_ID,
  getUnitCounterCatalogCategories,
  getUnitCounterCategoryLabel,
  getUnitCounterIconPathById,
  getUnitCounterPresetById,
  UNIT_COUNTER_ECHELONS,
  UNIT_COUNTER_PRESETS,
} from "../core/unit_counter_presets.js";
import {
  createEmptyHoi4UnitIconReviewDraft,
  filterHoi4UnitIconEntries,
  getHoi4UnitIconMappedPresetIds,
  getHoi4UnitIconVariantPath,
  loadHoi4UnitIconReviewDraft,
  loadHoi4UnitIconManifest,
  saveHoi4UnitIconReviewDraft,
} from "../core/unit_counter_icon_libraries.js";

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

function isScenarioShellLikeFeature(feature, featureId = "") {
  const candidate = String(feature?.properties?.id || feature?.id || featureId || "").trim().toUpperCase();
  if (!candidate) return false;
  if (candidate.includes("_FB_")) return true;
  return String(feature?.properties?.name || "").toLowerCase().includes("shell fallback");
}

function getScenarioInteractionLockMessage() {
  const baseMessage = t("Scenario state is inconsistent. Reload the page before continuing.", "ui");
  const detail = String(state.scenarioFatalRecovery?.message || "").trim();
  return detail ? `${baseMessage} ${detail}` : baseMessage;
}

function blockLockedScenarioInteraction() {
  if (!state.activeScenarioId || !state.scenarioFatalRecovery) return false;
  showToast(getScenarioInteractionLockMessage(), {
    title: t("Scenario locked", "ui"),
    tone: "error",
    duration: 5200,
  });
  return true;
}

function isAntarcticSectorLikeFeature(feature, featureId = "") {
  const candidate = String(feature?.properties?.id || feature?.id || featureId || "").trim().toUpperCase();
  if (!candidate) return false;
  const detailTier = String(feature?.properties?.detail_tier || "").trim().toLowerCase();
  if (detailTier !== "antarctic_sector") return false;
  const countryCode = getCountryCodeFromProps(feature?.properties || {}, candidate);
  return countryCode === "AQ" || candidate.startsWith("AQ_");
}

function shouldExcludeScenarioPoliticalFeature(feature, featureId = "") {
  return isScenarioShellLikeFeature(feature, featureId) || isAntarcticSectorLikeFeature(feature, featureId);
}

function getCountryNameFromProps(props = {}) {
  const candidate = getGeoFeatureDisplayLabel({ properties: props }) || (
    props.name_en ||
    props.name ||
    props.NAME_EN ||
    props.NAME ||
    props.admin ||
    props.ADMIN ||
    ""
  );
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
  const resolveScenarioCountryFeatureCount = (entry = {}) => {
    const entryKind = String(entry?.entry_kind || entry?.entryKind || "").trim().toLowerCase();
    const ownerFeatureCount = Number(entry?.feature_count ?? entry?.featureCount ?? 0) || 0;
    const controllerFeatureCount = Number(entry?.controller_feature_count ?? entry?.controllerFeatureCount ?? 0) || 0;
    return entryKind === "controller_only" ? controllerFeatureCount : ownerFeatureCount;
  };

  if (state.activeScenarioId && state.scenarioCountriesByTag && typeof state.scenarioCountriesByTag === "object") {
    const scenarioEntries = Object.entries(state.scenarioCountriesByTag)
      .map(([rawCode, scenarioCountry]) => {
        const code = normalizeCountryCode(rawCode);
        if (!code) return null;
        const name = getScenarioCountryDisplayName(scenarioCountry, state.countryNames?.[code] || code) || code;
        const displayName = t(name, "geo") || name || code;
        const ownerFeatureCount = Number(scenarioCountry?.feature_count || 0) || 0;
        const controllerFeatureCount = Number(scenarioCountry?.controller_feature_count || 0) || 0;
        return {
          code,
          name,
          displayName,
          featureCount: resolveScenarioCountryFeatureCount(scenarioCountry),
          ownerFeatureCount,
          controllerFeatureCount,
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
          inspector_group_id: String(scenarioCountry?.inspector_group_id || "").trim(),
          inspector_group_label: String(scenarioCountry?.inspector_group_label || "").trim(),
          inspector_group_anchor_id: String(scenarioCountry?.inspector_group_anchor_id || "").trim(),
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
    (entry) => !entry?.releasable
      && !entry?.hiddenFromCountryList
      && (!entry?.scenarioSubject || !!entry?.inspectorGroupId)
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

const TNO_SCENARIO_ID = "tno_1962";
const TNO_CHINA_INSPECTOR_GROUP = Object.freeze({
  id: "scenario_group_china_region",
  label: "China Region",
  anchorId: "continent_asia",
});
const TNO_RUSSIA_INSPECTOR_GROUP = Object.freeze({
  id: "scenario_group_russia_region",
  label: "Russia Region",
  anchorId: "continent_europe",
});

function readExplicitInspectorGroupMeta(entry = {}) {
  const id = String(entry?.inspector_group_id || entry?.inspectorGroupId || "").trim();
  const label = String(entry?.inspector_group_label || entry?.inspectorGroupLabel || "").trim();
  const anchorId = String(entry?.inspector_group_anchor_id || entry?.inspectorGroupAnchorId || "").trim();
  if (!id) {
    return {
      id: "",
      label: "",
      anchorId: "",
    };
  }
  return {
    id,
    label: label || id,
    anchorId,
  };
}

function collectScenarioInspectorIso2Codes(...entries) {
  const iso2Codes = new Set();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    [
      entry.base_iso2,
      entry.baseIso2,
      entry.lookup_iso2,
      entry.lookupIso2,
      entry.provenance_iso2,
      entry.provenanceIso2,
    ].forEach((value) => {
      const normalized = String(value || "").trim().toUpperCase();
      if (normalized) {
        iso2Codes.add(normalized);
      }
    });
  });
  return iso2Codes;
}

function resolveScenarioInspectorGroupMeta(entryOrCode) {
  const entry = typeof entryOrCode === "object" && entryOrCode ? entryOrCode : null;
  const scenarioMeta = getScenarioCountryMeta(entryOrCode) || null;
  const explicitScenarioGroup = readExplicitInspectorGroupMeta(scenarioMeta || {});
  if (explicitScenarioGroup.id) return explicitScenarioGroup;
  const explicitEntryGroup = readExplicitInspectorGroupMeta(entry || {});
  if (explicitEntryGroup.id) return explicitEntryGroup;

  if (String(state.activeScenarioId || "").trim() !== TNO_SCENARIO_ID) {
    return explicitEntryGroup;
  }

  const tag = normalizeCountryCode(
    scenarioMeta?.tag
    || entry?.tag
    || entry?.code
    || (typeof entryOrCode === "string" ? entryOrCode : "")
  );
  if (!tag) {
    return explicitEntryGroup;
  }

  const iso2Codes = collectScenarioInspectorIso2Codes(scenarioMeta, entry);
  if (iso2Codes.has("RU") && !tag.startsWith("RK")) {
    return TNO_RUSSIA_INSPECTOR_GROUP;
  }
  if (iso2Codes.has("CN") && tag !== "MAN") {
    return TNO_CHINA_INSPECTOR_GROUP;
  }
  return explicitEntryGroup;
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

function getInspectorGroupExpansionKey(groupId) {
  return `group::${String(groupId || "").trim()}`;
}

function getInspectorTopLevelGroupMeta(entry = {}) {
  const fallbackContinentId = String(entry?.continentId || "continent_other").trim() || "continent_other";
  const fallbackContinentLabel = String(entry?.continentLabel || "Other").trim() || "Other";
  const groupId = String(entry?.topLevelGroupId || fallbackContinentId).trim() || fallbackContinentId;
  const groupLabel = String(entry?.topLevelGroupLabel || fallbackContinentLabel).trim() || fallbackContinentLabel;
  const groupAnchorId = String(entry?.topLevelGroupAnchorId || "").trim();
  return {
    id: groupId,
    label: groupLabel,
    displayLabel: t(groupLabel, "geo") || groupLabel,
    anchorId: groupAnchorId,
  };
}

function getInspectorTopLevelGroupIdForCode(code) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return "";
  const inspectorGroupId = resolveScenarioInspectorGroupMeta(normalizedCode).id;
  if (inspectorGroupId) return inspectorGroupId;
  return getCountryGroupingMeta(normalizedCode)?.continentId || "";
}

function buildCountryColorTree(entries) {
  const tree = new Map();
  const topLevelOrder = new Map();
  const configuredContinents = Array.isArray(state.countryGroupsData?.continents)
    ? state.countryGroupsData.continents
    : [];
  const priorityOrderMap = getPriorityCountryOrderMap();
  const anchoredScenarioGroups = new Map();
  const unanchoredScenarioGroups = new Map();
  const orderedTopLevelGroups = [];

  const pushTopLevelGroup = (groupMeta) => {
    if (!groupMeta?.id || topLevelOrder.has(groupMeta.id)) return;
    topLevelOrder.set(groupMeta.id, orderedTopLevelGroups.length);
    orderedTopLevelGroups.push(groupMeta);
  };

  entries.forEach((entry) => {
    const groupMeta = getInspectorTopLevelGroupMeta(entry);
    if (groupMeta.id === entry?.continentId) return;
    if (groupMeta.anchorId) {
      const list = anchoredScenarioGroups.get(groupMeta.anchorId) || [];
      if (!list.some((item) => item.id === groupMeta.id)) {
        list.push(groupMeta);
        anchoredScenarioGroups.set(groupMeta.anchorId, list);
      }
      return;
    }
    if (!unanchoredScenarioGroups.has(groupMeta.id)) {
      unanchoredScenarioGroups.set(groupMeta.id, groupMeta);
    }
  });

  configuredContinents.forEach((continent) => {
    const continentId = String(continent?.id || "").trim();
    if (!continentId) return;

    (anchoredScenarioGroups.get(continentId) || [])
      .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel))
      .forEach(pushTopLevelGroup);

    const continentLabel = String(continent?.label || "").trim() || continentId;
    pushTopLevelGroup({
      id: continentId,
      label: continentLabel,
      displayLabel: t(continentLabel, "geo") || continentLabel,
      anchorId: "",
    });
  });

  Array.from(unanchoredScenarioGroups.values())
    .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel))
    .forEach(pushTopLevelGroup);

  entries.forEach((entry) => {
    const groupMeta = getInspectorTopLevelGroupMeta(entry);
    if (!topLevelOrder.has(groupMeta.id)) {
      pushTopLevelGroup(groupMeta);
    }
  });

  entries.forEach((entry) => {
    const groupMeta = getInspectorTopLevelGroupMeta(entry);

    if (!tree.has(groupMeta.id)) {
      tree.set(groupMeta.id, {
        id: groupMeta.id,
        label: groupMeta.label,
        displayLabel: groupMeta.displayLabel,
        sortIndex: topLevelOrder.has(groupMeta.id) ? topLevelOrder.get(groupMeta.id) : Number.MAX_SAFE_INTEGER,
        countries: [],
      });
    }

    tree.get(groupMeta.id).countries.push(entry);
  });

  return Array.from(tree.values())
    .map((groupNode) => ({
      ...groupNode,
      countries: sortCountriesWithinContinent(groupNode.countries, priorityOrderMap),
    }))
    .sort((a, b) => {
      if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
      return a.displayLabel.localeCompare(b.displayLabel);
    });
}

function getDefaultExpandedInspectorGroupId(groupedEntries = []) {
  const selectedCode = normalizeCountryCode(state.selectedInspectorCountryCode);
  const selectedGroupId = getInspectorTopLevelGroupIdForCode(selectedCode);
  if (selectedGroupId) return selectedGroupId;

  const activeCode = normalizeCountryCode(state.activeSovereignCode);
  const activeGroupId = getInspectorTopLevelGroupIdForCode(activeCode);
  if (activeGroupId) return activeGroupId;

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

  const defaultGroupId = getDefaultExpandedInspectorGroupId(groupedEntries);
  if (defaultGroupId) {
    state.expandedInspectorContinents.add(getInspectorGroupExpansionKey(defaultGroupId));
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
  if (blockLockedScenarioInteraction()) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "scenario-locked",
      mode: "ownership",
    };
  }
  const {
    requestedIds,
    matchedIds: normalizedTargetIds,
    missingIds,
  } = filterToVisibleFeatureIds(targetIds);
  const normalizedOwnerCode = normalizeCountryCode(ownerCode);
  if (!normalizedTargetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "empty-target",
      mode: "ownership",
    };
  }
  if (!normalizedOwnerCode) {
    return {
      applied: false,
      changed: 0,
      matchedCount: normalizedTargetIds.length,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
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
    requestedCount: requestedIds.length,
    missingCount: missingIds.length,
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
  if (blockLockedScenarioInteraction()) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "scenario-locked",
      mode: "ownership",
    };
  }
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
    const feature = landIndex.get(id);
    if (feature && !shouldExcludeScenarioPoliticalFeature(feature, id)) {
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

  const frontlineTabStack = document.getElementById("frontlineTabStack");
  const buildRow = () => {
    const row = document.createElement("div");
    row.className = "mt-2 flex flex-wrap items-center gap-2";
    return row;
  };
  const buildSelect = (id, options) => {
    const select = document.createElement("select");
    select.id = id;
    select.className = "select-input";
    options.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = t(label, "ui");
      select.appendChild(option);
    });
    return select;
  };
  const buildButton = (id, label, variant = "btn-secondary") => {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = variant;
    button.textContent = t(label, "ui");
    return button;
  };
  const buildInput = (id, placeholder, type = "text") => {
    const input = document.createElement("input");
    input.id = id;
    input.type = type;
    input.className = "input";
    if (placeholder) {
      input.placeholder = t(placeholder, "ui");
    }
    return input;
  };
  const buildSegmentedChoiceField = (id, options, {
    groupClassName = "frontline-segmented-field",
    buttonClassName = "frontline-segmented-choice",
  } = {}) => {
    const shell = document.createElement("div");
    shell.className = groupClassName;
    const select = buildSelect(id, options);
    select.classList.add("frontline-segmented-native");
    shell.appendChild(select);
    options.forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = buttonClassName;
      button.dataset.value = value;
      button.dataset.frontlineStyleChoice = "true";
      button.textContent = t(label, "ui");
      shell.appendChild(button);
    });
    return { shell, select };
  };
  const buildDetailGroup = (id, label, { open = false } = {}) => {
    const shell = document.createElement("details");
    shell.id = id;
    shell.className = "unit-counter-detail-group";
    shell.open = !!open;
    const summary = document.createElement("summary");
    summary.className = "unit-counter-detail-group-summary";
    summary.textContent = t(label, "ui");
    const body = document.createElement("div");
    body.className = "unit-counter-detail-group-body";
    shell.appendChild(summary);
    shell.appendChild(body);
    return { shell, body };
  };
  const unitCounterPresets = Object.freeze(UNIT_COUNTER_PRESETS.map((preset) => ({
    ...preset,
    id: String(preset.id || "").trim().toUpperCase(),
    defaultEchelon: String(preset.defaultEchelon || "").trim().toUpperCase(),
    category: String(preset.category || "ground").trim().toLowerCase() || "ground",
    keywords: Array.isArray(preset.keywords) ? preset.keywords.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean) : [],
    featured: preset.featured !== false,
  })));
  const featuredUnitCounterPresets = Object.freeze(unitCounterPresets.filter((preset) => preset.featured));
  const unitCounterCatalogCategories = Object.freeze(getUnitCounterCatalogCategories());
  const unitCounterEchelons = Object.freeze(UNIT_COUNTER_ECHELONS.map(([value, label]) => [
    String(value || "").trim().toUpperCase(),
    label,
  ]));
  const unitCounterSizeLabels = Object.freeze({
    small: "Small",
    medium: "Medium",
    large: "Large",
  });
  const unitCounterCombatPresets = Object.freeze([
    { id: "elite", label: "Elite", organizationPct: 94, equipmentPct: 92 },
    { id: "regular", label: "Regular", organizationPct: 82, equipmentPct: 78 },
    { id: "worn", label: "Worn", organizationPct: 68, equipmentPct: 62 },
    { id: "understrength", label: "Understrength", organizationPct: 58, equipmentPct: 48 },
    { id: "improvised", label: "Improvised", organizationPct: 47, equipmentPct: 42 },
  ]);
  const clampUnitCounterStatValue = (value, fallback = 78) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return Math.max(0, Math.min(100, Number(fallback) || 0));
    }
    return Math.max(0, Math.min(100, Math.round(nextValue)));
  };
  const clampUnitCounterFixedScaleMultiplier = (value, fallback = 1.5) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return Math.max(0.5, Math.min(2.0, Number(fallback) || 1.5));
    }
    return Math.max(0.5, Math.min(2.0, nextValue));
  };
  const normalizeUnitCounterStatsPresetId = (value = "") => {
    const normalizedValue = String(value || "").trim().toLowerCase();
    return unitCounterCombatPresets.some((preset) => preset.id === normalizedValue) ? normalizedValue : "regular";
  };
  const getUnitCounterCombatPreset = (value = "") => {
    const presetId = normalizeUnitCounterStatsPresetId(value);
    return unitCounterCombatPresets.find((preset) => preset.id === presetId) || unitCounterCombatPresets[1];
  };
  const rollBiasedUnitCounterStat = (minimum = 40, maximum = 100) => {
    const span = Math.max(0, Number(maximum) - Number(minimum));
    const biasedRoll = 0.55 * Math.random() + 0.25 * Math.random() + 0.2 * Math.random();
    return clampUnitCounterStatValue(Number(minimum) + span * biasedRoll, minimum);
  };
  const getRandomizedUnitCounterCombatState = () => ({
    organizationPct: rollBiasedUnitCounterStat(44, 100),
    equipmentPct: rollBiasedUnitCounterStat(40, 96),
    statsPresetId: "random",
    statsSource: "random",
  });
  const resolveUnitCounterCombatState = (candidate = {}) => {
    const preset = getUnitCounterCombatPreset(candidate.statsPresetId || "regular");
    const statsSource = ["preset", "random", "manual"].includes(String(candidate.statsSource || "").trim().toLowerCase())
      ? String(candidate.statsSource || "").trim().toLowerCase()
      : "preset";
    return {
      organizationPct: clampUnitCounterStatValue(candidate.organizationPct, preset.organizationPct),
      equipmentPct: clampUnitCounterStatValue(candidate.equipmentPct, preset.equipmentPct),
      statsPresetId: String(candidate.statsPresetId || preset.id || "").trim().toLowerCase() || preset.id,
      statsSource,
      baseFillColor: String(candidate.baseFillColor || "").trim(),
    };
  };
  const getUnitCounterPresetMeta = (presetId = "") => {
    const normalizedPresetId = String(presetId || "").trim().toUpperCase();
    return unitCounterPresets.find((preset) => preset.id === normalizedPresetId)
      || {
        ...getUnitCounterPresetById(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID),
        id: String(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toUpperCase(),
        defaultEchelon: String(getUnitCounterPresetById(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID).defaultEchelon || "").trim().toUpperCase(),
      };
  };
  const getSidebarUnitCounterPresetOptions = (selectedPresetId = "") => {
    const normalizedSelectedId = String(selectedPresetId || "").trim().toUpperCase();
    const options = featuredUnitCounterPresets.slice();
    if (normalizedSelectedId && !options.some((preset) => preset.id === normalizedSelectedId)) {
      options.unshift(getUnitCounterPresetMeta(normalizedSelectedId));
    }
    return options;
  };
  const getFilteredUnitCounterCatalog = ({
    category = "all",
    query = "",
  } = {}) => {
    const normalizedCategory = String(category || "all").trim().toLowerCase() || "all";
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return unitCounterPresets.filter((preset) => {
      if (normalizedCategory !== "all" && preset.category !== normalizedCategory) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystacks = [
        preset.id,
        preset.label,
        preset.shortCode,
        preset.unitType,
        preset.category,
        ...(preset.keywords || []),
      ]
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean);
      return haystacks.some((entry) => entry.includes(normalizedQuery));
    });
  };
  let hoi4UnitIconManifestStatus = "idle";
  let hoi4UnitIconManifestData = null;
  let hoi4UnitIconManifestError = null;
  let hoi4UnitIconReviewDraft = loadHoi4UnitIconReviewDraft();
  const normalizeHoi4ReviewPresetIds = (values = []) => Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const persistHoi4UnitIconReviewDraft = () => {
    hoi4UnitIconReviewDraft = saveHoi4UnitIconReviewDraft(hoi4UnitIconReviewDraft);
  };
  const getHoi4EffectiveMappedPresetIds = (entry) => getHoi4UnitIconMappedPresetIds(entry, hoi4UnitIconReviewDraft);
  const formatUnitCounterPresetChipLabel = (presetId = "") => {
    const normalizedPresetId = String(presetId || "").trim().toUpperCase();
    if (!normalizedPresetId) return t("Unmapped", "ui");
    const preset = getUnitCounterPresetMeta(normalizedPresetId);
    return preset?.label || normalizedPresetId;
  };
  const getHoi4CurrentPresetCandidateEntryId = (presetId = "") => {
    const normalizedPresetId = String(presetId || "").trim().toLowerCase();
    return normalizedPresetId
      ? String(hoi4UnitIconReviewDraft?.presetCandidates?.[normalizedPresetId] || "").trim()
      : "";
  };
  const setHoi4EntryMappedPresetIds = (entryId = "", mappedPresetIds = []) => {
    const normalizedEntryId = String(entryId || "").trim();
    if (!normalizedEntryId) return;
    const nextPresetIds = normalizeHoi4ReviewPresetIds(mappedPresetIds);
    const entry = hoi4UnitIconManifestData?.entries?.find((candidate) => candidate.id === normalizedEntryId) || null;
    const basePresetIds = entry ? normalizeHoi4ReviewPresetIds(entry.mappedPresetIds) : [];
    if (!nextPresetIds.length && !basePresetIds.length) {
      delete hoi4UnitIconReviewDraft.entryOverrides[normalizedEntryId];
    } else if (JSON.stringify(nextPresetIds) === JSON.stringify(basePresetIds)) {
      delete hoi4UnitIconReviewDraft.entryOverrides[normalizedEntryId];
    } else {
      hoi4UnitIconReviewDraft.entryOverrides[normalizedEntryId] = { mappedPresetIds: nextPresetIds };
    }
  };
  const toggleHoi4EntryCurrentPresetMapping = (entryId = "", presetId = "") => {
    const normalizedEntryId = String(entryId || "").trim();
    const normalizedPresetId = String(presetId || "").trim().toLowerCase();
    if (!normalizedEntryId || !normalizedPresetId) return false;
    const entry = hoi4UnitIconManifestData?.entries?.find((candidate) => candidate.id === normalizedEntryId) || null;
    if (!entry) return false;
    const nextPresetIds = new Set(getHoi4EffectiveMappedPresetIds(entry));
    if (nextPresetIds.has(normalizedPresetId)) {
      nextPresetIds.delete(normalizedPresetId);
      if (getHoi4CurrentPresetCandidateEntryId(normalizedPresetId) === normalizedEntryId) {
        delete hoi4UnitIconReviewDraft.presetCandidates[normalizedPresetId];
      }
    } else {
      nextPresetIds.add(normalizedPresetId);
    }
    setHoi4EntryMappedPresetIds(normalizedEntryId, Array.from(nextPresetIds));
    persistHoi4UnitIconReviewDraft();
    return nextPresetIds.has(normalizedPresetId);
  };
  const setHoi4CurrentPresetCandidate = (entryId = "", presetId = "") => {
    const normalizedEntryId = String(entryId || "").trim();
    const normalizedPresetId = String(presetId || "").trim().toLowerCase();
    if (!normalizedEntryId || !normalizedPresetId) return;
    const entry = hoi4UnitIconManifestData?.entries?.find((candidate) => candidate.id === normalizedEntryId) || null;
    if (!entry) return;
    const nextPresetIds = new Set(getHoi4EffectiveMappedPresetIds(entry));
    nextPresetIds.add(normalizedPresetId);
    setHoi4EntryMappedPresetIds(normalizedEntryId, Array.from(nextPresetIds));
    hoi4UnitIconReviewDraft.presetCandidates[normalizedPresetId] = normalizedEntryId;
    persistHoi4UnitIconReviewDraft();
  };
  const exportHoi4UnitIconReviewDraft = () => {
    const normalizedDraft = saveHoi4UnitIconReviewDraft(hoi4UnitIconReviewDraft || createEmptyHoi4UnitIconReviewDraft());
    const blob = new Blob([JSON.stringify(normalizedDraft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hoi4_unit_icon_review.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 100);
    showToast(t("HOI4 review draft downloaded.", "ui"), {
      title: t("Review exported", "ui"),
      tone: "success",
    });
  };
  const ensureHoi4UnitIconManifest = () => {
    if (hoi4UnitIconManifestStatus === "loading" || hoi4UnitIconManifestStatus === "ready") {
      return;
    }
    hoi4UnitIconManifestStatus = "loading";
    hoi4UnitIconManifestError = null;
    loadHoi4UnitIconManifest()
      .then((manifest) => {
        hoi4UnitIconManifestData = manifest;
        hoi4UnitIconManifestStatus = "ready";
        scheduleStrategicOverlayRefresh("counterCatalog");
      })
      .catch((error) => {
        console.error("Failed to load HOI4 unit icon manifest:", error);
        hoi4UnitIconManifestStatus = "error";
        hoi4UnitIconManifestError = error;
        scheduleStrategicOverlayRefresh("counterCatalog");
      });
  };
  const getHoi4CatalogFilterOptionsLegacy = (effectivePresetId = "") => {
    const currentPreset = getUnitCounterPresetMeta(effectivePresetId || DEFAULT_UNIT_COUNTER_PRESET_ID);
    return [
      ["all", t("All", "ui")],
      ["current", currentPreset?.label ? `${t("Current Preset", "ui")} · ${currentPreset.label}` : t("Current Preset", "ui")],
      ["ground", "Ground"],
      ["air", "Air"],
      ["naval", "Naval"],
    ];
  };
  const formatHoi4EntryKind = (value = "") => String(value || "").replace(/_/g, " ");
  const getHoi4ReviewSummaryText = (effectivePresetId = "") => {
    const presetMeta = getUnitCounterPresetMeta(effectivePresetId || DEFAULT_UNIT_COUNTER_PRESET_ID);
    const candidateEntryId = getHoi4CurrentPresetCandidateEntryId(presetMeta.id);
    const candidateEntry = hoi4UnitIconManifestData?.entries?.find((entry) => entry.id === candidateEntryId) || null;
    const overrideCount = Object.keys(hoi4UnitIconReviewDraft?.entryOverrides || {}).length;
    return [
      `${t("Current Preset", "ui")}: ${presetMeta.label}`,
      candidateEntry ? `${t("Candidate", "ui")}: ${candidateEntry.label}` : `${t("Candidate", "ui")}: ${t("None selected", "ui")}`,
      `${t("Draft Overrides", "ui")}: ${overrideCount}`,
    ].join(" · ");
  };
  const cancelHoi4CatalogGridRender = (grid) => {
    if (!grid) return;
    if (typeof grid._hoi4RenderHandle === "number" && grid._hoi4RenderHandle) {
      globalThis.cancelAnimationFrame(grid._hoi4RenderHandle);
    }
    grid._hoi4RenderHandle = 0;
    grid._hoi4RenderToken = Number(grid._hoi4RenderToken || 0) + 1;
  };
  const buildHoi4CatalogCardRecord = (entry) => {
    const card = document.createElement("article");
    card.className = "counter-editor-symbol-card counter-editor-hoi4-card";
    card.dataset.hoi4EntryId = entry.id;

    const preview = document.createElement("div");
    preview.className = "counter-editor-hoi4-preview is-single";
    const image = document.createElement("img");
    image.alt = entry.label;
    image.loading = "lazy";
    image.decoding = "async";
    const missing = document.createElement("span");
    missing.className = "counter-editor-hoi4-preview-missing";
    const previewLabel = document.createElement("span");
    previewLabel.className = "counter-editor-hoi4-preview-label";
    preview.append(image, missing, previewLabel);

    const title = document.createElement("span");
    title.className = "counter-editor-symbol-card-title";
    const subtitle = document.createElement("span");
    subtitle.className = "counter-editor-symbol-card-subtitle";
    const meta = document.createElement("div");
    meta.className = "counter-editor-hoi4-meta";
    const tags = document.createElement("div");
    tags.className = "counter-editor-hoi4-tags";
    const actions = document.createElement("div");
    actions.className = "counter-editor-hoi4-actions";
    const mappingBtn = document.createElement("button");
    mappingBtn.type = "button";
    mappingBtn.className = "counter-editor-hoi4-action-btn";
    mappingBtn.dataset.hoi4ReviewAction = "toggle-current-mapping";
    mappingBtn.dataset.hoi4EntryId = entry.id;
    const candidateBtn = document.createElement("button");
    candidateBtn.type = "button";
    candidateBtn.className = "counter-editor-hoi4-action-btn";
    candidateBtn.dataset.hoi4ReviewAction = "set-current-candidate";
    candidateBtn.dataset.hoi4EntryId = entry.id;
    actions.append(mappingBtn, candidateBtn);
    card.append(preview, title, subtitle, meta, tags, actions);

    return {
      card,
      image,
      missing,
      previewLabel,
      title,
      subtitle,
      meta,
      tags,
      mappingBtn,
      candidateBtn,
    };
  };
  const updateHoi4CatalogCardRecord = (record, entry, { effectivePresetId, preferredVariant }) => {
    const currentPresetId = String(effectivePresetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toLowerCase();
    const variantPath = getHoi4UnitIconVariantPath(entry, preferredVariant);
    const mappedPresetIds = getHoi4EffectiveMappedPresetIds(entry);
    const isMappedToCurrentPreset = mappedPresetIds.includes(currentPresetId);
    const isCurrentPresetCandidate = getHoi4CurrentPresetCandidateEntryId(currentPresetId) === entry.id;
    record.card.classList.toggle("is-candidate", isCurrentPresetCandidate);
    if (variantPath) {
      if (record.image.getAttribute("src") !== variantPath) {
        record.image.src = variantPath;
      }
      record.image.hidden = false;
      record.missing.hidden = true;
    } else {
      record.image.hidden = true;
      record.image.removeAttribute("src");
      record.missing.hidden = false;
      record.missing.textContent = preferredVariant === "large"
        ? t("Missing Large", "ui")
        : t("Missing Small", "ui");
    }
    record.previewLabel.textContent = preferredVariant === "large"
      ? t("Large", "ui")
      : t("On-map Small", "ui");
    record.title.textContent = entry.label;
    record.subtitle.textContent = `${entry.domain} · ${formatHoi4EntryKind(entry.kind)}`;
    record.meta.textContent = entry.spriteName;
    record.tags.replaceChildren();
    const visiblePresetIds = mappedPresetIds.length ? mappedPresetIds : [""];
    visiblePresetIds.forEach((presetId) => {
      const tag = document.createElement("span");
      tag.className = "counter-editor-hoi4-tag";
      tag.textContent = presetId ? formatUnitCounterPresetChipLabel(presetId) : t("Unmapped", "ui");
      record.tags.appendChild(tag);
    });
    if (isCurrentPresetCandidate) {
      const candidateTag = document.createElement("span");
      candidateTag.className = "counter-editor-hoi4-tag is-candidate";
      candidateTag.textContent = t("Current Candidate", "ui");
      record.tags.appendChild(candidateTag);
    }
    const currentPresetLabel = formatUnitCounterPresetChipLabel(currentPresetId);
    record.mappingBtn.textContent = isMappedToCurrentPreset
      ? `${t("Unmap", "ui")} ${currentPresetLabel}`
      : `${t("Map", "ui")} ${currentPresetLabel}`;
    record.mappingBtn.classList.toggle("is-active", isMappedToCurrentPreset);
    record.candidateBtn.textContent = isCurrentPresetCandidate
      ? t("Current Candidate", "ui")
      : `${t("Set Candidate", "ui")} · ${currentPresetLabel}`;
    record.candidateBtn.classList.toggle("is-active", isCurrentPresetCandidate);
  };
  const renderHoi4CatalogCards = (grid, entries, options) => {
    cancelHoi4CatalogGridRender(grid);
    const emptyState = document.createElement("div");
    emptyState.className = "counter-editor-symbol-empty";
    if (!entries.length) {
      emptyState.textContent = t("No HOI4 icons match the current filter.", "ui");
      grid.replaceChildren(emptyState);
      return;
    }
    const cache = grid._hoi4CardCache instanceof Map ? grid._hoi4CardCache : new Map();
    grid._hoi4CardCache = cache;
    grid.replaceChildren();
    const renderToken = Number(grid._hoi4RenderToken || 0) + 1;
    grid._hoi4RenderToken = renderToken;
    const chunkSize = 24;
    const appendChunk = (startIndex = 0) => {
      if (grid._hoi4RenderToken !== renderToken) return;
      const fragment = document.createDocumentFragment();
      const endIndex = Math.min(startIndex + chunkSize, entries.length);
      for (let index = startIndex; index < endIndex; index += 1) {
        const entry = entries[index];
        let record = cache.get(entry.id);
        if (!record) {
          record = buildHoi4CatalogCardRecord(entry);
          cache.set(entry.id, record);
        }
        updateHoi4CatalogCardRecord(record, entry, options);
        fragment.appendChild(record.card);
      }
      grid.appendChild(fragment);
      if (endIndex < entries.length) {
        grid._hoi4RenderHandle = globalThis.requestAnimationFrame(() => appendChunk(endIndex));
      } else {
        grid._hoi4RenderHandle = 0;
      }
    };
    appendChunk(0);
  };
  const getHoi4CatalogFilterOptions = (effectivePresetId = "") => {
    const currentPreset = getUnitCounterPresetMeta(effectivePresetId || DEFAULT_UNIT_COUNTER_PRESET_ID);
    return [
      ["all", t("All", "ui")],
      ["current", currentPreset?.label ? `${t("Current Preset", "ui")} · ${currentPreset.label}` : t("Current Preset", "ui")],
      ["ground", "Ground"],
      ["air", "Air"],
      ["naval", "Naval"],
    ];
  };
  const inferUnitCounterPresetId = (candidate = {}) => {
    const rawPreset = String(candidate?.presetId || candidate?.unitType || "").trim().toUpperCase();
    if (rawPreset && unitCounterPresets.some((preset) => preset.id === rawPreset)) {
      return rawPreset;
    }
    const rawToken = String(candidate?.symbolCode || candidate?.sidc || candidate?.label || "").trim().toUpperCase();
    const matchedPreset = unitCounterPresets.find((preset) => {
      if (!rawToken) return false;
      return rawToken === preset.id
        || rawToken === preset.shortCode
        || rawToken.includes(preset.shortCode);
    });
    return matchedPreset?.id || unitCounterPresets[0].id;
  };
  const getUnitCounterNationMeta = (nationTag = "") => {
    const normalizedTag = normalizeCountryCode(nationTag);
    if (!normalizedTag) {
      return {
        tag: "",
        displayName: t("Auto from placement", "ui"),
        color: "rgba(71, 85, 105, 0.78)",
      };
    }
    const scenarioMeta = getScenarioCountryMeta(normalizedTag);
    const fallbackName = state.countryNames?.[normalizedTag] || countryNames[normalizedTag] || normalizedTag;
    const scenarioName = scenarioMeta
      ? getScenarioCountryDisplayName(scenarioMeta, fallbackName) || fallbackName
      : fallbackName;
    return {
      tag: normalizedTag,
      displayName: t(scenarioName || normalizedTag, "geo") || scenarioName || normalizedTag,
      color: String(
        scenarioMeta?.color_hex
          || scenarioMeta?.colorHex
          || ensureCountryPaletteColor(normalizedTag)
          || "#64748b"
      ),
    };
  };
  const getUnitCounterNationOptions = () => getDynamicCountryEntries().map((entry) => {
    const meta = getUnitCounterNationMeta(entry.code);
    return {
      value: entry.code,
      label: `${entry.code} · ${meta.displayName}`,
    };
  });
  const getUnitCounterEchelonLabel = (value = "") => {
    const normalizedValue = String(value || "").trim().toUpperCase();
    return unitCounterEchelons.find(([code]) => code === normalizedValue)?.[1] || normalizedValue || t("Auto", "ui");
  };
  const formatUnitCounterListLabel = (counter = {}) => {
    const presetMeta = getUnitCounterPresetMeta(inferUnitCounterPresetId(counter));
    const nationMeta = getUnitCounterNationMeta(counter.nationTag);
    const primaryLabel = String(counter.label || "").trim() || presetMeta.label;
    const rendererLabel = String(counter.renderer || "game").trim().toUpperCase();
    const detailTokens = [
      presetMeta.shortCode,
      String(counter.echelon || "").trim() ? getUnitCounterEchelonLabel(counter.echelon) : "",
      rendererLabel,
    ].filter(Boolean);
    return [`${nationMeta.tag || "AUTO"} · ${primaryLabel}`, detailTokens.join(" · ")].filter(Boolean).join(" · ");
  };
  const UNIT_COUNTER_PREVIEW_SVG_CACHE_LIMIT = 48;
  const unitCounterPreviewSvgCache = new Map();
  const getUnitCounterPreviewSvg = (sidc = "") => {
    const normalizedSidc = String(sidc || "").trim();
    if (!normalizedSidc || !globalThis.ms?.Symbol) {
      return null;
    }
    if (unitCounterPreviewSvgCache.has(normalizedSidc)) {
      const cachedNode = unitCounterPreviewSvgCache.get(normalizedSidc);
      unitCounterPreviewSvgCache.delete(normalizedSidc);
      unitCounterPreviewSvgCache.set(normalizedSidc, cachedNode);
      return cachedNode.cloneNode(true);
    }
    try {
      const markup = new globalThis.ms.Symbol(normalizedSidc, {
        size: 18,
        fill: true,
        monoColor: "#0f172a",
        outlineColor: "#f8f5eb",
        outlineWidth: 3,
      }).asSVG();
      const parsed = new globalThis.DOMParser().parseFromString(markup, "image/svg+xml");
      const svg = parsed?.documentElement;
      if (!(svg instanceof SVGElement)) {
        return null;
      }
      unitCounterPreviewSvgCache.set(normalizedSidc, svg);
      if (unitCounterPreviewSvgCache.size > UNIT_COUNTER_PREVIEW_SVG_CACHE_LIMIT) {
        const oldestKey = unitCounterPreviewSvgCache.keys().next().value;
        unitCounterPreviewSvgCache.delete(oldestKey);
      }
      return svg.cloneNode(true);
    } catch (_error) {
      return null;
    }
  };
  const buildUnitCounterPreviewStat = (kind, label) => {
    const stat = document.createElement("div");
    stat.className = `unit-counter-preview-stat is-${kind}`;
    const statLabel = document.createElement("span");
    statLabel.className = "unit-counter-preview-stat-label";
    statLabel.textContent = label;
    const track = document.createElement("span");
    track.className = "unit-counter-preview-stat-track";
    const fill = document.createElement("span");
    fill.className = "unit-counter-preview-stat-fill";
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "unit-counter-preview-stat-value";
    stat.append(statLabel, track, value);
    return { stat, fill, value };
  };
  const ensureUnitCounterPreviewNodes = (container) => {
    if (container?._previewNodes) {
      return container._previewNodes;
    }
    container.replaceChildren();
    const card = document.createElement("div");
    card.className = "unit-counter-preview-card is-medium";

    const strip = document.createElement("div");
    strip.className = "unit-counter-preview-strip";
    card.appendChild(strip);

    const topLine = document.createElement("div");
    topLine.className = "unit-counter-preview-topline";
    const nationPill = document.createElement("span");
    nationPill.className = "unit-counter-preview-nation";
    const typePill = document.createElement("span");
    typePill.className = "unit-counter-preview-renderer";
    topLine.append(nationPill, typePill);
    card.appendChild(topLine);

    const body = document.createElement("div");
    body.className = "unit-counter-preview-body";
    const symbolShell = document.createElement("div");
    symbolShell.className = "unit-counter-preview-symbol";

    const content = document.createElement("div");
    content.className = "unit-counter-preview-copy";
    const title = document.createElement("div");
    title.className = "unit-counter-preview-title";
    const status = document.createElement("div");
    status.className = "unit-counter-preview-status";
    status.hidden = true;
    const meta = document.createElement("div");
    meta.className = "unit-counter-preview-meta";

    const statStack = document.createElement("div");
    statStack.className = "unit-counter-preview-stats";
    const orgStat = buildUnitCounterPreviewStat("org", t("ORG", "ui"));
    const equipmentStat = buildUnitCounterPreviewStat("equipment", t("EQP", "ui"));
    statStack.append(orgStat.stat, equipmentStat.stat);

    const footer = document.createElement("div");
    footer.className = "unit-counter-preview-footer";
    const echelonBadge = document.createElement("span");
    echelonBadge.className = "unit-counter-preview-chip";
    const strengthBadge = document.createElement("span");
    strengthBadge.className = "unit-counter-preview-chip is-alert";
    strengthBadge.hidden = true;
    footer.append(echelonBadge, strengthBadge);

    content.append(title, status, meta, statStack, footer);
    body.append(symbolShell, content);
    card.appendChild(body);
    container.appendChild(card);

    container._previewNodes = {
      card,
      nationPill,
      typePill,
      symbolShell,
      title,
      status,
      meta,
      statStack,
      orgStat,
      equipmentStat,
      footer,
      echelonBadge,
      strengthBadge,
      symbolKey: "",
    };
    return container._previewNodes;
  };
  const renderUnitCounterPreview = (container, {
    renderer = "game",
    size = "medium",
    nationTag = "",
    nationSource = "display",
    label = "",
    subLabel = "",
    strengthText = "",
    sidc = "",
    symbolCode = "",
    presetId = "",
    echelon = "",
    organizationPct = 78,
    equipmentPct = 74,
    baseFillColor = "",
    statusText = "",
    detailMode = false,
    compactMode = false,
  } = {}) => {
    if (!container) return;
    const presetMeta = getUnitCounterPresetMeta(presetId || inferUnitCounterPresetId({ presetId, symbolCode, sidc, label }));
    const nationMeta = getUnitCounterNationMeta(nationTag);
    const combatState = resolveUnitCounterCombatState({
      organizationPct,
      equipmentPct,
      baseFillColor,
    });
    const previewLabel = String(label || "").trim() || presetMeta.label;
    const previewSubLabel = String(subLabel || "").trim() || `${nationMeta.displayName} · ${getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon)}`;
    const previewStrength = String(strengthText || "").trim();
    const previewRenderer = String(renderer || presetMeta.defaultRenderer || "game").trim().toLowerCase();
    const previewSidc = String(sidc || "").trim().toUpperCase();
    const previewSymbolToken = String(symbolCode || sidc || presetMeta.shortCode || "").trim().toUpperCase() || presetMeta.shortCode;
    const previewSymbolKey = previewRenderer === "milstd"
      ? `milstd:${previewSidc}`
      : `game:${previewSymbolToken || presetMeta.shortCode}`;
    const nodes = ensureUnitCounterPreviewNodes(container);

    container.classList.toggle("is-detail", !!detailMode);
    container.classList.toggle("is-compact", !!compactMode);
    container.classList.toggle("is-milstd", previewRenderer === "milstd");
    container.classList.toggle("is-game", previewRenderer !== "milstd");
    container.style.setProperty("--unit-counter-accent", nationMeta.color || "#64748b");
    container.style.setProperty("--unit-counter-fill", combatState.baseFillColor || "#f4f0e6");
    container.style.setProperty("--unit-counter-org-ratio", `${combatState.organizationPct}%`);
    container.style.setProperty("--unit-counter-equip-ratio", `${combatState.equipmentPct}%`);

    nodes.card.className = `unit-counter-preview-card is-${String(size || "medium").trim().toLowerCase()}${detailMode ? " is-detail" : ""}${compactMode ? " is-compact" : ""}`;
    nodes.nationPill.textContent = nationMeta.tag || t("AUTO", "ui");
    nodes.typePill.textContent = presetMeta.shortCode;
    nodes.title.textContent = previewLabel;
    nodes.meta.textContent = compactMode
      ? `${nationMeta.tag || t("AUTO", "ui")} · ${getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon)}`
      : previewSubLabel;
    nodes.status.hidden = !statusText;
    nodes.status.textContent = statusText || "";
    nodes.statStack.hidden = !!compactMode;
    nodes.footer.hidden = !!compactMode;
    nodes.echelonBadge.textContent = getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon).slice(0, detailMode ? 24 : 3).toUpperCase();
    nodes.strengthBadge.hidden = !previewStrength;
    nodes.strengthBadge.textContent = previewStrength || "";
    nodes.orgStat.stat.style.setProperty("--unit-counter-stat-ratio", `${combatState.organizationPct}%`);
    nodes.orgStat.value.textContent = String(combatState.organizationPct);
    nodes.equipmentStat.stat.style.setProperty("--unit-counter-stat-ratio", `${combatState.equipmentPct}%`);
    nodes.equipmentStat.value.textContent = String(combatState.equipmentPct);

    if (nodes.symbolKey !== previewSymbolKey) {
      nodes.symbolShell.replaceChildren();
      if (previewRenderer === "milstd" && previewSidc) {
        const svg = getUnitCounterPreviewSvg(previewSidc);
        if (svg) {
          nodes.symbolShell.appendChild(svg);
        } else {
          nodes.symbolShell.textContent = presetMeta.shortCode;
        }
      } else {
        nodes.symbolShell.textContent = previewSymbolToken || presetMeta.shortCode;
      }
      nodes.symbolKey = previewSymbolKey;
    }
  };

  let frontlineOverlaySection = document.getElementById("frontlineOverlayPanel");
  if (!frontlineOverlaySection && frontlineTabStack) {
    frontlineOverlaySection = document.createElement("div");
    frontlineOverlaySection.id = "frontlineOverlayPanel";
    frontlineOverlaySection.className = "inspector-tool-card frontline-tab-card";

    const statusRow = document.createElement("div");
    statusRow.className = "frontline-status-row";

    const statusTitleGroup = document.createElement("div");
    statusTitleGroup.className = "frontline-status-copy";

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Frontline Overlay", "ui");

    const statusPill = document.createElement("span");
    statusPill.id = "frontlineEnabledStatus";
    statusPill.className = "frontline-status-pill";
    statusPill.textContent = t("Off", "ui");

    statusTitleGroup.appendChild(title);
    statusTitleGroup.appendChild(statusPill);

    const statusHint = document.createElement("p");
    statusHint.id = "frontlineStatusHint";
    statusHint.className = "sidebar-tool-hint";
    statusHint.textContent = t("Frontline rendering is disabled until you explicitly enable it for this project.", "ui");

    statusRow.appendChild(statusTitleGroup);

    const enableRow = buildRow();
    const enableToggle = document.createElement("label");
    enableToggle.className = "toggle-label";
    enableToggle.innerHTML = `<input id="frontlineEnabledToggle" type="checkbox" class="checkbox-input" /> <span>${t("Enable Frontline Overlay", "ui")}</span>`;
    enableRow.appendChild(enableToggle);

    const emptyState = document.createElement("div");
    emptyState.id = "frontlineEmptyState";
    emptyState.className = "inspector-empty-state frontline-empty-state";
    emptyState.innerHTML = `
      <h3 class="section-header-block">${t("Frontline is off", "ui")}</h3>
      <p class="sidebar-tool-hint">${t("Turn it on when you want to derive conflict lines from the active scenario.", "ui")}</p>
    `;

    const settings = document.createElement("div");
    settings.id = "frontlineSettingsPanel";
    settings.className = "frontline-settings-stack hidden";

    const controlsHeader = document.createElement("div");
    controlsHeader.className = "section-header mt-2";
    controlsHeader.textContent = t("View", "ui");

    const controlsHint = document.createElement("p");
    controlsHint.className = "sidebar-tool-hint";
    controlsHint.textContent = t("Keep the line restrained by default, then opt into labels only when the theater needs annotation.", "ui");

    const controlsRow = buildRow();
    controlsRow.classList.add("frontline-compact-row");
    const frontlineStyleField = buildSegmentedChoiceField("strategicFrontlineStyleSelect", [
      ["clean", "Clean"],
      ["dual-rail", "Dual Rail"],
      ["teeth", "Teeth"],
    ]);
    const frontlineStyleSelect = frontlineStyleField.select;
    const frontlineLabelToggle = document.createElement("label");
    frontlineLabelToggle.className = "checkbox-row";
    frontlineLabelToggle.innerHTML = `<input id="strategicFrontlineLabelsToggle" type="checkbox" class="checkbox-input" /> <span>${t("Labels", "ui")}</span>`;
    const frontlineLabelPlacement = buildSelect("strategicLabelPlacementSelect", [
      ["midpoint", "Midpoint"],
      ["centroid", "Centroid"],
    ]);
    frontlineLabelPlacement.classList.add("frontline-inline-select");
    controlsRow.appendChild(frontlineStyleField.shell);
    controlsRow.appendChild(frontlineLabelToggle);

    const controlsAdvanced = document.createElement("details");
    controlsAdvanced.className = "unit-counter-advanced-shell frontline-advanced-shell";
    const controlsAdvancedSummary = document.createElement("summary");
    controlsAdvancedSummary.className = "unit-counter-advanced-summary";
    controlsAdvancedSummary.textContent = t("Advanced Label Placement", "ui");
    const controlsAdvancedBody = document.createElement("div");
    controlsAdvancedBody.className = "unit-counter-advanced-body";
    controlsAdvancedBody.appendChild(frontlineLabelPlacement);
    controlsAdvanced.appendChild(controlsAdvancedSummary);
    controlsAdvanced.appendChild(controlsAdvancedBody);

    settings.appendChild(controlsHeader);
    settings.appendChild(controlsHint);
    settings.appendChild(controlsRow);
    settings.appendChild(controlsAdvanced);

    frontlineOverlaySection.appendChild(statusRow);
    frontlineOverlaySection.appendChild(statusHint);
    frontlineOverlaySection.appendChild(enableRow);
    frontlineOverlaySection.appendChild(emptyState);
    frontlineOverlaySection.appendChild(settings);
    frontlineTabStack.appendChild(frontlineOverlaySection);
  }

  let strategicOverlaySection = document.getElementById("strategicOverlayPanel");
  if (!strategicOverlaySection && frontlineTabStack) {
    strategicOverlaySection = document.createElement("div");
    strategicOverlaySection.id = "strategicOverlayPanel";
    strategicOverlaySection.className = "inspector-tool-card frontline-tab-card";

    const headerRow = document.createElement("div");
    headerRow.className = "strategic-workspace-header";

    const headerCopy = document.createElement("div");
    headerCopy.className = "strategic-workspace-header-copy";

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Strategic Overlay", "ui");

    const hint = document.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Operation graphics and unit counters stay in the same frontline workspace and remain project-local.", "ui");

    const workspaceIconCloseBtn = buildButton("strategicOverlayIconCloseBtn", "Close");
    workspaceIconCloseBtn.classList.add("secondary", "strategic-workspace-icon-close", "hidden");
    headerCopy.appendChild(title);
    headerCopy.appendChild(hint);
    headerRow.appendChild(headerCopy);
    headerRow.appendChild(workspaceIconCloseBtn);

    const workspaceActions = buildRow();
    workspaceActions.className = "strategic-workspace-actions mt-2";
    const workspaceOpenBtn = buildButton("strategicOverlayOpenWorkspaceBtn", "Open Workspace");
    workspaceOpenBtn.classList.add("secondary");
    const workspaceCloseBtn = buildButton("strategicOverlayCloseWorkspaceBtn", "Close Workspace");
    workspaceCloseBtn.classList.add("secondary", "hidden");
    workspaceActions.appendChild(workspaceOpenBtn);
    workspaceActions.appendChild(workspaceCloseBtn);

    const operationalLineBlock = document.createElement("div");
    operationalLineBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-lines";
    const operationalLineHeader = document.createElement("div");
    operationalLineHeader.className = "section-header mt-3";
    operationalLineHeader.textContent = t("Operational Lines", "ui");
    const operationalLineHint = document.createElement("p");
    operationalLineHint.className = "sidebar-tool-hint";
    operationalLineHint.textContent = t("These are separate from political frontlines and act as your single-line battle planning layer.", "ui");
    const operationalLineRow = buildRow();
    operationalLineRow.classList.add("frontline-compact-row", "strategic-line-primary-row");
    const operationalLineKindSelect = buildSelect("operationalLineKindSelect", [
      ["frontline", "Frontline"],
      ["offensive_line", "Offensive Line"],
      ["spearhead_line", "Spearhead Line"],
      ["defensive_line", "Defensive Line"],
    ]);
    const operationalLineLabelInput = buildInput("operationalLineLabelInput", "Label");
    operationalLineRow.appendChild(operationalLineKindSelect);
    operationalLineRow.appendChild(operationalLineLabelInput);
    operationalLineRow.appendChild(buildButton("operationalLineStartBtn", "Start Draw"));

    const operationalLineStyleRow = buildRow();
    operationalLineStyleRow.classList.add("frontline-compact-row");
    const operationalLineStrokeInput = buildInput("operationalLineStrokeInput", "", "color");
    operationalLineStrokeInput.value = "#7f1d1d";
    operationalLineStrokeInput.className = "input strategic-inline-color";
    operationalLineStrokeInput.setAttribute("aria-label", t("Operational line stroke", "ui"));
    const operationalLineWidthInput = buildInput("operationalLineWidthInput", "Width", "number");
    operationalLineWidthInput.min = "0";
    operationalLineWidthInput.max = "16";
    operationalLineWidthInput.step = "0.2";
    const operationalLineOpacityInput = buildInput("operationalLineOpacityInput", "Opacity", "number");
    operationalLineOpacityInput.min = "0";
    operationalLineOpacityInput.max = "1";
    operationalLineOpacityInput.step = "0.05";
    operationalLineStyleRow.appendChild(operationalLineStrokeInput);
    operationalLineStyleRow.appendChild(operationalLineWidthInput);
    operationalLineStyleRow.appendChild(operationalLineOpacityInput);

    const operationalLineEditorHint = document.createElement("p");
    operationalLineEditorHint.id = "operationalLineEditorHint";
    operationalLineEditorHint.className = "sidebar-tool-hint mt-2";
    operationalLineEditorHint.textContent = t("Use the bottom command bar for fast entry, or start drawing here for the selected line type.", "ui");

    const operationalLineActions = buildRow();
    operationalLineActions.className = "sidebar-equal-actions mt-3 strategic-line-management-actions";
    operationalLineActions.appendChild(buildButton("operationalLineUndoBtn", "Undo Vertex"));
    operationalLineActions.appendChild(buildButton("operationalLineFinishBtn", "Finish"));
    operationalLineActions.appendChild(buildButton("operationalLineCancelBtn", "Cancel"));
    operationalLineActions.appendChild(buildButton("operationalLineDeleteBtn", "Delete Selected"));

    const operationalLineList = document.createElement("select");
    operationalLineList.id = "operationalLineList";
    operationalLineList.className = "select-input mt-2 strategic-line-list";
    operationalLineList.size = 4;

    const graphicsBlock = document.createElement("div");
    graphicsBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-graphics";
    const graphicsHeader = document.createElement("div");
    graphicsHeader.className = "section-header mt-3";
    graphicsHeader.textContent = t("Operation Graphics", "ui");
    const graphicsHint = document.createElement("p");
    graphicsHint.className = "sidebar-tool-hint";
    graphicsHint.textContent = t("Use short intent lines and quiet captions so arrows support the frontline instead of overpowering it.", "ui");
    const graphicsRow = buildRow();
    graphicsRow.classList.add("frontline-compact-row", "strategic-graphics-primary-row");
    const graphicsKindSelect = buildSelect("operationGraphicKindSelect", [
      ["attack", "Attack"],
      ["retreat", "Retreat"],
      ["supply", "Supply"],
      ["naval", "Naval"],
      ["encirclement", "Encirclement"],
      ["theater", "Theater"],
    ]);
    const graphicsLabelInput = buildInput("operationGraphicLabelInput", "Label");
    graphicsRow.appendChild(graphicsKindSelect);
    graphicsRow.appendChild(graphicsLabelInput);
    graphicsRow.appendChild(buildButton("operationGraphicStartBtn", "Start Draw"));

    const graphicsStyleRow = buildRow();
    graphicsStyleRow.classList.add("frontline-compact-row");
    const graphicsPresetSelect = buildSelect("operationGraphicPresetSelect", [
      ["attack", "Attack Style"],
      ["retreat", "Retreat Style"],
      ["supply", "Supply Style"],
      ["naval", "Naval Style"],
      ["encirclement", "Encirclement Style"],
      ["theater", "Theater Style"],
    ]);
    const graphicsStrokeInput = buildInput("operationGraphicStrokeInput", "", "color");
    graphicsStrokeInput.value = "#991b1b";
    graphicsStrokeInput.className = "input strategic-inline-color";
    graphicsStrokeInput.setAttribute("aria-label", t("Graphic stroke", "ui"));
    const graphicsWidthInput = buildInput("operationGraphicWidthInput", "Width", "number");
    graphicsWidthInput.min = "0";
    graphicsWidthInput.max = "16";
    graphicsWidthInput.step = "0.2";
    const graphicsOpacityInput = buildInput("operationGraphicOpacityInput", "Opacity", "number");
    graphicsOpacityInput.min = "0";
    graphicsOpacityInput.max = "1";
    graphicsOpacityInput.step = "0.05";
    graphicsStyleRow.appendChild(graphicsPresetSelect);
    graphicsStyleRow.appendChild(graphicsStrokeInput);
    graphicsStyleRow.appendChild(graphicsWidthInput);
    graphicsStyleRow.appendChild(graphicsOpacityInput);

    const graphicsEditorHint = document.createElement("p");
    graphicsEditorHint.id = "operationGraphicEditorHint";
    graphicsEditorHint.className = "sidebar-tool-hint mt-2";
    graphicsEditorHint.textContent = t(
      "Select a line to drag vertices, click midpoint pips to insert points, or remove the selected vertex.",
      "ui"
    );

    const graphicsActions = buildRow();
    graphicsActions.className = "sidebar-equal-actions mt-3 strategic-graphics-management-actions";
    graphicsActions.appendChild(buildButton("operationGraphicUndoBtn", "Undo Vertex"));
    graphicsActions.appendChild(buildButton("operationGraphicFinishBtn", "Finish"));
    graphicsActions.appendChild(buildButton("operationGraphicCancelBtn", "Cancel"));
    graphicsActions.appendChild(buildButton("operationGraphicDeleteBtn", "Delete Selected"));
    const graphicsDeleteVertexBtn = buildButton("operationGraphicDeleteVertexBtn", "Delete Vertex");
    let skipDeleteGraphicVertexClick = false;
    const handleDeleteGraphicVertex = (event) => {
      event?.preventDefault?.();
      if (event?.type === "click" && skipDeleteGraphicVertexClick) {
        skipDeleteGraphicVertexClick = false;
        return;
      }
      if (event?.type === "pointerdown") {
        skipDeleteGraphicVertexClick = true;
      }
      mapRenderer.deleteSelectedOperationGraphicVertex();
      refreshStrategicOverlayUI();
    };
    graphicsDeleteVertexBtn.addEventListener("pointerdown", handleDeleteGraphicVertex);
    graphicsDeleteVertexBtn.addEventListener("click", handleDeleteGraphicVertex);
    graphicsDeleteVertexBtn.dataset.bound = "true";
    graphicsActions.appendChild(graphicsDeleteVertexBtn);

    const graphicsList = document.createElement("select");
    graphicsList.id = "operationGraphicList";
    graphicsList.className = "select-input mt-2 strategic-graphics-list";
    graphicsList.size = 4;

    const graphicsAdvanced = document.createElement("details");
    graphicsAdvanced.className = "unit-counter-advanced-shell frontline-advanced-shell mt-2";
    const graphicsAdvancedSummary = document.createElement("summary");
    graphicsAdvancedSummary.className = "unit-counter-advanced-summary";
    graphicsAdvancedSummary.textContent = t("Graphic Style Controls", "ui");
    const graphicsAdvancedBody = document.createElement("div");
    graphicsAdvancedBody.className = "unit-counter-advanced-body";
    graphicsAdvancedBody.appendChild(graphicsStyleRow);
    graphicsAdvanced.appendChild(graphicsAdvancedSummary);
    graphicsAdvanced.appendChild(graphicsAdvancedBody);

    const countersBlock = document.createElement("div");
    countersBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-counters";
    const unitHeader = document.createElement("div");
    unitHeader.className = "section-header mt-4";
    unitHeader.textContent = t("Unit Counters", "ui");
    const unitHint = document.createElement("p");
    unitHint.className = "sidebar-tool-hint";
    unitHint.textContent = t("Counters should read like map pieces first. Keep only unit, nation, echelon, and label in the fast path.", "ui");
    const unitEditorShell = document.createElement("div");
    unitEditorShell.className = "unit-counter-editor-shell mt-2";
    unitEditorShell.id = "unitCounterEditorShell";

    const unitPreviewFrame = document.createElement("div");
    unitPreviewFrame.className = "unit-counter-preview-frame";

    const unitPreviewCard = document.createElement("div");
    unitPreviewCard.id = "unitCounterPreviewCard";
    unitPreviewCard.className = "unit-counter-preview-shell is-compact";

    const unitPreviewActions = document.createElement("div");
    unitPreviewActions.className = "unit-counter-preview-actions";
    const unitDetailToggleBtn = document.createElement("button");
    unitDetailToggleBtn.type = "button";
    unitDetailToggleBtn.id = "unitCounterDetailToggleBtn";
    unitDetailToggleBtn.className = "btn secondary unit-counter-detail-icon-btn";
    unitDetailToggleBtn.setAttribute("aria-label", t("Toggle details", "ui"));
    unitDetailToggleBtn.setAttribute("aria-haspopup", "dialog");
    unitDetailToggleBtn.textContent = "\u2699";
    unitPreviewActions.appendChild(unitDetailToggleBtn);

    unitPreviewFrame.appendChild(unitPreviewCard);
    unitPreviewFrame.appendChild(unitPreviewActions);

    const unitPlacementStatus = document.createElement("div");
    unitPlacementStatus.id = "unitCounterPlacementStatus";
    unitPlacementStatus.className = "unit-counter-placement-status hidden";

    const unitPresetNationRow = buildRow();
    unitPresetNationRow.className = "unit-counter-grid-row unit-counter-fast-row mt-3 strategic-counter-fast-controls";
    const unitPresetSelect = buildSelect("unitCounterPresetSelect", featuredUnitCounterPresets.map((preset) => [
      preset.id,
      `${preset.label} · ${preset.shortCode}`,
    ]));
    const unitNationModeSelect = buildSelect("unitCounterNationModeSelect", [
      ["display", "Nation: Auto"],
      ["manual", "Nation: Manual"],
    ]);
    const unitNationSelect = buildSelect("unitCounterNationSelect", [["", "Auto from placement"]]);
    const unitAttachmentSelect = buildSelect("unitCounterAttachmentSelect", [["", "Anchor: Province / Free"]]);
    const unitEchelonSelect = buildSelect("unitCounterEchelonSelect", unitCounterEchelons);
    const unitLabelInput = buildInput("unitCounterLabelInput", "Counter Label");
    unitPresetNationRow.appendChild(unitPresetSelect);
    unitPresetNationRow.appendChild(unitNationModeSelect);
    unitPresetNationRow.appendChild(unitNationSelect);
    unitPresetNationRow.appendChild(unitAttachmentSelect);
    unitPresetNationRow.appendChild(unitEchelonSelect);
    unitPresetNationRow.appendChild(unitLabelInput);

    const unitIdentityGroup = buildDetailGroup("unitCounterIdentityGroup", "Identity", { open: true });
    const unitCombatGroup = buildDetailGroup("unitCounterCombatGroup", "Combat State", { open: true });
    const unitFinishGroup = buildDetailGroup("unitCounterFinishGroup", "Finish", { open: false });

    const counterEditorModalOverlay = document.createElement("div");
    counterEditorModalOverlay.id = "unitCounterEditorModalOverlay";
    counterEditorModalOverlay.className = "counter-editor-modal-overlay hidden";
    const counterEditorModal = document.createElement("div");
    counterEditorModal.id = "unitCounterEditorModal";
    counterEditorModal.className = "counter-editor-modal";
    counterEditorModal.setAttribute("role", "dialog");
    counterEditorModal.setAttribute("aria-modal", "true");
    counterEditorModal.setAttribute("aria-labelledby", "unitCounterEditorModalTitle");
    counterEditorModal.tabIndex = -1;
    const counterEditorModalHeader = document.createElement("div");
    counterEditorModalHeader.className = "counter-editor-modal-header";
    const counterEditorModalCopy = document.createElement("div");
    counterEditorModalCopy.className = "counter-editor-modal-copy";
    const counterEditorModalTitle = document.createElement("h2");
    counterEditorModalTitle.id = "unitCounterEditorModalTitle";
    counterEditorModalTitle.className = "counter-editor-modal-title";
    counterEditorModalTitle.textContent = t("Counter Editor", "ui");
    const counterEditorModalMessage = document.createElement("p");
    counterEditorModalMessage.className = "counter-editor-modal-message";
    counterEditorModalMessage.textContent = t("Browse symbols, tune combat state, and preview the selected counter in one place.", "ui");
    counterEditorModalCopy.append(counterEditorModalTitle, counterEditorModalMessage);
    const counterEditorModalCloseBtn = document.createElement("button");
    counterEditorModalCloseBtn.type = "button";
    counterEditorModalCloseBtn.id = "unitCounterEditorModalCloseBtn";
    counterEditorModalCloseBtn.className = "counter-editor-modal-close-btn";
    counterEditorModalCloseBtn.setAttribute("aria-label", t("Close counter editor", "ui"));
    counterEditorModalCloseBtn.textContent = "\u00D7";
    counterEditorModalHeader.append(counterEditorModalCopy, counterEditorModalCloseBtn);

    const counterEditorModalBody = document.createElement("div");
    counterEditorModalBody.className = "counter-editor-modal-body";
    const counterEditorModalPreview = document.createElement("div");
    counterEditorModalPreview.className = "counter-editor-modal-preview";
    const unitDetailPreviewCard = document.createElement("div");
    unitDetailPreviewCard.id = "unitCounterDetailPreviewCard";
    unitDetailPreviewCard.className = "unit-counter-preview-shell counter-editor-preview-shell";
    const counterEditorModalStatus = document.createElement("div");
    counterEditorModalStatus.id = "unitCounterEditorModalStatus";
    counterEditorModalStatus.className = "counter-editor-modal-status hidden";
    counterEditorModalPreview.append(unitDetailPreviewCard, counterEditorModalStatus);

    const counterEditorModalControls = document.createElement("div");
    counterEditorModalControls.className = "counter-editor-modal-controls";
    const unitCounterCatalogPanel = document.createElement("div");
    unitCounterCatalogPanel.className = "counter-editor-symbol-panel";
    const unitCounterCatalogHeader = document.createElement("div");
    unitCounterCatalogHeader.className = "counter-editor-symbol-header";
    const unitCounterCatalogHeaderTitle = document.createElement("div");
    unitCounterCatalogHeaderTitle.id = "unitCounterCatalogHeaderTitle";
    unitCounterCatalogHeaderTitle.className = "section-header";
    unitCounterCatalogHeaderTitle.textContent = t("Symbol Browser", "ui");
    const unitCounterCatalogHeaderHint = document.createElement("p");
    unitCounterCatalogHeaderHint.id = "unitCounterCatalogHeaderHint";
    unitCounterCatalogHeaderHint.className = "sidebar-tool-hint";
    unitCounterCatalogHeaderHint.textContent = t("Search the internal counter catalog, then apply a preset back into the editor.", "ui");
    unitCounterCatalogHeader.append(unitCounterCatalogHeaderTitle, unitCounterCatalogHeaderHint);
    const unitCounterCatalogSourceTabs = document.createElement("div");
    unitCounterCatalogSourceTabs.id = "unitCounterCatalogSourceTabs";
    unitCounterCatalogSourceTabs.className = "counter-editor-source-tabs";
    const unitCounterInternalSourceBtn = document.createElement("button");
    unitCounterInternalSourceBtn.type = "button";
    unitCounterInternalSourceBtn.className = "counter-editor-source-btn";
    unitCounterInternalSourceBtn.dataset.counterCatalogSource = "internal";
    unitCounterInternalSourceBtn.textContent = t("Internal", "ui");
    const unitCounterHoi4SourceBtn = document.createElement("button");
    unitCounterHoi4SourceBtn.type = "button";
    unitCounterHoi4SourceBtn.className = "counter-editor-source-btn";
    unitCounterHoi4SourceBtn.dataset.counterCatalogSource = "hoi4";
    unitCounterHoi4SourceBtn.textContent = "HOI4 Library";
    unitCounterCatalogSourceTabs.append(unitCounterInternalSourceBtn, unitCounterHoi4SourceBtn);
    const unitCounterCatalogSearchInput = buildInput("unitCounterCatalogSearchInput", "Search symbols");
    unitCounterCatalogSearchInput.classList.add("counter-editor-symbol-search");
    const unitCounterLibraryVariantRow = document.createElement("div");
    unitCounterLibraryVariantRow.id = "unitCounterLibraryVariantRow";
    unitCounterLibraryVariantRow.className = "counter-editor-category-row hidden";
    const unitCounterLibrarySmallVariantBtn = document.createElement("button");
    unitCounterLibrarySmallVariantBtn.type = "button";
    unitCounterLibrarySmallVariantBtn.className = "counter-editor-category-btn";
    unitCounterLibrarySmallVariantBtn.dataset.counterLibraryVariant = "small";
    unitCounterLibrarySmallVariantBtn.textContent = t("On-map Small", "ui");
    const unitCounterLibraryLargeVariantBtn = document.createElement("button");
    unitCounterLibraryLargeVariantBtn.type = "button";
    unitCounterLibraryLargeVariantBtn.className = "counter-editor-category-btn";
    unitCounterLibraryLargeVariantBtn.dataset.counterLibraryVariant = "large";
    unitCounterLibraryLargeVariantBtn.textContent = t("Large", "ui");
    unitCounterLibraryVariantRow.append(unitCounterLibrarySmallVariantBtn, unitCounterLibraryLargeVariantBtn);
    const unitCounterLibraryReviewBar = document.createElement("div");
    unitCounterLibraryReviewBar.id = "unitCounterLibraryReviewBar";
    unitCounterLibraryReviewBar.className = "counter-editor-library-review-bar hidden";
    const unitCounterLibraryReviewSummary = document.createElement("div");
    unitCounterLibraryReviewSummary.id = "unitCounterLibraryReviewSummary";
    unitCounterLibraryReviewSummary.className = "counter-editor-library-review-summary";
    const unitCounterLibraryExportBtn = buildButton("unitCounterLibraryExportBtn", "Export HOI4 Review JSON");
    unitCounterLibraryExportBtn.classList.add("counter-editor-library-export-btn");
    unitCounterLibraryReviewBar.append(unitCounterLibraryReviewSummary, unitCounterLibraryExportBtn);
    const unitCounterCatalogCategoriesEl = document.createElement("div");
    unitCounterCatalogCategoriesEl.id = "unitCounterCatalogCategories";
    unitCounterCatalogCategoriesEl.className = "counter-editor-category-row";
    const unitCounterCatalogGrid = document.createElement("div");
    unitCounterCatalogGrid.id = "unitCounterCatalogGrid";
    unitCounterCatalogGrid.className = "counter-editor-symbol-grid";
    unitCounterCatalogPanel.append(
      unitCounterCatalogHeader,
      unitCounterCatalogSourceTabs,
      unitCounterCatalogSearchInput,
      unitCounterLibraryVariantRow,
      unitCounterLibraryReviewBar,
      unitCounterCatalogCategoriesEl,
      unitCounterCatalogGrid
    );

    const unitDetailDrawer = document.createElement("div");
    unitDetailDrawer.id = "unitCounterDetailDrawer";
    unitDetailDrawer.className = "unit-counter-detail-drawer";

    const unitIdentityBlock = document.createElement("div");
    unitIdentityBlock.className = "unit-counter-detail-block";

    const unitModeRow = buildRow();
    unitModeRow.className = "unit-counter-grid-row mt-2";
    const unitRendererSelect = buildSelect("unitCounterRendererSelect", [
      ["game", "Game"],
      ["milstd", "MILSTD"],
    ]);
    const unitSizeSelect = buildSelect("unitCounterSizeSelect", [
      ["small", "Small"],
      ["medium", "Medium"],
      ["large", "Large"],
    ]);
    unitModeRow.appendChild(unitRendererSelect);
    unitModeRow.appendChild(unitSizeSelect);

    const unitCopyRow = buildRow();
    unitCopyRow.className = "unit-counter-grid-row mt-2";
    const unitSubLabelInput = buildInput("unitCounterSubLabelInput", "Sub-label");
    const unitStrengthInput = buildInput("unitCounterStrengthInput", "Strength");
    unitCopyRow.appendChild(unitSubLabelInput);
    unitCopyRow.appendChild(unitStrengthInput);

    const unitSymbolInput = buildInput("unitCounterSymbolInput", "SIDC / Symbol Code");
    const unitSymbolHint = document.createElement("p");
    unitSymbolHint.id = "unitCounterSymbolHint";
    unitSymbolHint.className = "sidebar-tool-hint mt-2";
    unitSymbolHint.textContent = t("Game renderer uses short codes like HQ or ARM. MILSTD expects a SIDC string.", "ui");
    unitIdentityBlock.appendChild(unitModeRow);
    unitIdentityBlock.appendChild(unitCopyRow);
    unitIdentityBlock.appendChild(unitSymbolInput);
    unitIdentityBlock.appendChild(unitSymbolHint);

    const unitCombatBlock = document.createElement("div");
    unitCombatBlock.className = "unit-counter-detail-block";

    const unitCombatPresetField = buildSegmentedChoiceField("unitCounterStatsPresetSelect", unitCounterCombatPresets.map((preset) => [
      preset.id,
      preset.label,
    ]), {
      groupClassName: "unit-counter-stat-preset-group",
      buttonClassName: "unit-counter-stat-preset-button",
    });
    unitCombatPresetField.shell.querySelectorAll("button").forEach((button) => {
      button.removeAttribute("data-frontline-style-choice");
      button.dataset.unitCounterStatsPresetChoice = "true";
    });
    const unitRandomizeBtn = buildButton("unitCounterStatsRandomizeBtn", "Randomize");
    unitRandomizeBtn.classList.add("secondary");

    const unitCombatPresetStack = document.createElement("div");
    unitCombatPresetStack.className = "unit-counter-combat-preset-stack mt-2";
    unitCombatPresetStack.appendChild(unitCombatPresetField.shell);
    unitCombatPresetStack.appendChild(unitRandomizeBtn);

    const unitStatInputs = buildRow();
    unitStatInputs.className = "unit-counter-grid-row mt-2";
    const unitOrganizationInput = buildInput("unitCounterOrganizationInput", "Organization", "number");
    unitOrganizationInput.min = "0";
    unitOrganizationInput.max = "100";
    unitOrganizationInput.step = "1";
    const unitEquipmentInput = buildInput("unitCounterEquipmentInput", "Equipment", "number");
    unitEquipmentInput.min = "0";
    unitEquipmentInput.max = "100";
    unitEquipmentInput.step = "1";
    unitStatInputs.appendChild(unitOrganizationInput);
    unitStatInputs.appendChild(unitEquipmentInput);

    const unitCombatBars = document.createElement("div");
    unitCombatBars.className = "unit-counter-combat-bar-stack mt-2";
    unitCombatBars.innerHTML = `
      <div class="unit-counter-combat-bar is-org">
        <span class="unit-counter-combat-bar-label">${t("Organization", "ui")}</span>
        <span class="unit-counter-combat-bar-track"><span id="unitCounterOrganizationBar" class="unit-counter-combat-bar-fill"></span></span>
      </div>
      <div class="unit-counter-combat-bar is-equipment">
        <span class="unit-counter-combat-bar-label">${t("Equipment", "ui")}</span>
        <span class="unit-counter-combat-bar-track"><span id="unitCounterEquipmentBar" class="unit-counter-combat-bar-fill"></span></span>
      </div>
    `;
    unitCombatBlock.appendChild(unitCombatPresetStack);
    unitCombatBlock.appendChild(unitStatInputs);
    unitCombatBlock.appendChild(unitCombatBars);

    const unitFinishBlock = document.createElement("div");
    unitFinishBlock.className = "unit-counter-detail-block";

    const unitColorPanel = document.createElement("div");
    unitColorPanel.className = "unit-counter-color-panel mt-2";
    const unitColorSwatch = document.createElement("button");
    unitColorSwatch.type = "button";
    unitColorSwatch.id = "unitCounterBaseFillSwatch";
    unitColorSwatch.className = "unit-counter-color-swatch";
    unitColorSwatch.setAttribute("aria-label", t("Counter fill swatch", "ui"));
    const unitColorInput = buildInput("unitCounterBaseFillColorInput", "", "color");
    unitColorInput.classList.add("unit-counter-color-input");
    unitColorInput.setAttribute("aria-label", t("Counter fill color", "ui"));
    const unitColorResetBtn = buildButton("unitCounterBaseFillResetBtn", "Paper");
    unitColorResetBtn.classList.add("secondary");
    const unitColorEyedropperBtn = buildButton("unitCounterBaseFillEyedropperBtn", "Eyedropper");
    unitColorEyedropperBtn.classList.add("secondary");
    unitColorPanel.appendChild(unitColorSwatch);
    unitColorPanel.appendChild(unitColorInput);
    unitColorPanel.appendChild(unitColorResetBtn);
    unitColorPanel.appendChild(unitColorEyedropperBtn);
    unitFinishBlock.appendChild(unitColorPanel);

    unitIdentityGroup.body.appendChild(unitIdentityBlock);
    unitCombatGroup.body.appendChild(unitCombatBlock);
    unitFinishGroup.body.appendChild(unitFinishBlock);
    unitDetailDrawer.appendChild(unitIdentityGroup.shell);
    unitDetailDrawer.appendChild(unitCombatGroup.shell);
    unitDetailDrawer.appendChild(unitFinishGroup.shell);

    counterEditorModalControls.append(unitCounterCatalogPanel, unitDetailDrawer);
    counterEditorModalBody.append(counterEditorModalPreview, counterEditorModalControls);
    counterEditorModal.append(counterEditorModalHeader, counterEditorModalBody);
    counterEditorModalOverlay.appendChild(counterEditorModal);

    const unitOptionsRow = buildRow();
    unitOptionsRow.className = "mt-2 flex flex-wrap items-center justify-between gap-2 strategic-counter-visual-options";
    const unitLabelToggle = document.createElement("label");
    unitLabelToggle.className = "checkbox-row";
    unitLabelToggle.innerHTML = `<input id="unitCounterLabelsToggle" type="checkbox" class="checkbox-input" /> <span>${t("Show Labels", "ui")}</span>`;
    unitOptionsRow.appendChild(unitLabelToggle);
    const unitScaleShell = document.createElement("div");
    unitScaleShell.className = "strategic-counter-scale-shell";
    unitScaleShell.innerHTML = `
      <div class="range-row">
        <label class="range-label" for="unitCounterFixedScaleRange">${t("Counter Scale", "ui")}</label>
        <span id="unitCounterFixedScaleValue" class="range-value">1.50x</span>
      </div>
    `;
    const unitScaleRange = document.createElement("input");
    unitScaleRange.id = "unitCounterFixedScaleRange";
    unitScaleRange.type = "range";
    unitScaleRange.min = "50";
    unitScaleRange.max = "200";
    unitScaleRange.step = "5";
    unitScaleRange.value = "150";
    unitScaleRange.className = "range-input";
    unitScaleShell.appendChild(unitScaleRange);
    unitOptionsRow.appendChild(unitScaleShell);

    const unitActions = buildRow();
    unitActions.className = "sidebar-equal-actions mt-3 strategic-counter-management-actions";
    const createCounterActionButton = (id, label, iconText, fullLabel) => {
      const button = buildButton(id, label);
      button.classList.add("strategic-counter-action-btn");
      button.setAttribute("title", t(fullLabel || label, "ui"));
      button.setAttribute("aria-label", t(fullLabel || label, "ui"));
      const icon = document.createElement("span");
      icon.className = "strategic-counter-action-icon";
      icon.textContent = iconText;
      const copy = document.createElement("span");
      copy.className = "strategic-counter-action-label";
      copy.textContent = t(label, "ui");
      button.replaceChildren(icon, copy);
      return button;
    };
    unitActions.appendChild(createCounterActionButton("unitCounterPlaceBtn", "Place", "+", "Place Counter"));
    unitActions.appendChild(createCounterActionButton("unitCounterCancelBtn", "Cancel", "\u00D7", "Cancel Place"));
    unitActions.appendChild(createCounterActionButton("unitCounterDeleteBtn", "Delete", "\u2212", "Delete Selected"));

    const unitListHeader = document.createElement("div");
    unitListHeader.className = "unit-counter-list-header mt-3 strategic-counter-list-header";
    unitListHeader.innerHTML = `
      <div class="section-header">${t("Placed Counters", "ui")}</div>
      <p class="sidebar-tool-hint">${t("Each entry now shows nation, unit preset, echelon, and renderer at a glance.", "ui")}</p>
    `;

    const unitList = document.createElement("select");
    unitList.id = "unitCounterList";
    unitList.className = "select-input mt-2 unit-counter-list strategic-counter-list";
    unitList.size = 4;

    strategicOverlaySection.appendChild(headerRow);
    strategicOverlaySection.appendChild(workspaceActions);
    operationalLineBlock.appendChild(operationalLineHeader);
    operationalLineBlock.appendChild(operationalLineHint);
    operationalLineBlock.appendChild(operationalLineRow);
    operationalLineBlock.appendChild(operationalLineStyleRow);
    operationalLineBlock.appendChild(operationalLineEditorHint);
    operationalLineBlock.appendChild(operationalLineActions);
    operationalLineBlock.appendChild(operationalLineList);
    graphicsBlock.appendChild(graphicsHeader);
    graphicsBlock.appendChild(graphicsHint);
    graphicsBlock.appendChild(graphicsRow);
    graphicsBlock.appendChild(graphicsAdvanced);
    graphicsBlock.appendChild(graphicsEditorHint);
    graphicsBlock.appendChild(graphicsActions);
    graphicsBlock.appendChild(graphicsList);
    countersBlock.appendChild(unitHeader);
    countersBlock.appendChild(unitHint);
    unitEditorShell.appendChild(unitPreviewFrame);
    unitEditorShell.appendChild(unitPlacementStatus);
    unitEditorShell.appendChild(unitPresetNationRow);
    unitEditorShell.appendChild(unitOptionsRow);
    unitEditorShell.appendChild(unitActions);
    unitEditorShell.appendChild(unitListHeader);
    unitEditorShell.appendChild(unitList);
    countersBlock.appendChild(unitEditorShell);
    document.body.appendChild(counterEditorModalOverlay);

    const buildAccordionSection = (id, title, contentBlock, opts = {}) => {
      const wrapper = document.createElement("div");
      wrapper.className = "strategic-accordion-section";
      wrapper.id = id;
      const header = document.createElement("button");
      header.type = "button";
      header.className = "strategic-accordion-header";
      const arrow = document.createElement("span");
      arrow.className = "strategic-accordion-arrow";
      arrow.textContent = "\u25B6";
      const titleEl = document.createElement("span");
      titleEl.className = "strategic-accordion-title";
      titleEl.textContent = t(title, "ui");
      const badge = document.createElement("span");
      badge.className = "strategic-accordion-badge";
      badge.textContent = "0";
      header.appendChild(arrow);
      header.appendChild(titleEl);
      header.appendChild(badge);
      const body = document.createElement("div");
      body.className = "strategic-accordion-body";
      body.id = `${id}Body`;
      body.appendChild(contentBlock);
      const syncExpandedState = (isOpen) => {
        wrapper.classList.toggle("is-open", !!isOpen);
        header.setAttribute("aria-expanded", isOpen ? "true" : "false");
      };
      header.setAttribute("aria-controls", body.id);
      header.addEventListener("click", () => {
        syncExpandedState(!wrapper.classList.contains("is-open"));
      });
      wrapper.appendChild(header);
      wrapper.appendChild(body);
      syncExpandedState(!!opts.defaultOpen);
      return wrapper;
    };

    const accordionLines = buildAccordionSection("accordionLines", "Operational Lines", operationalLineBlock, { defaultOpen: true });
    const accordionGraphics = buildAccordionSection("accordionGraphics", "Operation Graphics", graphicsBlock);
    const accordionCounters = buildAccordionSection("accordionCounters", "Unit Counters", countersBlock);
    strategicOverlaySection.appendChild(accordionLines);
    strategicOverlaySection.appendChild(accordionGraphics);
    strategicOverlaySection.appendChild(accordionCounters);
    frontlineTabStack.appendChild(strategicOverlaySection);
  }

  if (strategicOverlaySection && frontlineTabStack && strategicOverlaySection.parentElement !== frontlineTabStack) {
    strategicOverlaySection.classList.add("frontline-tab-card");
    frontlineTabStack.appendChild(strategicOverlaySection);
  }

  let strategicWorkspaceBackdrop = document.getElementById("strategicWorkspaceBackdrop");
  if (!strategicWorkspaceBackdrop) {
    strategicWorkspaceBackdrop = document.createElement("div");
    strategicWorkspaceBackdrop.id = "strategicWorkspaceBackdrop";
    strategicWorkspaceBackdrop.className = "strategic-workspace-backdrop hidden";
    document.body.appendChild(strategicWorkspaceBackdrop);
  }

  let strategicCommandBar = document.getElementById("strategicCommandBar");
  if (!strategicCommandBar) {
    strategicCommandBar = document.createElement("div");
    strategicCommandBar.id = "strategicCommandBar";
    strategicCommandBar.className = "strategic-command-bar";
    strategicCommandBar.innerHTML = `
      <button id="strategicCommandFrontlineBtn" type="button" class="strategic-command-btn" data-line-kind="frontline">${t("作战前线", "ui")}</button>
      <button id="strategicCommandOffensiveBtn" type="button" class="strategic-command-btn" data-line-kind="offensive_line">${t("进攻线", "ui")}</button>
      <button id="strategicCommandSpearheadBtn" type="button" class="strategic-command-btn" data-line-kind="spearhead_line">${t("穿插线", "ui")}</button>
      <button id="strategicCommandDefensiveBtn" type="button" class="strategic-command-btn" data-line-kind="defensive_line">${t("防守线", "ui")}</button>
    `;
    document.body.appendChild(strategicCommandBar);
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
  const inspectorSidebarTabButtons = Array.from(document.querySelectorAll("[data-inspector-tab]"));
  const inspectorSidebarTabPanels = Array.from(document.querySelectorAll("[data-inspector-panel]"));
  const frontlineEnabledStatus = document.getElementById("frontlineEnabledStatus");
  const frontlineStatusHint = document.getElementById("frontlineStatusHint");
  const frontlineEnabledToggle = document.getElementById("frontlineEnabledToggle");
  const frontlineEmptyState = document.getElementById("frontlineEmptyState");
  const frontlineSettingsPanel = document.getElementById("frontlineSettingsPanel");
  const strategicFrontlineStyleSelect = document.getElementById("strategicFrontlineStyleSelect");
  const frontlineStyleChoiceButtons = Array.from(document.querySelectorAll("[data-frontline-style-choice]"));
  const strategicFrontlineLabelsToggle = document.getElementById("strategicFrontlineLabelsToggle");
  const strategicLabelPlacementSelect = document.getElementById("strategicLabelPlacementSelect");
  const strategicWorkspaceBackdropEl = document.getElementById("strategicWorkspaceBackdrop");
  const strategicCommandButtons = Array.from(document.querySelectorAll("#strategicCommandBar .strategic-command-btn"));
  const strategicOverlayOpenWorkspaceBtn = document.getElementById("strategicOverlayOpenWorkspaceBtn");
  const strategicOverlayCloseWorkspaceBtn = document.getElementById("strategicOverlayCloseWorkspaceBtn");
  const strategicOverlayIconCloseBtn = document.getElementById("strategicOverlayIconCloseBtn");
  const operationalLineKindSelect = document.getElementById("operationalLineKindSelect");
  const operationalLineLabelInput = document.getElementById("operationalLineLabelInput");
  const operationalLineStrokeInput = document.getElementById("operationalLineStrokeInput");
  const operationalLineWidthInput = document.getElementById("operationalLineWidthInput");
  const operationalLineOpacityInput = document.getElementById("operationalLineOpacityInput");
  const operationalLineEditorHint = document.getElementById("operationalLineEditorHint");
  const operationalLineStartBtn = document.getElementById("operationalLineStartBtn");
  const operationalLineUndoBtn = document.getElementById("operationalLineUndoBtn");
  const operationalLineFinishBtn = document.getElementById("operationalLineFinishBtn");
  const operationalLineCancelBtn = document.getElementById("operationalLineCancelBtn");
  const operationalLineDeleteBtn = document.getElementById("operationalLineDeleteBtn");
  const operationalLineList = document.getElementById("operationalLineList");
  const operationGraphicKindSelect = document.getElementById("operationGraphicKindSelect");
  const operationGraphicLabelInput = document.getElementById("operationGraphicLabelInput");
  const operationGraphicPresetSelect = document.getElementById("operationGraphicPresetSelect");
  const operationGraphicStrokeInput = document.getElementById("operationGraphicStrokeInput");
  const operationGraphicWidthInput = document.getElementById("operationGraphicWidthInput");
  const operationGraphicOpacityInput = document.getElementById("operationGraphicOpacityInput");
  const operationGraphicEditorHint = document.getElementById("operationGraphicEditorHint");
  const operationGraphicStartBtn = document.getElementById("operationGraphicStartBtn");
  const operationGraphicUndoBtn = document.getElementById("operationGraphicUndoBtn");
  const operationGraphicFinishBtn = document.getElementById("operationGraphicFinishBtn");
  const operationGraphicCancelBtn = document.getElementById("operationGraphicCancelBtn");
  const operationGraphicDeleteBtn = document.getElementById("operationGraphicDeleteBtn");
  const operationGraphicDeleteVertexBtn = document.getElementById("operationGraphicDeleteVertexBtn");
  const operationGraphicList = document.getElementById("operationGraphicList");
  const unitCounterPreviewCard = document.getElementById("unitCounterPreviewCard");
  const unitCounterPlacementStatus = document.getElementById("unitCounterPlacementStatus");
  const unitCounterDetailToggleBtn = document.getElementById("unitCounterDetailToggleBtn");
  const unitCounterEditorModalOverlay = document.getElementById("unitCounterEditorModalOverlay");
  const unitCounterEditorModal = document.getElementById("unitCounterEditorModal");
  const unitCounterEditorModalCloseBtn = document.getElementById("unitCounterEditorModalCloseBtn");
  const unitCounterEditorModalStatus = document.getElementById("unitCounterEditorModalStatus");
  const unitCounterDetailPreviewCard = document.getElementById("unitCounterDetailPreviewCard");
  const unitCounterDetailDrawer = document.getElementById("unitCounterDetailDrawer");
  const unitCounterPresetSelect = document.getElementById("unitCounterPresetSelect");
  const unitCounterNationModeSelect = document.getElementById("unitCounterNationModeSelect");
  const unitCounterNationSelect = document.getElementById("unitCounterNationSelect");
  const unitCounterAttachmentSelect = document.getElementById("unitCounterAttachmentSelect");
  const unitCounterRendererSelect = document.getElementById("unitCounterRendererSelect");
  const unitCounterSizeSelect = document.getElementById("unitCounterSizeSelect");
  const unitCounterEchelonSelect = document.getElementById("unitCounterEchelonSelect");
  const unitCounterLabelInput = document.getElementById("unitCounterLabelInput");
  const unitCounterSubLabelInput = document.getElementById("unitCounterSubLabelInput");
  const unitCounterStrengthInput = document.getElementById("unitCounterStrengthInput");
  const unitCounterSymbolInput = document.getElementById("unitCounterSymbolInput");
  const unitCounterSymbolHint = document.getElementById("unitCounterSymbolHint");
  const unitCounterStatsPresetSelect = document.getElementById("unitCounterStatsPresetSelect");
  const unitCounterStatsPresetButtons = Array.from(document.querySelectorAll("[data-unit-counter-stats-preset-choice]"));
  const unitCounterStatsRandomizeBtn = document.getElementById("unitCounterStatsRandomizeBtn");
  const unitCounterOrganizationInput = document.getElementById("unitCounterOrganizationInput");
  const unitCounterEquipmentInput = document.getElementById("unitCounterEquipmentInput");
  const unitCounterOrganizationBar = document.getElementById("unitCounterOrganizationBar");
  const unitCounterEquipmentBar = document.getElementById("unitCounterEquipmentBar");
  const unitCounterBaseFillSwatch = document.getElementById("unitCounterBaseFillSwatch");
  const unitCounterBaseFillColorInput = document.getElementById("unitCounterBaseFillColorInput");
  const unitCounterBaseFillResetBtn = document.getElementById("unitCounterBaseFillResetBtn");
  const unitCounterBaseFillEyedropperBtn = document.getElementById("unitCounterBaseFillEyedropperBtn");
  const unitCounterLabelsToggle = document.getElementById("unitCounterLabelsToggle");
  const unitCounterFixedScaleRange = document.getElementById("unitCounterFixedScaleRange");
  const unitCounterFixedScaleValue = document.getElementById("unitCounterFixedScaleValue");
  const unitCounterPlaceBtn = document.getElementById("unitCounterPlaceBtn");
  const unitCounterCancelBtn = document.getElementById("unitCounterCancelBtn");
  const unitCounterDeleteBtn = document.getElementById("unitCounterDeleteBtn");
  const unitCounterList = document.getElementById("unitCounterList");
  const unitCounterCatalogHeaderTitle = document.getElementById("unitCounterCatalogHeaderTitle");
  const unitCounterCatalogHeaderHint = document.getElementById("unitCounterCatalogHeaderHint");
  const unitCounterCatalogSourceTabs = document.getElementById("unitCounterCatalogSourceTabs");
  const unitCounterCatalogSearchInput = document.getElementById("unitCounterCatalogSearchInput");
  const unitCounterLibraryVariantRow = document.getElementById("unitCounterLibraryVariantRow");
  const unitCounterLibraryReviewBar = document.getElementById("unitCounterLibraryReviewBar");
  const unitCounterLibraryReviewSummary = document.getElementById("unitCounterLibraryReviewSummary");
  const unitCounterLibraryExportBtn = document.getElementById("unitCounterLibraryExportBtn");
  const unitCounterCatalogCategoriesEl = document.getElementById("unitCounterCatalogCategories");
  const unitCounterCatalogGrid = document.getElementById("unitCounterCatalogGrid");
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
  const frontlineProjectSection = document.getElementById("frontlineProjectSection");
  const projectLegendSection = document.getElementById("lblProjectLegend")?.closest("details");
  const diagnosticsSection = document.getElementById("lblDiagnostics")?.closest("details");
  const selectedCountryActionsTitle = document.getElementById("lblHistoricalPresets");
  const selectedCountryActionHint = document.getElementById("selectedCountryActionHint");
  let counterEditorModalPreviouslyFocused = null;
  const STRATEGIC_OVERLAY_REFRESH_SCOPES = Object.freeze([
    "frontlineControls",
    "operationalLines",
    "operationGraphics",
    "counterIdentity",
    "counterCombat",
    "counterPreview",
    "counterCatalog",
    "counterList",
    "badgeCounts",
    "workspaceChrome",
  ]);
  const strategicOverlayRefreshScopeSet = new Set(STRATEGIC_OVERLAY_REFRESH_SCOPES);
  const strategicOverlayPerfCounters = Object.create(null);
  let pendingStrategicOverlayRefreshHandle = null;
  const pendingStrategicOverlayRefreshScopes = new Set();
  let unitCounterCatalogSearchDebounceHandle = null;
  let suppressUnitCounterListChange = false;

  const ensureStrategicOverlayUiState = () => {
    if (!state.strategicOverlayUi || typeof state.strategicOverlayUi !== "object") {
      state.strategicOverlayUi = {};
    }
    state.strategicOverlayUi.counterEditorModalOpen = !!state.strategicOverlayUi.counterEditorModalOpen;
    state.strategicOverlayUi.counterCatalogSource = String(state.strategicOverlayUi.counterCatalogSource || "internal").trim().toLowerCase() === "hoi4"
      ? "hoi4"
      : "internal";
    state.strategicOverlayUi.counterCatalogCategory = String(state.strategicOverlayUi.counterCatalogCategory || "all").trim().toLowerCase() || "all";
    state.strategicOverlayUi.counterCatalogQuery = String(state.strategicOverlayUi.counterCatalogQuery || "");
    state.strategicOverlayUi.hoi4CounterCategory = String(state.strategicOverlayUi.hoi4CounterCategory || "all").trim().toLowerCase() || "all";
    state.strategicOverlayUi.hoi4CounterQuery = String(state.strategicOverlayUi.hoi4CounterQuery || "");
    state.strategicOverlayUi.hoi4CounterVariant = String(state.strategicOverlayUi.hoi4CounterVariant || "small").trim().toLowerCase() === "large"
      ? "large"
      : "small";
  };
  const recordStrategicOverlayPerfCounter = (name) => {
    const key = String(name || "").trim();
    if (!key) return;
    strategicOverlayPerfCounters[key] = Number(strategicOverlayPerfCounters[key] || 0) + 1;
  };
  const normalizeStrategicOverlayRefreshScopes = (scope = "all") => {
    const rawScopes = Array.isArray(scope) ? scope : [scope];
    const normalizedScopes = new Set();
    rawScopes.forEach((entry) => {
      const normalizedEntry = String(entry || "all").trim();
      if (!normalizedEntry || normalizedEntry === "all") {
        STRATEGIC_OVERLAY_REFRESH_SCOPES.forEach((scopeKey) => normalizedScopes.add(scopeKey));
        return;
      }
      if (strategicOverlayRefreshScopeSet.has(normalizedEntry)) {
        normalizedScopes.add(normalizedEntry);
      }
    });
    if (!normalizedScopes.size) {
      STRATEGIC_OVERLAY_REFRESH_SCOPES.forEach((scopeKey) => normalizedScopes.add(scopeKey));
    }
    return normalizedScopes;
  };
  const hasStrategicOverlayScope = (scopes, ...candidates) => candidates.some((candidate) => scopes.has(candidate));
  const flushPendingStrategicOverlayRefresh = () => {
    const scopes = Array.from(pendingStrategicOverlayRefreshScopes);
    pendingStrategicOverlayRefreshScopes.clear();
    pendingStrategicOverlayRefreshHandle = null;
    refreshStrategicOverlayUI({ scopes });
  };
  const scheduleStrategicOverlayRefresh = (scope = "all") => {
    normalizeStrategicOverlayRefreshScopes(scope).forEach((scopeKey) => pendingStrategicOverlayRefreshScopes.add(scopeKey));
    if (pendingStrategicOverlayRefreshHandle !== null) {
      return;
    }
    pendingStrategicOverlayRefreshHandle = typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame(() => {
        flushPendingStrategicOverlayRefresh();
      })
      : globalThis.setTimeout(() => {
        flushPendingStrategicOverlayRefresh();
      }, 0);
  };
  const getCounterEditorModalFocusableElements = () => {
    if (!(unitCounterEditorModal instanceof HTMLElement)) {
      return [];
    }
    return Array.from(unitCounterEditorModal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => (
      element instanceof HTMLElement
      && !element.hidden
      && element.getAttribute("aria-hidden") !== "true"
      && element.tabIndex >= 0
    ));
  };
  const setCounterEditorModalState = (nextOpen, { restoreFocus = true } = {}) => {
    ensureStrategicOverlayUiState();
    const isOpen = !!nextOpen;
    state.strategicOverlayUi.counterEditorModalOpen = isOpen;
    if (unitCounterEditorModalOverlay) {
      unitCounterEditorModalOverlay.classList.toggle("hidden", !isOpen);
    }
    if (unitCounterDetailDrawer) {
      unitCounterDetailDrawer.classList.toggle("hidden", !isOpen);
    }
    document.body.classList.toggle("counter-editor-modal-open", isOpen);
    if (isOpen) {
      counterEditorModalPreviouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (state.strategicOverlayUi?.modalOpen) {
        setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
      }
      globalThis.requestAnimationFrame(() => {
        if (unitCounterCatalogSearchInput) {
          unitCounterCatalogSearchInput.focus({ preventScroll: true });
        } else {
          unitCounterEditorModal?.focus({ preventScroll: true });
        }
      });
    } else if (restoreFocus && counterEditorModalPreviouslyFocused && document.contains(counterEditorModalPreviouslyFocused)) {
      counterEditorModalPreviouslyFocused.focus({ preventScroll: true });
      counterEditorModalPreviouslyFocused = null;
    }
  };
  const cancelStrategicEditingModes = () => {
    const cancelled = mapRenderer.cancelActiveStrategicInteractionModes();
    if (cancelled) {
      refreshStrategicOverlayUI();
    }
    return cancelled;
  };

  initDevWorkspace();

  const updateScenarioInspectorLayout = () => {
    const isScenarioMode = !!state.activeScenarioId;
    const scenarioDefaultsKey = String(state.activeScenarioId || "__base__");
    if (scenarioDefaultsKey !== lastScenarioInspectorDefaultsKey) {
      collapseScenarioManagedSections();
      lastScenarioInspectorDefaultsKey = scenarioDefaultsKey;
    }
    projectLegendSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    diagnosticsSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    if (countryInspectorOrderingHint) {
      countryInspectorOrderingHint.classList.add("hidden");
    }
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.classList.remove("hidden");
      selectedCountryActionsSection.setAttribute("aria-hidden", "false");
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
      selectedCountryActionHint.classList.add("hidden");
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
  let lastScenarioInspectorDefaultsKey = null;

  const collapseScenarioManagedSections = () => {
    countryInspectorSection?.removeAttribute("open");
    selectedCountryActionsSection?.removeAttribute("open");
    waterInspectorSection?.removeAttribute("open");
    specialRegionInspectorSection?.removeAttribute("open");
    frontlineProjectSection?.removeAttribute("open");
  };

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
    const scenarioName = getScenarioCountryDisplayName(scenarioCountry);
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
    const entryKind = String(scenarioMeta.entry_kind || entry.entryKind || "").trim();
    const ownerFeatureCount = Number(
      scenarioMeta.feature_count
      ?? entry.ownerFeatureCount
      ?? entry.featureCount
      ?? 0
    ) || 0;
    const controllerFeatureCount = Number(
      scenarioMeta.controller_feature_count
      ?? entry.controllerFeatureCount
      ?? 0
    ) || 0;
    const featureCount = String(entryKind).trim().toLowerCase() === "controller_only"
      ? controllerFeatureCount
      : ownerFeatureCount;
    const continentId = String(
      scenarioMeta.continent_id || scenarioMeta.continentId || groupingMeta.continentId || "continent_other"
    );
    const continentLabel = String(
      scenarioMeta.continent_label || scenarioMeta.continentLabel || groupingMeta.continentLabel || "Other"
    );
    const subregionId = String(
      scenarioMeta.subregion_id || scenarioMeta.subregionId || groupingMeta.subregionId || "subregion_unclassified"
    );
    const subregionLabel = String(
      scenarioMeta.subregion_label || scenarioMeta.subregionLabel || groupingMeta.subregionLabel || "Unclassified"
    );
    const inspectorGroupMeta = resolveScenarioInspectorGroupMeta(entry);
    const inspectorGroupId = inspectorGroupMeta.id;
    const inspectorGroupLabel = inspectorGroupMeta.label;
    const inspectorGroupAnchorId = inspectorGroupMeta.anchorId;
    const topLevelGroupId = inspectorGroupId || continentId;
    const topLevelGroupLabel = inspectorGroupLabel || continentLabel;
    return {
      ...entry,
      fallbackIndex,
      lookupIso2,
      inspectorDataCode,
      presetLookupCode,
      groupingCode: groupLookupCode,
      presets: state.presetsState[presetLookupCode] || [],
      hierarchyGroups: scenarioMeta.releasable ? [] : getHierarchyGroupsForCode(groupLookupCode),
      continentId,
      continentLabel,
      continentDisplayLabel: t(continentLabel, "geo") || continentLabel,
      subregionId,
      subregionLabel,
      subregionDisplayLabel: t(subregionLabel, "geo") || subregionLabel,
      inspectorGroupId,
      inspectorGroupLabel,
      inspectorGroupAnchorId,
      topLevelGroupId,
      topLevelGroupLabel,
      topLevelGroupDisplayLabel: t(topLevelGroupLabel, "geo") || topLevelGroupLabel,
      topLevelGroupAnchorId: inspectorGroupAnchorId,
      quality: String(scenarioMeta.quality || entry.quality || "").trim(),
      featureCount,
      ownerFeatureCount,
      controllerFeatureCount,
      baseIso2: String(scenarioMeta.base_iso2 || entry.baseIso2 || "").trim().toUpperCase(),
      releaseLookupIso2: String(
        scenarioMeta.release_lookup_iso2
        || entry.releaseLookupIso2
        || ""
      ).trim().toUpperCase(),
      scenarioOnly: !!(scenarioMeta.scenario_only ?? entry.scenarioOnly),
      releasable: !!(scenarioMeta.releasable ?? entry.releasable),
      scenarioSubject: entryKind === "scenario_subject",
      entryKind,
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
    loadButton.textContent = t(activeAuditLoaded ? "Hide Audit Details" : "Load Audit Details", "ui");
    loadButton.addEventListener("click", async () => {
      if (activeAuditLoaded) {
        releaseScenarioAuditPayload(activeScenarioId);
        return;
      }
      try {
        await loadScenarioAuditPayload(activeScenarioId, {
          forceReload: false,
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
    const resolved = normalized && latestCountryStatesByCode.has(normalized)
      ? normalized
      : "";

    state.selectedInspectorCountryCode = resolved;
    state.inspectorHighlightCountryCode = resolved;
    return resolved;
  };

  const selectInspectorCountry = (code) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return;
    const previousSelectedCode = normalizeCountryCode(state.selectedInspectorCountryCode);
    const countryState = latestCountryStatesByCode.get(normalized);
    let requiresListRebuild = false;
    if (countryState?.topLevelGroupId) {
      const groupKey = getInspectorGroupExpansionKey(countryState.topLevelGroupId);
      if (!state.expandedInspectorContinents.has(groupKey)) {
        state.expandedInspectorContinents.add(groupKey);
        requiresListRebuild = true;
      }
    }
    if (countryState?.releasable && countryState.parentOwnerTag && state.expandedInspectorReleaseParents instanceof Set) {
      if (!state.expandedInspectorReleaseParents.has(countryState.parentOwnerTag)) {
        state.expandedInspectorReleaseParents.add(countryState.parentOwnerTag);
        requiresListRebuild = true;
      }
    }
    state.selectedInspectorCountryCode = normalized;
    state.inspectorHighlightCountryCode = normalized;
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.open = true;
    }
    if (typeof state.updatePaintModeUIFn === "function") {
      state.updatePaintModeUIFn();
    }
    if (typeof state.renderNowFn === "function") {
      state.renderNowFn();
    }
    if (requiresListRebuild) {
      renderList();
      return;
    }
    refreshCountryRows({
      countryCodes: [previousSelectedCode, normalized],
      refreshInspector: true,
    });
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
    return getGeoFeatureDisplayLabel(feature, "Water Region")
      || t("Water Region", "ui")
      || "Water Region";
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
        waterInspectorSection?.setAttribute("open", "");
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
        waterInspectorSection?.setAttribute("open", "");
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
    if (typeof state.updateWorkspaceStatusFn === "function") {
      state.updateWorkspaceStatusFn();
    }
    scheduleAdaptiveInspectorHeights();
  };

  const getSpecialFeatureDisplayName = (feature) => {
    return getGeoFeatureDisplayLabel(feature, "Special Region")
      || t("Special Region", "ui")
      || "Special Region";
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
    const selectedSpecialRegionId = ensureSelectedSpecialRegion();
    if (specialRegionInspectorSection) {
      specialRegionInspectorSection.classList.toggle("hidden", !hasScenarioInspectorContent);
    }
    if (scenarioSpecialRegionVisibilityToggle) {
      scenarioSpecialRegionVisibilityToggle.checked = !!state.showScenarioSpecialRegions;
    }
    scenarioSpecialRegionVisibilityHint?.classList.add("hidden");
    if (scenarioReliefOverlayVisibilityToggle) {
      scenarioReliefOverlayVisibilityToggle.checked = !!state.showScenarioReliefOverlays;
    }
    scenarioReliefOverlayVisibilityHint?.classList.add("hidden");
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
        specialRegionInspectorSection?.setAttribute("open", "");
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
        specialRegionInspectorSection?.setAttribute("open", "");
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
    if (typeof state.updateWorkspaceStatusFn === "function") {
      state.updateWorkspaceStatusFn();
    }
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

      const groupKey = getInspectorGroupExpansionKey(continent.id);
      const isOpen = state.expandedInspectorContinents.has(groupKey);

      const group = document.createElement("div");
      group.className = "country-explorer-group";

      const header = document.createElement("button");
      header.type = "button";
      header.className = "inspector-accordion-btn country-explorer-header";
      header.setAttribute("aria-expanded", String(isOpen));
      header.addEventListener("click", () => {
        if (state.expandedInspectorContinents.has(groupKey)) {
          state.expandedInspectorContinents.delete(groupKey);
        } else {
          state.expandedInspectorContinents.add(groupKey);
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
    if (typeof state.updateWorkspaceStatusFn === "function") {
      state.updateWorkspaceStatusFn();
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
    if (typeof state.updateWorkspaceStatusFn === "function") {
      state.updateWorkspaceStatusFn();
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
      refreshCountryRows({
        countryCodes: [selectedCode],
        refreshInspector: true,
      });
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
      if (state.showScenarioSpecialRegions) {
        void ensureActiveScenarioOptionalLayerLoaded("special", { renderNow: true });
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
      if (state.showScenarioReliefOverlays) {
        void ensureActiveScenarioOptionalLayerLoaded("relief", { renderNow: true });
      }
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
    section.className = "inspector-detail-section inspector-action-section";
    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = titleText;
    const body = document.createElement("div");
    body.className = "inspector-action-list inspector-action-section-body";
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
    const disabledPresetNames = state.activeScenarioId && Array.isArray(countryState?.disabledRegionalPresetNames)
      ? countryState.disabledRegionalPresetNames
      : [];
    return buildPresetEntries(presetLookupCode, (preset) => {
      if (!state.activeScenarioId) return true;
      const normalizedPresetName = normalizePresetName(preset?.name);
      return (
        !consumedPresetNames.includes(normalizedPresetName)
        && !disabledPresetNames.includes(normalizedPresetName)
      );
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
      const previousActiveCode = normalizeCountryCode(state.activeSovereignCode);
      const selectedCode = normalizeCountryCode(state.selectedInspectorCountryCode);
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
      refreshCountryRows({
        countryCodes: [previousActiveCode, normalizedCountryCode, selectedCode],
        refreshInspector: true,
      });
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
    details.className = "scenario-visual-adjustments inspector-action-section";
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

  const setRightSidebarTab = (tabId) => {
    const normalizedId = String(tabId || "").trim().toLowerCase();
    const activeId = normalizedId === "frontline"
      ? "project"
      : (["inspector", "project"].includes(normalizedId) ? normalizedId : "inspector");
    if (!state.ui || typeof state.ui !== "object") {
      state.ui = {};
    }
    state.ui.rightSidebarTab = activeId;
    document.body.classList.remove("frontline-mode-active");
    if (activeId !== "project") {
      setCounterEditorModalState(false, { restoreFocus: false });
      cancelStrategicEditingModes();
      setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
    }
    inspectorSidebarTabButtons.forEach((button) => {
      const id = String(button.dataset.inspectorTab || "").trim().toLowerCase();
      const isActive = id === activeId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    inspectorSidebarTabPanels.forEach((panel) => {
      const id = String(panel.dataset.inspectorPanel || "").trim().toLowerCase();
      const isActive = id === activeId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
    scheduleAdaptiveInspectorHeights();
  };

  const invalidateFrontlineOverlayState = () => {
    state.frontlineOverlayDirty = true;
    state.cachedFrontlineMesh = null;
    state.cachedFrontlineMeshHash = "";
    state.cachedFrontlineLabelAnchors = [];
  };

  const applyFrontlineAnnotationViewPatch = (patch = {}, dirtyReason = "frontline-overlay") => {
    const before = captureHistoryState({ strategicOverlay: true });
    state.annotationView = normalizeAnnotationView({
      ...(state.annotationView || {}),
      ...(patch && typeof patch === "object" ? patch : {}),
    });
    invalidateFrontlineOverlayState();
    if (render) render();
    refreshStrategicOverlayUI();
    pushHistoryEntry({
      before,
      after: captureHistoryState({ strategicOverlay: true }),
      meta: {
        kind: "strategic-overlay-frontline",
        dirtyReason,
      },
    });
    markDirty(dirtyReason);
  };

  const refreshFrontlineTabUI = () => {
    const annotationView = normalizeAnnotationView(state.annotationView);
    const frontlineEnabled = !!annotationView.frontlineEnabled;
    const hasScenario = !!state.activeScenarioId;
    if (frontlineEnabledStatus) {
      frontlineEnabledStatus.textContent = frontlineEnabled ? t("On", "ui") : t("Off", "ui");
      frontlineEnabledStatus.classList.toggle("is-active", frontlineEnabled);
    }
    if (frontlineStatusHint) {
      frontlineStatusHint.textContent = !hasScenario
        ? t("Apply a scenario first, then enable the overlay when you want a derived frontline view.", "ui")
        : frontlineEnabled
        ? t("This project is currently deriving frontlines from scenario control boundaries.", "ui")
        : t("Frontline rendering is disabled until you explicitly enable it for this project.", "ui");
    }
    if (frontlineEnabledToggle) {
      frontlineEnabledToggle.checked = frontlineEnabled;
    }
    if (frontlineEmptyState) {
      frontlineEmptyState.classList.toggle("hidden", frontlineEnabled);
    }
    if (frontlineSettingsPanel) {
      frontlineSettingsPanel.classList.toggle("hidden", !frontlineEnabled);
    }
    if (strategicFrontlineStyleSelect) {
      strategicFrontlineStyleSelect.value = String(annotationView.frontlineStyle || "clean");
      strategicFrontlineStyleSelect.disabled = !frontlineEnabled;
    }
    frontlineStyleChoiceButtons.forEach((button) => {
      const isActive = String(button.dataset.value || "") === String(annotationView.frontlineStyle || "clean");
      button.classList.toggle("is-active", isActive);
      button.disabled = !frontlineEnabled;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    if (strategicFrontlineLabelsToggle) {
      strategicFrontlineLabelsToggle.checked = !!annotationView.showFrontlineLabels;
      strategicFrontlineLabelsToggle.disabled = !frontlineEnabled;
    }
    if (strategicLabelPlacementSelect) {
      strategicLabelPlacementSelect.value = String(annotationView.labelPlacementMode || "midpoint");
      strategicLabelPlacementSelect.disabled = !frontlineEnabled || !annotationView.showFrontlineLabels;
    }
  };

  const setStrategicWorkspaceModalState = (nextOpen, section = "line") => {
    if (!state.strategicOverlayUi || typeof state.strategicOverlayUi !== "object") {
      state.strategicOverlayUi = {};
    }
    const wasOpen = !!state.strategicOverlayUi.modalOpen;
    const nextIsOpen = !!nextOpen;
    state.strategicOverlayUi.modalOpen = nextIsOpen;
    state.strategicOverlayUi.modalSection = section === "counter" ? "counter" : "line";
    if (nextIsOpen && !wasOpen) {
      setCounterEditorModalState(false, { restoreFocus: false });
    } else if (!nextIsOpen && wasOpen) {
      cancelStrategicEditingModes();
    }
    document.body.classList.toggle("strategic-workspace-open", nextIsOpen);
    document.body.classList.toggle("strategic-workspace-visual-mode", nextIsOpen);
    if (strategicOverlaySection) {
      strategicOverlaySection.classList.toggle("is-workspace-modal", nextIsOpen);
      strategicOverlaySection.classList.toggle("is-visual-workspace", nextIsOpen);
      strategicOverlaySection.dataset.workspaceSection = section === "counter" ? "counter" : "line";
    }
    if (strategicWorkspaceBackdropEl) {
      strategicWorkspaceBackdropEl.classList.toggle("hidden", !nextIsOpen);
    }
    if (strategicOverlayOpenWorkspaceBtn) {
      strategicOverlayOpenWorkspaceBtn.classList.toggle("hidden", nextIsOpen);
    }
    if (strategicOverlayCloseWorkspaceBtn) {
      strategicOverlayCloseWorkspaceBtn.classList.toggle("hidden", !nextIsOpen);
    }
    if (strategicOverlayIconCloseBtn) {
      strategicOverlayIconCloseBtn.classList.toggle("hidden", !nextIsOpen);
    }
  };

  const refreshStrategicOverlayUI = ({ scopes = "all" } = {}) => {
    const normalizedScopes = normalizeStrategicOverlayRefreshScopes(scopes);
    const annotationView = normalizeAnnotationView(state.annotationView);
    const syncSelectOptions = (selectEl, options, { value, disabled, signatureKey = "optionsSignature" } = {}) => {
      if (!(selectEl instanceof HTMLSelectElement)) {
        return;
      }
      const nextSignature = options.map((option) => `${option.value}::${option.label}`).join("||");
      if (selectEl.dataset[signatureKey] !== nextSignature) {
        selectEl.replaceChildren();
        options.forEach((entry) => {
          const optionEl = document.createElement("option");
          optionEl.value = String(entry.value || "");
          optionEl.textContent = entry.label;
          selectEl.appendChild(optionEl);
        });
        selectEl.dataset[signatureKey] = nextSignature;
      }
      if (typeof value !== "undefined") {
        selectEl.value = String(value || "");
      }
      if (typeof disabled !== "undefined") {
        selectEl.disabled = !!disabled;
      }
    };
    ensureStrategicOverlayUiState();
    if (hasStrategicOverlayScope(normalizedScopes, "frontlineControls")) {
      recordStrategicOverlayPerfCounter("frontlineControls");
      refreshFrontlineTabUI();
    }
    if (hasStrategicOverlayScope(normalizedScopes, "workspaceChrome")) {
      recordStrategicOverlayPerfCounter("workspaceChrome");
      setStrategicWorkspaceModalState(
        !!state.strategicOverlayUi?.modalOpen,
        String(state.strategicOverlayUi?.modalSection || "line")
      );
      if (unitCounterDetailDrawer) {
        unitCounterDetailDrawer.dataset.open = state.strategicOverlayUi?.counterEditorModalOpen ? "true" : "false";
      }
      if (unitCounterDetailToggleBtn) {
        unitCounterDetailToggleBtn.setAttribute("aria-label", t("Open counter editor", "ui"));
        unitCounterDetailToggleBtn.setAttribute("aria-expanded", state.strategicOverlayUi?.counterEditorModalOpen ? "true" : "false");
        unitCounterDetailToggleBtn.classList.toggle("is-active", !!state.strategicOverlayUi?.counterEditorModalOpen);
      }
      setCounterEditorModalState(!!state.strategicOverlayUi?.counterEditorModalOpen, { restoreFocus: false });
    }

    if (hasStrategicOverlayScope(normalizedScopes, "operationalLines")) {
      recordStrategicOverlayPerfCounter("operationalLines");
    const operationalLineEditor = state.operationalLineEditor || {};
    const selectedOperationalLine = (state.operationalLines || []).find(
      (line) => String(line?.id || "") === String(operationalLineEditor.selectedId || "")
    ) || null;
    const selectedOperationalLineId = String(operationalLineEditor.selectedId || "");
    const isOperationalLineDrawing = !!operationalLineEditor.active;
    const hasSelectedOperationalLine = !!selectedOperationalLineId && !!selectedOperationalLine;
    const operationalLineKind = String(
      hasSelectedOperationalLine && !isOperationalLineDrawing
        ? (selectedOperationalLine?.kind || "frontline")
        : (operationalLineEditor.kind || selectedOperationalLine?.kind || "frontline")
    );
    const operationalLineStroke = String(
      hasSelectedOperationalLine && !isOperationalLineDrawing
        ? (selectedOperationalLine?.stroke || "")
        : (operationalLineEditor.stroke || selectedOperationalLine?.stroke || "")
    ).trim();
    const operationalLineWidth = hasSelectedOperationalLine && !isOperationalLineDrawing
      ? Number(selectedOperationalLine?.width || 0)
      : (Number.isFinite(Number(operationalLineEditor.width)) ? Number(operationalLineEditor.width) : Number(selectedOperationalLine?.width || 0));
    const operationalLineOpacity = hasSelectedOperationalLine && !isOperationalLineDrawing
      ? Number(selectedOperationalLine?.opacity ?? 1)
      : (Number.isFinite(Number(operationalLineEditor.opacity)) ? Number(operationalLineEditor.opacity) : Number(selectedOperationalLine?.opacity ?? 1));
    if (operationalLineKindSelect) operationalLineKindSelect.value = operationalLineKind;
    if (operationalLineLabelInput) operationalLineLabelInput.value = String(operationalLineEditor.label || selectedOperationalLine?.label || "");
    if (operationalLineStrokeInput) operationalLineStrokeInput.value = operationalLineStroke || "#7f1d1d";
    if (operationalLineWidthInput) operationalLineWidthInput.value = String(Number(operationalLineWidth || 0).toFixed(1).replace(/\.0$/, ""));
    if (operationalLineOpacityInput) {
      operationalLineOpacityInput.value = String(Number(operationalLineOpacity || 0).toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
    }
    syncSelectOptions(operationalLineList, [
      { value: "", label: t("No operational lines", "ui") },
      ...(state.operationalLines || []).map((line) => ({
        value: String(line.id || ""),
        label: `${String(line.label || line.kind || line.id || "").trim()} (${line.kind})`,
      })),
    ], {
      value: selectedOperationalLineId,
      signatureKey: "lineOptionsSignature",
    });
    if (operationalLineStartBtn) operationalLineStartBtn.disabled = isOperationalLineDrawing;
    if (operationalLineUndoBtn) operationalLineUndoBtn.disabled = !isOperationalLineDrawing;
    if (operationalLineFinishBtn) operationalLineFinishBtn.disabled = !isOperationalLineDrawing;
    if (operationalLineCancelBtn) operationalLineCancelBtn.disabled = !isOperationalLineDrawing;
    if (operationalLineDeleteBtn) operationalLineDeleteBtn.disabled = !hasSelectedOperationalLine;
    if (operationalLineEditorHint) {
      operationalLineEditorHint.textContent = isOperationalLineDrawing
        ? t("Click the map to place vertices. Double-click or press Finish to commit the operational line.", "ui")
        : hasSelectedOperationalLine
        ? t("Selected line can be restyled, relabeled, or deleted. Use the map to compose new lines.", "ui")
        : t("Choose a line type below or from the bottom command bar to begin drawing.", "ui");
    }
    if (isOperationalLineDrawing || hasSelectedOperationalLine) {
      const linesAccordion = document.getElementById("accordionLines");
      const linesAccordionHeader = linesAccordion?.querySelector?.(".strategic-accordion-header");
      linesAccordion?.classList.add("is-open");
      linesAccordionHeader?.setAttribute("aria-expanded", "true");
    }
    strategicCommandButtons.forEach((button) => {
      const active = String(button.dataset.lineKind || "") === String(state.strategicOverlayUi?.activeMode || "");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    }

    if (hasStrategicOverlayScope(normalizedScopes, "operationGraphics")) {
      recordStrategicOverlayPerfCounter("operationGraphics");
    const operationEditor = state.operationGraphicsEditor || {};
    const selectedGraphic = (state.operationGraphics || []).find(
      (graphic) => String(graphic?.id || "") === String(operationEditor.selectedId || "")
    ) || null;
    const selectedGraphicId = String(operationEditor.selectedId || "");
    const isGraphicDrawing = !!operationEditor.active;
    const useSelectedGraphicValues = !isGraphicDrawing && !!selectedGraphicId && !!selectedGraphic;
    const operationKind = String(
      useSelectedGraphicValues ? (selectedGraphic?.kind || "attack") : (operationEditor.kind || selectedGraphic?.kind || "attack")
    );
    const operationPreset = String(
      useSelectedGraphicValues
        ? (selectedGraphic?.stylePreset || operationKind || "attack")
        : (operationEditor.stylePreset || selectedGraphic?.stylePreset || operationKind || "attack")
    );
    const operationStroke = String(
      useSelectedGraphicValues ? (selectedGraphic?.stroke || "") : (operationEditor.stroke || selectedGraphic?.stroke || "")
    ).trim();
    const operationWidth = useSelectedGraphicValues
      ? Number(selectedGraphic?.width || 0)
      : (Number.isFinite(Number(operationEditor.width)) ? Number(operationEditor.width) : Number(selectedGraphic?.width || 0));
    const operationOpacity = useSelectedGraphicValues
      ? Number(selectedGraphic?.opacity ?? 1)
      : (Number.isFinite(Number(operationEditor.opacity)) ? Number(operationEditor.opacity) : Number(selectedGraphic?.opacity ?? 1));
    if (operationGraphicKindSelect) {
      operationGraphicKindSelect.value = operationKind;
    }
    if (operationGraphicLabelInput) {
      operationGraphicLabelInput.value = String(operationEditor.label || "");
    }
    if (operationGraphicPresetSelect) {
      operationGraphicPresetSelect.value = operationPreset;
    }
    if (operationGraphicStrokeInput) {
      operationGraphicStrokeInput.value = operationStroke || "#991b1b";
    }
    if (operationGraphicWidthInput) {
      operationGraphicWidthInput.value = String(Number(operationWidth || 0).toFixed(1).replace(/\.0$/, ""));
    }
    if (operationGraphicOpacityInput) {
      operationGraphicOpacityInput.value = String(Number(operationOpacity || 0).toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
    }
    syncSelectOptions(operationGraphicList, [
      { value: "", label: t("No operation graphics", "ui") },
      ...(state.operationGraphics || []).map((graphic) => ({
        value: String(graphic.id || ""),
        label: `${String(graphic.label || graphic.kind || graphic.id || "").trim()} (${graphic.kind})`,
      })),
    ], {
      value: selectedGraphicId,
      signatureKey: "graphicOptionsSignature",
    });
    const hasSelectedGraphic = !!String(operationEditor.selectedId || "").trim();
    const graphicMinPoints = selectedGraphic ? (["encirclement", "theater"].includes(String(selectedGraphic.kind || "")) ? 3 : 2) : 0;
    const canDeleteVertex = !!selectedGraphic
      && Number.isInteger(Number(operationEditor.selectedVertexIndex))
      && Number(operationEditor.selectedVertexIndex) >= 0
      && Array.isArray(selectedGraphic.points)
      && selectedGraphic.points.length > graphicMinPoints;
    if (operationGraphicStartBtn) operationGraphicStartBtn.disabled = isGraphicDrawing;
    if (operationGraphicUndoBtn) operationGraphicUndoBtn.disabled = !isGraphicDrawing;
    if (operationGraphicFinishBtn) operationGraphicFinishBtn.disabled = !isGraphicDrawing;
    if (operationGraphicCancelBtn) operationGraphicCancelBtn.disabled = !isGraphicDrawing;
    if (operationGraphicDeleteBtn) operationGraphicDeleteBtn.disabled = !hasSelectedGraphic;
    if (operationGraphicDeleteVertexBtn) operationGraphicDeleteVertexBtn.disabled = !canDeleteVertex;
    if (operationGraphicEditorHint) {
      operationGraphicEditorHint.textContent = isGraphicDrawing
        ? t("Click the map to place vertices. Double-click or press Finish to commit the line.", "ui")
        : hasSelectedGraphic
        ? t("Drag white handles to move vertices, click midpoint pips to insert, then remove the selected vertex if needed.", "ui")
        : t("Select a line to edit its geometry and style, or start a new drawing from the controls above.", "ui");
    }
    if (isGraphicDrawing || hasSelectedGraphic) {
      const graphicsAccordion = document.getElementById("accordionGraphics");
      const graphicsAccordionHeader = graphicsAccordion?.querySelector?.(".strategic-accordion-header");
      graphicsAccordion?.classList.add("is-open");
      graphicsAccordionHeader?.setAttribute("aria-expanded", "true");
    }
    }

    if (hasStrategicOverlayScope(normalizedScopes, "counterIdentity", "counterCombat", "counterPreview", "counterCatalog", "counterList", "workspaceChrome")) {
    const unitEditor = state.unitCounterEditor || {};
    const selectedCounter = (state.unitCounters || []).find(
      (counter) => String(counter?.id || "") === String(unitEditor.selectedId || "")
    ) || null;
    const effectivePresetId = String(
      unitEditor.presetId
      || selectedCounter?.presetId
      || inferUnitCounterPresetId({
        ...(selectedCounter || {}),
        ...(unitEditor || {}),
      })
      || unitCounterPresets[0].id
    ).trim().toUpperCase();
    const effectivePreset = getUnitCounterPresetMeta(effectivePresetId);
    const effectiveRenderer = String(
      unitEditor.renderer
      || selectedCounter?.renderer
      || effectivePreset.defaultRenderer
      || annotationView.unitRendererDefault
      || "game"
    );
    const effectiveUnitCounterFixedScaleMultiplier = clampUnitCounterFixedScaleMultiplier(
      annotationView.unitCounterFixedScaleMultiplier,
      1.5,
    );
    const effectiveSize = String(unitEditor.size || selectedCounter?.size || "medium");
    const effectiveNationSource = String(unitEditor.nationSource || selectedCounter?.nationSource || "display").trim().toLowerCase() || "display";
    const effectiveNationTag = String(unitEditor.nationTag || selectedCounter?.nationTag || "").trim().toUpperCase();
    const effectiveEchelon = String(unitEditor.echelon || selectedCounter?.echelon || effectivePreset.defaultEchelon || "").trim().toUpperCase();
    const effectiveLabel = String(unitEditor.label || selectedCounter?.label || "").trim();
    const effectiveSubLabel = String(unitEditor.subLabel || selectedCounter?.subLabel || "").trim();
    const effectiveStrengthText = String(unitEditor.strengthText || selectedCounter?.strengthText || "").trim();
    const effectiveCombatState = resolveUnitCounterCombatState({
      organizationPct: unitEditor.organizationPct ?? selectedCounter?.organizationPct,
      equipmentPct: unitEditor.equipmentPct ?? selectedCounter?.equipmentPct,
      baseFillColor: unitEditor.baseFillColor ?? selectedCounter?.baseFillColor,
      statsPresetId: unitEditor.statsPresetId || selectedCounter?.statsPresetId || "regular",
      statsSource: unitEditor.statsSource || selectedCounter?.statsSource || "preset",
    });
    const rawEffectiveSymbol = String(
      unitEditor.sidc
      || unitEditor.symbolCode
      || selectedCounter?.sidc
      || selectedCounter?.symbolCode
      || ""
    ).trim().toUpperCase();
    const effectiveSymbol = rawEffectiveSymbol || (
      effectiveRenderer === "milstd"
        ? String(effectivePreset.baseSidc || "").trim().toUpperCase()
        : String(effectivePreset.shortCode || "").trim().toUpperCase()
    );
    const nationOptions = getUnitCounterNationOptions();
    const shouldRefreshCounterIdentity = hasStrategicOverlayScope(normalizedScopes, "counterIdentity");
    const shouldRefreshCounterCombat = hasStrategicOverlayScope(normalizedScopes, "counterCombat");
    const shouldRefreshCounterPreview = hasStrategicOverlayScope(normalizedScopes, "counterPreview");
    const shouldRefreshCounterCatalog = hasStrategicOverlayScope(normalizedScopes, "counterCatalog");
    const shouldRefreshCounterList = hasStrategicOverlayScope(normalizedScopes, "counterList");
    if (shouldRefreshCounterIdentity) {
      recordStrategicOverlayPerfCounter("counterIdentity");
      syncSelectOptions(unitCounterPresetSelect, getSidebarUnitCounterPresetOptions(effectivePresetId).map((preset) => ({
        value: preset.id,
        label: `${preset.label} · ${preset.shortCode}`,
      })), {
        value: effectivePresetId,
        signatureKey: "presetOptionsSignature",
      });
      if (unitCounterNationModeSelect) {
        unitCounterNationModeSelect.value = effectiveNationSource === "manual" ? "manual" : "display";
      }
      const selectedNationValue = effectiveNationTag;
      const knownNationValues = new Set(["", ...nationOptions.map((entry) => entry.value)]);
      const nextNationOptions = nationOptions.slice();
      if (selectedNationValue && !knownNationValues.has(selectedNationValue)) {
        const fallbackMeta = getUnitCounterNationMeta(selectedNationValue);
        nextNationOptions.unshift({
          value: selectedNationValue,
          label: `${selectedNationValue} · ${fallbackMeta.displayName}`,
        });
      }
      syncSelectOptions(unitCounterNationSelect, [
        { value: "", label: t("Auto from placement", "ui") },
        ...nextNationOptions,
      ], {
        value: selectedNationValue,
        disabled: effectiveNationSource !== "manual",
        signatureKey: "nationOptionsSignature",
      });
      const selectedAttachmentLineId = String(unitEditor.attachment?.lineId || selectedCounter?.attachment?.lineId || "").trim();
      syncSelectOptions(unitCounterAttachmentSelect, [
        { value: "", label: t("Anchor: Province / Free", "ui") },
        ...(state.operationalLines || []).map((line) => ({
          value: String(line.id || ""),
          label: `${line.label || line.kind || line.id} (${line.kind})`,
        })),
      ], {
        value: selectedAttachmentLineId,
        signatureKey: "attachmentOptionsSignature",
      });
      if (unitCounterRendererSelect) unitCounterRendererSelect.value = effectiveRenderer;
      if (unitCounterSizeSelect) unitCounterSizeSelect.value = effectiveSize;
      if (unitCounterEchelonSelect) unitCounterEchelonSelect.value = effectiveEchelon;
      if (unitCounterLabelInput) unitCounterLabelInput.value = effectiveLabel;
      if (unitCounterSubLabelInput) unitCounterSubLabelInput.value = effectiveSubLabel;
      if (unitCounterStrengthInput) unitCounterStrengthInput.value = effectiveStrengthText;
      if (unitCounterSymbolInput) {
        unitCounterSymbolInput.value = effectiveSymbol;
        unitCounterSymbolInput.placeholder = effectiveRenderer === "milstd"
          ? t("SIDC (e.g. 130310001412110000000000000000)", "ui")
          : t("Short code (e.g. HQ / ARM / INF)", "ui");
      }
      if (unitCounterSymbolHint) {
        unitCounterSymbolHint.textContent = effectiveRenderer === "milstd"
          ? t("MILSTD uses the browser-loaded milsymbol renderer. Paste a full SIDC for the symbol body.", "ui")
          : t("Game renderer keeps the lighter counter style and uses a short internal code or abbreviation.", "ui");
      }
      if (state.unitCounterEditor?.selectedId || state.unitCounterEditor?.active || state.strategicOverlayUi?.counterEditorModalOpen) {
        const counterAccordion = document.getElementById("accordionCounters");
        const counterAccordionHeader = counterAccordion?.querySelector?.(".strategic-accordion-header");
        counterAccordion?.classList.add("is-open");
        counterAccordionHeader?.setAttribute("aria-expanded", "true");
      }
      if (unitCounterPlaceBtn) unitCounterPlaceBtn.disabled = !!unitEditor.active;
      if (unitCounterCancelBtn) unitCounterCancelBtn.disabled = !unitEditor.active;
      if (unitCounterDeleteBtn) unitCounterDeleteBtn.disabled = !String(unitEditor.selectedId || "").trim();
      if (unitCounterLabelsToggle) {
        unitCounterLabelsToggle.checked = annotationView.showUnitLabels !== false;
      }
      if (unitCounterFixedScaleRange) {
        unitCounterFixedScaleRange.value = String(Math.round(effectiveUnitCounterFixedScaleMultiplier * 100));
      }
      if (unitCounterFixedScaleValue) {
        unitCounterFixedScaleValue.textContent = `${effectiveUnitCounterFixedScaleMultiplier.toFixed(2)}x`;
      }
    }
    const placementStatusText = unitEditor.active
      ? t("Placing on map", "ui")
      : "";
    if (shouldRefreshCounterPreview) {
      recordStrategicOverlayPerfCounter("counterPreview");
      renderUnitCounterPreview(unitCounterPreviewCard, {
      renderer: effectiveRenderer,
      size: effectiveSize,
      nationTag: effectiveNationTag,
      nationSource: effectiveNationSource,
      label: effectiveLabel,
      subLabel: effectiveSubLabel,
      strengthText: effectiveStrengthText,
      sidc: effectiveSymbol,
      symbolCode: effectiveSymbol,
      presetId: effectivePresetId,
      echelon: effectiveEchelon,
      organizationPct: effectiveCombatState.organizationPct,
      equipmentPct: effectiveCombatState.equipmentPct,
      baseFillColor: effectiveCombatState.baseFillColor,
      statusText: placementStatusText,
      compactMode: true,
    });
      renderUnitCounterPreview(unitCounterDetailPreviewCard, {
      renderer: effectiveRenderer,
      size: effectiveSize,
      nationTag: effectiveNationTag,
      nationSource: effectiveNationSource,
      label: effectiveLabel,
      subLabel: effectiveSubLabel,
      strengthText: effectiveStrengthText,
      sidc: effectiveSymbol,
      symbolCode: effectiveSymbol,
      presetId: effectivePresetId,
      echelon: effectiveEchelon,
      organizationPct: effectiveCombatState.organizationPct,
      equipmentPct: effectiveCombatState.equipmentPct,
      baseFillColor: effectiveCombatState.baseFillColor,
      statusText: placementStatusText,
      detailMode: true,
    });
      if (unitCounterPlacementStatus) {
        unitCounterPlacementStatus.textContent = placementStatusText || t("Use the gear button for the full counter editor.", "ui");
        unitCounterPlacementStatus.classList.toggle("hidden", !placementStatusText);
      }
      if (unitCounterEditorModalStatus) {
        unitCounterEditorModalStatus.textContent = placementStatusText || t("Apply a symbol, then return to the map to continue placement or edit the selected counter live.", "ui");
        unitCounterEditorModalStatus.classList.toggle("hidden", false);
        unitCounterEditorModalStatus.dataset.mode = placementStatusText ? "placing" : "idle";
      }
    }
    if (shouldRefreshCounterCombat) {
      recordStrategicOverlayPerfCounter("counterCombat");
      if (unitCounterStatsPresetSelect) {
      unitCounterStatsPresetSelect.value = effectiveCombatState.statsPresetId === "random"
        ? "regular"
        : effectiveCombatState.statsPresetId;
      }
      unitCounterStatsPresetButtons.forEach((button) => {
        const value = String(button.dataset.value || "").trim().toLowerCase();
        const active = effectiveCombatState.statsPresetId !== "random" && value === effectiveCombatState.statsPresetId;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (unitCounterOrganizationInput) {
        unitCounterOrganizationInput.value = String(effectiveCombatState.organizationPct);
      }
      if (unitCounterEquipmentInput) {
        unitCounterEquipmentInput.value = String(effectiveCombatState.equipmentPct);
      }
      if (unitCounterOrganizationBar) {
        unitCounterOrganizationBar.style.width = `${effectiveCombatState.organizationPct}%`;
      }
      if (unitCounterEquipmentBar) {
        unitCounterEquipmentBar.style.width = `${effectiveCombatState.equipmentPct}%`;
      }
      const effectiveFillColor = effectiveCombatState.baseFillColor || "#f4f0e6";
      if (unitCounterBaseFillSwatch) {
        unitCounterBaseFillSwatch.style.setProperty("--unit-counter-fill-preview", effectiveFillColor);
        unitCounterBaseFillSwatch.dataset.active = effectiveCombatState.baseFillColor ? "true" : "false";
      }
      if (unitCounterBaseFillColorInput) {
        unitCounterBaseFillColorInput.value = /^#(?:[0-9a-f]{6})$/i.test(effectiveFillColor) ? effectiveFillColor : "#f4f0e6";
      }
      if (unitCounterBaseFillResetBtn) {
        unitCounterBaseFillResetBtn.disabled = !effectiveCombatState.baseFillColor;
      }
      if (unitCounterBaseFillEyedropperBtn) {
        unitCounterBaseFillEyedropperBtn.disabled = !("EyeDropper" in globalThis);
      }
    }
    if (shouldRefreshCounterCatalog) {
      recordStrategicOverlayPerfCounter("counterCatalog");
      ensureStrategicOverlayUiState();
      const catalogSource = state.strategicOverlayUi.counterCatalogSource || "internal";
      const usingHoi4Catalog = catalogSource === "hoi4";
      const hoi4PreferredVariant = state.strategicOverlayUi.hoi4CounterVariant === "large" ? "large" : "small";
      if (unitCounterCatalogHeaderTitle) {
        unitCounterCatalogHeaderTitle.textContent = usingHoi4Catalog
          ? t("HOI4 Library", "ui")
          : t("Symbol Browser", "ui");
      }
      if (unitCounterCatalogHeaderHint) {
        unitCounterCatalogHeaderHint.textContent = usingHoi4Catalog
          ? t("Review imported Hearts of Iron IV counter icons. This library is read-only for now.", "ui")
          : t("Search the internal counter catalog, then apply a preset back into the editor.", "ui");
      }
      if (unitCounterCatalogSourceTabs) {
        Array.from(unitCounterCatalogSourceTabs.querySelectorAll("[data-counter-catalog-source]")).forEach((element) => {
          const button = element instanceof HTMLButtonElement ? element : null;
          if (!button) return;
          const active = String(button.dataset.counterCatalogSource || "") === catalogSource;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
      if (unitCounterLibraryVariantRow) {
        unitCounterLibraryVariantRow.classList.toggle("hidden", !usingHoi4Catalog);
        Array.from(unitCounterLibraryVariantRow.querySelectorAll("[data-counter-library-variant]")).forEach((element) => {
          const button = element instanceof HTMLButtonElement ? element : null;
          if (!button) return;
          const active = String(button.dataset.counterLibraryVariant || "small") === hoi4PreferredVariant;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
      if (unitCounterLibraryReviewBar) {
        unitCounterLibraryReviewBar.classList.toggle("hidden", !usingHoi4Catalog);
      }
      if (unitCounterLibraryReviewSummary) {
        unitCounterLibraryReviewSummary.textContent = usingHoi4Catalog
          ? getHoi4ReviewSummaryText(effectivePresetId)
          : "";
      }
      if (unitCounterCatalogSearchInput) {
        unitCounterCatalogSearchInput.value = usingHoi4Catalog
          ? String(state.strategicOverlayUi?.hoi4CounterQuery || "")
          : String(state.strategicOverlayUi?.counterCatalogQuery || "");
        unitCounterCatalogSearchInput.placeholder = usingHoi4Catalog
          ? t("Search HOI4 sprite names, labels, keywords...", "ui")
          : t("Search internal presets, symbols, keywords...", "ui");
      }
      if (unitCounterCatalogCategoriesEl) {
        const categoryOptions = usingHoi4Catalog
          ? getHoi4CatalogFilterOptions(effectivePresetId)
          : [["all", t("All", "ui")], ...unitCounterCatalogCategories.map((category) => [category, getUnitCounterCategoryLabel(category)])];
        const activeCategory = usingHoi4Catalog
          ? String(state.strategicOverlayUi?.hoi4CounterCategory || "all")
          : String(state.strategicOverlayUi?.counterCatalogCategory || "all");
        unitCounterCatalogCategoriesEl.replaceChildren();
        categoryOptions.forEach(([categoryValue, label]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "counter-editor-category-btn";
          button.dataset.counterCatalogCategory = String(categoryValue || "");
          button.textContent = label;
          const active = activeCategory === String(categoryValue || "");
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
          unitCounterCatalogCategoriesEl.appendChild(button);
        });
      }
      if (unitCounterCatalogGrid && state.strategicOverlayUi?.counterEditorModalOpen) {
        cancelHoi4CatalogGridRender(unitCounterCatalogGrid);
        unitCounterCatalogGrid.replaceChildren();
        const emptyState = document.createElement("div");
        emptyState.className = "counter-editor-symbol-empty";
        if (!usingHoi4Catalog) {
          const filteredCatalog = getFilteredUnitCounterCatalog({
            category: state.strategicOverlayUi?.counterCatalogCategory || "all",
            query: state.strategicOverlayUi?.counterCatalogQuery || "",
          });
          if (!filteredCatalog.length) {
            emptyState.textContent = t("No symbols match the current filter.", "ui");
            unitCounterCatalogGrid.appendChild(emptyState);
          } else {
            filteredCatalog.forEach((preset) => {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "counter-editor-symbol-card";
              button.dataset.unitCounterCatalogPreset = preset.id;
              const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
              icon.setAttribute("viewBox", "-5 -5 10 10");
              icon.setAttribute("aria-hidden", "true");
              const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
              path.setAttribute("d", getUnitCounterIconPathById(preset.iconId));
              icon.appendChild(path);
              const title = document.createElement("span");
              title.className = "counter-editor-symbol-card-title";
              title.textContent = preset.label;
              const subtitle = document.createElement("span");
              subtitle.className = "counter-editor-symbol-card-subtitle";
              subtitle.textContent = `${preset.shortCode} · ${getUnitCounterCategoryLabel(preset.category)}`;
              const active = preset.id === effectivePresetId;
              button.classList.toggle("is-active", active);
              button.setAttribute("aria-pressed", active ? "true" : "false");
              button.append(icon, title, subtitle);
              unitCounterCatalogGrid.appendChild(button);
            });
          }
        } else {
          if (hoi4UnitIconManifestStatus === "idle") {
            ensureHoi4UnitIconManifest();
          }
          if (hoi4UnitIconManifestStatus === "loading" || hoi4UnitIconManifestStatus === "idle") {
            emptyState.textContent = t("Loading HOI4 unit icon library...", "ui");
            unitCounterCatalogGrid.appendChild(emptyState);
          } else if (hoi4UnitIconManifestStatus === "error") {
            emptyState.textContent = hoi4UnitIconManifestError?.message
              ? String(hoi4UnitIconManifestError.message)
              : t("Failed to load the HOI4 unit icon library.", "ui");
            unitCounterCatalogGrid.appendChild(emptyState);
          } else {
            const filteredEntries = filterHoi4UnitIconEntries(hoi4UnitIconManifestData?.entries || [], {
              filter: state.strategicOverlayUi?.hoi4CounterCategory || "all",
              query: state.strategicOverlayUi?.hoi4CounterQuery || "",
              currentPresetId: effectivePresetId,
              getMappedPresetIds: getHoi4EffectiveMappedPresetIds,
            });
            renderHoi4CatalogCards(unitCounterCatalogGrid, filteredEntries, {
              effectivePresetId,
              preferredVariant: hoi4PreferredVariant,
            });
            /* Legacy two-preview fallback retained only as commented reference during cleanup.
              filteredEntries.forEach((entry) => {
                const card = document.createElement("div");
                card.className = "counter-editor-symbol-card counter-editor-hoi4-card";
                const previewSet = getHoi4UnitIconPreviewSet(entry, hoi4PreferredVariant);
                const previewRow = document.createElement("div");
                previewRow.className = "counter-editor-hoi4-preview-row";
                const createPreview = (label, src, preferred = false) => {
                  const box = document.createElement("div");
                  box.className = "counter-editor-hoi4-preview";
                  if (preferred) {
                    box.classList.add("is-preferred");
                  }
                  const previewLabel = document.createElement("span");
                  previewLabel.className = "counter-editor-hoi4-preview-label";
                  previewLabel.textContent = label;
                  if (src) {
                    const image = document.createElement("img");
                    image.src = src;
                    image.alt = `${entry.label} ${label}`;
                    image.loading = "lazy";
                    box.appendChild(image);
                  } else {
                    const fallback = document.createElement("span");
                    fallback.className = "counter-editor-symbol-card-subtitle";
                    fallback.textContent = t("Missing", "ui");
                    box.appendChild(fallback);
                  }
                  box.appendChild(previewLabel);
                  return box;
                };
                previewRow.append(
                  createPreview(t("Small", "ui"), previewSet.small, hoi4PreferredVariant === "small"),
                  createPreview(t("Large", "ui"), previewSet.large, hoi4PreferredVariant === "large")
                );
                const title = document.createElement("span");
                title.className = "counter-editor-symbol-card-title";
                title.textContent = entry.label;
                const subtitle = document.createElement("span");
                subtitle.className = "counter-editor-symbol-card-subtitle";
                subtitle.textContent = `${entry.domain} · ${formatEntryKind(entry.kind)}`;
                const path = document.createElement("div");
                path.className = "counter-editor-hoi4-path";
                path.textContent = entry.sourceGamePath || entry.sourceTextureFile || entry.spriteName;
                const meta = document.createElement("div");
                meta.className = "counter-editor-hoi4-meta";
                meta.textContent = entry.spriteName;
                const tags = document.createElement("div");
                tags.className = "counter-editor-hoi4-tags";
                const presetTags = Array.isArray(entry.mappedPresetIds) && entry.mappedPresetIds.length
                  ? entry.mappedPresetIds
                  : ["unmapped"];
                presetTags.forEach((presetId) => {
                  const tag = document.createElement("span");
                  tag.className = "counter-editor-hoi4-tag";
                  tag.textContent = presetId === "unmapped" ? t("Unmapped", "ui") : presetId.toUpperCase();
                  tags.appendChild(tag);
                });
                card.append(previewRow, title, subtitle, meta, path, tags);
                unitCounterCatalogGrid.appendChild(card);
              }); */
            }
          }
        }
      }
    if (shouldRefreshCounterList) {
      recordStrategicOverlayPerfCounter("counterList");
      suppressUnitCounterListChange = true;
      try {
        syncSelectOptions(unitCounterList, [
          { value: "", label: t("No unit counters", "ui") },
          ...(state.unitCounters || []).map((counter) => ({
            value: String(counter.id || ""),
            label: formatUnitCounterListLabel(counter),
          })),
        ], {
          value: String(unitEditor.selectedId || ""),
          signatureKey: "counterListOptionsSignature",
        });
      } finally {
        suppressUnitCounterListChange = false;
      }
    }
    }

    if (hasStrategicOverlayScope(normalizedScopes, "badgeCounts", "operationalLines", "operationGraphics", "counterList")) {
      recordStrategicOverlayPerfCounter("badgeCounts");
      const linesBadge = document.querySelector("#accordionLines .strategic-accordion-badge");
      const graphicsBadge = document.querySelector("#accordionGraphics .strategic-accordion-badge");
      const countersBadge = document.querySelector("#accordionCounters .strategic-accordion-badge");
      if (linesBadge) linesBadge.textContent = String((state.operationalLines || []).length);
      if (graphicsBadge) graphicsBadge.textContent = String((state.operationGraphics || []).length);
      if (countersBadge) countersBadge.textContent = String((state.unitCounters || []).length);
    }
  };

  state.updateLegendUI = refreshLegendEditor;
  state.updateStrategicOverlayUIFn = refreshStrategicOverlayUI;
  state.getStrategicOverlayPerfCountersFn = () => ({ ...strategicOverlayPerfCounters });
  state.refreshCountryListRowsFn = refreshCountryRows;
  state.refreshCountryInspectorDetailFn = renderCountryInspectorDetail;
  setRightSidebarTab(state.ui?.rightSidebarTab || "inspector");
  refreshStrategicOverlayUI();

  inspectorSidebarTabButtons.forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener("click", () => {
      setRightSidebarTab(button.dataset.inspectorTab || "inspector");
    });
    button.dataset.bound = "true";
  });

  if (frontlineEnabledToggle && !frontlineEnabledToggle.dataset.bound) {
    frontlineEnabledToggle.addEventListener("change", (event) => {
      const nextEnabled = !!event.target.checked;
      applyFrontlineAnnotationViewPatch(
        { frontlineEnabled: nextEnabled },
        nextEnabled ? "frontline-enabled" : "frontline-disabled"
      );
    });
    frontlineEnabledToggle.dataset.bound = "true";
  }

  if (strategicFrontlineStyleSelect && !strategicFrontlineStyleSelect.dataset.bound) {
    strategicFrontlineStyleSelect.addEventListener("change", (event) => {
      applyFrontlineAnnotationViewPatch(
        { frontlineStyle: String(event.target.value || "clean") },
        "frontline-style"
      );
    });
    strategicFrontlineStyleSelect.dataset.bound = "true";
  }
  frontlineStyleChoiceButtons.forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener("click", () => {
      const nextStyle = String(button.dataset.value || "clean");
      if (strategicFrontlineStyleSelect) {
        strategicFrontlineStyleSelect.value = nextStyle;
      }
      applyFrontlineAnnotationViewPatch(
        { frontlineStyle: nextStyle },
        "frontline-style"
      );
    });
    button.dataset.bound = "true";
  });
  if (strategicFrontlineLabelsToggle && !strategicFrontlineLabelsToggle.dataset.bound) {
    strategicFrontlineLabelsToggle.addEventListener("change", (event) => {
      applyFrontlineAnnotationViewPatch(
        { showFrontlineLabels: !!event.target.checked },
        "frontline-labels"
      );
    });
    strategicFrontlineLabelsToggle.dataset.bound = "true";
  }
  if (strategicLabelPlacementSelect && !strategicLabelPlacementSelect.dataset.bound) {
    strategicLabelPlacementSelect.addEventListener("change", (event) => {
      applyFrontlineAnnotationViewPatch(
        { labelPlacementMode: String(event.target.value || "midpoint") },
        "frontline-label-placement"
      );
    });
    strategicLabelPlacementSelect.dataset.bound = "true";
  }

  if (strategicOverlayOpenWorkspaceBtn && !strategicOverlayOpenWorkspaceBtn.dataset.bound) {
    strategicOverlayOpenWorkspaceBtn.addEventListener("click", () => {
      const currentSection = String(state.strategicOverlayUi?.modalSection || "line");
      const preferredSection = currentSection === "counter" ? "line" : currentSection;
      setStrategicWorkspaceModalState(true, preferredSection);
    });
    strategicOverlayOpenWorkspaceBtn.dataset.bound = "true";
  }
  if (strategicOverlayCloseWorkspaceBtn && !strategicOverlayCloseWorkspaceBtn.dataset.bound) {
    strategicOverlayCloseWorkspaceBtn.addEventListener("click", () => {
      setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
    });
    strategicOverlayCloseWorkspaceBtn.dataset.bound = "true";
  }
  if (strategicOverlayIconCloseBtn && !strategicOverlayIconCloseBtn.dataset.bound) {
    strategicOverlayIconCloseBtn.addEventListener("click", () => {
      setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
    });
    strategicOverlayIconCloseBtn.dataset.bound = "true";
  }
  if (!document.body.dataset.strategicWorkspaceEscapeBound) {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.strategicOverlayUi?.modalOpen) return;
      setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
    });
    document.body.dataset.strategicWorkspaceEscapeBound = "true";
  }
  strategicCommandButtons.forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener("click", () => {
      const nextKind = String(button.dataset.lineKind || "frontline");
      state.strategicOverlayUi = {
        ...(state.strategicOverlayUi || {}),
        activeMode: nextKind,
        modalSection: "line",
      };
      if (operationalLineKindSelect) operationalLineKindSelect.value = nextKind;
      mapRenderer.startOperationalLineDraw({
        kind: nextKind,
        stylePreset: nextKind,
        label: String(operationalLineLabelInput?.value || ""),
        stroke: String(operationalLineStrokeInput?.value || ""),
        width: Number(operationalLineWidthInput?.value || 0),
        opacity: Number(operationalLineOpacityInput?.value || 1),
      });
      refreshStrategicOverlayUI();
    });
    button.dataset.bound = "true";
  });

  if (operationalLineKindSelect && !operationalLineKindSelect.dataset.bound) {
    operationalLineKindSelect.addEventListener("change", (event) => {
      const nextKind = String(event.target.value || "frontline");
      state.operationalLineEditor.kind = nextKind;
      state.operationalLineEditor.stylePreset = nextKind;
      state.strategicOverlayUi = {
        ...(state.strategicOverlayUi || {}),
        activeMode: nextKind,
        modalSection: "line",
      };
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ kind: nextKind, stylePreset: nextKind });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineKindSelect.dataset.bound = "true";
  }
  if (operationalLineLabelInput && !operationalLineLabelInput.dataset.bound) {
    operationalLineLabelInput.addEventListener("input", (event) => {
      state.operationalLineEditor.label = String(event.target.value || "");
    });
    operationalLineLabelInput.addEventListener("change", (event) => {
      const nextLabel = String(event.target.value || "");
      state.operationalLineEditor.label = nextLabel;
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ label: nextLabel });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineLabelInput.dataset.bound = "true";
  }
  if (operationalLineStrokeInput && !operationalLineStrokeInput.dataset.bound) {
    operationalLineStrokeInput.addEventListener("change", (event) => {
      const nextStroke = String(event.target.value || "");
      state.operationalLineEditor.stroke = nextStroke;
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ stroke: nextStroke });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineStrokeInput.dataset.bound = "true";
  }
  if (operationalLineWidthInput && !operationalLineWidthInput.dataset.bound) {
    operationalLineWidthInput.addEventListener("change", (event) => {
      const nextWidth = Number(event.target.value || 0);
      state.operationalLineEditor.width = nextWidth;
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ width: nextWidth });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineWidthInput.dataset.bound = "true";
  }
  if (operationalLineOpacityInput && !operationalLineOpacityInput.dataset.bound) {
    operationalLineOpacityInput.addEventListener("change", (event) => {
      const nextOpacity = Number(event.target.value || 1);
      state.operationalLineEditor.opacity = nextOpacity;
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ opacity: nextOpacity });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineOpacityInput.dataset.bound = "true";
  }
  if (operationalLineStartBtn && !operationalLineStartBtn.dataset.bound) {
    operationalLineStartBtn.addEventListener("click", () => {
      const nextKind = String(operationalLineKindSelect?.value || state.operationalLineEditor?.kind || "frontline");
      state.strategicOverlayUi = {
        ...(state.strategicOverlayUi || {}),
        activeMode: nextKind,
        modalSection: "line",
      };
      mapRenderer.startOperationalLineDraw({
        kind: nextKind,
        label: String(operationalLineLabelInput?.value || state.operationalLineEditor?.label || ""),
        stylePreset: nextKind,
        stroke: String(operationalLineStrokeInput?.value || state.operationalLineEditor?.stroke || ""),
        width: Number(operationalLineWidthInput?.value || state.operationalLineEditor?.width || 0),
        opacity: Number(operationalLineOpacityInput?.value || state.operationalLineEditor?.opacity || 1),
      });
      refreshStrategicOverlayUI();
    });
    operationalLineStartBtn.dataset.bound = "true";
  }
  if (operationalLineUndoBtn && !operationalLineUndoBtn.dataset.bound) {
    operationalLineUndoBtn.addEventListener("click", () => {
      mapRenderer.undoOperationalLineVertex();
      refreshStrategicOverlayUI();
    });
    operationalLineUndoBtn.dataset.bound = "true";
  }
  if (operationalLineFinishBtn && !operationalLineFinishBtn.dataset.bound) {
    operationalLineFinishBtn.addEventListener("click", () => {
      mapRenderer.finishOperationalLineDraw();
      refreshStrategicOverlayUI();
    });
    operationalLineFinishBtn.dataset.bound = "true";
  }
  if (operationalLineCancelBtn && !operationalLineCancelBtn.dataset.bound) {
    operationalLineCancelBtn.addEventListener("click", () => {
      mapRenderer.cancelOperationalLineDraw();
      refreshStrategicOverlayUI();
    });
    operationalLineCancelBtn.dataset.bound = "true";
  }
  if (operationalLineList && !operationalLineList.dataset.bound) {
    operationalLineList.addEventListener("change", (event) => {
      state.strategicOverlayUi = {
        ...(state.strategicOverlayUi || {}),
        modalSection: "line",
      };
      mapRenderer.selectOperationalLineById(String(event.target.value || ""));
      refreshStrategicOverlayUI();
    });
    operationalLineList.dataset.bound = "true";
  }
  if (operationalLineDeleteBtn && !operationalLineDeleteBtn.dataset.bound) {
    operationalLineDeleteBtn.addEventListener("click", async () => {
      if (!state.operationalLineEditor?.selectedId) return;
      const confirmed = await showAppDialog({
        title: t("Delete Selected", "ui"),
        message: t("Delete the selected operational line?", "ui"),
        details: t("Attached counters will fall back to province or free anchors.", "ui"),
        confirmLabel: t("Delete Line", "ui"),
        cancelLabel: t("Cancel", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      mapRenderer.deleteSelectedOperationalLine();
      refreshStrategicOverlayUI();
    });
    operationalLineDeleteBtn.dataset.bound = "true";
  }

  if (operationGraphicKindSelect && !operationGraphicKindSelect.dataset.bound) {
    operationGraphicKindSelect.addEventListener("change", (event) => {
      const nextKind = String(event.target.value || "attack");
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ kind: nextKind });
      } else {
        state.operationGraphicsEditor.kind = nextKind;
        if (render) {
          render();
        }
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicKindSelect.dataset.bound = "true";
  }
  if (operationGraphicPresetSelect && !operationGraphicPresetSelect.dataset.bound) {
    operationGraphicPresetSelect.addEventListener("change", (event) => {
      const nextPreset = String(event.target.value || "attack");
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ stylePreset: nextPreset });
      } else {
        state.operationGraphicsEditor.stylePreset = nextPreset;
        if (render) {
          render();
        }
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicPresetSelect.dataset.bound = "true";
  }
  if (operationGraphicLabelInput && !operationGraphicLabelInput.dataset.bound) {
    operationGraphicLabelInput.addEventListener("input", (event) => {
      state.operationGraphicsEditor.label = String(event.target.value || "");
    });
    operationGraphicLabelInput.addEventListener("change", (event) => {
      const nextLabel = String(event.target.value || "");
      state.operationGraphicsEditor.label = nextLabel;
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ label: nextLabel });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicLabelInput.dataset.bound = "true";
  }
  if (operationGraphicStrokeInput && !operationGraphicStrokeInput.dataset.bound) {
    operationGraphicStrokeInput.addEventListener("change", (event) => {
      const nextStroke = String(event.target.value || "");
      state.operationGraphicsEditor.stroke = nextStroke;
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ stroke: nextStroke });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicStrokeInput.dataset.bound = "true";
  }
  if (operationGraphicWidthInput && !operationGraphicWidthInput.dataset.bound) {
    operationGraphicWidthInput.addEventListener("change", (event) => {
      const nextWidth = Number(event.target.value || 0);
      state.operationGraphicsEditor.width = nextWidth;
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ width: nextWidth });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicWidthInput.dataset.bound = "true";
  }
  if (operationGraphicOpacityInput && !operationGraphicOpacityInput.dataset.bound) {
    operationGraphicOpacityInput.addEventListener("change", (event) => {
      const nextOpacity = Number(event.target.value || 1);
      state.operationGraphicsEditor.opacity = nextOpacity;
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ opacity: nextOpacity });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicOpacityInput.dataset.bound = "true";
  }
  if (operationGraphicStartBtn && !operationGraphicStartBtn.dataset.bound) {
    operationGraphicStartBtn.addEventListener("click", () => {
      mapRenderer.startOperationGraphicDraw({
        kind: String(operationGraphicKindSelect?.value || state.operationGraphicsEditor?.kind || "attack"),
        label: String(operationGraphicLabelInput?.value || state.operationGraphicsEditor?.label || ""),
        stylePreset: String(operationGraphicPresetSelect?.value || state.operationGraphicsEditor?.stylePreset || "attack"),
        stroke: String(operationGraphicStrokeInput?.value || state.operationGraphicsEditor?.stroke || ""),
        width: Number(operationGraphicWidthInput?.value || state.operationGraphicsEditor?.width || 0),
        opacity: Number(operationGraphicOpacityInput?.value || state.operationGraphicsEditor?.opacity || 1),
      });
      refreshStrategicOverlayUI();
    });
    operationGraphicStartBtn.dataset.bound = "true";
  }
  if (operationGraphicUndoBtn && !operationGraphicUndoBtn.dataset.bound) {
    operationGraphicUndoBtn.addEventListener("click", () => {
      mapRenderer.undoOperationGraphicVertex();
      refreshStrategicOverlayUI();
    });
    operationGraphicUndoBtn.dataset.bound = "true";
  }
  if (operationGraphicFinishBtn && !operationGraphicFinishBtn.dataset.bound) {
    operationGraphicFinishBtn.addEventListener("click", () => {
      mapRenderer.finishOperationGraphicDraw();
      refreshStrategicOverlayUI();
    });
    operationGraphicFinishBtn.dataset.bound = "true";
  }
  if (operationGraphicCancelBtn && !operationGraphicCancelBtn.dataset.bound) {
    operationGraphicCancelBtn.addEventListener("click", () => {
      mapRenderer.cancelOperationGraphicDraw();
      refreshStrategicOverlayUI();
    });
    operationGraphicCancelBtn.dataset.bound = "true";
  }
  if (operationGraphicList && !operationGraphicList.dataset.bound) {
    operationGraphicList.addEventListener("change", (event) => {
      mapRenderer.selectOperationGraphicById(String(event.target.value || ""));
      refreshStrategicOverlayUI();
    });
    operationGraphicList.dataset.bound = "true";
  }
  if (operationGraphicDeleteBtn && !operationGraphicDeleteBtn.dataset.bound) {
    operationGraphicDeleteBtn.addEventListener("click", async () => {
      if (!state.operationGraphicsEditor?.selectedId) return;
      const confirmed = await showAppDialog({
        title: t("Delete Selected", "ui"),
        message: t("Delete the selected operation graphic?", "ui"),
        details: t("This only removes the selected project-local strategic line.", "ui"),
        confirmLabel: t("Delete Graphic", "ui"),
        cancelLabel: t("Cancel", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      mapRenderer.deleteSelectedOperationGraphic();
      refreshStrategicOverlayUI();
    });
    operationGraphicDeleteBtn.dataset.bound = "true";
  }
  if (operationGraphicDeleteVertexBtn && !operationGraphicDeleteVertexBtn.dataset.bound) {
    operationGraphicDeleteVertexBtn.addEventListener("click", () => {
      mapRenderer.deleteSelectedOperationGraphicVertex();
      refreshStrategicOverlayUI();
    });
    operationGraphicDeleteVertexBtn.dataset.bound = "true";
  }

  const syncUnitCounterCombatStateToSelection = (partial = {}, { commitSelected = true } = {}) => {
    const nextCombatState = resolveUnitCounterCombatState({
      organizationPct: partial.organizationPct ?? state.unitCounterEditor.organizationPct,
      equipmentPct: partial.equipmentPct ?? state.unitCounterEditor.equipmentPct,
      baseFillColor: partial.baseFillColor ?? state.unitCounterEditor.baseFillColor,
      statsPresetId: partial.statsPresetId ?? state.unitCounterEditor.statsPresetId,
      statsSource: partial.statsSource ?? state.unitCounterEditor.statsSource,
    });
    state.unitCounterEditor.organizationPct = nextCombatState.organizationPct;
    state.unitCounterEditor.equipmentPct = nextCombatState.equipmentPct;
    state.unitCounterEditor.baseFillColor = nextCombatState.baseFillColor;
    state.unitCounterEditor.statsPresetId = nextCombatState.statsPresetId;
    state.unitCounterEditor.statsSource = nextCombatState.statsSource;
    if (commitSelected && !state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
      mapRenderer.updateSelectedUnitCounter(nextCombatState);
    } else if (render) {
      render();
    }
    scheduleStrategicOverlayRefresh(["counterCombat", "counterPreview"]);
  };
  const applyUnitCounterCombatPreset = (presetId, { source = "preset" } = {}) => {
    const preset = getUnitCounterCombatPreset(presetId);
    syncUnitCounterCombatStateToSelection({
      organizationPct: preset.organizationPct,
      equipmentPct: preset.equipmentPct,
      statsPresetId: preset.id,
      statsSource: source,
    });
  };
  const applyUnitCounterPresetSelection = (nextPresetId, { commitSelected = true } = {}) => {
    const normalizedPresetId = String(nextPresetId || unitCounterPresets[0].id).trim().toUpperCase();
    const nextPreset = getUnitCounterPresetMeta(normalizedPresetId);
    const nextRenderer = String(nextPreset.defaultRenderer || "game").trim().toLowerCase();
    const fallbackToken = nextRenderer === "milstd"
      ? String(nextPreset.baseSidc || "").trim().toUpperCase()
      : String(nextPreset.shortCode || "").trim().toUpperCase();
    state.unitCounterEditor.presetId = normalizedPresetId;
    state.unitCounterEditor.iconId = String(nextPreset.iconId || "").trim().toLowerCase();
    state.unitCounterEditor.unitType = String(nextPreset.unitType || nextPreset.id || "").trim().toUpperCase();
    state.unitCounterEditor.renderer = nextRenderer;
    state.unitCounterEditor.echelon = String(nextPreset.defaultEchelon || "").trim().toUpperCase();
    state.unitCounterEditor.sidc = fallbackToken;
    state.unitCounterEditor.symbolCode = fallbackToken;
    if (commitSelected && !state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
      mapRenderer.updateSelectedUnitCounter({
        presetId: normalizedPresetId,
        iconId: state.unitCounterEditor.iconId,
        unitType: state.unitCounterEditor.unitType,
        renderer: String(state.unitCounterEditor.renderer || nextRenderer).trim().toLowerCase(),
        echelon: String(state.unitCounterEditor.echelon || nextPreset.defaultEchelon || "").trim().toUpperCase(),
        sidc: String(state.unitCounterEditor.sidc || state.unitCounterEditor.symbolCode || fallbackToken || "").trim().toUpperCase(),
      });
    } else if (render) {
      render();
    }
    scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview", "counterCatalog"]);
  };

  if (unitCounterPresetSelect && !unitCounterPresetSelect.dataset.bound) {
    unitCounterPresetSelect.addEventListener("change", (event) => {
      applyUnitCounterPresetSelection(String(event.target.value || unitCounterPresets[0].id));
    });
    unitCounterPresetSelect.dataset.bound = "true";
  }
  if (unitCounterNationModeSelect && !unitCounterNationModeSelect.dataset.bound) {
    unitCounterNationModeSelect.addEventListener("change", (event) => {
      const nextMode = String(event.target.value || "display").trim().toLowerCase();
      state.unitCounterEditor.nationSource = nextMode === "manual" ? "manual" : "display";
      if (nextMode !== "manual") {
        state.unitCounterEditor.nationTag = "";
      }
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({
          nationSource: state.unitCounterEditor.nationSource,
          nationTag: state.unitCounterEditor.nationTag,
        });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterNationModeSelect.dataset.bound = "true";
  }
  if (unitCounterNationSelect && !unitCounterNationSelect.dataset.bound) {
    unitCounterNationSelect.addEventListener("change", (event) => {
      const nextNationTag = String(event.target.value || "").trim().toUpperCase();
      state.unitCounterEditor.nationTag = nextNationTag;
      state.unitCounterEditor.nationSource = nextNationTag ? "manual" : "display";
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({
          nationTag: nextNationTag,
          nationSource: state.unitCounterEditor.nationSource,
        });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterNationSelect.dataset.bound = "true";
  }
  if (unitCounterAttachmentSelect && !unitCounterAttachmentSelect.dataset.bound) {
    unitCounterAttachmentSelect.addEventListener("change", (event) => {
      const nextLineId = String(event.target.value || "").trim();
      state.unitCounterEditor.attachment = nextLineId
        ? { kind: "operational-line", lineId: nextLineId }
        : null;
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ attachment: state.unitCounterEditor.attachment });
      } else if (render) {
        render();
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterAttachmentSelect.dataset.bound = "true";
  }
  if (unitCounterRendererSelect && !unitCounterRendererSelect.dataset.bound) {
    unitCounterRendererSelect.addEventListener("change", (event) => {
      const nextRenderer = String(event.target.value || "game");
      state.unitCounterEditor.renderer = nextRenderer;
      if (nextRenderer === "milstd" && !String(state.unitCounterEditor.sidc || state.unitCounterEditor.symbolCode || "").trim()) {
        state.unitCounterEditor.sidc = "130310001412110000000000000000";
        state.unitCounterEditor.symbolCode = state.unitCounterEditor.sidc;
      }
      state.annotationView = {
        ...(state.annotationView || {}),
        unitRendererDefault: nextRenderer,
      };
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ renderer: nextRenderer });
      } else if (render) {
        render();
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
      markDirty("unit-counter-renderer");
    });
    unitCounterRendererSelect.dataset.bound = "true";
  }
  if (unitCounterSizeSelect && !unitCounterSizeSelect.dataset.bound) {
    unitCounterSizeSelect.addEventListener("change", (event) => {
      const nextSize = String(event.target.value || "medium");
      state.unitCounterEditor.size = nextSize;
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ size: nextSize });
      } else if (render) {
        render();
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterSizeSelect.dataset.bound = "true";
  }
  if (unitCounterEchelonSelect && !unitCounterEchelonSelect.dataset.bound) {
    unitCounterEchelonSelect.addEventListener("change", (event) => {
      state.unitCounterEditor.echelon = String(event.target.value || "").trim().toUpperCase();
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ echelon: state.unitCounterEditor.echelon });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterEchelonSelect.dataset.bound = "true";
  }
  if (unitCounterLabelInput && !unitCounterLabelInput.dataset.bound) {
    unitCounterLabelInput.addEventListener("input", (event) => {
      state.unitCounterEditor.label = String(event.target.value || "");
      scheduleStrategicOverlayRefresh("counterPreview");
    });
    unitCounterLabelInput.addEventListener("change", (event) => {
      const nextLabel = String(event.target.value || "");
      state.unitCounterEditor.label = nextLabel;
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ label: nextLabel });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview", "counterList"]);
    });
    unitCounterLabelInput.dataset.bound = "true";
  }
  if (unitCounterSubLabelInput && !unitCounterSubLabelInput.dataset.bound) {
    unitCounterSubLabelInput.addEventListener("input", (event) => {
      state.unitCounterEditor.subLabel = String(event.target.value || "");
      scheduleStrategicOverlayRefresh("counterPreview");
    });
    unitCounterSubLabelInput.addEventListener("change", (event) => {
      state.unitCounterEditor.subLabel = String(event.target.value || "");
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ subLabel: state.unitCounterEditor.subLabel });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterSubLabelInput.dataset.bound = "true";
  }
  if (unitCounterStrengthInput && !unitCounterStrengthInput.dataset.bound) {
    unitCounterStrengthInput.addEventListener("input", (event) => {
      state.unitCounterEditor.strengthText = String(event.target.value || "");
      scheduleStrategicOverlayRefresh("counterPreview");
    });
    unitCounterStrengthInput.addEventListener("change", (event) => {
      state.unitCounterEditor.strengthText = String(event.target.value || "");
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ strengthText: state.unitCounterEditor.strengthText });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterStrengthInput.dataset.bound = "true";
  }
  if (unitCounterSymbolInput && !unitCounterSymbolInput.dataset.bound) {
    unitCounterSymbolInput.addEventListener("input", (event) => {
      const nextToken = String(event.target.value || "").trim().toUpperCase();
      state.unitCounterEditor.sidc = nextToken;
      state.unitCounterEditor.symbolCode = nextToken;
      scheduleStrategicOverlayRefresh("counterPreview");
    });
    unitCounterSymbolInput.addEventListener("change", (event) => {
      const nextSymbol = String(event.target.value || "").trim().toUpperCase();
      state.unitCounterEditor.sidc = nextSymbol;
      state.unitCounterEditor.symbolCode = nextSymbol;
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ sidc: nextSymbol });
      } else if (render) {
        render();
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterSymbolInput.dataset.bound = "true";
  }
  if (unitCounterDetailToggleBtn && !unitCounterDetailToggleBtn.dataset.bound) {
    unitCounterDetailToggleBtn.addEventListener("click", () => {
      ensureStrategicOverlayUiState();
      state.strategicOverlayUi.counterEditorModalOpen = true;
      refreshStrategicOverlayUI({
        scopes: ["workspaceChrome", "counterIdentity", "counterCombat", "counterPreview", "counterCatalog"],
      });
    });
    unitCounterDetailToggleBtn.dataset.bound = "true";
  }
  if (unitCounterEditorModalCloseBtn && !unitCounterEditorModalCloseBtn.dataset.bound) {
    unitCounterEditorModalCloseBtn.addEventListener("click", () => {
      setCounterEditorModalState(false);
      refreshStrategicOverlayUI({ scopes: ["workspaceChrome"] });
    });
    unitCounterEditorModalCloseBtn.dataset.bound = "true";
  }
  if (unitCounterEditorModalOverlay && !unitCounterEditorModalOverlay.dataset.bound) {
    unitCounterEditorModalOverlay.addEventListener("click", (event) => {
      if (event.target !== unitCounterEditorModalOverlay) return;
      setCounterEditorModalState(false);
      refreshStrategicOverlayUI({ scopes: ["workspaceChrome"] });
    });
    unitCounterEditorModalOverlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCounterEditorModalState(false);
        refreshStrategicOverlayUI({ scopes: ["workspaceChrome"] });
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = getCounterEditorModalFocusableElements();
      if (!focusables.length) {
        event.preventDefault();
        unitCounterEditorModal?.focus({ preventScroll: true });
        return;
      }
      const currentIndex = focusables.indexOf(document.activeElement);
      if (currentIndex === -1) {
        event.preventDefault();
        focusables[0].focus({ preventScroll: true });
        return;
      }
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      const nextIndex = (currentIndex + delta + focusables.length) % focusables.length;
      focusables[nextIndex].focus({ preventScroll: true });
    });
    unitCounterEditorModalOverlay.dataset.bound = "true";
  }
  if (unitCounterCatalogSearchInput && !unitCounterCatalogSearchInput.dataset.bound) {
    unitCounterCatalogSearchInput.addEventListener("input", (event) => {
      ensureStrategicOverlayUiState();
      if (state.strategicOverlayUi.counterCatalogSource === "hoi4") {
        state.strategicOverlayUi.hoi4CounterQuery = String(event.target.value || "");
      } else {
        state.strategicOverlayUi.counterCatalogQuery = String(event.target.value || "");
      }
      if (unitCounterCatalogSearchDebounceHandle !== null) {
        globalThis.clearTimeout(unitCounterCatalogSearchDebounceHandle);
      }
      unitCounterCatalogSearchDebounceHandle = globalThis.setTimeout(() => {
        unitCounterCatalogSearchDebounceHandle = null;
        scheduleStrategicOverlayRefresh("counterCatalog");
      }, 180);
    });
    unitCounterCatalogSearchInput.dataset.bound = "true";
  }
  if (unitCounterCatalogCategoriesEl && !unitCounterCatalogCategoriesEl.dataset.bound) {
    unitCounterCatalogCategoriesEl.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-catalog-category]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      ensureStrategicOverlayUiState();
      const nextCategory = String(button.dataset.counterCatalogCategory || "all").trim().toLowerCase() || "all";
      if (state.strategicOverlayUi.counterCatalogSource === "hoi4") {
        state.strategicOverlayUi.hoi4CounterCategory = nextCategory;
      } else {
        state.strategicOverlayUi.counterCatalogCategory = nextCategory;
      }
      scheduleStrategicOverlayRefresh("counterCatalog");
    });
    unitCounterCatalogCategoriesEl.dataset.bound = "true";
  }
  if (unitCounterCatalogSourceTabs && !unitCounterCatalogSourceTabs.dataset.bound) {
    unitCounterCatalogSourceTabs.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-catalog-source]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      ensureStrategicOverlayUiState();
      const nextSource = String(button.dataset.counterCatalogSource || "internal").trim().toLowerCase() === "hoi4"
        ? "hoi4"
        : "internal";
      if (state.strategicOverlayUi.counterCatalogSource === nextSource) return;
      state.strategicOverlayUi.counterCatalogSource = nextSource;
      scheduleStrategicOverlayRefresh("counterCatalog");
    });
    unitCounterCatalogSourceTabs.dataset.bound = "true";
  }
  if (unitCounterLibraryVariantRow && !unitCounterLibraryVariantRow.dataset.bound) {
    unitCounterLibraryVariantRow.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-library-variant]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      ensureStrategicOverlayUiState();
      state.strategicOverlayUi.hoi4CounterVariant = String(button.dataset.counterLibraryVariant || "small").trim().toLowerCase() === "large"
        ? "large"
        : "small";
      scheduleStrategicOverlayRefresh("counterCatalog");
    });
    unitCounterLibraryVariantRow.dataset.bound = "true";
  }
  if (unitCounterLibraryExportBtn && !unitCounterLibraryExportBtn.dataset.bound) {
    unitCounterLibraryExportBtn.addEventListener("click", () => {
      exportHoi4UnitIconReviewDraft();
    });
    unitCounterLibraryExportBtn.dataset.bound = "true";
  }
  if (unitCounterCatalogGrid && !unitCounterCatalogGrid.dataset.bound) {
    unitCounterCatalogGrid.addEventListener("click", (event) => {
      const reviewButton = event.target instanceof HTMLElement ? event.target.closest("[data-hoi4-review-action]") : null;
      if (reviewButton instanceof HTMLButtonElement) {
        const action = String(reviewButton.dataset.hoi4ReviewAction || "").trim();
        const entryId = String(reviewButton.dataset.hoi4EntryId || "").trim();
        const currentPresetId = String(state.unitCounterEditor?.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim();
        if (action === "toggle-current-mapping") {
          toggleHoi4EntryCurrentPresetMapping(entryId, currentPresetId);
          scheduleStrategicOverlayRefresh("counterCatalog");
          return;
        }
        if (action === "set-current-candidate") {
          setHoi4CurrentPresetCandidate(entryId, currentPresetId);
          scheduleStrategicOverlayRefresh("counterCatalog");
          return;
        }
      }
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-unit-counter-catalog-preset]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      applyUnitCounterPresetSelection(String(button.dataset.unitCounterCatalogPreset || unitCounterPresets[0].id));
    });
    unitCounterCatalogGrid.dataset.bound = "true";
  }
  if (unitCounterStatsPresetSelect && !unitCounterStatsPresetSelect.dataset.bound) {
    unitCounterStatsPresetSelect.addEventListener("change", (event) => {
      applyUnitCounterCombatPreset(String(event.target.value || "regular"), { source: "preset" });
    });
    unitCounterStatsPresetSelect.dataset.bound = "true";
  }
  unitCounterStatsPresetButtons.forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener("click", () => {
      applyUnitCounterCombatPreset(String(button.dataset.value || "regular"), { source: "preset" });
    });
    button.dataset.bound = "true";
  });
  if (unitCounterStatsRandomizeBtn && !unitCounterStatsRandomizeBtn.dataset.bound) {
    unitCounterStatsRandomizeBtn.addEventListener("click", () => {
      syncUnitCounterCombatStateToSelection(getRandomizedUnitCounterCombatState());
    });
    unitCounterStatsRandomizeBtn.dataset.bound = "true";
  }
  if (unitCounterOrganizationInput && !unitCounterOrganizationInput.dataset.bound) {
    unitCounterOrganizationInput.addEventListener("input", (event) => {
      syncUnitCounterCombatStateToSelection({
        organizationPct: event.target.value,
        statsSource: "manual",
      }, { commitSelected: false });
    });
    unitCounterOrganizationInput.addEventListener("change", (event) => {
      syncUnitCounterCombatStateToSelection({
        organizationPct: event.target.value,
        statsSource: "manual",
      });
    });
    unitCounterOrganizationInput.dataset.bound = "true";
  }
  if (unitCounterEquipmentInput && !unitCounterEquipmentInput.dataset.bound) {
    unitCounterEquipmentInput.addEventListener("input", (event) => {
      syncUnitCounterCombatStateToSelection({
        equipmentPct: event.target.value,
        statsSource: "manual",
      }, { commitSelected: false });
    });
    unitCounterEquipmentInput.addEventListener("change", (event) => {
      syncUnitCounterCombatStateToSelection({
        equipmentPct: event.target.value,
        statsSource: "manual",
      });
    });
    unitCounterEquipmentInput.dataset.bound = "true";
  }
  if (unitCounterBaseFillSwatch && !unitCounterBaseFillSwatch.dataset.bound) {
    unitCounterBaseFillSwatch.addEventListener("click", () => {
      unitCounterBaseFillColorInput?.click();
    });
    unitCounterBaseFillSwatch.dataset.bound = "true";
  }
  if (unitCounterBaseFillColorInput && !unitCounterBaseFillColorInput.dataset.bound) {
    unitCounterBaseFillColorInput.addEventListener("input", (event) => {
      syncUnitCounterCombatStateToSelection({
        baseFillColor: String(event.target.value || "").trim(),
        statsSource: state.unitCounterEditor.statsSource || "manual",
      }, { commitSelected: false });
    });
    unitCounterBaseFillColorInput.addEventListener("change", (event) => {
      syncUnitCounterCombatStateToSelection({
        baseFillColor: String(event.target.value || "").trim(),
        statsSource: state.unitCounterEditor.statsSource || "manual",
      });
    });
    unitCounterBaseFillColorInput.dataset.bound = "true";
  }
  if (unitCounterBaseFillResetBtn && !unitCounterBaseFillResetBtn.dataset.bound) {
    unitCounterBaseFillResetBtn.addEventListener("click", () => {
      syncUnitCounterCombatStateToSelection({
        baseFillColor: "",
        statsSource: state.unitCounterEditor.statsSource || "manual",
      });
    });
    unitCounterBaseFillResetBtn.dataset.bound = "true";
  }
  if (unitCounterBaseFillEyedropperBtn && !unitCounterBaseFillEyedropperBtn.dataset.bound) {
    unitCounterBaseFillEyedropperBtn.addEventListener("click", async () => {
      if (!("EyeDropper" in globalThis)) return;
      try {
        const picker = new globalThis.EyeDropper();
        const result = await picker.open();
        syncUnitCounterCombatStateToSelection({
          baseFillColor: String(result?.sRGBHex || "").trim(),
          statsSource: state.unitCounterEditor.statsSource || "manual",
        });
      } catch (_error) {
        // Ignore cancelled eyedropper sessions.
      }
    });
    unitCounterBaseFillEyedropperBtn.dataset.bound = "true";
  }
  if (unitCounterLabelsToggle && !unitCounterLabelsToggle.dataset.bound) {
    unitCounterLabelsToggle.addEventListener("change", (event) => {
      state.annotationView = {
        ...(state.annotationView || {}),
        showUnitLabels: !!event.target.checked,
      };
      if (render) render();
      scheduleStrategicOverlayRefresh("counterIdentity");
      markDirty("unit-counter-label-visibility");
    });
    unitCounterLabelsToggle.dataset.bound = "true";
  }
  if (unitCounterFixedScaleRange && !unitCounterFixedScaleRange.dataset.bound) {
    const applyUnitCounterFixedScale = (rawValue) => {
      const nextScale = clampUnitCounterFixedScaleMultiplier(Number(rawValue) / 100, 1.5);
      state.annotationView = normalizeAnnotationView({
        ...(state.annotationView || {}),
        unitCounterFixedScaleMultiplier: nextScale,
      });
      if (unitCounterFixedScaleValue) {
        unitCounterFixedScaleValue.textContent = `${nextScale.toFixed(2)}x`;
      }
      if (render) render();
      scheduleStrategicOverlayRefresh("counterIdentity");
      markDirty("unit-counter-fixed-scale");
    };
    unitCounterFixedScaleRange.addEventListener("input", (event) => {
      applyUnitCounterFixedScale(event.target.value);
    });
    unitCounterFixedScaleRange.addEventListener("change", (event) => {
      applyUnitCounterFixedScale(event.target.value);
    });
    unitCounterFixedScaleRange.dataset.bound = "true";
  }
  if (unitCounterPlaceBtn && !unitCounterPlaceBtn.dataset.bound) {
    unitCounterPlaceBtn.addEventListener("click", () => {
      const nextPresetId = String(unitCounterPresetSelect?.value || state.unitCounterEditor?.presetId || unitCounterPresets[0].id).trim().toUpperCase();
      const nextPreset = getUnitCounterPresetMeta(nextPresetId);
      const nextRenderer = String(unitCounterRendererSelect?.value || state.unitCounterEditor?.renderer || nextPreset.defaultRenderer || "game");
      const nextSymbol = String(
        unitCounterSymbolInput?.value
        || state.unitCounterEditor?.sidc
        || state.unitCounterEditor?.symbolCode
        || (String(nextRenderer).trim().toLowerCase() === "milstd"
          ? nextPreset.baseSidc
          : nextPreset.shortCode)
        || ""
      ).trim().toUpperCase();
      mapRenderer.startUnitCounterPlacement({
        renderer: nextRenderer,
        label: String(unitCounterLabelInput?.value || state.unitCounterEditor?.label || ""),
        sidc: nextSymbol,
        symbolCode: nextSymbol,
        size: String(unitCounterSizeSelect?.value || state.unitCounterEditor?.size || "medium"),
        nationTag: String(unitCounterNationSelect?.value || state.unitCounterEditor?.nationTag || "").trim().toUpperCase(),
        nationSource: String(unitCounterNationModeSelect?.value || state.unitCounterEditor?.nationSource || "display").trim().toLowerCase(),
        presetId: nextPresetId,
        iconId: String(nextPreset.iconId || "").trim().toLowerCase(),
        unitType: String(nextPreset.unitType || nextPreset.id || "").trim().toUpperCase(),
        echelon: String(unitCounterEchelonSelect?.value || state.unitCounterEditor?.echelon || nextPreset.defaultEchelon || "").trim().toUpperCase(),
        subLabel: String(unitCounterSubLabelInput?.value || state.unitCounterEditor?.subLabel || ""),
        strengthText: String(unitCounterStrengthInput?.value || state.unitCounterEditor?.strengthText || ""),
        attachment: String(unitCounterAttachmentSelect?.value || state.unitCounterEditor?.attachment?.lineId || "").trim()
          ? {
            kind: "operational-line",
            lineId: String(unitCounterAttachmentSelect?.value || state.unitCounterEditor?.attachment?.lineId || "").trim(),
          }
          : null,
        baseFillColor: String(state.unitCounterEditor?.baseFillColor || ""),
        organizationPct: clampUnitCounterStatValue(state.unitCounterEditor?.organizationPct, 78),
        equipmentPct: clampUnitCounterStatValue(state.unitCounterEditor?.equipmentPct, 74),
        statsPresetId: String(state.unitCounterEditor?.statsPresetId || "regular"),
        statsSource: String(state.unitCounterEditor?.statsSource || "preset"),
      });
      const placementRefreshScopes = ["counterIdentity", "counterPreview", "counterList"];
      scheduleStrategicOverlayRefresh(placementRefreshScopes);
      globalThis.requestAnimationFrame?.(() => {
        scheduleStrategicOverlayRefresh(placementRefreshScopes);
      });
    });
    unitCounterPlaceBtn.dataset.bound = "true";
  }
  if (unitCounterCancelBtn && !unitCounterCancelBtn.dataset.bound) {
    unitCounterCancelBtn.addEventListener("click", () => {
      mapRenderer.cancelUnitCounterPlacement();
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview", "counterList"]);
    });
    unitCounterCancelBtn.dataset.bound = "true";
  }
  if (unitCounterList && !unitCounterList.dataset.bound) {
    unitCounterList.addEventListener("change", (event) => {
      if (suppressUnitCounterListChange) {
        return;
      }
      mapRenderer.selectUnitCounterById(String(event.target.value || ""));
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterCombat", "counterPreview", "counterList"]);
    });
    unitCounterList.dataset.bound = "true";
  }
  if (unitCounterDeleteBtn && !unitCounterDeleteBtn.dataset.bound) {
    unitCounterDeleteBtn.addEventListener("click", async () => {
      if (!state.unitCounterEditor?.selectedId) return;
      const confirmed = await showAppDialog({
        title: t("Delete Selected", "ui"),
        message: t("Delete the selected unit counter?", "ui"),
        details: t("This removes the selected project-local counter from the map.", "ui"),
        confirmLabel: t("Delete Counter", "ui"),
        cancelLabel: t("Cancel", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      mapRenderer.deleteSelectedUnitCounter();
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterCombat", "counterPreview", "counterList"]);
    });
    unitCounterDeleteBtn.dataset.bound = "true";
  }

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
    resetBtn.addEventListener("click", async () => {
      const confirmed = await showAppDialog({
        title: t("Reset Country Colors", "ui"),
        message: t("Reset all country colors and clear visual overrides?", "ui"),
        details: t(
          "This removes manual color changes from the current map. You can undo the reset from the toast that follows.",
          "ui"
        ),
        confirmLabel: t("Reset Colors", "ui"),
        cancelLabel: t("Keep Current Colors", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      resetCountryColors();
      markDirty("reset-country-colors");
      if (typeof state.renderCountryListFn === "function") {
        state.renderCountryListFn();
      }
      if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
      }
      scheduleAdaptiveInspectorHeights();
      showToast(t("Country colors were reset.", "ui"), {
        title: t("Colors reset", "ui"),
        tone: "warning",
        duration: 7200,
        actionLabel: canUndoHistory() ? t("Undo", "ui") : "",
        onAction: canUndoHistory()
          ? async () => {
            if (!undoHistory()) return;
            scheduleAdaptiveInspectorHeights();
            showToast(t("Country colors were restored.", "ui"), {
              title: t("Undo applied", "ui"),
              tone: "success",
            });
          }
          : null,
      });
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
    uploadProjectBtn.addEventListener("click", async () => {
      if (state.isDirty) {
        const shouldContinue = await showAppDialog({
          title: t("Load Project", "ui"),
          message: t("You have unsaved changes. Loading a project will replace the current map.", "ui"),
          details: t(
            "Continue only if you are ready to discard the current working state or have already exported it.",
            "ui"
          ),
          confirmLabel: t("Discard and Load", "ui"),
          cancelLabel: t("Stay on Current Map", "ui"),
          tone: "warning",
        });
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
        let scenarioImportAudit = data.scenario?.importAudit || null;
        if (data.scenario?.id) {
          const validation = await validateImportedScenarioBaseline(data.scenario);
          if (!validation.ok) {
            const shouldContinue = validation.reason === "baseline_mismatch"
              ? await showAppDialog({
                title: t("Scenario Baseline Mismatch", "ui"),
                message: validation.message,
                details: t(
                  "The saved project was created against a different scenario baseline. Continue only if you are comfortable loading it against current assets.",
                  "ui"
                ),
                confirmLabel: t("Load Anyway", "ui"),
                cancelLabel: t("Cancel Import", "ui"),
                tone: "warning",
              })
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
            if (validation.reason === "baseline_mismatch") {
              scenarioImportAudit = {
                scenarioId: String(data.scenario.id || "").trim(),
                savedVersion: Number(data.scenario.version || 1) || 1,
                currentVersion: Number(validation.currentVersion || 1) || 1,
                savedBaselineHash: String(data.scenario.baselineHash || "").trim(),
                currentBaselineHash: String(validation.currentBaselineHash || "").trim(),
                acceptedAt: new Date().toISOString(),
              };
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
        state.mapSemanticMode = normalizeMapSemanticMode(data.mapSemanticMode, state.activeScenarioId ? state.mapSemanticMode : "political");
        if (state.activeScenarioId) {
          if (data.scenarioControllersByFeatureId) {
            state.scenarioControllersByFeatureId = { ...data.scenarioControllersByFeatureId };
          }
        } else {
          state.scenarioControllersByFeatureId = data.scenarioControllersByFeatureId
            ? { ...data.scenarioControllersByFeatureId }
            : {};
        }
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
        state.devHoverHit = null;
        state.devSelectedHit = null;
        state.devSelectionFeatureIds = new Set();
        state.devSelectionOrder = [];
        state.devClipboardFallbackText = "";
        state.devClipboardPreviewFormat = "names_with_ids";
        ensureSovereigntyState({ force: true });
        state.specialZoneEditor = {
          active: false,
          vertices: [],
          zoneType: "custom",
          label: "",
          selectedId: null,
          counter: 1,
        };
        state.annotationView = normalizeAnnotationView({
          ...(state.annotationView || {}),
          ...(data.annotationView || {}),
        });
        state.operationalLines = Array.isArray(data.operationalLines) ? data.operationalLines : [];
        state.operationGraphics = Array.isArray(data.operationGraphics) ? data.operationGraphics : [];
        state.unitCounters = Array.isArray(data.unitCounters) ? data.unitCounters : [];
        state.operationalLineEditor = {
          active: false,
          mode: "idle",
          points: [],
          kind: "frontline",
          label: "",
          stylePreset: "frontline",
          stroke: "",
          width: 0,
          opacity: 1,
          selectedId: null,
          selectedVertexIndex: -1,
          counter: 1,
        };
        state.operationGraphicsEditor = {
          active: false,
          mode: "idle",
          collection: "operationGraphics",
          points: [],
          kind: "attack",
          label: "",
          stylePreset: "attack",
          stroke: "",
          width: 0,
          opacity: 1,
          selectedId: null,
          selectedVertexIndex: -1,
          counter: 1,
        };
        state.unitCounterEditor = {
          active: false,
          renderer: String(state.annotationView?.unitRendererDefault || "game"),
          label: "",
          sidc: "",
          symbolCode: "",
          nationTag: "",
          nationSource: "display",
          presetId: "inf",
          iconId: "",
          unitType: "",
          echelon: "",
          subLabel: "",
          strengthText: "",
          layoutAnchor: { kind: "feature", key: "", slotIndex: null },
          attachment: null,
          baseFillColor: "",
          organizationPct: 78,
          equipmentPct: 74,
          statsPresetId: "regular",
          statsSource: "preset",
          size: "medium",
          selectedId: null,
          counter: 1,
        };
        state.strategicOverlayUi = {
          activeMode: "idle",
          modalOpen: false,
          modalSection: "line",
          modalEntityId: "",
          modalEntityType: "",
          counterEditorModalOpen: false,
          counterCatalogSource: "internal",
          counterCatalogCategory: "all",
          counterCatalogQuery: "",
          hoi4CounterCategory: "all",
          hoi4CounterQuery: "",
          hoi4CounterVariant: "small",
        };
        invalidateFrontlineOverlayState();
        state.operationalLinesDirty = true;
        state.operationGraphicsDirty = true;
        state.unitCountersDirty = true;
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
        state.styleConfig.internalBorders = {
          color: "#cccccc",
          opacity: 1,
          width: 0.5,
        };
        state.styleConfig.empireBorders = {
          color: "#666666",
          width: 1,
        };
        state.styleConfig.coastlines = {
          color: "#333333",
          width: 1.2,
        };
        if (
          data.styleConfig?.internalBorders &&
          typeof data.styleConfig.internalBorders === "object"
        ) {
          state.styleConfig.internalBorders = {
            ...(state.styleConfig.internalBorders || {}),
            ...data.styleConfig.internalBorders,
          };
        }
        if (
          data.styleConfig?.empireBorders &&
          typeof data.styleConfig.empireBorders === "object"
        ) {
          state.styleConfig.empireBorders = {
            ...(state.styleConfig.empireBorders || {}),
            ...data.styleConfig.empireBorders,
          };
        }
        if (
          data.styleConfig?.coastlines &&
          typeof data.styleConfig.coastlines === "object"
        ) {
          state.styleConfig.coastlines = {
            ...(state.styleConfig.coastlines || {}),
            ...data.styleConfig.coastlines,
          };
        }
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
        if (data.styleConfig?.cityPoints && typeof data.styleConfig.cityPoints === "object") {
          state.styleConfig.cityPoints = normalizeCityLayerStyleConfig({
            ...(state.styleConfig.cityPoints || {}),
            ...data.styleConfig.cityPoints,
          });
        }
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
          state.showCityPoints =
            data.layerVisibility.showCityPoints === undefined
              ? true
              : !!data.layerVisibility.showCityPoints;
          state.showUrban = !!data.layerVisibility.showUrban;
          state.showPhysical = !!data.layerVisibility.showPhysical;
          state.showRivers = !!data.layerVisibility.showRivers;
          state.showSpecialZones =
            data.layerVisibility.showSpecialZones === undefined
              ? false
              : !!data.layerVisibility.showSpecialZones;
        }
        state.recentColors = Array.isArray(data.recentColors) ? [...data.recentColors] : [];
        state.interactionGranularity = data.interactionGranularity || "subdivision";
        state.batchFillScope = data.batchFillScope || "parent";
        state.referenceImageState = {
          ...(state.referenceImageState || {}),
          ...(data.referenceImageState || {}),
        };
        state.customPresets =
          data.customPresets && typeof data.customPresets === "object"
            ? data.customPresets
            : {};
        const paletteRestoreTarget = String(data.activePaletteId || "").trim();
        const shouldRestorePalette = !!paletteRestoreTarget && (
          paletteRestoreTarget !== String(state.activePaletteId || "").trim()
          || !state.activePaletteMeta
          || !state.activePalettePack
          || !state.activePaletteMap
        );
        if (shouldRestorePalette) {
          const paletteRestored = await setActivePaletteSource(paletteRestoreTarget, {
            syncUI: true,
            overwriteCountryPalette: false,
          });
          if (!paletteRestored) {
            console.warn(`[project-import] Unable to restore saved palette source: ${paletteRestoreTarget}`);
            showToast(t("Saved palette could not be restored. Keeping the current palette.", "ui"), {
              title: t("Palette restore skipped", "ui"),
              tone: "warning",
              duration: 3600,
            });
          }
        }
        if (state.activeScenarioId && state.showCityPoints) {
          if (typeof state.ensureBaseCityDataFn === "function") {
            await state.ensureBaseCityDataFn({ reason: "project-import", renderNow: false });
          }
          await ensureActiveScenarioOptionalLayerLoaded("cities", { renderNow: false });
        }
        if (state.showRivers && typeof state.ensureContextLayerDataFn === "function") {
          await state.ensureContextLayerDataFn("rivers", { reason: "project-import", renderNow: false });
        }
        if (state.showUrban && typeof state.ensureContextLayerDataFn === "function") {
          await state.ensureContextLayerDataFn("urban", { reason: "project-import", renderNow: false });
        }
        if (state.showPhysical && typeof state.ensureContextLayerDataFn === "function") {
          await state.ensureContextLayerDataFn("physical-set", { reason: "project-import", renderNow: false });
        }
        state.scenarioImportAudit = state.activeScenarioId ? scenarioImportAudit : null;
        if (typeof state.updateParentBorderCountryListFn === "function") {
          state.updateParentBorderCountryListFn();
        }
        if (typeof state.updateSpecialZoneEditorUIFn === "function") {
          state.updateSpecialZoneEditorUIFn();
        }
        if (typeof state.updateStrategicOverlayUIFn === "function") {
          state.updateStrategicOverlayUIFn();
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
        if (typeof state.updateRecentUI === "function") {
          state.updateRecentUI();
        }
        if (typeof state.updateScenarioContextBarFn === "function") {
          state.updateScenarioContextBarFn();
        }
        state.persistViewSettingsFn?.();
        rebuildPresetState();
        mapRenderer.refreshColorState({ renderNow: false });
        if (render) render();
        if (typeof state.renderCountryListFn === "function") {
          state.renderCountryListFn();
        }
        if (typeof state.refreshCountryInspectorDetailFn === "function") {
          state.refreshCountryInspectorDetailFn();
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

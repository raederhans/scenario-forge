import { countryPresets, state } from "./state.js";

const COUNTRY_CODE_ALIASES = {
  UK: "GB",
  EL: "GR",
};

function normalizeCountryCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
}

function clonePreset(preset = {}) {
  const ids = Array.isArray(preset.ids)
    ? Array.from(new Set(preset.ids.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  return {
    ...preset,
    name: String(preset.name || "").trim(),
    ids,
  };
}

function normalizePresetName(value) {
  return String(value || "").trim().toLowerCase();
}

function getStaticPresetsForCode(code) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return [];

  for (const [rawCode, presets] of Object.entries(countryPresets || {})) {
    if (normalizeCountryCode(rawCode) !== normalizedCode) continue;
    return Array.isArray(presets) ? presets : [];
  }
  return [];
}

function resolveCatalogEntriesForScenario(scenarioId = state.activeScenarioId) {
  const entries = Array.isArray(state.releasableCatalog?.entries)
    ? state.releasableCatalog.entries
    : [];
  const normalizedScenarioId = String(scenarioId || "").trim();

  return entries.filter((entry) => {
    if (!entry || entry.validation_status === "error") return false;
    const scenarioIds = Array.isArray(entry.scenario_ids) ? entry.scenario_ids : [];
    if (!normalizedScenarioId) return true;
    if (!scenarioIds.length) return true;
    return scenarioIds.includes(normalizedScenarioId);
  });
}

function resolvePresetFeatureIds(entry = {}) {
  const presetSource = entry?.preset_source && typeof entry.preset_source === "object"
    ? entry.preset_source
    : {};
  const sourceType = String(presetSource.type || "").trim();
  const tag = normalizeCountryCode(entry.tag);

  const warnEmptyResolution = (details = {}) => {
    console.warn("[releasable] Unable to resolve feature ids for preset source.", {
      tag,
      sourceType,
      ...details,
    });
  };

  if (sourceType === "legacy_preset_name") {
    const presetName = String(presetSource.name || "").trim();
    const lookupCode = normalizeCountryCode(entry.release_lookup_iso2 || entry.lookup_iso2 || entry.base_iso2);
    const presets = getStaticPresetsForCode(lookupCode);
    const match = presets.find((preset) => String(preset?.name || "").trim() === presetName);
    const ids = Array.isArray(match?.ids)
      ? Array.from(new Set(match.ids.map((id) => String(id || "").trim()).filter(Boolean)))
      : [];
    if (!ids.length) {
      warnEmptyResolution({
        lookupCode,
        presetName,
      });
    }
    return ids;
  }

  if (sourceType === "hierarchy_group_ids") {
    const groups = state.hierarchyData?.groups && typeof state.hierarchyData.groups === "object"
      ? state.hierarchyData.groups
      : {};
    const featureIds = new Set();
    (Array.isArray(presetSource.group_ids) ? presetSource.group_ids : []).forEach((groupId) => {
      const ids = Array.isArray(groups[groupId]) ? groups[groupId] : [];
      ids.forEach((featureId) => {
        const normalized = String(featureId || "").trim();
        if (normalized) {
          featureIds.add(normalized);
        }
      });
    });
    const ids = Array.from(featureIds);
    if (!ids.length) {
      warnEmptyResolution({
        groupIds: Array.isArray(presetSource.group_ids) ? presetSource.group_ids : [],
      });
    }
    return ids;
  }

  if (sourceType === "feature_ids") {
    const ids = Array.from(
      new Set((Array.isArray(presetSource.feature_ids) ? presetSource.feature_ids : [])
        .map((featureId) => String(featureId || "").trim())
        .filter(Boolean))
    );
    if (!ids.length) {
      warnEmptyResolution({
        featureIds: Array.isArray(presetSource.feature_ids) ? presetSource.feature_ids : [],
      });
    }
    return ids;
  }

  return [];
}

function getReleasableGroupingMeta(entry = {}) {
  const groupingCode = normalizeCountryCode(entry.release_lookup_iso2 || entry.lookup_iso2 || entry.base_iso2);
  if (!groupingCode || !(state.countryGroupMetaByCode instanceof Map)) {
    return {
      groupingCode: "",
      continentId: "",
      continentLabel: "",
      subregionId: "",
      subregionLabel: "",
    };
  }
  const meta = state.countryGroupMetaByCode.get(groupingCode) || {};
  return {
    groupingCode,
    continentId: String(meta.continentId || "").trim(),
    continentLabel: String(meta.continentLabel || "").trim(),
    subregionId: String(meta.subregionId || "").trim(),
    subregionLabel: String(meta.subregionLabel || "").trim(),
  };
}

function createEmptyReleasableIndex() {
  return {
    byTag: {},
    childTagsByParent: {},
    consumedPresetNamesByParentLookup: {},
  };
}

function buildScenarioReleasableIndex(scenarioId = state.activeScenarioId) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) {
    return createEmptyReleasableIndex();
  }

  const index = createEmptyReleasableIndex();
  resolveCatalogEntriesForScenario(normalizedScenarioId).forEach((entry, catalogOrder) => {
    const tag = normalizeCountryCode(entry.tag);
    if (!tag) return;

    const parentTags = Array.isArray(entry.parent_owner_tags)
      ? entry.parent_owner_tags
        .map((value) => normalizeCountryCode(value))
        .filter(Boolean)
      : [];
    const parentOwnerTag = normalizeCountryCode(entry.parent_owner_tag) || parentTags[0] || "";
    const lookupCode = normalizeCountryCode(entry.release_lookup_iso2 || entry.lookup_iso2 || entry.base_iso2);
    const normalizedEntry = {
      ...entry,
      tag,
      catalog_order: catalogOrder,
      parent_owner_tag: parentOwnerTag,
      parent_owner_tags: parentTags.length ? parentTags : (parentOwnerTag ? [parentOwnerTag] : []),
      release_lookup_iso2: lookupCode,
      lookup_iso2: lookupCode,
    };

    index.byTag[tag] = normalizedEntry;
    normalizedEntry.parent_owner_tags.forEach((parentTag) => {
      if (!index.childTagsByParent[parentTag]) {
        index.childTagsByParent[parentTag] = [];
      }
      if (!index.childTagsByParent[parentTag].includes(tag)) {
        index.childTagsByParent[parentTag].push(tag);
      }
    });

    if (entry?.preset_source?.type === "legacy_preset_name") {
      const presetName = normalizePresetName(entry?.preset_source?.name);
      if (lookupCode && presetName) {
        if (!index.consumedPresetNamesByParentLookup[lookupCode]) {
          index.consumedPresetNamesByParentLookup[lookupCode] = [];
        }
        if (!index.consumedPresetNamesByParentLookup[lookupCode].includes(presetName)) {
          index.consumedPresetNamesByParentLookup[lookupCode].push(presetName);
        }
      }
    }
  });

  return index;
}

function getScenarioReleasableIndex(scenarioId = state.activeScenarioId) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) {
    return createEmptyReleasableIndex();
  }
  if (
    normalizedScenarioId === String(state.activeScenarioId || "").trim()
    && state.scenarioReleasableIndex
    && typeof state.scenarioReleasableIndex === "object"
  ) {
    return state.scenarioReleasableIndex;
  }
  return buildScenarioReleasableIndex(normalizedScenarioId);
}

function buildReleasablePresetOverlays() {
  const defaultOverlays = {};
  const scenarioOverlays = {};

  resolveCatalogEntriesForScenario("").forEach((entry) => {
    const tag = normalizeCountryCode(entry.tag);
    const lookupCode = normalizeCountryCode(entry.release_lookup_iso2);
    const featureIds = resolvePresetFeatureIds(entry);
    if (!tag || !lookupCode || !featureIds.length) return;

    const displayName = String(entry.display_name || tag).trim() || tag;
    if (!defaultOverlays[lookupCode]) {
      defaultOverlays[lookupCode] = [];
    }
    defaultOverlays[lookupCode].push({
      name: `Release: ${displayName}`,
      ids: featureIds,
      generated: true,
      locked: true,
      preset_kind: "releasable_release",
      releasable_tag: tag,
      parent_owner_tag: String(entry.parent_owner_tag || "").trim().toUpperCase(),
    });
  });

  resolveCatalogEntriesForScenario(state.activeScenarioId).forEach((entry) => {
    const tag = normalizeCountryCode(entry.tag);
    const featureIds = resolvePresetFeatureIds(entry);
    if (!tag || !featureIds.length) return;

    scenarioOverlays[tag] = [
      {
        name: "Core Territory",
        ids: featureIds,
        generated: true,
        locked: true,
        preset_kind: "releasable_core",
        releasable_tag: tag,
        parent_owner_tag: String(entry.parent_owner_tag || "").trim().toUpperCase(),
      },
    ];
  });

  return { defaultOverlays, scenarioOverlays };
}

function mergePresetLayers(...layers) {
  const merged = {};
  const upsertPresets = (rawCode, presets = []) => {
    const code = normalizeCountryCode(rawCode);
    if (!code) return;
    if (!merged[code]) {
      merged[code] = [];
    }
    (Array.isArray(presets) ? presets : []).forEach((preset) => {
      const normalizedPreset = clonePreset(preset);
      if (!normalizedPreset.name) return;
      const existingIndex = merged[code].findIndex((entry) => entry.name === normalizedPreset.name);
      if (existingIndex >= 0) {
        merged[code][existingIndex] = normalizedPreset;
      } else {
        merged[code].push(normalizedPreset);
      }
    });
  };

  layers.forEach((layer) => {
    Object.entries(layer || {}).forEach(([rawCode, presets]) => {
      upsertPresets(rawCode, presets);
    });
  });

  return merged;
}

function rebuildPresetState() {
  const { defaultOverlays, scenarioOverlays } = buildReleasablePresetOverlays();
  state.defaultReleasablePresetOverlays = defaultOverlays;
  state.scenarioReleasablePresetOverlays = scenarioOverlays;
  state.presetsState = mergePresetLayers(
    countryPresets,
    state.activeScenarioId ? scenarioOverlays : defaultOverlays,
    state.customPresets || {}
  );
  return state.presetsState;
}

function getScenarioReleasableCountries(scenarioId = state.activeScenarioId) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) return {};

  const releasables = {};
  resolveCatalogEntriesForScenario(normalizedScenarioId).forEach((entry, catalogOrder) => {
    const tag = normalizeCountryCode(entry.tag);
    const featureIds = resolvePresetFeatureIds(entry);
    if (!tag || !featureIds.length) return;

    const colorHex = String(entry.color_hex || "").trim().toLowerCase();
    const displayName = String(entry.display_name || tag).trim() || tag;
    const parentOwnerTag = String(entry.parent_owner_tag || "").trim().toUpperCase();
    const parentOwnerTags = Array.isArray(entry.parent_owner_tags)
      ? entry.parent_owner_tags
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
      : [];
    const lookupIso2 = normalizeCountryCode(entry.release_lookup_iso2);
    const groupingMeta = getReleasableGroupingMeta(entry);

    releasables[tag] = {
      code: tag,
      display_name: displayName,
      color_hex: colorHex,
      feature_count: featureIds.length,
      quality: "releasable",
      base_iso2: lookupIso2,
      lookup_iso2: lookupIso2,
      release_lookup_iso2: lookupIso2,
      scenario_only: true,
      entry_kind: "releasable",
      releasable: true,
      parent_owner_tag: parentOwnerTag,
      parent_owner_tags: parentOwnerTags.length ? parentOwnerTags : (parentOwnerTag ? [parentOwnerTag] : []),
      preset_lookup_code: tag,
      catalog_order: catalogOrder,
      capital_state_id: Number(entry.capital_state_id || 0) || 0,
      core_state_ids: Array.isArray(entry.core_state_ids) ? [...entry.core_state_ids] : [],
      notes: String(entry.notes || "").trim(),
      continent_id: groupingMeta.continentId,
      continent_label: groupingMeta.continentLabel,
      subregion_id: groupingMeta.subregionId,
      subregion_label: groupingMeta.subregionLabel,
    };
  });

  return releasables;
}

export {
  buildScenarioReleasableIndex,
  getScenarioReleasableIndex,
  getScenarioReleasableCountries,
  mergePresetLayers,
  normalizeCountryCode,
  normalizePresetName,
  rebuildPresetState,
};

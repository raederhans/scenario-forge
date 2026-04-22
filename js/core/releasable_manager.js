import { countryPresets, state as runtimeState } from "./state.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
const state = runtimeState;

const BOUNDARY_VARIANT_ID_ALIASES = {
  legacy_approx: "historical_reference",
};

function normalizeCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
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

function normalizeRuleId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeBoundaryVariantId(value) {
  const normalized = normalizeRuleId(value);
  return BOUNDARY_VARIANT_ID_ALIASES[normalized] || normalized;
}

function normalizePresetSource(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    type: String(source.type || "").trim(),
    name: String(source.name || "").trim(),
    group_ids: Array.isArray(source.group_ids)
      ? Array.from(new Set(source.group_ids.map((item) => String(item || "").trim()).filter(Boolean)))
      : [],
    feature_ids: Array.isArray(source.feature_ids)
      ? Array.from(new Set(source.feature_ids.map((item) => String(item || "").trim()).filter(Boolean)))
      : [],
    exclude_group_ids: Array.isArray(source.exclude_group_ids)
      ? Array.from(new Set(source.exclude_group_ids.map((item) => String(item || "").trim()).filter(Boolean)))
      : [],
    exclude_feature_ids: Array.isArray(source.exclude_feature_ids)
      ? Array.from(new Set(source.exclude_feature_ids.map((item) => String(item || "").trim()).filter(Boolean)))
      : [],
  };
}

function normalizeBoundaryVariants(entry = {}) {
  const rawVariants = Array.isArray(entry?.boundary_variants) ? entry.boundary_variants : [];
  return rawVariants
    .map((variant) => {
      const normalizedId = normalizeBoundaryVariantId(variant?.id);
      if (!normalizedId) return null;
      const featureCountHint = Number(variant?.resolved_feature_count_hint);
      return {
        id: normalizedId,
        label: String(variant?.label || normalizedId).trim(),
        description: String(variant?.description || "").trim(),
        basis: String(variant?.basis || "").trim(),
        preset_source: normalizePresetSource(variant?.preset_source),
        resolved_feature_count_hint: Number.isFinite(featureCountHint) ? featureCountHint : null,
      };
    })
    .filter(Boolean);
}

function normalizeCompanionActions(entry = {}) {
  const rawActions = Array.isArray(entry?.companion_actions) ? entry.companion_actions : [];
  return rawActions
    .map((action) => {
      const normalizedId = normalizeRuleId(action?.id);
      if (!normalizedId) return null;
      const featureCountHint = Number(action?.resolved_feature_count_hint);
      return {
        id: normalizedId,
        label: String(action?.label || normalizedId).trim(),
        description: String(action?.description || "").trim(),
        basis: String(action?.basis || "").trim(),
        action_type: String(action?.action_type || "").trim(),
        target_owner_tag: normalizeCountryCode(action?.target_owner_tag),
        auto_apply_on_core_territory: !!action?.auto_apply_on_core_territory,
        hidden_in_ui: !!action?.hidden_in_ui,
        preset_source: normalizePresetSource(action?.preset_source),
        resolved_feature_count_hint: Number.isFinite(featureCountHint) ? featureCountHint : null,
      };
    })
    .filter(Boolean);
}

function getDefaultBoundaryVariantId(entry = {}) {
  const variants = normalizeBoundaryVariants(entry);
  if (!variants.length) return "";
  const requestedDefault = normalizeBoundaryVariantId(entry?.default_boundary_variant_id);
  if (requestedDefault && variants.some((variant) => variant.id === requestedDefault)) {
    return requestedDefault;
  }
  return variants[0].id;
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

function resolveCatalogEntriesForScenario(scenarioId = runtimeState.activeScenarioId) {
  const entries = Array.isArray(runtimeState.releasableCatalog?.entries)
    ? runtimeState.releasableCatalog.entries
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

function resolveFeatureIdsFromPresetSource(presetSource = {}, entry = {}) {
  const normalizedPresetSource = normalizePresetSource(presetSource);
  const sourceType = String(normalizedPresetSource.type || "").trim();
  const tag = normalizeCountryCode(entry.tag);

  const warnEmptyResolution = (details = {}) => {
    console.warn("[releasable] Unable to resolve feature ids for preset source.", {
      tag,
      sourceType,
      ...details,
    });
  };

  if (sourceType === "legacy_preset_name") {
    const presetName = String(normalizedPresetSource.name || "").trim();
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

  if (sourceType === "hierarchy_group_ids" || sourceType === "feature_selection") {
    const groups = runtimeState.hierarchyData?.groups && typeof runtimeState.hierarchyData.groups === "object"
      ? runtimeState.hierarchyData.groups
      : {};
    const featureIds = new Set();
    normalizedPresetSource.feature_ids.forEach((featureId) => {
      const normalized = String(featureId || "").trim();
      if (normalized) {
        featureIds.add(normalized);
      }
    });
    normalizedPresetSource.group_ids.forEach((groupId) => {
      const ids = Array.isArray(groups[groupId]) ? groups[groupId] : [];
      ids.forEach((featureId) => {
        const normalized = String(featureId || "").trim();
        if (normalized) {
          featureIds.add(normalized);
        }
      });
    });
    normalizedPresetSource.exclude_group_ids.forEach((groupId) => {
      const ids = Array.isArray(groups[groupId]) ? groups[groupId] : [];
      ids.forEach((featureId) => {
        featureIds.delete(String(featureId || "").trim());
      });
    });
    normalizedPresetSource.exclude_feature_ids.forEach((featureId) => {
      featureIds.delete(String(featureId || "").trim());
    });
    const ids = Array.from(featureIds);
    if (!ids.length) {
      warnEmptyResolution({
        groupIds: normalizedPresetSource.group_ids,
      });
    }
    return ids;
  }

  if (sourceType === "feature_ids") {
    const ids = Array.from(new Set(normalizedPresetSource.feature_ids));
    normalizedPresetSource.group_ids.forEach((groupId) => {
      const idsForGroup = Array.isArray(runtimeState.hierarchyData?.groups?.[groupId])
        ? runtimeState.hierarchyData.groups[groupId]
        : [];
      idsForGroup.forEach((featureId) => {
        const normalized = String(featureId || "").trim();
        if (normalized && !ids.includes(normalized)) {
          ids.push(normalized);
        }
      });
    });
    normalizedPresetSource.exclude_feature_ids.forEach((featureId) => {
      const normalized = String(featureId || "").trim();
      const index = ids.indexOf(normalized);
      if (index >= 0) {
        ids.splice(index, 1);
      }
    });
    if (!ids.length) {
      warnEmptyResolution({
        featureIds: normalizedPresetSource.feature_ids,
      });
    }
    return ids;
  }

  return [];
}

function getSelectedBoundaryVariantId(entry = {}) {
  const tag = normalizeCountryCode(entry?.tag);
  const variants = normalizeBoundaryVariants(entry);
  if (!tag || !variants.length) return "";
  const selectedId = normalizeBoundaryVariantId(runtimeState.releasableBoundaryVariantByTag?.[tag]);
  if (
    selectedId
    && runtimeState.releasableBoundaryVariantByTag?.[tag]
    && normalizeRuleId(runtimeState.releasableBoundaryVariantByTag[tag]) !== selectedId
  ) {
    runtimeState.releasableBoundaryVariantByTag = {
      ...runtimeState.releasableBoundaryVariantByTag,
      [tag]: selectedId,
    };
  }
  if (selectedId && variants.some((variant) => variant.id === selectedId)) {
    return selectedId;
  }
  const defaultId = getDefaultBoundaryVariantId(entry);
  if (!runtimeState.releasableBoundaryVariantByTag || typeof runtimeState.releasableBoundaryVariantByTag !== "object") {
    runtimeState.releasableBoundaryVariantByTag = {};
  }
  if (defaultId && runtimeState.releasableBoundaryVariantByTag[tag] !== defaultId) {
    runtimeState.releasableBoundaryVariantByTag = {
      ...runtimeState.releasableBoundaryVariantByTag,
      [tag]: defaultId,
    };
  }
  return defaultId;
}

function getResolvedReleasableBoundaryVariant(entry = {}) {
  const variants = normalizeBoundaryVariants(entry);
  if (!variants.length) return null;
  const selectedId = getSelectedBoundaryVariantId(entry);
  return variants.find((variant) => variant.id === selectedId) || variants[0];
}

function resolvePresetFeatureIds(entry = {}) {
  const selectedVariant = getResolvedReleasableBoundaryVariant(entry);
  const presetSource = selectedVariant?.preset_source && typeof selectedVariant.preset_source === "object"
    ? selectedVariant.preset_source
    : entry?.preset_source;
  return resolveFeatureIdsFromPresetSource(presetSource, entry);
}

function resolveCompanionActionFeatureIds(action = {}, entry = {}) {
  return resolveFeatureIdsFromPresetSource(action?.preset_source, entry);
}

function resolveCatalogEntryForTag(tag, scenarioId = runtimeState.activeScenarioId) {
  const normalizedTag = normalizeCountryCode(tag);
  if (!normalizedTag) return null;
  const scenarioEntry = getScenarioReleasableIndex(scenarioId)?.byTag?.[normalizedTag];
  if (scenarioEntry && typeof scenarioEntry === "object") {
    return scenarioEntry;
  }
  return resolveCatalogEntriesForScenario(scenarioId).find(
    (entry) => normalizeCountryCode(entry?.tag) === normalizedTag
  ) || null;
}

function setReleasableBoundaryVariant(tag, variantId) {
  const normalizedTag = normalizeCountryCode(tag);
  if (!normalizedTag) return null;
  const entry = resolveCatalogEntryForTag(normalizedTag);
  if (!entry) return null;
  const variants = normalizeBoundaryVariants(entry);
  if (!variants.length) return null;

  const requestedId = normalizeBoundaryVariantId(variantId);
  const resolvedVariant = variants.find((variant) => variant.id === requestedId)
    || variants.find((variant) => variant.id === getDefaultBoundaryVariantId(entry))
    || variants[0];
  if (!resolvedVariant) return null;

  if (!runtimeState.releasableBoundaryVariantByTag || typeof runtimeState.releasableBoundaryVariantByTag !== "object") {
    runtimeState.releasableBoundaryVariantByTag = {};
  }
  runtimeState.releasableBoundaryVariantByTag = {
    ...runtimeState.releasableBoundaryVariantByTag,
    [normalizedTag]: resolvedVariant.id,
  };

  const featureIds = resolvePresetFeatureIds(entry);
  if (runtimeState.scenarioCountriesByTag?.[normalizedTag]) {
    runtimeState.scenarioCountriesByTag = {
      ...runtimeState.scenarioCountriesByTag,
      [normalizedTag]: {
        ...runtimeState.scenarioCountriesByTag[normalizedTag],
        feature_count: featureIds.length,
        default_boundary_variant_id: getDefaultBoundaryVariantId(entry),
        selected_boundary_variant_id: resolvedVariant.id,
        selected_boundary_variant_label: resolvedVariant.label,
        selected_boundary_variant_description: resolvedVariant.description,
        boundary_variants: variants,
        companion_actions: normalizeCompanionActions(entry),
      },
    };
  }

  rebuildPresetState();
  return {
    tag: normalizedTag,
    variantId: resolvedVariant.id,
    featureCount: featureIds.length,
    variant: resolvedVariant,
  };
}

function getReleasableGroupingMeta(entry = {}) {
  const groupingCode = normalizeCountryCode(entry.release_lookup_iso2 || entry.lookup_iso2 || entry.base_iso2);
  if (!groupingCode || !(runtimeState.countryGroupMetaByCode instanceof Map)) {
    return {
      groupingCode: "",
      continentId: "",
      continentLabel: "",
      subregionId: "",
      subregionLabel: "",
    };
  }
  const meta = runtimeState.countryGroupMetaByCode.get(groupingCode) || {};
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

function normalizeExcludedTags(values = []) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeCountryCode(value))
      .filter(Boolean)
  );
}

function buildScenarioReleasableIndex(scenarioId = runtimeState.activeScenarioId, { excludeTags = [] } = {}) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) {
    return createEmptyReleasableIndex();
  }

  const index = createEmptyReleasableIndex();
  const excludedTags = normalizeExcludedTags(excludeTags);
  resolveCatalogEntriesForScenario(normalizedScenarioId).forEach((entry, catalogOrder) => {
    const tag = normalizeCountryCode(entry.tag);
    if (!tag || excludedTags.has(tag)) return;

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
      default_boundary_variant_id: getDefaultBoundaryVariantId(entry),
      boundary_variants: normalizeBoundaryVariants(entry),
      companion_actions: normalizeCompanionActions(entry),
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

function getScenarioReleasableIndex(scenarioId = runtimeState.activeScenarioId, { excludeTags = [] } = {}) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) {
    return createEmptyReleasableIndex();
  }
  if (
    !(Array.isArray(excludeTags) && excludeTags.length) &&
    normalizedScenarioId === String(runtimeState.activeScenarioId || "").trim()
    && runtimeState.scenarioReleasableIndex
    && typeof runtimeState.scenarioReleasableIndex === "object"
  ) {
    return runtimeState.scenarioReleasableIndex;
  }
  return buildScenarioReleasableIndex(normalizedScenarioId, { excludeTags });
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
      boundary_variant_id: getSelectedBoundaryVariantId(entry),
    });
  });

  resolveCatalogEntriesForScenario(runtimeState.activeScenarioId).forEach((entry) => {
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
        boundary_variant_id: getSelectedBoundaryVariantId(entry),
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

function buildScenarioRegionalPresetOverlays() {
  if (!runtimeState.activeScenarioId) return {};
  const scenarioCountries = runtimeState.scenarioCountriesByTag && typeof runtimeState.scenarioCountriesByTag === "object"
    ? runtimeState.scenarioCountriesByTag
    : {};
  const overlays = {};
  const assignOverlayPresets = (rawCode, presets) => {
    const normalizedCode = normalizeCountryCode(rawCode);
    if (!normalizedCode || !presets.length) return;
    overlays[normalizedCode] = presets.map((preset) => clonePreset(preset));
  };

  Object.entries(scenarioCountries).forEach(([rawCode, entry]) => {
    const code = normalizeCountryCode(rawCode || entry?.tag);
    if (!code) return;
    const regionalPresets = Array.isArray(entry?.regional_presets)
      ? entry.regional_presets
      : Array.isArray(entry?.regionalPresets)
        ? entry.regionalPresets
        : [];
    if (!regionalPresets.length) return;

    const normalizedPresets = regionalPresets
      .map((preset) => clonePreset(preset))
      .filter((preset) => preset.name && preset.ids.length);

    if (normalizedPresets.length) {
      [
        code,
        entry?.preset_lookup_code,
        entry?.presetLookupCode,
        entry?.lookup_iso2,
        entry?.lookupIso2,
        entry?.base_iso2,
        entry?.baseIso2,
      ].forEach((candidate) => assignOverlayPresets(candidate, normalizedPresets));
    }
  });

  return overlays;
}

function rebuildPresetState() {
  const { defaultOverlays, scenarioOverlays } = buildReleasablePresetOverlays();
  const scenarioRegionalPresetOverlays = buildScenarioRegionalPresetOverlays();
  runtimeState.defaultReleasablePresetOverlays = defaultOverlays;
  runtimeState.scenarioReleasablePresetOverlays = scenarioOverlays;
  runtimeState.presetsState = mergePresetLayers(
    countryPresets,
    scenarioRegionalPresetOverlays,
    runtimeState.activeScenarioId ? scenarioOverlays : defaultOverlays,
    runtimeState.customPresets || {}
  );
  return runtimeState.presetsState;
}

function getScenarioReleasableCountries(scenarioId = runtimeState.activeScenarioId, { excludeTags = [] } = {}) {
  const normalizedScenarioId = String(scenarioId || "").trim();
  if (!normalizedScenarioId) return {};

  const releasables = {};
  const excludedTags = normalizeExcludedTags(excludeTags);
  resolveCatalogEntriesForScenario(normalizedScenarioId).forEach((entry, catalogOrder) => {
    const tag = normalizeCountryCode(entry.tag);
    if (excludedTags.has(tag)) return;
    const featureIds = resolvePresetFeatureIds(entry);
    if (!tag || !featureIds.length) return;
    const selectedBoundaryVariant = getResolvedReleasableBoundaryVariant(entry);

    const colorHex = String(entry.color_hex || "").trim().toLowerCase();
    const displayName = String(entry.display_name || tag).trim() || tag;
    const displayNameEn = String(entry.display_name_en || displayName || tag).trim() || tag;
    const displayNameZh = String(entry.display_name_zh || "").trim();
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
      display_name_en: displayNameEn,
      display_name_zh: displayNameZh,
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
      default_boundary_variant_id: getDefaultBoundaryVariantId(entry),
      selected_boundary_variant_id: selectedBoundaryVariant?.id || "",
      selected_boundary_variant_label: String(selectedBoundaryVariant?.label || "").trim(),
      selected_boundary_variant_description: String(selectedBoundaryVariant?.description || "").trim(),
      boundary_variants: normalizeBoundaryVariants(entry),
      companion_actions: normalizeCompanionActions(entry),
      notes: String(entry.notes || "").trim(),
      continent_id: groupingMeta.continentId,
      continent_label: groupingMeta.continentLabel,
      subregion_id: groupingMeta.subregionId,
      subregion_label: groupingMeta.subregionLabel,
      inspector_group_id: String(entry.inspector_group_id || "").trim(),
      inspector_group_label: String(entry.inspector_group_label || "").trim(),
      inspector_group_anchor_id: String(entry.inspector_group_anchor_id || "").trim(),
    };
  });

  return releasables;
}

export {
  buildScenarioReleasableIndex,
  getScenarioReleasableIndex,
  getScenarioReleasableCountries,
  getResolvedReleasableBoundaryVariant,
  mergePresetLayers,
  normalizeCountryCode,
  normalizePresetName,
  resolveCompanionActionFeatureIds,
  resolveFeatureIdsFromPresetSource,
  rebuildPresetState,
  setReleasableBoundaryVariant,
};


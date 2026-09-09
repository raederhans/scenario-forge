import { state as runtimeState, defaultCountryPalette, legacyDefaultCountryPalette } from "./state.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import {
  buildRuntimeDefaultColorsByIso2,
  getRuntimeBridgeMappedIso2,
} from "./palette_runtime_bridge.js";
import {
  applyActivePaletteRuntimeState,
  applyResolvedDefaultCountryPaletteState,
  commitActivePaletteSourceState,
  restoreActivePaletteSourceState,
  setPaletteLibraryEntriesState,
  setPaletteLoadErrorState,
  setPaletteQuickSwatchesState,
} from "./state/color_state.js";

function normalizeCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

function normalizeHexColor(value) {
  const input = String(value || "").trim().toLowerCase();
  const shortHex = /^#([0-9a-f]{3})$/.exec(input);
  if (shortHex) {
    return `#${shortHex[1]
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }
  if (/^#[0-9a-f]{6}$/.test(input)) return input;
  return "";
}

function getMappedIso2(mappedEntry) {
  return normalizeCountryCode(getRuntimeBridgeMappedIso2(mappedEntry));
}

function getUnmappedReason(unmappedEntry) {
  if (typeof unmappedEntry === "string") {
    return String(unmappedEntry || "").trim();
  }
  if (unmappedEntry && typeof unmappedEntry === "object") {
    return String(unmappedEntry.reason || unmappedEntry.mappingReason || "").trim();
  }
  return "";
}

function getSuggestedIso2(unmappedEntry) {
  if (unmappedEntry && typeof unmappedEntry === "object") {
    return normalizeCountryCode(unmappedEntry.suggested_iso2 || unmappedEntry.suggestedIso2);
  }
  return "";
}

function getPaletteDisplayColor(entry) {
  return normalizeHexColor(
    entry?.map_hex ||
    entry?.hex ||
    entry?.ui_hex ||
    entry?.country_file_hex
  );
}

function getPaletteUiColor(entry) {
  return normalizeHexColor(entry?.ui_hex || entry?.hex);
}

function buildPaletteColorVariants(entry) {
  const candidates = [
    { key: "map", label: "Map", color: entry?.map_hex || entry?.hex, source: entry?.map_source || "" },
    { key: "ui", label: "UI", color: entry?.ui_hex || entry?.hex, source: entry?.ui_source || "" },
    { key: "country_file", label: "Country file", color: entry?.country_file_hex, source: entry?.country_file_source || "" },
  ];
  const seenColors = new Set();
  return candidates.reduce((variants, candidate) => {
    const color = normalizeHexColor(candidate.color);
    if (!color || seenColors.has(color)) return variants;
    seenColors.add(color);
    variants.push({
      key: candidate.key,
      label: candidate.label,
      color,
      source: String(candidate.source || "").trim(),
    });
    return variants;
  }, []);
}

function getPaletteLabel(entry, tag) {
  return (
    String(entry?.localized_name || "").trim() ||
    String(entry?.country_file_label || "").trim() ||
    String(entry?.label || "").trim() ||
    String(tag || "").trim()
  );
}

function getGeoLocaleText(name, language) {
  const key = String(name || "").trim();
  if (!key) return "";
  const entry = runtimeState.locales?.geo?.[key];
  if (!entry || typeof entry !== "object") return "";
  const primary = language === "zh" ? entry.zh : entry.en;
  const secondary = language === "zh" ? entry.en : entry.zh;
  return String(primary || secondary || "").trim();
}

function resolvePaletteDisplayName(entry, tag) {
  const englishName = getPaletteLabel(entry, tag);
  const fileLabel = getPaletteFileLabel(entry, tag);
  const currentLanguage = runtimeState.currentLanguage === "zh" ? "zh" : "en";
  const localizedNameZh = getGeoLocaleText(englishName, "zh")
    || getGeoLocaleText(fileLabel, "zh");
  const localizedNameEn = getGeoLocaleText(englishName, "en") || englishName;
  const localizedName = currentLanguage === "zh"
    ? (localizedNameZh || localizedNameEn || englishName)
    : (localizedNameEn || englishName);
  return {
    localizedName,
    localizedNameEn: localizedNameEn || englishName,
    localizedNameZh,
  };
}

function isPaletteCodeLabel(value) {
  return /^[A-Z0-9_]{2,5}$/.test(String(value || "").trim());
}

function resolvePaletteSourceLabel(entry, tag, displayName = {}) {
  const fileLabel = getPaletteFileLabel(entry, tag);
  const localizedSourceLabelZh = getGeoLocaleText(fileLabel, "zh");
  const localizedSourceLabelEn = getGeoLocaleText(fileLabel, "en") || fileLabel;
  const sourceLabel = runtimeState.currentLanguage === "zh"
    ? (
      localizedSourceLabelZh
      || (isPaletteCodeLabel(fileLabel) ? String(displayName.localizedName || "").trim() : "")
      || localizedSourceLabelEn
      || fileLabel
    )
    : (localizedSourceLabelEn || fileLabel);
  return {
    sourceLabel,
    sourceLabelEn: localizedSourceLabelEn || fileLabel,
    sourceLabelZh: localizedSourceLabelZh
      || (isPaletteCodeLabel(fileLabel) ? String(displayName.localizedNameZh || displayName.localizedName || "").trim() : ""),
  };
}

function getPaletteMetaById(paletteId) {
  const targetId = String(paletteId || "").trim();
  const registryEntries = Array.isArray(runtimeState.paletteRegistry?.palettes)
    ? runtimeState.paletteRegistry.palettes
    : [];
  return registryEntries.find((entry) => String(entry?.palette_id || "").trim() === targetId) || null;
}

function getPaletteFileLabel(entry, tag) {
  return (
    String(entry?.country_file_label || "").trim() ||
    String(entry?.label || "").trim() ||
    String(entry?.localized_name || "").trim() ||
    String(tag || "").trim()
  );
}

function normalizePaletteMatchToken(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function addPaletteMatchToken(targetSet, value) {
  const token = normalizePaletteMatchToken(value);
  if (token) targetSet.add(token);
}

function collectCountryPaletteMatchTargets(countryState = {}) {
  const iso2 = new Set();
  const tags = new Set();
  const names = new Set();
  [
    countryState.code,
    countryState.tag,
    countryState.lookupIso2,
    countryState.lookup_iso2,
    countryState.baseIso2,
    countryState.base_iso2,
    countryState.releaseLookupIso2,
    countryState.release_lookup_iso2,
    countryState.presetLookupCode,
    countryState.preset_lookup_code,
  ].forEach((value) => {
    const normalized = normalizeCountryCode(value);
    if (!normalized) return;
    if (normalized.length === 2) {
      iso2.add(normalized);
    } else {
      tags.add(normalized);
    }
  });
  [
    countryState.displayName,
    countryState.name,
    countryState.localizedName,
    countryState.localizedNameEn,
    countryState.localizedNameZh,
  ].forEach((value) => addPaletteMatchToken(names, value));
  return { iso2, tags, names };
}

function getPaletteSuggestionMatchScore({
  tag,
  entry,
  mappedIso2,
  targets,
}) {
  const normalizedTag = normalizeCountryCode(tag);
  if (mappedIso2 && targets.iso2.has(mappedIso2)) {
    return { score: 400, matchKind: "iso2" };
  }
  if (normalizedTag && targets.tags.has(normalizedTag)) {
    return { score: 300, matchKind: "tag" };
  }

  const entryNames = new Set();
  [
    getPaletteLabel(entry, tag),
    getPaletteFileLabel(entry, tag),
    entry?.localized_name,
    entry?.country_file_label,
    entry?.label,
  ].forEach((value) => addPaletteMatchToken(entryNames, value));

  for (const entryName of entryNames) {
    if (targets.names.has(entryName)) {
      return { score: 200, matchKind: "name" };
    }
  }
  return null;
}

function buildPaletteColorSuggestionsForCountry(
  countryState,
  paletteAssets = [],
  {
    maxSuggestions = 24,
  } = {},
) {
  const targets = collectCountryPaletteMatchTargets(countryState);
  if (!targets.iso2.size && !targets.tags.size && !targets.names.size) return [];

  const suggestions = [];
  const seenKeys = new Set();
  (Array.isArray(paletteAssets) ? paletteAssets : []).forEach((asset, paletteIndex) => {
    const entries = asset?.pack?.entries;
    if (!entries || typeof entries !== "object") return;
    const mapped = asset?.map?.mapped && typeof asset.map.mapped === "object"
      ? asset.map.mapped
      : {};
    const paletteId = String(
      asset.paletteId ||
      asset.palette_id ||
      asset.meta?.palette_id ||
      asset.meta?.id ||
      ""
    ).trim();
    const paletteLabel = String(
      asset.paletteLabel ||
      asset.palette_label ||
      asset.meta?.display_name ||
      asset.meta?.label ||
      paletteId
    ).trim() || paletteId;

    Object.entries(entries).forEach(([tag, entry]) => {
      const color = getPaletteDisplayColor(entry);
      if (!color) return;
      const mappedIso2 = getMappedIso2(mapped[tag]);
      const match = getPaletteSuggestionMatchScore({
        tag,
        entry,
        mappedIso2,
        targets,
      });
      if (!match) return;
      const suggestionKey = `${paletteId}:${String(tag || "").toUpperCase()}:${color}`;
      if (seenKeys.has(suggestionKey)) return;
      seenKeys.add(suggestionKey);
      const displayName = resolvePaletteDisplayName(entry, tag);
      const sourceName = resolvePaletteSourceLabel(entry, tag, displayName);
      suggestions.push({
        key: suggestionKey,
        paletteId,
        paletteLabel,
        paletteIndex,
        sourceTag: String(tag || "").toUpperCase(),
        iso2: mappedIso2,
        color,
        label: displayName.localizedName || getPaletteLabel(entry, tag),
        localizedNameEn: displayName.localizedNameEn,
        localizedNameZh: displayName.localizedNameZh,
        sourceLabel: sourceName.sourceLabel,
        sourceLabelEn: sourceName.sourceLabelEn,
        sourceLabelZh: sourceName.sourceLabelZh,
        matchKind: match.matchKind,
        score: match.score,
      });
    });
  });

  return suggestions
    .sort((left, right) => (
      right.score - left.score
      || left.paletteIndex - right.paletteIndex
      || String(left.paletteLabel).localeCompare(String(right.paletteLabel))
      || String(left.label).localeCompare(String(right.label))
    ))
    .slice(0, maxSuggestions);
}

function buildFixedPaletteColorsByIso2(palettePack, paletteMap) {
  return buildRuntimeDefaultColorsByIso2(palettePack, paletteMap);
}

function resolveDefaultCountryPalette() {
  return {
    ...legacyDefaultCountryPalette,
    ...(runtimeState.fixedPaletteColorsByIso2 || {}),
  };
}

function syncResolvedDefaultCountryPalette({ overwriteCountryPalette = false } = {}) {
  const next = resolveDefaultCountryPalette();
  return applyResolvedDefaultCountryPaletteState(runtimeState, next, {
    overwriteCountryPalette,
    defaultPaletteTarget: defaultCountryPalette,
  });
}

function getPaletteSourceOptions() {
  const registryEntries = Array.isArray(runtimeState.paletteRegistry?.palettes)
    ? runtimeState.paletteRegistry.palettes
    : [];
  if (registryEntries.length) {
    return registryEntries.map((entry) => ({
      value: String(entry.palette_id || ""),
      label: String(entry.display_name || entry.palette_id || ""),
      kind: "asset",
    }));
  }
  return [];
}

function buildPaletteLibraryEntries() {
  const entries = runtimeState.activePalettePack?.entries;
  if (!entries || typeof entries !== "object") {
    return setPaletteLibraryEntriesState(runtimeState, []);
  }

  const mapped = runtimeState.activePaletteMap?.mapped && typeof runtimeState.activePaletteMap.mapped === "object"
    ? runtimeState.activePaletteMap.mapped
    : {};
  const unmapped = runtimeState.activePaletteMap?.unmapped && typeof runtimeState.activePaletteMap.unmapped === "object"
    ? runtimeState.activePaletteMap.unmapped
    : {};
  const quickTags = Array.isArray(runtimeState.activePalettePack?.quick_tags)
    ? runtimeState.activePalettePack.quick_tags.map((tag) => String(tag || "").trim().toUpperCase())
    : [];
  const quickOrder = new Map();
  quickTags.forEach((tag, index) => {
    if (tag) quickOrder.set(tag, index);
  });

  const libraryEntries = Object.entries(entries).map(([tag, entry]) => {
    const mappedEntry = mapped[tag];
    const unmappedEntry = unmapped[tag];
    const mappedIso2 = getMappedIso2(mappedEntry);
    const countryFileLabel = getPaletteFileLabel(entry, tag);
    const {
      localizedName,
      localizedNameEn,
      localizedNameZh,
    } = resolvePaletteDisplayName(entry, tag);
    const {
      sourceLabel,
      sourceLabelEn,
      sourceLabelZh,
    } = resolvePaletteSourceLabel(entry, tag, { localizedName, localizedNameZh });
    const displayColor = getPaletteDisplayColor(entry);
    const uiColor = getPaletteUiColor(entry);
    const mappingReason = mappedIso2 ? "" : getUnmappedReason(unmappedEntry);
    const paletteRegion = entry?.palette_region && typeof entry.palette_region === "object"
      ? entry.palette_region
      : null;
    const paletteRegionOrder = Number(paletteRegion?.order);
    return {
      key: tag,
      sourceTag: tag,
      iso2: mappedIso2,
      mappedIso2,
      color: displayColor,
      displayColor,
      uiColor,
      label: localizedName,
      localizedName,
      localizedNameEn,
      localizedNameZh,
      countryFileLabel,
      sourceLabel,
      sourceLabelEn,
      sourceLabelZh,
      mappingStatus: mappedIso2 ? "mapped" : "unmapped",
      mapped: !!mappedIso2,
      mappingReason,
      unmappedReason: mappingReason,
      suggestedIso2: getSuggestedIso2(unmappedEntry),
      dynamic: !!entry?.dynamic,
      nameSource: String(entry?.name_source || "").trim(),
      countryFileIsSharedTemplate: !!entry?.country_file_is_shared_template,
      quickIndex: quickOrder.has(tag) ? quickOrder.get(tag) : Number.POSITIVE_INFINITY,
      matchKind: mappedEntry && typeof mappedEntry === "object" ? String(mappedEntry.match_kind || "") : "",
      decisionSource: mappedEntry && typeof mappedEntry === "object" ? String(mappedEntry.decision_source || "") : "",
      paletteRegionKey: String(paletteRegion?.key || "").trim(),
      paletteRegionLabel: String(paletteRegion?.label || "").trim(),
      paletteRegionOrder: Number.isFinite(paletteRegionOrder) ? paletteRegionOrder : 999,
      paletteRegionSource: String(paletteRegion?.source || "").trim(),
      colorVariants: buildPaletteColorVariants(entry),
    };
  });

  libraryEntries.sort((a, b) => {
    const quickA = Number.isFinite(a.quickIndex);
    const quickB = Number.isFinite(b.quickIndex);
    if (quickA !== quickB) return quickA ? -1 : 1;
    if (quickA && quickB && a.quickIndex !== b.quickIndex) return a.quickIndex - b.quickIndex;
    if (a.dynamic !== b.dynamic) return a.dynamic ? 1 : -1;
    if (a.mapped !== b.mapped) return a.mapped ? -1 : 1;
    return a.localizedName.localeCompare(b.localizedName) || a.sourceTag.localeCompare(b.sourceTag);
  });

  return setPaletteLibraryEntriesState(runtimeState, libraryEntries);
}

function buildPaletteQuickSwatches(maxCount = 24) {
  const swatches = [];
  const seen = new Set();
  const entries = runtimeState.activePalettePack?.entries && typeof runtimeState.activePalettePack.entries === "object"
    ? runtimeState.activePalettePack.entries
    : {};
  const mapped = runtimeState.activePaletteMap?.mapped && typeof runtimeState.activePaletteMap.mapped === "object"
    ? runtimeState.activePaletteMap.mapped
    : {};
  const quickTags = Array.isArray(runtimeState.activePalettePack?.quick_tags)
    ? runtimeState.activePalettePack.quick_tags
    : [];

  quickTags.forEach((rawTag) => {
    if (swatches.length >= maxCount) return;
    const tag = String(rawTag || "").trim().toUpperCase();
    if (!tag || !entries[tag]) return;
    const color = getPaletteDisplayColor(entries[tag]);
    if (!color || seen.has(color)) return;
    seen.add(color);
    const mappedIso2 = getMappedIso2(mapped[tag]);
    swatches.push({
      color,
      sourceTag: tag,
      iso2: mappedIso2,
      label: resolvePaletteDisplayName(entries[tag], tag).localizedName,
    });
  });

  return setPaletteQuickSwatchesState(runtimeState, swatches, maxCount);
}

function applyActivePaletteState({
  overwriteCountryPalette = false,
  syncDefaultPalette = true,
} = {}) {
  applyActivePaletteRuntimeState(runtimeState, {
    fixedPaletteColorsByIso2: buildFixedPaletteColorsByIso2(
      runtimeState.activePalettePack,
      runtimeState.activePaletteMap
    ),
    activePaletteOceanMeta: runtimeState.activePalettePack?.ocean || null,
  });
  if (syncDefaultPalette) {
    syncResolvedDefaultCountryPalette({ overwriteCountryPalette });
  }
  buildPaletteLibraryEntries();
  buildPaletteQuickSwatches();
}

async function ensurePaletteAssetsLoaded(
  paletteId,
  { d3Client = globalThis.d3 } = {}
) {
  const targetId = String(paletteId || "").trim();
  if (!targetId) {
    throw new Error("Palette id is required.");
  }

  const meta = getPaletteMetaById(targetId);
  if (!meta) {
    throw new Error(`Unknown palette source: ${targetId}`);
  }

  const cachedPack = runtimeState.palettePackCacheById?.[targetId];
  const cachedMap = runtimeState.paletteMapCacheById?.[targetId];
  if (cachedPack && cachedMap) {
    return { meta, pack: cachedPack, map: cachedMap };
  }

  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for palette loading.");
  }

  const paletteUrl = String(meta.palette_url || "").trim();
  const mapUrl = String(meta.map_url || "").trim();
  if (!paletteUrl || !mapUrl) {
    throw new Error(`Palette source ${targetId} is missing palette_url or map_url.`);
  }

  const [pack, map] = await Promise.all([
    d3Client.json(paletteUrl),
    d3Client.json(mapUrl),
  ]);
  runtimeState.palettePackCacheById[targetId] = pack;
  runtimeState.paletteMapCacheById[targetId] = map;
  setPaletteLoadErrorState(runtimeState, targetId, "");
  return { meta, pack, map };
}

function syncPaletteSourceControls() {
  if (typeof runtimeState.updatePaletteSourceUIFn === "function") {
    runtimeState.updatePaletteSourceUIFn();
  }
}

async function setActivePaletteSource(
  paletteId,
  {
    syncUI = true,
    publishObservers = true,
    syncDefaultPalette = true,
    overwriteCountryPalette = false,
    d3Client = globalThis.d3,
    isCurrent = () => true,
  } = {}
) {
  const previousState = {
    activePaletteId: runtimeState.activePaletteId,
    activePaletteMeta: runtimeState.activePaletteMeta,
    activePalettePack: runtimeState.activePalettePack,
    activePaletteMap: runtimeState.activePaletteMap,
    currentPaletteTheme: runtimeState.currentPaletteTheme,
    activePaletteOceanMeta: runtimeState.activePaletteOceanMeta,
  };

  try {
    const { meta, pack, map } = await ensurePaletteAssetsLoaded(paletteId, { d3Client });
    if (!isCurrent()) return false;
    commitActivePaletteSourceState(runtimeState, {
      activePaletteId: meta?.palette_id || paletteId,
      activePaletteMeta: meta,
      activePalettePack: pack,
      activePaletteMap: map,
      currentPaletteTheme: meta?.display_name || runtimeState.currentPaletteTheme,
    });
    applyActivePaletteState({
      overwriteCountryPalette,
      syncDefaultPalette,
    });
    if (
      publishObservers
      && typeof runtimeState.renderPaletteFn === "function"
    ) {
      runtimeState.renderPaletteFn(runtimeState.currentPaletteTheme);
    }
    if (
      publishObservers
      && typeof runtimeState.updatePaletteLibraryUIFn === "function"
    ) {
      runtimeState.updatePaletteLibraryUIFn();
    }
    if (publishObservers && syncUI) {
      syncPaletteSourceControls();
    }
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    const targetId = String(paletteId || "").trim();
    if (targetId) {
      setPaletteLoadErrorState(
        runtimeState,
        targetId,
        String(error?.message || error || "Unknown palette load error"),
      );
    }
    restoreActivePaletteSourceState(runtimeState, previousState);
    if (publishObservers && syncUI) {
      syncPaletteSourceControls();
    }
    console.warn("[palette_manager] Failed to load palette source:", error);
    return false;
  }
}

export {
  applyActivePaletteState,
  buildFixedPaletteColorsByIso2,
  buildPaletteColorSuggestionsForCountry,
  buildPaletteLibraryEntries,
  buildPaletteQuickSwatches,
  ensurePaletteAssetsLoaded,
  getMappedIso2,
  getPaletteDisplayColor,
  getPaletteFileLabel,
  getPaletteLabel,
  getPaletteMetaById,
  getPaletteSourceOptions,
  getSuggestedIso2,
  getUnmappedReason,
  normalizeCountryCode,
  normalizeHexColor,
  resolveDefaultCountryPalette,
  setActivePaletteSource,
  syncResolvedDefaultCountryPalette,
};


import { state, defaultCountryPalette, legacyDefaultCountryPalette } from "./state.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";

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

function replaceObjectContents(target, nextValues) {
  Object.keys(target || {}).forEach((key) => {
    delete target[key];
  });
  Object.entries(nextValues || {}).forEach(([key, value]) => {
    target[key] = value;
  });
}

function getMappedIso2(mappedEntry) {
  if (typeof mappedEntry === "string") {
    return normalizeCountryCode(mappedEntry);
  }
  if (mappedEntry && typeof mappedEntry === "object") {
    return normalizeCountryCode(mappedEntry.iso2);
  }
  return "";
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

function getPaletteLabel(entry, tag) {
  return (
    String(entry?.localized_name || "").trim() ||
    String(entry?.country_file_label || "").trim() ||
    String(entry?.label || "").trim() ||
    String(tag || "").trim()
  );
}

function getPaletteMetaById(paletteId) {
  const targetId = String(paletteId || "").trim();
  const registryEntries = Array.isArray(state.paletteRegistry?.palettes)
    ? state.paletteRegistry.palettes
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

function buildFixedPaletteColorsByIso2(palettePack, paletteMap) {
  const mapped = paletteMap?.mapped && typeof paletteMap.mapped === "object" ? paletteMap.mapped : {};
  const entries = palettePack?.entries && typeof palettePack.entries === "object" ? palettePack.entries : {};
  const fixed = {};
  Object.entries(mapped).forEach(([tag, mappedEntry]) => {
    const iso2 = getMappedIso2(mappedEntry);
    const hex = normalizeHexColor(entries?.[tag]?.map_hex || entries?.[tag]?.country_file_hex || entries?.[tag]?.ui_hex);
    if (!iso2 || !hex) return;
    fixed[iso2] = hex;
  });
  return fixed;
}

function resolveDefaultCountryPalette() {
  return {
    ...legacyDefaultCountryPalette,
    ...(state.fixedPaletteColorsByIso2 || {}),
  };
}

function syncResolvedDefaultCountryPalette({ overwriteCountryPalette = false } = {}) {
  const next = resolveDefaultCountryPalette();
  state.resolvedDefaultCountryPalette = next;
  replaceObjectContents(defaultCountryPalette, next);
  if (overwriteCountryPalette) {
    replaceObjectContents(state.countryPalette, next);
  }
  return next;
}

function getPaletteSourceOptions() {
  const registryEntries = Array.isArray(state.paletteRegistry?.palettes)
    ? state.paletteRegistry.palettes
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
  const entries = state.activePalettePack?.entries;
  if (!entries || typeof entries !== "object") {
    state.paletteLibraryEntries = [];
    return state.paletteLibraryEntries;
  }

  const mapped = state.activePaletteMap?.mapped && typeof state.activePaletteMap.mapped === "object"
    ? state.activePaletteMap.mapped
    : {};
  const unmapped = state.activePaletteMap?.unmapped && typeof state.activePaletteMap.unmapped === "object"
    ? state.activePaletteMap.unmapped
    : {};
  const quickTags = Array.isArray(state.activePalettePack?.quick_tags)
    ? state.activePalettePack.quick_tags.map((tag) => String(tag || "").trim().toUpperCase())
    : [];
  const quickOrder = new Map();
  quickTags.forEach((tag, index) => {
    if (tag) quickOrder.set(tag, index);
  });

  const libraryEntries = Object.entries(entries).map(([tag, entry]) => {
    const mappedEntry = mapped[tag];
    const unmappedEntry = unmapped[tag];
    const mappedIso2 = getMappedIso2(mappedEntry);
    const localizedName = getPaletteLabel(entry, tag);
    const countryFileLabel = getPaletteFileLabel(entry, tag);
    const displayColor = getPaletteDisplayColor(entry);
    const uiColor = getPaletteUiColor(entry);
    const mappingReason = mappedIso2 ? "" : getUnmappedReason(unmappedEntry);
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
      countryFileLabel,
      sourceLabel: countryFileLabel,
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

  state.paletteLibraryEntries = libraryEntries;
  return libraryEntries;
}

function buildPaletteQuickSwatches(maxCount = 24) {
  const swatches = [];
  const seen = new Set();
  const entries = state.activePalettePack?.entries && typeof state.activePalettePack.entries === "object"
    ? state.activePalettePack.entries
    : {};
  const mapped = state.activePaletteMap?.mapped && typeof state.activePaletteMap.mapped === "object"
    ? state.activePaletteMap.mapped
    : {};
  const quickTags = Array.isArray(state.activePalettePack?.quick_tags)
    ? state.activePalettePack.quick_tags
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
      label: getPaletteLabel(entries[tag], tag),
    });
  });

  state.paletteQuickSwatches = swatches.slice(0, maxCount);
  return state.paletteQuickSwatches;
}

function applyActivePaletteState({ overwriteCountryPalette = false } = {}) {
  state.fixedPaletteColorsByIso2 = buildFixedPaletteColorsByIso2(
    state.activePalettePack,
    state.activePaletteMap
  );
  state.activePaletteOceanMeta = state.activePalettePack?.ocean || null;
  syncResolvedDefaultCountryPalette({ overwriteCountryPalette });
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

  const cachedPack = state.palettePackCacheById?.[targetId];
  const cachedMap = state.paletteMapCacheById?.[targetId];
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
  state.palettePackCacheById[targetId] = pack;
  state.paletteMapCacheById[targetId] = map;
  state.paletteLoadErrorById[targetId] = "";
  return { meta, pack, map };
}

function syncPaletteSourceControls() {
  if (typeof state.updatePaletteSourceUIFn === "function") {
    state.updatePaletteSourceUIFn();
  }
}

async function setActivePaletteSource(
  paletteId,
  {
    syncUI = true,
    overwriteCountryPalette = false,
    d3Client = globalThis.d3,
  } = {}
) {
  const previousState = {
    activePaletteId: state.activePaletteId,
    activePaletteMeta: state.activePaletteMeta,
    activePalettePack: state.activePalettePack,
    activePaletteMap: state.activePaletteMap,
    currentPaletteTheme: state.currentPaletteTheme,
    activePaletteOceanMeta: state.activePaletteOceanMeta,
  };

  try {
    const { meta, pack, map } = await ensurePaletteAssetsLoaded(paletteId, { d3Client });
    state.activePaletteId = String(meta?.palette_id || paletteId || "").trim();
    state.activePaletteMeta = meta || null;
    state.activePalettePack = pack || null;
    state.activePaletteMap = map || null;
    state.currentPaletteTheme = String(
      meta?.display_name || state.currentPaletteTheme || state.activePaletteId || "HOI4 Vanilla"
    );
    applyActivePaletteState({ overwriteCountryPalette });
    if (typeof state.renderPaletteFn === "function") {
      state.renderPaletteFn(state.currentPaletteTheme);
    }
    if (typeof state.updatePaletteLibraryUIFn === "function") {
      state.updatePaletteLibraryUIFn();
    }
    if (syncUI) {
      syncPaletteSourceControls();
    }
    return true;
  } catch (error) {
    const targetId = String(paletteId || "").trim();
    if (targetId) {
      state.paletteLoadErrorById[targetId] = String(error?.message || error || "Unknown palette load error");
    }
    state.activePaletteId = previousState.activePaletteId;
    state.activePaletteMeta = previousState.activePaletteMeta;
    state.activePalettePack = previousState.activePalettePack;
    state.activePaletteMap = previousState.activePaletteMap;
    state.currentPaletteTheme = previousState.currentPaletteTheme;
    state.activePaletteOceanMeta = previousState.activePaletteOceanMeta;
    if (syncUI) {
      syncPaletteSourceControls();
    }
    console.warn("[palette_manager] Failed to load palette source:", error);
    return false;
  }
}

export {
  applyActivePaletteState,
  buildFixedPaletteColorsByIso2,
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

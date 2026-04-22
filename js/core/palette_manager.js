import { state as runtimeState, defaultCountryPalette, legacyDefaultCountryPalette } from "./state.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import {
  buildRuntimeDefaultColorsByIso2,
  getRuntimeBridgeMappedIso2,
} from "./palette_runtime_bridge.js";
const state = runtimeState;

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
  runtimeState.resolvedDefaultCountryPalette = next;
  replaceObjectContents(defaultCountryPalette, next);
  if (overwriteCountryPalette) {
    replaceObjectContents(runtimeState.countryPalette, next);
  }
  return next;
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
    runtimeState.paletteLibraryEntries = [];
    return runtimeState.paletteLibraryEntries;
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

  runtimeState.paletteLibraryEntries = libraryEntries;
  return libraryEntries;
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
      label: getPaletteLabel(entries[tag], tag),
    });
  });

  runtimeState.paletteQuickSwatches = swatches.slice(0, maxCount);
  return runtimeState.paletteQuickSwatches;
}

function applyActivePaletteState({ overwriteCountryPalette = false } = {}) {
  runtimeState.fixedPaletteColorsByIso2 = buildFixedPaletteColorsByIso2(
    runtimeState.activePalettePack,
    runtimeState.activePaletteMap
  );
  runtimeState.activePaletteOceanMeta = runtimeState.activePalettePack?.ocean || null;
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
  runtimeState.paletteLoadErrorById[targetId] = "";
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
    overwriteCountryPalette = false,
    d3Client = globalThis.d3,
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
    runtimeState.activePaletteId = String(meta?.palette_id || paletteId || "").trim();
    runtimeState.activePaletteMeta = meta || null;
    runtimeState.activePalettePack = pack || null;
    runtimeState.activePaletteMap = map || null;
    runtimeState.currentPaletteTheme = String(
      meta?.display_name || runtimeState.currentPaletteTheme || runtimeState.activePaletteId || "HOI4 Vanilla"
    );
    applyActivePaletteState({ overwriteCountryPalette });
    if (typeof runtimeState.renderPaletteFn === "function") {
      runtimeState.renderPaletteFn(runtimeState.currentPaletteTheme);
    }
    if (typeof runtimeState.updatePaletteLibraryUIFn === "function") {
      runtimeState.updatePaletteLibraryUIFn();
    }
    if (syncUI) {
      syncPaletteSourceControls();
    }
    return true;
  } catch (error) {
    const targetId = String(paletteId || "").trim();
    if (targetId) {
      runtimeState.paletteLoadErrorById[targetId] = String(error?.message || error || "Unknown palette load error");
    }
    runtimeState.activePaletteId = previousState.activePaletteId;
    runtimeState.activePaletteMeta = previousState.activePaletteMeta;
    runtimeState.activePalettePack = previousState.activePalettePack;
    runtimeState.activePaletteMap = previousState.activePaletteMap;
    runtimeState.currentPaletteTheme = previousState.currentPaletteTheme;
    runtimeState.activePaletteOceanMeta = previousState.activePaletteOceanMeta;
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


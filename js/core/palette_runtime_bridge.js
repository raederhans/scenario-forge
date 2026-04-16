const RUNTIME_BRIDGE_COUNTRY_CODE_ALIASES = Object.freeze({
  UK: "GB",
  EL: "GR",
});

function normalizeRuntimeBridgeTag(rawTag) {
  return String(rawTag || "").trim().toUpperCase();
}

function normalizeRuntimeBridgeIso2(rawIso2) {
  const normalized = String(rawIso2 || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return RUNTIME_BRIDGE_COUNTRY_CODE_ALIASES[normalized] || normalized;
}

function normalizeRuntimeBridgeHex(rawColor) {
  const color = String(rawColor || "").trim().toLowerCase();
  const shortHex = /^#([0-9a-f]{3})$/.exec(color);
  if (shortHex) {
    return `#${shortHex[1]
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }
  return /^#[0-9a-f]{6}$/.test(color) ? color : "";
}

function getRuntimeBridgeMappedIso2(mappedEntry) {
  if (mappedEntry && typeof mappedEntry === "object") {
    return normalizeRuntimeBridgeIso2(mappedEntry.iso2);
  }
  if (typeof mappedEntry === "string") {
    return normalizeRuntimeBridgeIso2(mappedEntry);
  }
  return "";
}

function shouldExposeRuntimeBridgeDefault(mappedEntry) {
  if (!mappedEntry || typeof mappedEntry !== "object") return true;
  return mappedEntry.expose_as_runtime_default !== false;
}

function getRuntimeBridgePaletteColor(entry) {
  return normalizeRuntimeBridgeHex(
    entry?.map_hex ||
    entry?.hex ||
    entry?.ui_hex ||
    entry?.country_file_hex
  );
}

function getRuntimeBridgeCountryIso2(tag, countryEntry, paletteMap) {
  const mappedEntry = paletteMap?.mapped?.[tag];
  const mappedIso2 = getRuntimeBridgeMappedIso2(mappedEntry);
  if (mappedIso2) return mappedIso2;
  return normalizeRuntimeBridgeIso2(countryEntry?.base_iso2 || countryEntry?.lookup_iso2);
}

function buildRuntimeDefaultTagByIso2(paletteMap) {
  const mapped = paletteMap?.mapped && typeof paletteMap.mapped === "object" ? paletteMap.mapped : {};
  const defaultTagByIso2 = {};
  Object.entries(mapped).forEach(([rawTag, mappedEntry]) => {
    if (!shouldExposeRuntimeBridgeDefault(mappedEntry)) return;
    const tag = normalizeRuntimeBridgeTag(rawTag);
    const iso2 = getRuntimeBridgeMappedIso2(mappedEntry);
    if (tag && iso2 && !defaultTagByIso2[iso2]) {
      defaultTagByIso2[iso2] = tag;
    }
  });
  return defaultTagByIso2;
}

function buildRuntimeDefaultColorsByIso2(
  palettePack,
  paletteMap,
  { fallbackColorByTag = {} } = {}
) {
  const entries = palettePack?.entries && typeof palettePack.entries === "object" ? palettePack.entries : {};
  const defaultTagByIso2 = buildRuntimeDefaultTagByIso2(paletteMap);
  const colorByIso2 = {};
  Object.entries(defaultTagByIso2).forEach(([iso2, tag]) => {
    const color =
      getRuntimeBridgePaletteColor(entries[tag]) ||
      normalizeRuntimeBridgeHex(fallbackColorByTag?.[tag]);
    if (iso2 && color) {
      colorByIso2[iso2] = color;
    }
  });
  return colorByIso2;
}

function buildScenarioRuntimeDefaultTagColors(
  countryMap,
  {
    palettePack = null,
    paletteMap = null,
    fallbackColorByTag = {},
  } = {}
) {
  const colorByIso2 = buildRuntimeDefaultColorsByIso2(palettePack, paletteMap, {
    fallbackColorByTag,
  });
  const byTag = {};
  Object.entries(countryMap || {}).forEach(([rawTag, rawEntry]) => {
    const tag = normalizeRuntimeBridgeTag(rawTag);
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
    const ownColor = normalizeRuntimeBridgeHex(
      fallbackColorByTag?.[tag] ||
      entry.color_hex ||
      entry.colorHex
    );
    const iso2 = getRuntimeBridgeCountryIso2(tag, entry, paletteMap);
    const bridgedColor = iso2 ? colorByIso2[iso2] : "";
    const color = bridgedColor || ownColor;
    if (tag && color) {
      byTag[tag] = color;
    }
  });
  return {
    byTag,
    byIso2: colorByIso2,
    defaultTagByIso2: buildRuntimeDefaultTagByIso2(paletteMap),
  };
}

export {
  buildRuntimeDefaultColorsByIso2,
  buildRuntimeDefaultTagByIso2,
  buildScenarioRuntimeDefaultTagColors,
  getRuntimeBridgeMappedIso2,
  normalizeRuntimeBridgeHex,
  normalizeRuntimeBridgeIso2,
  shouldExposeRuntimeBridgeDefault,
};

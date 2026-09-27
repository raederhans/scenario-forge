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

function hashRuntimeBridgeString(value) {
  const input = normalizeRuntimeBridgeTag(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslChannelToRgb(p, q, t) {
  let channel = t;
  if (channel < 0) channel += 1;
  if (channel > 1) channel -= 1;
  if (channel < 1 / 6) return p + (q - p) * 6 * channel;
  if (channel < 1 / 2) return q;
  if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
  return p;
}

function hslToRuntimeBridgeHex(hue, saturation, lightness) {
  const h = (((Number(hue) || 0) % 360) + 360) % 360 / 360;
  const s = Math.min(Math.max(Number(saturation) || 0, 0), 1);
  const l = Math.min(Math.max(Number(lightness) || 0, 0), 1);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels = [
    hslChannelToRgb(p, q, h + 1 / 3),
    hslChannelToRgb(p, q, h),
    hslChannelToRgb(p, q, h - 1 / 3),
  ];
  return `#${channels
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function buildDeterministicRuntimeBridgeColor(tag) {
  const hash = hashRuntimeBridgeString(tag);
  const hue = hash % 360;
  const saturation = 0.52 + ((hash >>> 8) % 12) / 100;
  const lightness = 0.43 + ((hash >>> 16) % 10) / 100;
  return hslToRuntimeBridgeHex(hue, saturation, lightness);
}

function getRuntimeBridgePaletteTagColor(tag, palettePack) {
  const entries = palettePack?.entries && typeof palettePack.entries === "object" ? palettePack.entries : {};
  return getRuntimeBridgePaletteColor(entries[normalizeRuntimeBridgeTag(tag)]);
}

function getRuntimeBridgeCountryIso2(tag, countryEntry, paletteMap) {
  const mappedEntry = paletteMap?.mapped?.[tag];
  const mappedIso2 = getRuntimeBridgeMappedIso2(mappedEntry);
  if (mappedIso2) return mappedIso2;
  return normalizeRuntimeBridgeIso2(countryEntry?.base_iso2 || countryEntry?.lookup_iso2);
}

function getRuntimeBridgeOwnerColorEntry(tag, rawEntry) {
  const entry = rawEntry && typeof rawEntry === "object" ? { ...rawEntry } : {};
  if (String(tag || "").trim().length === 2) {
    if (!entry.base_iso2) {
      entry.base_iso2 = tag;
    }
    if (!entry.lookup_iso2) {
      entry.lookup_iso2 = tag;
    }
  }
  return entry;
}

function buildScenarioOwnerColorEntryPairs(countryMap, {
  ownerTags = [],
  ownerEntriesByTag = {},
} = {}) {
  const entryByTag = new Map();
  Object.entries(countryMap || {}).forEach(([rawTag, rawEntry]) => {
    const tag = normalizeRuntimeBridgeTag(rawTag);
    if (!tag) return;
    entryByTag.set(tag, rawEntry && typeof rawEntry === "object" ? rawEntry : {});
  });
  (Array.isArray(ownerTags) ? ownerTags : []).forEach((rawTag) => {
    const tag = normalizeRuntimeBridgeTag(rawTag);
    if (!tag || entryByTag.has(tag)) return;
    entryByTag.set(tag, ownerEntriesByTag?.[tag] || {});
  });
  Object.entries(ownerEntriesByTag || {}).forEach(([rawTag, rawEntry]) => {
    const tag = normalizeRuntimeBridgeTag(rawTag);
    if (!tag || entryByTag.has(tag)) return;
    entryByTag.set(tag, rawEntry && typeof rawEntry === "object" ? rawEntry : {});
  });
  return Array.from(entryByTag.entries()).map(([tag, rawEntry]) => [
    tag,
    getRuntimeBridgeOwnerColorEntry(tag, rawEntry),
  ]);
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

function buildScenarioOwnerColorMapDetails(
  countryMap,
  {
    palettePack = null,
    paletteMap = null,
    seedColorByTag = {},
    fallbackColorByTag = {},
    ownerTags = [],
    ownerEntriesByTag = {},
  } = {}
) {
  const colorByIso2 = buildRuntimeDefaultColorsByIso2(palettePack, paletteMap, {
    fallbackColorByTag,
  });
  const byTag = {};
  const generatedTags = [];
  buildScenarioOwnerColorEntryPairs(countryMap, {
    ownerTags,
    ownerEntriesByTag,
  }).forEach(([tag, entry]) => {
    const ownColor = normalizeRuntimeBridgeHex(
      seedColorByTag?.[tag]
      || fallbackColorByTag?.[tag]
      || entry.color_hex
      || entry.colorHex
    );
    const paletteTagColor = getRuntimeBridgePaletteTagColor(tag, palettePack);
    const iso2 = getRuntimeBridgeCountryIso2(tag, entry, paletteMap);
    const bridgedColor = iso2 ? normalizeRuntimeBridgeHex(colorByIso2[iso2]) : "";
    const generatedColor = ownColor || paletteTagColor || bridgedColor
      ? ""
      : buildDeterministicRuntimeBridgeColor(tag);
    byTag[tag] = ownColor || paletteTagColor || bridgedColor || generatedColor;
    if (generatedColor) {
      generatedTags.push(tag);
    }
  });
  // State normalization collapses legacy aliases onto canonical country codes.
  // Keep their colors aligned so a later alias cannot overwrite the explicit color.
  Object.entries(RUNTIME_BRIDGE_COUNTRY_CODE_ALIASES).forEach(([alias, canonical]) => {
    if (byTag[alias] && byTag[canonical]) {
      byTag[alias] = byTag[canonical];
    }
  });
  return {
    byTag,
    generatedTags: generatedTags.filter((tag) => {
      const canonical = RUNTIME_BRIDGE_COUNTRY_CODE_ALIASES[tag];
      return !canonical || !byTag[canonical] || generatedTags.includes(canonical);
    }),
  };
}

function buildScenarioOwnerColorMap(countryMap, options = {}) {
  return buildScenarioOwnerColorMapDetails(countryMap, options).byTag;
}

export {
  buildDeterministicRuntimeBridgeColor,
  buildRuntimeDefaultColorsByIso2,
  buildRuntimeDefaultTagByIso2,
  buildScenarioOwnerColorMap,
  buildScenarioOwnerColorMapDetails,
  buildScenarioRuntimeDefaultTagColors,
  getRuntimeBridgeMappedIso2,
  normalizeRuntimeBridgeHex,
  normalizeRuntimeBridgeIso2,
  shouldExposeRuntimeBridgeDefault,
};

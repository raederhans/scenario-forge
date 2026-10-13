import { normalizeHexColor, hexToRgb } from "../core/color_hex_utils.js";
import { getUniqueLegendColors, normalizeLabels } from "../core/legend_state_normalizers.js";

// RGB distance is a practical similarity hint, not a test of color vision.
export const COLOR_CHECK_THRESHOLDS = Object.freeze([0, 18, 30]);
export const DEFAULT_COLOR_CHECK_THRESHOLD = 18;

const text = (value) => String(value ?? "").trim();
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const entryKey = (entry) => `${entry.kind}:${entry.id}`;

function normalizeThreshold(value) {
  const candidate = typeof value === "number" || (typeof value === "string" && text(value))
    ? Number(value)
    : Number.NaN;
  return Number.isFinite(candidate)
    ? Math.min(100, Math.max(0, candidate))
    : DEFAULT_COLOR_CHECK_THRESHOLD;
}

function rgbDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * Compare detached country or solid-legend entries without changing their source.
 * Entries and counts reflect the selected scope; skippedCount counts malformed
 * entries in that scope. Repeated identities retain their first valid entry.
 * Every qualifying pair is returned; similarity is not treated as transitive.
 */
export function findSimilarPaletteColors(rawEntries, { threshold = DEFAULT_COLOR_CHECK_THRESHOLD, scope = "all" } = {}) {
  const resolvedThreshold = normalizeThreshold(threshold);
  const resolvedScope = scope === "country" || scope === "legend" ? scope : "all";
  const entries = [];
  const seen = new Set();
  let skippedCount = 0;

  for (const raw of Array.isArray(rawEntries) ? rawEntries : []) {
    const kind = raw?.kind;
    if (resolvedScope !== "all" && kind !== resolvedScope) continue;
    const id = text(raw?.id);
    const color = normalizeHexColor(raw?.color);
    if ((kind !== "country" && kind !== "legend") || !id || !color) {
      skippedCount += 1;
      continue;
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { id, kind, name: text(raw.name) || text(raw.code) || id, color };
    if (raw.code != null) entry.code = text(raw.code);
    entries.push(entry);
  }
  entries.sort((left, right) => compareText(entryKey(left), entryKey(right)));
  const rgbColors = entries.map((entry) => hexToRgb(entry.color));

  const pairs = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      if (left.kind !== right.kind) continue;
      const distance = rgbDistance(rgbColors[leftIndex], rgbColors[rightIndex]);
      if (distance > resolvedThreshold) continue;
      pairs.push({ left, right, distance, type: distance === 0 ? "duplicate" : "similar" });
    }
  }
  pairs.sort((left, right) => (
    Number(left.type !== "duplicate") - Number(right.type !== "duplicate")
    || left.distance - right.distance
    || compareText(entryKey(left.left), entryKey(right.left))
    || compareText(entryKey(left.right), entryKey(right.right))
  ));

  return {
    entries,
    pairs,
    duplicateCount: pairs.filter((pair) => pair.type === "duplicate").length,
    similarCount: pairs.filter((pair) => pair.type === "similar").length,
    skippedCount,
    countryCount: entries.filter((entry) => entry.kind === "country").length,
    legendCount: entries.filter((entry) => entry.kind === "legend").length,
    threshold: resolvedThreshold,
  };
}

/** Read the inspector's base-color chain without its palette-writing getters. */
export function collectCountryColorCheckEntries(state, countryStates, { defaultPalette = {}, fallbackColor } = {}) {
  const source = countryStates instanceof Map
    ? Array.from(countryStates.values())
    : Array.isArray(countryStates) ? countryStates : [];
  const entries = [];
  const seen = new Set();
  source.forEach((country, index) => {
    const code = text(country?.code).toUpperCase();
    if (!code || seen.has(code) || country.hiddenFromCountryList || country.hidden_from_country_list
      || country.releasable || country.entryKind === "releasable" || country.entry_kind === "releasable") return;
    seen.add(code);
    const fallbackIndex = Number.isFinite(Number(country.fallbackIndex))
      ? Number(country.fallbackIndex) : index;
    const color = state?.sovereignBaseColors?.[code]
      || state?.countryPalette?.[code]
      || defaultPalette?.[code]
      || (typeof fallbackColor === "function" ? fallbackColor(code, fallbackIndex) : "")
      || "";
    entries.push({ id: `country:${code}`, kind: "country", code,
      name: text(country.displayName) || text(country.name) || code, color });
  });
  return entries;
}

/** Match the solid legend's live order and item limit; patterned zones are out of scope. */
export function collectLegendColorCheckEntries(state) {
  const labels = normalizeLabels(state?.legendLabels);
  const category = state?.currentLanguage === "zh" ? "类别" : "Category";
  return getUniqueLegendColors(state).map((color, index) => ({
    id: `legend:${color}`,
    kind: "legend",
    name: labels[color] || `${category} ${index + 1}`,
    color,
  }));
}

const parentsByCountries = new WeakMap();
const emptyCountries = Object.freeze({});

export function getParentMergedParents(countriesByTag = emptyCountries) {
  const countries = countriesByTag ?? emptyCountries;
  if (parentsByCountries.has(countries)) return parentsByCountries.get(countries);
  const entries = countries instanceof Map ? countries.entries() : Object.entries(countries);
  const has = tag => countries instanceof Map ? countries.has(tag) : Object.hasOwn(countries, tag);
  const parents = new Map();
  for (const [tag, entry] of entries) {
    if (entry.presentation === "parent_merged" && has(entry.parent_owner_tag)) {
      parents.set(tag, entry.parent_owner_tag);
    }
  }
  parentsByCountries.set(countries, parents);
  return parents;
}

export function resolveParentMergedBorderKeys({ borderKey, reference, parentKey, parents }) {
  if (borderKey === reference && parents.has(reference)) {
    const parent = parents.get(reference);
    return { borderKey: parent, parentKey: `subject:${reference}`, homeKey: parent };
  }
  return { borderKey, parentKey, homeKey: borderKey };
}

// Default colours are split by a few RGB steps (±1 per sibling, at most 8
// siblings per parent today) so border identity stays exact. A child whose fill
// is visually the parent's current colour compares as the parent for paint
// contours. The comparison is against the live fill, not the mutable owner
// palette: an inspector edit of either side leaves visibly different fills and
// keeps its contour.
const MAX_DECONFLICT_STEP = 4;
const parseHex = value => {
  const hex = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) : null;
};

export function resolveParentMergedContourColor({ color, owner, parents, baseColors }) {
  const parent = parents.get(owner);
  if (!parent || !color) return color;
  const own = parseHex(color);
  const parentColor = parseHex(baseColors?.[parent]);
  if (!own || !parentColor) return color;
  const step = Math.max(...own.map((value, index) => Math.abs(value - parentColor[index])));
  return step <= MAX_DECONFLICT_STEP ? String(baseColors[parent]).trim().toLowerCase() : color;
}

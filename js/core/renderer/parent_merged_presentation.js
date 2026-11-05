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

// Default colours are split by ±1 RGB so border identity stays exact. A child
// still showing its own default must compare as its parent for paint contours;
// any other colour is a real user edit and keeps its contour.
export function resolveParentMergedContourColor({ color, owner, parents, baseColors }) {
  const parent = parents.get(owner);
  if (!parent || !color) return color;
  const normalize = value => String(value || "").trim().toLowerCase();
  return normalize(color) === normalize(baseColors?.[owner]) ? normalize(baseColors?.[parent]) || color : color;
}

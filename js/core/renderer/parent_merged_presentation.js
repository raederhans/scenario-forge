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

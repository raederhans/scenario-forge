// Hierarchy and manifest payloads are immutable snapshots. Cache by both inputs,
// so switching or rolling back a manifest never changes the global hierarchy.
const effectiveHierarchies = new WeakMap();
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const countryOf = (groupId) => groupId.split("_")[0];

function mergeHierarchy(base, override) {
  if (!Array.isArray(override.country_codes) || !override.country_codes.length
    || !override.country_codes.every((code) => typeof code === "string" && /^[A-Z]{2}$/.test(code))
    || !isRecord(override.groups) || !isRecord(override.labels)) return base;
  const countries = new Set(override.country_codes);
  const entries = Object.entries(override.groups);
  const seen = new Set();
  if (!entries.length || !entries.every(([id, children]) => {
    if (!countries.has(countryOf(id)) || !id.includes("_") || !Array.isArray(children) || !children.length) return false;
    return children.every((child) => {
      if (typeof child !== "string" || !child.trim() || child !== child.trim() || seen.has(child)) return false;
      seen.add(child);
      return true;
    });
  }) || [...countries].some((country) => !entries.some(([id]) => countryOf(id) === country))
    || !Object.entries(override.labels).every(([id, label]) =>
      Object.hasOwn(override.groups, id) && typeof label === "string" && !!label.trim())) return base;

  const keep = (entries) => entries.filter(([id]) => !countries.has(countryOf(id)));
  return {
    ...base,
    groups: Object.fromEntries([...keep(Object.entries(base.groups || {})), ...entries]),
    labels: Object.fromEntries([...keep(Object.entries(base.labels || {})), ...Object.entries(override.labels)]),
  };
}

export function getEffectiveScenarioHierarchy(runtimeState) {
  const base = runtimeState?.hierarchyData;
  const override = runtimeState?.activeScenarioManifest?.hierarchy_overrides;
  return getEffectiveScenarioHierarchyFromInputs(base, override);
}

export function getEffectiveScenarioHierarchyFromInputs(base, override) {
  if (!isRecord(base) || !isRecord(override)) return base;
  let byOverride = effectiveHierarchies.get(base);
  if (!byOverride) {
    byOverride = new WeakMap();
    effectiveHierarchies.set(base, byOverride);
  }
  if (!byOverride.has(override)) byOverride.set(override, mergeHierarchy(base, override));
  return byOverride.get(override);
}

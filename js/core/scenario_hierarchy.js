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

// Scenario-scoped political feature merges ({mergedId: memberIds}) replace their
// members in every group and quick-fill level. The shared hierarchy keeps the
// members for scenarios where they stay separate.
function projectFeatureMerges(base, merges) {
  const target = new Map();
  for (const [mergedId, members] of Object.entries(merges)) {
    if (!mergedId || !Array.isArray(members) || members.length < 2
      || !members.every((member) => typeof member === "string" && member && !target.has(member))) return base;
    members.forEach((member) => target.set(member, mergedId));
  }
  const project = (ids) => Array.isArray(ids) ? [...new Set(ids.map((id) => target.get(id) ?? id))] : ids;
  const mapValues = (record, fn) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));
  const projectLevel = (level) => !isRecord(level) ? level : {
    ...level,
    ...(Array.isArray(level.unmapped_feature_ids) ? { unmapped_feature_ids: project(level.unmapped_feature_ids) } : {}),
    ...(isRecord(level.groups) ? { groups: mapValues(level.groups, (group) =>
      isRecord(group) ? { ...group, feature_ids: project(group.feature_ids) } : group) } : {}),
  };
  const countries = base.quick_fill?.countries;
  return {
    ...base,
    groups: mapValues(base.groups || {}, project),
    ...(isRecord(countries) ? { quick_fill: { ...base.quick_fill, countries: mapValues(countries, (spec) =>
      isRecord(spec?.levels) ? { ...spec, levels: mapValues(spec.levels, projectLevel) } : spec) } } : {}),
  };
}

function applyOverride(base, override) {
  // A country snapshot that is absent or invalid leaves the projected hierarchy as is.
  return mergeHierarchy(isRecord(override.feature_merges) ? projectFeatureMerges(base, override.feature_merges) : base, override);
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
  if (!byOverride.has(override)) byOverride.set(override, applyOverride(base, override));
  return byOverride.get(override);
}

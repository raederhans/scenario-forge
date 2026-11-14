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

// Member ID -> merged ID of a scenario's feature merges, or null when the record is invalid.
const mergeTargets = new WeakMap();
function featureMergeTargets(merges) {
  if (!isRecord(merges)) return null;
  if (mergeTargets.has(merges)) return mergeTargets.get(merges);
  let target = new Map();
  for (const [mergedId, members] of Object.entries(merges)) {
    if (!mergedId || !Array.isArray(members) || members.length < 2
      || !members.every((member) => typeof member === "string" && member && !target.has(member))) {
      target = null;
      break;
    }
    members.forEach((member) => target.set(member, mergedId));
  }
  mergeTargets.set(merges, target);
  return target;
}

// Shared feature-ID lists (historical display presets, the vanilla releasable
// catalog) keep the members of scenario-scoped merges. A merged feature joins a
// list only when the list names all of its members; a list that names only some
// drops them and reports the merged ID in `partial`, so a list never grows.
export function projectScenarioFeatureIds(ids, override) {
  const list = Array.isArray(ids) ? ids : [];
  const target = featureMergeTargets(override?.feature_merges);
  const present = new Set(list);
  const projected = new Set();
  const partial = new Map();
  for (const id of list) {
    const mergedId = target?.get(id);
    if (!mergedId) {
      projected.add(id);
    } else if (override.feature_merges[mergedId].every((member) => present.has(member))) {
      projected.add(mergedId);
    } else if (!partial.has(mergedId)) {
      partial.set(mergedId, override.feature_merges[mergedId].filter((member) => !present.has(member)));
    }
  }
  return { ids: [...new Set([...projected].flatMap((id) => override?.feature_splits?.[id] || [id]))],
    partial: [...partial].map(([mergedId, missing]) => ({ mergedId, missing })) };
}

// The inverse for set arithmetic in member IDs: merged IDs of the projected
// hierarchy become their members again.
export function expandScenarioFeatureIds(ids, override) {
  const merges = featureMergeTargets(override?.feature_merges) ? override.feature_merges : {};
  const present = new Set(Array.isArray(ids) ? ids : []);
  const parents = new Map(Object.entries(override?.feature_splits || {}).flatMap(([parent, children]) =>
    children.every((child) => present.has(child)) ? children.map((child) => [child, parent]) : []));
  return [...new Set((Array.isArray(ids) ? ids : []).flatMap((id) => {
    const parent = parents.get(id) || id;
    return Object.hasOwn(merges, parent) ? merges[parent] : [parent];
  }))];
}

// Scenario-scoped political feature merges ({mergedId: memberIds}) replace their
// members in every group and quick-fill level. The shared hierarchy keeps the
// members for scenarios where they stay separate.
function projectFeatureMerges(base, merges, splits) {
  const target = featureMergeTargets(merges);
  if (!target && !splits) return base;
  const project = (ids) => Array.isArray(ids) ? [...new Set(ids.flatMap((id) => {
    const merged = target?.get(id) ?? id;
    return splits?.[merged] || [merged];
  }))] : ids;
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
  return projectFeatureMerges(mergeHierarchy(base, override), override.feature_merges, override.feature_splits);
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

// A scenario country often holds only part of its geographic country (RKM is a
// corner of RU). Its inspector lists only groups it owns parcels in, each cut
// down to those parcels, so a group action never paints a neighbour's land.
export function clipHierarchyGroupsToOwner(groups, ownerCode, getOwnerCode) {
  const list = Array.isArray(groups) ? groups : [];
  const target = String(ownerCode || "").trim();
  if (!target || typeof getOwnerCode !== "function") return list;
  return list
    .map((group) => ({
      ...group,
      children: (Array.isArray(group?.children) ? group.children : []).filter((id) => getOwnerCode(id) === target),
    }))
    .filter((group) => group.children.length > 0);
}

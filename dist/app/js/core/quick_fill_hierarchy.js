// Semantic quick-fill membership. No rendering thresholds, DOM, or state writes.
// Hierarchy payloads are immutable snapshots; replacing a snapshot invalidates the index.
import { getEffectiveScenarioHierarchy } from "./scenario_hierarchy.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import { normalizeScenarioDistrictGroupsPayload } from "./scenario_districts.js";

const hierarchyIndexes = new WeakMap();
const districtIndexes = new WeakMap();
const text = (value) => String(value ?? "").trim();
const code = (value) => normalizeCountryCodeAlias(text(value).toUpperCase());
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const unique = (values) => Array.from(new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean)));

export function normalizeQuickFillScope(value) {
  const scope = text(value);
  return scope === "country" || /^level:[a-z][a-z0-9_]{0,39}$/.test(scope) ? scope : "parent";
}

function newLevel(label = "Parent", status = "complete") {
  return { label, status, groups: new Map(), byFeature: new Map(), conflicts: new Set(), unmapped: new Set(), blockedParents: new Set() };
}

function addGroup(level, key, members, label = key, complete = true) {
  const ids = unique(members);
  if (!ids.length) return;
  level.groups.set(key, { id: key, label, members: ids, complete });
  for (const id of ids) {
    if (level.byFeature.has(id) && level.byFeature.get(id) !== key) level.conflicts.add(id);
    else level.byFeature.set(id, key);
  }
}

export function getQuickFillHierarchyIndex(payload) {
  if (!payload || typeof payload !== "object") return { countries: new Map() };
  if (hierarchyIndexes.has(payload)) return hierarchyIndexes.get(payload);
  const countries = new Map();
  const ensureCountry = (countryCode) => {
    if (!countries.has(countryCode)) countries.set(countryCode, { defaultLevel: "parent", levels: new Map(), noParent: false });
    return countries.get(countryCode);
  };
  for (const [id, members] of Object.entries(payload.groups || {})) {
    const country = ensureCountry(code(id.split("_")[0]));
    if (!country.levels.has("parent")) country.levels.set("parent", newLevel());
    addGroup(country.levels.get("parent"), id, members, payload.labels?.[id] || id);
  }
  for (const [countryCode, spec] of Object.entries(payload.quick_fill?.countries || {})) {
    const country = ensureCountry(code(countryCode));
    country.noParent = spec.parent_available === false;
    country.defaultLevel = text(spec.default_level) || "parent";
    for (const [levelId, raw] of Object.entries(spec.levels || {})) {
      const level = newLevel(text(raw.label) || levelId, text(raw.status) || "complete");
      level.unmapped = new Set(unique(raw.unmapped_feature_ids));
      level.blockedParents = new Set(unique(raw.blocked_parent_groups));
      if (raw.alias === "parent") {
        const parent = country.levels.get("parent");
        if (parent) {
          level.groups = parent.groups;
          level.byFeature = parent.byFeature;
          level.conflicts = parent.conflicts;
        }
      } else {
        for (const [id, group] of Object.entries(raw.groups || {})) {
          addGroup(level, id, group.feature_ids, text(group.label) || id, group.complete !== false);
        }
      }
      country.levels.set(levelId, level);
    }
  }
  const result = { countries };
  hierarchyIndexes.set(payload, result);
  return result;
}

export function getQuickFillLevels(payload, countryCode) {
  const country = getQuickFillHierarchyIndex(payload).countries.get(code(countryCode));
  if (!country) return [];
  return Array.from(country.levels, ([id, level]) => ({ id, label: level.label, status: level.status }))
    .filter((level) => level.id !== "parent");
}

function getDistrictIndex(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (districtIndexes.has(payload)) return districtIndexes.get(payload);
  const normalized = normalizeScenarioDistrictGroupsPayload(payload);
  const tags = new Map();
  const legacy = new Map();
  for (const [collection, target] of [[normalized.tags, tags], [normalized.legacy_countries, legacy]]) {
    for (const [key, record] of Object.entries(collection || {})) {
      const level = newLevel("Scenario district");
      for (const [id, district] of Object.entries(record.districts || {})) {
        addGroup(level, id, district.feature_ids, district.name_en || id);
      }
      target.set(key, level);
    }
  }
  const result = { scenarioId: normalized.scenario_id, tags, legacy };
  districtIndexes.set(payload, result);
  return result;
}

const result = (status, extra = {}) => ({ status, targetIds: [], ...extra });

export function createQuickFillHierarchyResolver(state, {
  getAdmin1Group,
  getFeatureCountryCodeNormalized,
  shouldExcludePoliticalInteractionFeature,
}) {
  let ownershipSnapshot = null;
  let ownershipRevision = -1;
  let ownersToIds = new Map();
  const owner = (id) => text(state.sovereigntyByFeatureId?.[id]).toUpperCase();
  const excluded = (feature, id) => !feature || shouldExcludePoliticalInteractionFeature(feature, id);

  // Full membership first, loaded geometry second. Never silently paint a loaded subset.
  function admitMembers(members, feature, featureId, metadata = {}) {
    const scenario = !!text(state.activeScenarioId);
    const targetOwner = owner(featureId);
    if (scenario && !targetOwner) return result("missing_owner", metadata);
    const owners = state.sovereigntyByFeatureId || {};
    const targetIds = [];
    const missingIds = [];
    for (const id of unique(members)) {
      if (scenario && !own(owners, id)) continue; // Not a member of this scenario's ID universe.
      if (scenario && owner(id) !== targetOwner) continue;
      const candidate = state.landIndex?.get(id);
      if (!candidate) missingIds.push(id);
      else if (!excluded(candidate, id)) targetIds.push(id);
    }
    if (missingIds.length) return result("loading", { ...metadata, missingIds });
    if (!targetIds.includes(featureId)) return result("missing_membership", metadata);
    return result("ready", { ...metadata, targetIds, singleton: targetIds.length === 1 });
  }

  function countryMembers(feature, id) {
    if (text(state.activeScenarioId)) {
      const tag = owner(id);
      if (!tag) return null;
      // Ownership is the complete semantic universe, unlike the hydrated land index.
      const revision = Number(state.sovereigntyRevision || 0);
      if (ownershipSnapshot !== state.sovereigntyByFeatureId || ownershipRevision !== revision) {
        ownershipSnapshot = state.sovereigntyByFeatureId;
        ownershipRevision = revision;
        ownersToIds = new Map();
        for (const candidate of Object.keys(ownershipSnapshot || {})) {
          const candidateOwner = owner(candidate);
          if (!ownersToIds.has(candidateOwner)) ownersToIds.set(candidateOwner, []);
          ownersToIds.get(candidateOwner).push(candidate);
        }
      }
      return ownersToIds.get(tag) || [];
    }
    const country = code(getFeatureCountryCodeNormalized(feature));
    const ids = state.countryToFeatureIds?.get(country);
    return Array.isArray(ids) ? ids : null;
  }

  function resolveLevel(level, id, feature, metadata) {
    if (level.conflicts.has(id)) return result("conflict", metadata);
    const key = level.byFeature.get(id);
    if (!key) return result(level.unmapped.has(id) ? "unmapped" : "missing_membership", metadata);
    const group = level.groups.get(key);
    if (!group || group.members.some((member) => level.conflicts.has(member))) return result("conflict", metadata);
    if (!group.complete) return result("incomplete_group", { ...metadata, groupId: key, label: group.label });
    return admitMembers(group.members, feature, id, { ...metadata, groupId: key, label: group.label });
  }

  function resolve(feature, id, requestedScope = state.batchFillScope) {
    if (!id || !state.landIndex?.has(id)) return result("loading");
    if (excluded(feature, id)) return result("excluded");
    const scope = normalizeQuickFillScope(requestedScope);
    const countryCode = code(getFeatureCountryCodeNormalized(feature));
    const scenario = text(state.activeScenarioId);
    const metadata = { scope, countryCode, ownerTag: scenario ? owner(id) : "" };
    if (scope === "country") {
      const members = countryMembers(feature, id);
      return members ? admitMembers(members, feature, id, { ...metadata, level: "country" }) : result("loading", metadata);
    }
    const districtIndex = getDistrictIndex(state.scenarioDistrictGroupsData);
    if (scenario && districtIndex?.scenarioId && districtIndex.scenarioId !== scenario) return result("stale_scenario", metadata);
    if (scenario && scope === "parent") {
      const district = districtIndex?.tags.get(owner(id)) || districtIndex?.legacy.get(countryCode);
      if (district) return resolveLevel(district, id, feature, { ...metadata, level: "scenario_district" });
      // Preserve TNO's opt-out. Geographic levels remain an explicit user choice.
      if (scenario.toLowerCase() === "tno_1962") return result("scenario_level_unavailable", metadata);
    }
    const hierarchy = getEffectiveScenarioHierarchy(state);
    const country = getQuickFillHierarchyIndex(hierarchy).countries.get(countryCode);
    const levelId = scope.startsWith("level:") ? scope.slice(6) : country?.defaultLevel || "parent";
    const level = country?.levels.get(levelId);
    if (level) {
      const parentKey = country.levels.get("parent")?.byFeature.get(id);
      if (level.blockedParents.has(parentKey)) return result("incomplete_group", { ...metadata, level: levelId });
      return resolveLevel(level, id, feature, { ...metadata, level: levelId });
    }
    if (scope.startsWith("level:")) return result("unsupported_level", { ...metadata, level: levelId });
    if (country?.noParent) return result("no_parent_level", metadata);
    if (hierarchy == null) return result("loading", metadata);

    // Legacy direct attributes remain supported, independently of border visibility.
    const direct = text(getAdmin1Group(feature));
    if (!direct) return result("missing_membership", metadata);
    const rawIds = state.countryToFeatureIds?.get(countryCode);
    if (!Array.isArray(rawIds)) return result("loading", metadata);
    if (rawIds.some((candidate) => !state.landIndex?.has(candidate))) return result("loading", metadata);
    const members = rawIds.filter((candidate) => text(getAdmin1Group(state.landIndex.get(candidate))) === direct);
    return admitMembers(members, feature, id, { ...metadata, level: "admin1", groupId: `${countryCode}:${direct}`, label: direct });
  }

  return Object.freeze({ resolve });
}

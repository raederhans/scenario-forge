import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import { getEffectiveScenarioHierarchy, clipHierarchyGroupsToOwner } from "./scenario_hierarchy.js";
import { normalizeScenarioDistrictGroupsPayload } from "./scenario_districts.js";

const hierarchyGroupsCache = new WeakMap();

export function getHierarchyGroupsForCode(runtimeState, code) {
  const normalizedCode = normalizeCountryCodeAlias(code);
  if (!normalizedCode) return [];
  const hierarchy = getEffectiveScenarioHierarchy(runtimeState);
  if (hierarchy === runtimeState.hierarchyData && runtimeState.hierarchyGroupsByCode?.size > 0) {
    return runtimeState.hierarchyGroupsByCode.get(normalizedCode) || [];
  }
  if (!hierarchy?.groups) return [];
  if (!normalizedCode.includes("_")) {
    let cached = hierarchyGroupsCache.get(hierarchy);
    if (!cached || cached.groups !== hierarchy.groups || cached.labels !== hierarchy.labels) {
      const byCode = new Map();
      const labels = hierarchy.labels || {};
      Object.entries(hierarchy.groups).forEach(([groupId, children]) => {
        const separator = groupId.indexOf("_");
        if (separator < 0) return;
        const groupCode = groupId.slice(0, separator);
        if (!byCode.has(groupCode)) byCode.set(groupCode, []);
        byCode.get(groupCode).push({
          id: groupId,
          label: labels[groupId] || groupId.slice(separator + 1).replace(/_/g, " "),
          ...(hierarchy.labels_zh?.[groupId] ? { labelZh: hierarchy.labels_zh[groupId] } : {}),
          children: Array.isArray(children) ? children : [],
        });
      });
      byCode.forEach((groups) => groups.sort((a, b) => a.label.localeCompare(b.label)));
      cached = { groups: hierarchy.groups, labels: hierarchy.labels, byCode };
      hierarchyGroupsCache.set(hierarchy, cached);
    }
    return cached.byCode.get(normalizedCode) || [];
  }
  const labels = hierarchy.labels || {};
  const groups = [];
  Object.entries(hierarchy.groups).forEach(([groupId, children]) => {
    if (!groupId.startsWith(`${normalizedCode}_`)) return;
    const label = labels[groupId] || groupId.replace(`${normalizedCode}_`, "").replace(/_/g, " ");
    groups.push({
      id: groupId,
      label,
      ...(hierarchy.labels_zh?.[groupId] ? { labelZh: hierarchy.labels_zh[groupId] } : {}),
      children: Array.isArray(children) ? children : [],
    });
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

export function getCountryGroupSystems({ runtimeState, ownerCode, groupingCode, getOwnerCode }) {
  const geographic = getHierarchyGroupsForCode(runtimeState, groupingCode);
  if (!runtimeState.activeScenarioId || runtimeState.mapSemanticMode === "blank") {
    return [{ id: "geographic", groups: geographic }];
  }
  const payload = normalizeScenarioDistrictGroupsPayload(runtimeState.scenarioDistrictGroupsData);
  const record = payload.tags[ownerCode] || payload.legacy_countries[groupingCode];
  const districts = Object.values(record?.districts || {}).map((district) => ({
    id: `district:${ownerCode}:${district.id}`,
    systemId: "scenario_districts",
    labelEn: district.name_en,
    labelZh: district.name_zh,
    label: district.name_en,
    children: district.feature_ids,
    totalCount: district.feature_ids.length,
  }));
  const groups = clipHierarchyGroupsToOwner(districts, ownerCode, getOwnerCode);
  return [
    ...(groups.length ? [{ id: "scenario_districts", groups }] : []),
    { id: "geographic", groups: clipHierarchyGroupsToOwner(geographic, ownerCode, getOwnerCode) },
  ];
}

export function findCountryGroupForFeature(systems, systemId, featureId) {
  return systems.find((system) => system.id === systemId)?.groups
    .find((group) => group.children.includes(featureId)) || null;
}

export function getGroupDisplayLabel(group, language, translateGeo) {
  if (language === "zh") return group.labelZh || translateGeo(group.label) || group.label;
  return group.labelEn || group.label;
}

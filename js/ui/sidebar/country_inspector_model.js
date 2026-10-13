import { COUNTRY_CODE_ALIASES } from "../../core/country_code_aliases.js";

// Country grouping, ordering and expansion selection read the live sidebar state.
// No DOM or renderer dependencies: both inspector and preset UI use this model.
export function createCountryInspectorModel(runtimeState, t) {
  function primitiveText(value) {
    if (typeof value === "object" || typeof value === "function") return "";
    return String(value || "");
  }

  function normalizeCountryCode(value) {
    const code = primitiveText(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return Object.hasOwn(COUNTRY_CODE_ALIASES, code) ? COUNTRY_CODE_ALIASES[code] : code;
  }

  function buildInspectorTopLevelCountryEntries(entries = []) {
    return (Array.isArray(entries) ? entries : []).filter(
      (entry) => !entry?.releasable
        && !entry?.hiddenFromCountryList
        && (!entry?.scenarioSubject || !!entry?.inspectorGroupId)
    );
  }

  function getScenarioCountryMeta(entryOrCode) {
    const rawCode = typeof entryOrCode === "object" && entryOrCode
      ? entryOrCode.code
      : entryOrCode;
    const normalizedCode = normalizeCountryCode(rawCode);
    if (!normalizedCode || !runtimeState.activeScenarioId) return null;
    const entry = runtimeState.scenarioCountriesByTag?.[normalizedCode];
    if (!entry || typeof entry !== "object") return null;
    return entry;
  }

  const TNO_SCENARIO_ID = "tno_1962";
  const TNO_CHINA_INSPECTOR_GROUP = Object.freeze({
    id: "scenario_group_china_region",
    label: "China Region",
    anchorId: "continent_asia",
  });
  const TNO_RUSSIA_INSPECTOR_GROUP = Object.freeze({
    id: "scenario_group_russia_region",
    label: "Russia Region",
    anchorId: "continent_europe",
  });
  const INSPECTOR_GROUP_LABEL_CATALOG = Object.freeze({
    "China Region": Object.freeze({ zh: "中国区域", en: "China Region" }),
    "Russia Region": Object.freeze({ zh: "俄罗斯区域", en: "Russia Region" }),
  });

  function readExplicitInspectorGroupMeta(entry = {}) {
    const id = primitiveText(entry?.inspector_group_id || entry?.inspectorGroupId || "").trim();
    const label = primitiveText(entry?.inspector_group_label || entry?.inspectorGroupLabel || "").trim();
    const anchorId = primitiveText(entry?.inspector_group_anchor_id || entry?.inspectorGroupAnchorId || "").trim();
    if (!id) {
      return {
        id: "",
        label: "",
        anchorId: "",
      };
    }
    return {
      id,
      label: label || id,
      anchorId,
    };
  }

  function collectScenarioInspectorIso2Codes(...entries) {
    const iso2Codes = new Set();
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      [
        entry.base_iso2,
        entry.baseIso2,
        entry.lookup_iso2,
        entry.lookupIso2,
        entry.provenance_iso2,
        entry.provenanceIso2,
      ].forEach((value) => {
        const normalized = primitiveText(value).trim().toUpperCase();
        if (normalized) {
          iso2Codes.add(normalized);
        }
      });
    });
    return iso2Codes;
  }

  function resolveScenarioInspectorGroupMeta(entryOrCode) {
    const entry = typeof entryOrCode === "object" && entryOrCode ? entryOrCode : null;
    const scenarioMeta = getScenarioCountryMeta(entryOrCode) || null;
    const explicitScenarioGroup = readExplicitInspectorGroupMeta(scenarioMeta || {});
    if (explicitScenarioGroup.id) return explicitScenarioGroup;
    const explicitEntryGroup = readExplicitInspectorGroupMeta(entry || {});
    if (explicitEntryGroup.id) return explicitEntryGroup;

    if (primitiveText(runtimeState.activeScenarioId || "").trim() !== TNO_SCENARIO_ID) {
      return explicitEntryGroup;
    }

    const tag = normalizeCountryCode(
      scenarioMeta?.tag
      || entry?.tag
      || entry?.code
      || (typeof entryOrCode === "string" ? entryOrCode : "")
    );
    if (!tag) {
      return explicitEntryGroup;
    }

    const iso2Codes = collectScenarioInspectorIso2Codes(scenarioMeta, entry);
    if (iso2Codes.has("RU") && !tag.startsWith("RK")) {
      return TNO_RUSSIA_INSPECTOR_GROUP;
    }
    if (iso2Codes.has("CN") && tag !== "MAN") {
      return TNO_CHINA_INSPECTOR_GROUP;
    }
    return explicitEntryGroup;
  }

  function resolveScenarioLookupCode(entryOrCode) {
    const fallbackCode = normalizeCountryCode(
      typeof entryOrCode === "object" && entryOrCode
        ? entryOrCode.code
        : entryOrCode
    );
    if (!runtimeState.activeScenarioId) {
      return fallbackCode;
    }

    const scenarioMeta = getScenarioCountryMeta(entryOrCode);
    const entry = typeof entryOrCode === "object" && entryOrCode ? entryOrCode : null;
    const candidates = [
      normalizeCountryCode(scenarioMeta?.preset_lookup_code),
      normalizeCountryCode(scenarioMeta?.presetLookupCode),
      normalizeCountryCode(entry?.preset_lookup_code),
      normalizeCountryCode(entry?.presetLookupCode),
      normalizeCountryCode(scenarioMeta?.lookup_iso2),
      normalizeCountryCode(scenarioMeta?.lookupIso2),
      normalizeCountryCode(entry?.lookup_iso2),
      normalizeCountryCode(entry?.lookupIso2),
      normalizeCountryCode(scenarioMeta?.base_iso2),
      normalizeCountryCode(scenarioMeta?.baseIso2),
      normalizeCountryCode(entry?.base_iso2),
      normalizeCountryCode(entry?.baseIso2),
      fallbackCode,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeCountryCode(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return fallbackCode;
  }

  function resolveInspectorDataCode(entryOrCode) {
    const fallbackCode = normalizeCountryCode(
      typeof entryOrCode === "object" && entryOrCode
        ? entryOrCode.code
        : entryOrCode
    );
    if (!runtimeState.activeScenarioId) {
      return fallbackCode;
    }

    const scenarioMeta = getScenarioCountryMeta(entryOrCode);
    const entry = typeof entryOrCode === "object" && entryOrCode ? entryOrCode : null;
    const candidates = [
      normalizeCountryCode(scenarioMeta?.release_lookup_iso2),
      normalizeCountryCode(scenarioMeta?.releaseLookupIso2),
      normalizeCountryCode(entry?.release_lookup_iso2),
      normalizeCountryCode(entry?.releaseLookupIso2),
      normalizeCountryCode(scenarioMeta?.lookup_iso2),
      normalizeCountryCode(scenarioMeta?.lookupIso2),
      normalizeCountryCode(entry?.lookup_iso2),
      normalizeCountryCode(entry?.lookupIso2),
      normalizeCountryCode(scenarioMeta?.base_iso2),
      normalizeCountryCode(scenarioMeta?.baseIso2),
      normalizeCountryCode(entry?.base_iso2),
      normalizeCountryCode(entry?.baseIso2),
      fallbackCode,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeCountryCode(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return fallbackCode;
  }

  function resolveCountryGroupingCode(entryOrCode) {
    return resolveInspectorDataCode(entryOrCode);
  }

  function getCountryGroupingMeta(entryOrCode) {
    const normalizedCode = resolveCountryGroupingCode(entryOrCode);
    if (!normalizedCode || !(runtimeState.countryGroupMetaByCode instanceof Map)) return null;
    return Map.prototype.get.call(runtimeState.countryGroupMetaByCode, normalizedCode) || null;
  }

  function getPriorityCountryOrderMap() {
    const priorityByContinent = runtimeState.countryGroupsData?.priority_by_continent || {};
    const priorityOrderMap = new Map();

    Object.entries(priorityByContinent).forEach(([continentId, rawCodes]) => {
      const continentOrder = new Map();
      (Array.isArray(rawCodes) ? rawCodes : []).forEach((rawCode, index) => {
        const code = normalizeCountryCode(rawCode);
        if (code && !continentOrder.has(code)) {
          continentOrder.set(code, index);
        }
      });
      priorityOrderMap.set(continentId, continentOrder);
    });

    return priorityOrderMap;
  }

  function getCountryPriorityRank(countryState, priorityOrderMap = getPriorityCountryOrderMap()) {
    const priorityCode = normalizeCountryCode(
      countryState?.groupingCode || countryState?.lookupIso2 || countryState?.code
    );
    if (!countryState?.continentId || !priorityCode) return Number.MAX_SAFE_INTEGER;
    const continentOrder = priorityOrderMap.get(countryState.continentId);
    if (!continentOrder || !continentOrder.has(priorityCode)) {
      return Number.MAX_SAFE_INTEGER;
    }
    return continentOrder.get(priorityCode);
  }

  function compareInspectorCountries(a, b, priorityOrderMap = getPriorityCountryOrderMap()) {
    const featuredDelta = Number(!!b?.featured) - Number(!!a?.featured);
    if (featuredDelta !== 0) return featuredDelta;

    const priorityDelta =
      getCountryPriorityRank(a, priorityOrderMap) - getCountryPriorityRank(b, priorityOrderMap);
    if (priorityDelta !== 0) return priorityDelta;

    const featureDelta = Number(b?.featureCount || 0) - Number(a?.featureCount || 0);
    if (featureDelta !== 0) return featureDelta;

    const scenarioOnlyDelta = Number(!!a?.scenarioOnly) - Number(!!b?.scenarioOnly);
    if (scenarioOnlyDelta !== 0) return scenarioOnlyDelta;

    return String(a?.displayName || "").localeCompare(String(b?.displayName || ""));
  }

  function sortCountriesWithinContinent(entries, priorityOrderMap = getPriorityCountryOrderMap()) {
    return [...entries].sort((a, b) => compareInspectorCountries(a, b, priorityOrderMap));
  }

  function getInspectorGroupExpansionKey(groupId) {
    return `group::${String(groupId || "").trim()}`;
  }

  function localizeInspectorGroupLabel(label) {
    const normalizedLabel = String(label || "").trim();
    if (!normalizedLabel) return "";
    const inlineLabel = INSPECTOR_GROUP_LABEL_CATALOG[normalizedLabel];
    if (inlineLabel) {
      return inlineLabel[runtimeState.currentLanguage === "zh" ? "zh" : "en"] || inlineLabel.en || normalizedLabel;
    }
    const geoLabel = t(normalizedLabel, "geo") || normalizedLabel;
    if (geoLabel !== normalizedLabel) return geoLabel;
    return t(normalizedLabel, "ui") || geoLabel;
  }

  function getInspectorTopLevelGroupMeta(entry = {}) {
    const fallbackContinentId = String(entry?.continentId || "continent_other").trim() || "continent_other";
    const fallbackContinentLabel = String(entry?.continentLabel || "Other").trim() || "Other";
    const groupId = String(entry?.topLevelGroupId || fallbackContinentId).trim() || fallbackContinentId;
    const groupLabel = String(entry?.topLevelGroupLabel || fallbackContinentLabel).trim() || fallbackContinentLabel;
    const groupAnchorId = String(entry?.topLevelGroupAnchorId || "").trim();
    return {
      id: groupId,
      label: groupLabel,
      displayLabel: localizeInspectorGroupLabel(groupLabel),
      anchorId: groupAnchorId,
    };
  }

  function getInspectorTopLevelGroupIdForCode(code) {
    const normalizedCode = normalizeCountryCode(code);
    if (!normalizedCode) return "";
    const inspectorGroupId = resolveScenarioInspectorGroupMeta(normalizedCode).id;
    if (inspectorGroupId) return inspectorGroupId;
    return getCountryGroupingMeta(normalizedCode)?.continentId || "";
  }

  function buildCountryColorTree(entries) {
    const tree = new Map();
    const topLevelOrder = new Map();
    const configuredContinents = Array.isArray(runtimeState.countryGroupsData?.continents)
      ? runtimeState.countryGroupsData.continents
      : [];
    const priorityOrderMap = getPriorityCountryOrderMap();
    const anchoredScenarioGroups = new Map();
    const unanchoredScenarioGroups = new Map();
    const orderedTopLevelGroups = [];

    // inspector 分组树只决定右侧列表怎么归类和排序；真正的国家数据仍来自 scenario/meta。
    // 有 anchor 的 scenario 分组会插到指定 continent 前，避免把 TNO 这类虚拟区域写成真实 continent。
    const pushTopLevelGroup = (groupMeta) => {
      if (!groupMeta?.id || topLevelOrder.has(groupMeta.id)) return;
      topLevelOrder.set(groupMeta.id, orderedTopLevelGroups.length);
      orderedTopLevelGroups.push(groupMeta);
    };

    entries.forEach((entry) => {
      const groupMeta = getInspectorTopLevelGroupMeta(entry);
      if (groupMeta.id === entry?.continentId) return;
      if (groupMeta.anchorId) {
        const list = anchoredScenarioGroups.get(groupMeta.anchorId) || [];
        if (!list.some((item) => item.id === groupMeta.id)) {
          list.push(groupMeta);
          anchoredScenarioGroups.set(groupMeta.anchorId, list);
        }
        return;
      }
      if (!unanchoredScenarioGroups.has(groupMeta.id)) {
        unanchoredScenarioGroups.set(groupMeta.id, groupMeta);
      }
    });

    for (const continent of configuredContinents) {
      const continentId = String(continent?.id || "").trim();
      if (!continentId) continue;

      (anchoredScenarioGroups.get(continentId) || [])
        .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel))
        .forEach(pushTopLevelGroup);

      const continentLabel = String(continent?.label || "").trim() || continentId;
      pushTopLevelGroup({
        id: continentId,
        label: continentLabel,
        displayLabel: localizeInspectorGroupLabel(continentLabel),
        anchorId: "",
      });
    }

    Array.from(unanchoredScenarioGroups.values())
      .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel))
      .forEach(pushTopLevelGroup);

    entries.forEach((entry) => {
      const groupMeta = getInspectorTopLevelGroupMeta(entry);
      if (!topLevelOrder.has(groupMeta.id)) {
        pushTopLevelGroup(groupMeta);
      }
    });

    // 这里先补齐“顶层分组顺序”，再回填国家成员。
    // 这样 scenario-only 分组既能挂到真实 continent 前后，又不会在后续 entries 遍历时被重复插入。
    entries.forEach((entry) => {
      const groupMeta = getInspectorTopLevelGroupMeta(entry);

      if (!tree.has(groupMeta.id)) {
        tree.set(groupMeta.id, {
          id: groupMeta.id,
          label: groupMeta.label,
          displayLabel: groupMeta.displayLabel,
          sortIndex: topLevelOrder.has(groupMeta.id) ? topLevelOrder.get(groupMeta.id) : Number.MAX_SAFE_INTEGER,
          countries: [],
        });
      }

      tree.get(groupMeta.id).countries.push(entry);
    });

    return Array.from(tree.values())
      .map((groupNode) => ({
        ...groupNode,
        countries: sortCountriesWithinContinent(groupNode.countries, priorityOrderMap),
      }))
      .sort((a, b) => {
        if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
        return a.displayLabel.localeCompare(b.displayLabel);
      });
  }

  function getDefaultExpandedInspectorGroupId(groupedEntries = []) {
    const selectedCode = normalizeCountryCode(String(runtimeState.selectedInspectorCountryCode || ""));
    const selectedGroupId = getInspectorTopLevelGroupIdForCode(selectedCode);
    if (selectedGroupId) return selectedGroupId;

    const activeCode = normalizeCountryCode(String(runtimeState.activeSovereignCode || ""));
    const activeGroupId = getInspectorTopLevelGroupIdForCode(activeCode);
    if (activeGroupId) return activeGroupId;

    const europeNode = groupedEntries.find((entry) => entry.id === "continent_europe");
    if (europeNode) return europeNode.id;

    return groupedEntries[0]?.id || "";
  }


  return {
    getScenarioCountryMeta,
    resolveScenarioInspectorGroupMeta,
    resolveScenarioLookupCode,
    resolveInspectorDataCode,
    resolveCountryGroupingCode,
    getCountryGroupingMeta,
    buildInspectorTopLevelCountryEntries,
    getPriorityCountryOrderMap,
    compareInspectorCountries,
    buildCountryColorTree,
    getDefaultExpandedInspectorGroupId,
    getInspectorGroupExpansionKey,
  };
}

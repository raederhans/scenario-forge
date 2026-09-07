const PARENT_BORDER_MIN_COVERAGE = 0.70;
const PARENT_BORDER_MAX_DOMINANT_SHARE = 0.90;
const PARENT_BORDER_MIN_RENDERABLE_GROUPS = 2;
const GB_PARENT_MIN_GROUPS = 20;
const GB_NUTS1_GROUP_MIN = 10;
const GB_NUTS1_PREFIX_LENGTH = 3;
const GB_ID_PATTERN_RE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const DE_STATE_GROUP_MIN = 12;
const DE_STATE_GROUP_MAX = 20;
const DE_CITY_STATES = new Set(["Berlin", "Hamburg", "Bremen"]);

// Owns parent border grouping policy decisions; inputs remain live.
export function createParentBorderGroupingPolicy(runtimeState, {
  canonicalCountryCode,
  getAdmin1Group,
  getFeatureCountryCodeNormalized,
  getFeatureId,
  shouldExcludePoliticalInteractionFeature,
}) {
  function getFullLandDataFeatures() {
    if (Array.isArray(runtimeState.landDataFull?.features) && runtimeState.landDataFull.features.length) {
      return runtimeState.landDataFull.features;
    }
    return Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features : [];
  }

  function getCountryFeatureEntriesMap() {
    const byCountry = new Map();
    const features = getFullLandDataFeatures();
    for (let index = 0, length = features.length; index < length; index += 1) {
      if (!(index in features)) continue;
      const feature = features[index];
      const id = getFeatureId(feature);
      const countryCode = getFeatureCountryCodeNormalized(feature);
      if (!id || !countryCode || shouldExcludePoliticalInteractionFeature(feature, id)) continue;
      const list = byCountry.get(countryCode) || [];
      list.push({ id, feature });
      byCountry.set(countryCode, list);
    }
    return byCountry;
  }

  function evaluateCountryGroupingCandidate(countryCode, source, featureEntries, featureToGroup) {
    if (!featureEntries?.length || !(featureToGroup instanceof Map) || !featureToGroup.size) return null;

    const groupCounts = new Map();
    let groupedCount = 0;
    featureEntries.forEach(({ id }) => {
      const group = featureToGroup.get(id);
      if (!group) return;
      groupedCount += 1;
      groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    });

    if (!groupedCount || !groupCounts.size) return null;

    const totalCount = featureEntries.length;
    const groupSizes = Array.from(groupCounts.values());
    const renderableGroupCount = groupSizes.filter((count) => count >= 2).length;
    const coverage = totalCount > 0 ? groupedCount / totalCount : 0;
    const dominantShare = groupedCount > 0 ? Math.max(...groupSizes) / groupedCount : 1;

    return {
      countryCode,
      source,
      featureToGroup,
      groupCounts,
      totalCount,
      groupedCount,
      groupCount: renderableGroupCount,
      groupCountTotal: groupCounts.size,
      coverage,
      dominantShare,
      accepted:
        renderableGroupCount >= PARENT_BORDER_MIN_RENDERABLE_GROUPS &&
        coverage >= PARENT_BORDER_MIN_COVERAGE &&
        dominantShare <= PARENT_BORDER_MAX_DOMINANT_SHARE,
    };
  }

  function buildHierarchyGroupingCandidate(countryCode, featureEntries) {
    const groups = runtimeState.hierarchyData?.groups;
    if (!groups || typeof groups !== "object") return null;

    const idSet = new Set(featureEntries.map((entry) => entry.id));
    const featureToGroup = new Map();
    Object.entries(groups).forEach(([groupId, children]) => {
      const groupCountry = canonicalCountryCode(String(groupId || "").split("_")[0]);
      if (!groupCountry || groupCountry !== countryCode) return;
      if (!Array.isArray(children)) return;
      children.forEach((child) => {
        const childId = String(child || "").trim();
        if (!childId || !idSet.has(childId)) return;
        if (!featureToGroup.has(childId)) {
          featureToGroup.set(childId, groupId);
        }
      });
    });

    return evaluateCountryGroupingCandidate(countryCode, "hierarchy", featureEntries, featureToGroup);
  }

  function buildAdmin1GroupingCandidate(countryCode, featureEntries) {
    const featureToGroup = new Map();
    featureEntries.forEach(({ id, feature }) => {
      const group = getAdmin1Group(feature);
      if (!group) return;
      featureToGroup.set(id, group);
    });
    return evaluateCountryGroupingCandidate(countryCode, "admin1_group", featureEntries, featureToGroup);
  }

  function buildScenarioDistrictGroupingCandidate(countryCode, featureEntries) {
    const districtCountry = runtimeState.scenarioDistrictGroupsData?.countries?.[countryCode];
    if (!districtCountry || typeof districtCountry !== "object") return null;
    const idSet = new Set(featureEntries.map((entry) => entry.id));
    const featureToGroup = new Map();
    Object.entries(districtCountry.districts && typeof districtCountry.districts === "object" ? districtCountry.districts : {})
      .forEach(([districtId, rawDistrict]) => {
        const normalizedDistrictId = String(rawDistrict?.id || rawDistrict?.district_id || districtId || "").trim();
        if (!normalizedDistrictId) return;
        const featureIds = Array.isArray(rawDistrict?.feature_ids) ? rawDistrict.feature_ids : [];
        featureIds.forEach((featureId) => {
          const normalizedFeatureId = String(featureId || "").trim();
          if (!normalizedFeatureId || !idSet.has(normalizedFeatureId)) return;
          if (!featureToGroup.has(normalizedFeatureId)) {
            featureToGroup.set(normalizedFeatureId, normalizedDistrictId);
          }
        });
      });
    if (!featureToGroup.size) {
      return {
        countryCode,
        source: "scenario_district",
        featureToGroup,
        groupCounts: new Map(),
        totalCount: featureEntries.length,
        groupedCount: 0,
        groupCount: 0,
        groupCountTotal: 0,
        coverage: 0,
        dominantShare: 1,
        accepted: false,
        forcedRule: "scenario_district",
      };
    }
    return {
      ...evaluateCountryGroupingCandidate(countryCode, "scenario_district", featureEntries, featureToGroup),
      forcedRule: "scenario_district",
    };
  }

  function buildIdPrefixGroupingCandidate(countryCode, featureEntries, prefixLength) {
    const length = Number(prefixLength);
    if (!Number.isFinite(length) || length < 3) return null;

    const featureToGroup = new Map();
    let validIds = 0;
    featureEntries.forEach(({ id }) => {
      const text = String(id || "").trim().toUpperCase();
      if (!GB_ID_PATTERN_RE.test(text)) return;
      validIds += 1;
      featureToGroup.set(id, text.slice(0, length));
    });

    if (!featureToGroup.size || !featureEntries.length) return null;
    const idPatternCoverage = validIds / featureEntries.length;
    if (idPatternCoverage < 0.95) return null;

    const candidate = evaluateCountryGroupingCandidate(countryCode, "id_prefix", featureEntries, featureToGroup);
    if (!candidate) return null;
    return {
      ...candidate,
      prefixLength: length,
      idPatternCoverage,
    };
  }

  function isGermanStateLevelCandidate(candidate) {
    if (!candidate || candidate.source !== "admin1_group") return false;
    if (candidate.groupCountTotal < DE_STATE_GROUP_MIN || candidate.groupCountTotal > DE_STATE_GROUP_MAX) {
      return false;
    }
    const groups = new Set(candidate.groupCounts ? Array.from(candidate.groupCounts.keys()) : []);
    return Array.from(DE_CITY_STATES).every((name) => groups.has(name));
  }

  function isBritishConstituentGroupingCandidate(candidate) {
    if (!candidate || candidate.source !== "hierarchy") return false;
    if (candidate.coverage < PARENT_BORDER_MIN_COVERAGE) return false;
    if (candidate.groupCount < 4) return false;
    const groups = new Set(candidate.groupCounts ? Array.from(candidate.groupCounts.keys()) : []);
    return (
      groups.has("GB_England")
      && groups.has("GB_Scotland")
      && groups.has("GB_Wales")
      && groups.has("GB_Northern_Ireland")
    );
  }

  function isBritishNuts1GroupingCandidate(candidate) {
    if (!candidate || candidate.source !== "id_prefix") return false;
    if (candidate.prefixLength !== GB_NUTS1_PREFIX_LENGTH) return false;
    if (candidate.coverage < PARENT_BORDER_MIN_COVERAGE) return false;
    return candidate.groupCountTotal >= GB_NUTS1_GROUP_MIN;
  }

  function resolveCountryParentGroupingCandidate(countryCode, featureEntries) {
    if (!countryCode || !featureEntries?.length) return null;

    const scenarioDistrictCandidate = buildScenarioDistrictGroupingCandidate(countryCode, featureEntries);
    if (scenarioDistrictCandidate) {
      return scenarioDistrictCandidate;
    }
    if (String(runtimeState.activeScenarioId || "").trim().toLowerCase() === "tno_1962") {
      return null;
    }

    const hierarchyCandidate = buildHierarchyGroupingCandidate(countryCode, featureEntries);
    const adminCandidate = buildAdmin1GroupingCandidate(countryCode, featureEntries);

    if (countryCode === "DE") {
      if (adminCandidate && isGermanStateLevelCandidate(adminCandidate)) {
        return {
          ...adminCandidate,
          accepted: true,
          forcedRule: "de_state_level",
        };
      }
      if (hierarchyCandidate?.accepted) return hierarchyCandidate;
      if (adminCandidate?.accepted) return adminCandidate;
      return null;
    }

    if (countryCode === "GB") {
      const britishLeafEntries = featureEntries.filter(({ id }) =>
        GB_ID_PATTERN_RE.test(String(id || "").trim().toUpperCase())
      );
      const nuts1Candidate = buildIdPrefixGroupingCandidate(
        countryCode,
        britishLeafEntries,
        GB_NUTS1_PREFIX_LENGTH
      );
      if (isBritishNuts1GroupingCandidate(nuts1Candidate)) {
        return {
          ...nuts1Candidate,
          accepted: true,
          forcedRule: "gb_nuts1",
        };
      }
      if (isBritishConstituentGroupingCandidate(hierarchyCandidate)) {
        return {
          ...hierarchyCandidate,
          accepted: true,
          forcedRule: "gb_constituent_countries",
        };
      }
      const hierarchyFineEnough =
        hierarchyCandidate?.accepted &&
        Math.max(hierarchyCandidate.groupCount, hierarchyCandidate.groupCountTotal) >= GB_PARENT_MIN_GROUPS;
      if (hierarchyFineEnough) return hierarchyCandidate;

      const idPrefixCandidate = [
        buildIdPrefixGroupingCandidate(countryCode, britishLeafEntries, 4),
      ].find(
        (candidate) =>
          candidate?.accepted &&
          Math.max(candidate.groupCount, candidate.groupCountTotal) >= GB_PARENT_MIN_GROUPS
      );
      if (idPrefixCandidate) return idPrefixCandidate;
      return null;
    }

    if (hierarchyCandidate?.accepted) return hierarchyCandidate;
    if (adminCandidate?.accepted) return adminCandidate;
    return null;
  }

  return Object.freeze({ getFullLandDataFeatures, getCountryFeatureEntriesMap, resolveCountryParentGroupingCandidate });
}

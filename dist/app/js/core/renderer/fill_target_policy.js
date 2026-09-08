// Owns fill target policy decisions; inputs remain live.
export function createFillTargetPolicy(runtimeState, {
  getAdmin1Group,
  getFeatureCountryCodeNormalized,
  getFeatureInteractionCountryCodeNormalized,
  isSovereigntyModeActive,
  shouldExcludePoliticalInteractionFeature,
}) {
  function getCountryFeatureIds(countryCode) {
    if (!countryCode || !(runtimeState.countryToFeatureIds instanceof Map)) return [];
    const ids = runtimeState.countryToFeatureIds.get(countryCode);
    if (!Array.isArray(ids)) return [];
    return ids.filter((candidateId) => {
      const candidateFeature = runtimeState.landIndex?.get(candidateId);
      return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
    });
  }

  function getScenarioOwnerFeatureIds(ownerTag) {
    const normalizedOwnerTag = String(ownerTag || "").trim().toUpperCase();
    if (!normalizedOwnerTag || !(runtimeState.ownerToFeatureIds instanceof Map)) return [];
    const ids = runtimeState.ownerToFeatureIds.get(normalizedOwnerTag);
    if (!Array.isArray(ids)) return [];
    return ids.filter((candidateId) => {
      const candidateFeature = runtimeState.landIndex?.get(candidateId);
      return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
    });
  }

  function getInteractionCountryFeatureIds(feature, featureId) {
    const interactionCountryCode = getFeatureInteractionCountryCodeNormalized(feature, featureId);
    const ownerIds = interactionCountryCode ? getScenarioOwnerFeatureIds(interactionCountryCode) : [];
    if (ownerIds.length) return ownerIds;

    const runtimeCountryCode = getFeatureCountryCodeNormalized(feature);
    const runtimeIds = runtimeCountryCode ? getCountryFeatureIds(runtimeCountryCode) : [];
    if (runtimeIds.length) return runtimeIds;

    return interactionCountryCode ? getCountryFeatureIds(interactionCountryCode) : [];
  }

  function resolveInteractionTargetIds(feature, id) {
    if (shouldExcludePoliticalInteractionFeature(feature, id)) {
      return [];
    }
    if (isSovereigntyModeActive()) {
      return [id];
    }
    if (runtimeState.interactionGranularity !== "country") {
      return [id];
    }
    const countryCode = getFeatureInteractionCountryCodeNormalized(feature, id);
    if (!countryCode) {
      return [id];
    }
    const ids = getInteractionCountryFeatureIds(feature, id);
    return ids.length ? ids : [id];
  }

  function resolveParentGroupKey(feature, featureId) {
    const scenarioDistrictGroup = String(runtimeState.scenarioDistrictGroupByFeatureId?.get(featureId) || "").trim();
    const scenarioOwnerTag = String(runtimeState.sovereigntyByFeatureId?.[featureId] || "").trim().toUpperCase();
    const scopeCode = scenarioDistrictGroup && scenarioOwnerTag
      ? scenarioOwnerTag
      : getFeatureInteractionCountryCodeNormalized(feature, featureId);
    if (!scopeCode) return "";
    const directGroup = getAdmin1Group(feature);
    const groupName = String(scenarioDistrictGroup || runtimeState.parentGroupByFeatureId?.get(featureId) || directGroup || "").trim();
    if (!groupName) return "";
    return `${scopeCode}::${groupName}`;
  }

  function resolveParentGroupTargetIds(feature, featureId) {
    if (!featureId || !runtimeState.landIndex?.has(featureId)) return [];
    if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return [];
    const scenarioDistrictGroup = String(runtimeState.scenarioDistrictGroupByFeatureId?.get(featureId) || "").trim();
    const scenarioOwnerTag = String(runtimeState.sovereigntyByFeatureId?.[featureId] || "").trim().toUpperCase();
    const parentGroupKey = resolveParentGroupKey(feature, featureId);
    const ids = scenarioDistrictGroup && scenarioOwnerTag
      ? getScenarioOwnerFeatureIds(scenarioOwnerTag)
      : getInteractionCountryFeatureIds(feature, featureId);
    if (!parentGroupKey || !ids.length) return [];
    const targetIds = ids.filter((candidateId) => {
      const candidateFeature = runtimeState.landIndex.get(candidateId);
      if (!candidateFeature) return false;
      if (shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId)) return false;
      return resolveParentGroupKey(candidateFeature, candidateId) === parentGroupKey;
    });
    if (targetIds.length < 2) return [];
    return Array.from(new Set(targetIds));
  }

  function resolveSpecialZoneParentGroupTargetIds(featureId) {
    const id = String(featureId || "").trim();
    const feature = id ? runtimeState.landIndex?.get(id) : null;
    if (!feature) return [];
    return resolveParentGroupTargetIds(feature, id);
  }

  function resolveCountryFillTargetIds(feature, featureId, { allowWhenParentGrouping = false } = {}) {
    if (!featureId || !runtimeState.landIndex?.has(featureId)) return [];
    if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return [];
    const countryCode = getFeatureInteractionCountryCodeNormalized(feature, featureId);
    if (!countryCode) return [];
    const ids = getInteractionCountryFeatureIds(feature, featureId).filter((candidateId) => {
      const candidateFeature = runtimeState.landIndex.get(candidateId);
      return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
    });
    if (ids.length < 2) return [];

    if (!allowWhenParentGrouping) {
      const hasParentGrouping = ids.some((candidateId) => {
        const candidateFeature = runtimeState.landIndex.get(candidateId);
        if (!candidateFeature) return false;
        return !!resolveParentGroupKey(candidateFeature, candidateId);
      });
      if (hasParentGrouping) return [];
    }

    return ids;
  }

  function isBatchFillDoubleClickBaseEligible(hit, feature) {
    if (!hit?.id || !feature) return false;
    if (runtimeState.currentTool !== "fill") return false;
    if (isSovereigntyModeActive()) return false;
    if (runtimeState.interactionGranularity !== "subdivision") return false;
    if (runtimeState.brushModeEnabled) return false;
    if (runtimeState.specialZoneEditor?.active) return false;
    return true;
  }

  function buildDoubleClickBatchPlan(feature, featureId) {
    if (!feature || !featureId) return null;
    if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return null;
    const requestedScope = String(runtimeState.batchFillScope || "parent") === "country" ? "country" : "parent";
    if (requestedScope === "parent") {
      const parentTargetIds = resolveParentGroupTargetIds(feature, featureId);
      if (parentTargetIds.length >= 2) {
        return {
          targetIds: parentTargetIds,
          kind: "fill-parent-group",
          dirtyReason: "fill-parent-group",
          fallbackToCountry: false,
        };
      }
    }

    const countryTargetIds = resolveCountryFillTargetIds(feature, featureId, {
      allowWhenParentGrouping: true,
    });
    if (countryTargetIds.length >= 2) {
      return {
        targetIds: countryTargetIds,
        kind: "fill-country-batch",
        dirtyReason: "fill-country-batch",
        fallbackToCountry: requestedScope === "parent",
      };
    }
    return null;
  }

  function isDoubleClickBatchEligible(hit, feature) {
    if (!isBatchFillDoubleClickBaseEligible(hit, feature)) return false;
    return !!buildDoubleClickBatchPlan(feature, hit.id);
  }

  return Object.freeze({ getCountryFeatureIds, resolveInteractionTargetIds, resolveParentGroupTargetIds, resolveSpecialZoneParentGroupTargetIds, buildDoubleClickBatchPlan, isDoubleClickBatchEligible });
}

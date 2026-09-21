import { createQuickFillHierarchyResolver, normalizeQuickFillScope } from "../quick_fill_hierarchy.js";

// Owns fill target policy decisions; inputs remain live.
export function createFillTargetPolicy(runtimeState, {
  getAdmin1Group,
  getFeatureCountryCodeNormalized,
  getFeatureInteractionCountryCodeNormalized,
  isSovereigntyModeActive,
  shouldExcludePoliticalInteractionFeature,
}) {
  const hierarchy = createQuickFillHierarchyResolver(runtimeState, {
    getAdmin1Group, getFeatureCountryCodeNormalized,
    getFeatureInteractionCountryCodeNormalized, shouldExcludePoliticalInteractionFeature,
  });

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

  function resolveParentGroupTargetIds(feature, featureId) {
    const resolution = hierarchy.resolve(feature, featureId, "parent");
    return resolution.status === "ready" ? resolution.targetIds : [];
  }

  function resolveSpecialZoneParentGroupTargetIds(featureId) {
    const id = String(featureId || "").trim();
    const feature = id ? runtimeState.landIndex?.get(id) : null;
    if (!feature) return [];
    return resolveParentGroupTargetIds(feature, id);
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

  function resolveQuickFillPlan(feature, featureId, scope = runtimeState.batchFillScope) {
    return hierarchy.resolve(feature, featureId, scope);
  }

  function buildDoubleClickBatchPlan(feature, featureId) {
    if (!isBatchFillDoubleClickBaseEligible({ id: featureId }, feature)) return null;
    const requestedScope = normalizeQuickFillScope(runtimeState.batchFillScope);
    let resolution = resolveQuickFillPlan(feature, featureId, requestedScope);
    let fallbackToCountry = false;
    if (requestedScope === "parent" && resolution.status === "no_parent_level") {
      resolution = resolveQuickFillPlan(feature, featureId, "country");
      fallbackToCountry = true;
    }
    if (resolution.status !== "ready" || !resolution.targetIds.length) return null;
    const country = requestedScope === "country" || fallbackToCountry;
    return {
      targetIds: resolution.targetIds,
      kind: country ? "fill-country-batch" : "fill-parent-group",
      dirtyReason: country ? "fill-country-batch" : "fill-parent-group",
      fallbackToCountry,
    };
  }

  function isDoubleClickBatchEligible(hit, feature) {
    if (!isBatchFillDoubleClickBaseEligible(hit, feature)) return false;
    return !!buildDoubleClickBatchPlan(feature, hit.id);
  }

  return Object.freeze({ resolveQuickFillPlan, getCountryFeatureIds, resolveInteractionTargetIds, resolveParentGroupTargetIds, resolveSpecialZoneParentGroupTargetIds, buildDoubleClickBatchPlan, isDoubleClickBatchEligible });
}

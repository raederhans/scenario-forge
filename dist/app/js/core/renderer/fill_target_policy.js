import { getMapDataBoundary } from "../map_data_boundary.js";
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
    const ids = getMapDataBoundary(runtimeState).reference.getGeographicCountryFeatureIds(countryCode);
    // Developer geographic macros must not silently paint the loaded subset.
    if (!ids.length || ids.some((id) => !runtimeState.landIndex?.has(id))) return [];
    return ids.filter((candidateId) => {
      const candidateFeature = runtimeState.landIndex?.get(candidateId);
      return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
    });
  }

  function resolveInteractionTargetIds(feature, id) {
    if (shouldExcludePoliticalInteractionFeature(feature, id)) return [];
    if (isSovereigntyModeActive()) return [id];
    if (runtimeState.interactionGranularity !== "country") return [id];
    // Country clicks use the same complete reference membership and hydration
    // guard as double-click Auto Fill. Never fall back to a loaded subset.
    const resolution = hierarchy.resolve(feature, id, "country");
    return resolution.status === "ready" ? resolution.targetIds : [];
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

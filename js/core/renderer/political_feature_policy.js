// Political visibility, interaction eligibility, and stable paint-layer ordering.
// Runtime fields and cache references are read when each rule runs.
export function createPoliticalFeaturePolicy(runtimeState, {
  getSafeCanvasColor,
  hasPendingPoliticalColorEdit,
  getRenderPassCacheState,
  getFeatureId,
  getFeatureCountryCodeNormalized,
  isAtlantropaFieldDrivenFeature,
  isInteractiveAtlantropaBooleanWeldIslandFeature,
  isScenarioAtlantropaVisible,
  isBaseGeographyScenarioFeature,
}) {
  function isScenarioShellFeature(feature, featureId = null) {
    if (String(feature?.properties?.scenario_helper_kind || "").trim().toLowerCase() === "shell_fallback") {
      return true;
    }
    const candidate = String(
      feature?.properties?.id ?? featureId ?? feature?.id ?? ""
    ).trim().toUpperCase();
    if (candidate.startsWith("RU_ARCTIC_FB_")) return true;
    return String(feature?.properties?.name || "").toLowerCase().includes("shell fallback");
  }

  function isRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId = null) {
    return isScenarioShellFeature(feature, featureId)
      && feature?.properties?.render_as_base_geography === false;
  }

  function isPoliticalShellUnderlayFeature(feature, featureId = null) {
    return isRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId);
  }

  function isPoliticalPrimaryUnderlayFeature(feature, _featureId = null) {
    return String(feature?.properties?.__source || "").trim().toLowerCase() === "primary";
  }

  function isPoliticalUnderlayFeature(feature, featureId = null) {
    return isPoliticalShellUnderlayFeature(feature, featureId)
      || isPoliticalPrimaryUnderlayFeature(feature, featureId);
  }

  function hasPoliticalForegroundColorOverride(featureId) {
    const id = String(featureId || "").trim();
    if (!id) return false;
    return !!(
      getSafeCanvasColor(runtimeState.visualOverrides?.[id], null)
      || getSafeCanvasColor(runtimeState.featureOverrides?.[id], null)
    );
  }

  function isPendingPoliticalColorEditFeature(feature, featureId = null) {
    const id = String(
      featureId
      || feature?.properties?.id
      || feature?.id
      || ""
    ).trim();
    if (!id || !hasPendingPoliticalColorEdit()) return false;
    const pendingIds = getRenderPassCacheState().pendingPoliticalColorEditIds;
    return pendingIds instanceof Set && pendingIds.has(id);
  }

  function isPoliticalForegroundFeature(feature, featureId = null) {
    const id = String(featureId || getFeatureId(feature) || "").trim();
    return hasPoliticalForegroundColorOverride(id)
      || isPendingPoliticalColorEditFeature(feature, id);
  }

  function hasVisiblePoliticalForegroundColorOverride(entries = []) {
    if (!Array.isArray(entries) || !entries.length) return false;
    return entries.some((entry) => {
      const feature = entry?.feature || entry;
      const featureId = entry?.id || getFeatureId(feature);
      return hasPoliticalForegroundColorOverride(featureId);
    });
  }

  function orderPoliticalShellUnderlayFirst(entries = []) {
    const underlayEntries = [];
    const detailEntries = [];
    const foregroundEntries = [];
    entries.forEach((entry) => {
      const feature = entry?.feature || entry;
      const featureId = entry?.id || getFeatureId(feature);
      let target = detailEntries;
      if (isPoliticalForegroundFeature(feature, featureId)) {
        target = foregroundEntries;
      } else if (isPoliticalUnderlayFeature(feature, featureId)) {
        target = underlayEntries;
      }
      target.push(entry);
    });
    return [...underlayEntries, ...detailEntries, ...foregroundEntries];
  }

  function shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId = null) {
    if (String(runtimeState.mapSemanticMode || "").trim().toLowerCase() === "blank") {
      return false;
    }
    return isRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId);
  }

  function getAtlantropaGeometryRole(feature) {
    return String(feature?.properties?.atl_geometry_role || "").trim().toLowerCase();
  }

  function getAtlantropaJoinMode(feature) {
    return String(feature?.properties?.atl_join_mode || "").trim().toLowerCase();
  }

  function isAntarcticSectorFeature(feature, featureId = null) {
    const candidate = String(
      feature?.properties?.id ?? featureId ?? feature?.id ?? ""
    ).trim().toUpperCase();
    if (!candidate) return false;
    const countryCode = getFeatureCountryCodeNormalized(feature);
    const detailTier = String(feature?.properties?.detail_tier || "").trim().toLowerCase();
    return detailTier === "antarctic_sector" && (countryCode === "AQ" || candidate.startsWith("AQ_"));
  }

  function isAtlantropaSupportHelperFeature(feature, featureId = null) {
    if (isAtlantropaFieldDrivenFeature(feature)) {
      return feature?.properties?.atl_interactive !== true;
    }
    const candidate = String(
      feature?.properties?.id ?? featureId ?? feature?.id ?? ""
    ).trim().toUpperCase();
    if (
      candidate.startsWith("ATLSHL_")
      || candidate.startsWith("ATLWLD_")
      || candidate.startsWith("ATLSEA_FILL_")
    ) {
      return true;
    }
    if (isInteractiveAtlantropaBooleanWeldIslandFeature(feature, featureId)) {
      return false;
    }
    const geometryRole = getAtlantropaGeometryRole(feature);
    const joinMode = getAtlantropaJoinMode(feature);
    return (
      geometryRole === "shore_seal"
      || geometryRole === "sea_completion"
      || geometryRole === "donor_sea"
      || joinMode === "gap_fill"
      || joinMode === "boolean_weld"
    );
  }

  function isAtlantropaVisualSupportHelperFeature(feature, featureId = null) {
    if (isAtlantropaFieldDrivenFeature(feature)) {
      return false;
    }
    const candidate = String(
      feature?.properties?.id ?? featureId ?? feature?.id ?? ""
    ).trim().toUpperCase();
    if (
      candidate.startsWith("ATLSHL_")
      || candidate.startsWith("ATLWLD_")
      || candidate.startsWith("ATLSEA_FILL_")
    ) {
      return true;
    }
    const geometryRole = getAtlantropaGeometryRole(feature);
    const joinMode = getAtlantropaJoinMode(feature);
    return (
      geometryRole === "shore_seal"
      || geometryRole === "sea_completion"
      || geometryRole === "donor_sea"
      || joinMode === "gap_fill"
    );
  }

  function isPoliticalVisualRenderableFeature(feature, featureId = null) {
    if (!feature) return false;
    if (isAtlantropaFieldDrivenFeature(feature) && !isScenarioAtlantropaVisible()) return false;
    if (isAntarcticSectorFeature(feature, featureId)) return false;
    if (isBaseGeographyScenarioFeature(feature)) return false;
    if (isAtlantropaVisualSupportHelperFeature(feature, featureId)) return false;
    return true;
  }

  function shouldExcludePoliticalVisualFeature(feature, featureId = null) {
    return !isPoliticalVisualRenderableFeature(feature, featureId);
  }

  function isPoliticalInteractionRenderableFeature(feature, featureId = null) {
    if (!isPoliticalVisualRenderableFeature(feature, featureId)) return false;
    if (isScenarioShellFeature(feature, featureId)) return false;
    if (feature?.properties?.interactive === false) return false;
    if (isAtlantropaSupportHelperFeature(feature, featureId)) return false;
    return true;
  }

  function shouldExcludePoliticalInteractionFeature(feature, featureId = null) {
    return !isPoliticalInteractionRenderableFeature(feature, featureId);
  }

  return Object.freeze({
    isScenarioShellFeature,
    hasVisiblePoliticalForegroundColorOverride,
    orderPoliticalShellUnderlayFirst,
    shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature,
    getAtlantropaGeometryRole,
    getAtlantropaJoinMode,
    isAntarcticSectorFeature,
    shouldExcludePoliticalVisualFeature,
    isPoliticalInteractionRenderableFeature,
    shouldExcludePoliticalInteractionFeature,
  });
}

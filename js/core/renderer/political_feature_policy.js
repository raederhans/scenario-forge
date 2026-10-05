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
  isStablePaintOrderEnabled = () => false,
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

  function isPoliticalForegroundFeature(feature, featureId = null, pendingIds = undefined) {
    const id = String(featureId || getFeatureId(feature) || "").trim();
    return hasPoliticalForegroundColorOverride(id)
      || (pendingIds === undefined
        ? isPendingPoliticalColorEditFeature(feature, id)
        : !!id && pendingIds instanceof Set && pendingIds.has(id));
  }

  function hasVisiblePoliticalForegroundColorOverride(entries = []) {
    if (!Array.isArray(entries) || !entries.length) return false;
    return entries.some((entry) => {
      const feature = entry?.feature || entry;
      const featureId = entry?.id || getFeatureId(feature);
      return hasPoliticalForegroundColorOverride(featureId);
    });
  }

  let stableDrawOrderCache = null;

  function getStableDrawOrderCache() {
    const features = runtimeState.landData?.features;
    const source = Array.isArray(features) ? features : null;
    const revision = [runtimeState.topologyRevision, runtimeState.scenarioDataGeneration,
      runtimeState.sceneGeneration, runtimeState.activeScenarioId].join("|");
    if (stableDrawOrderCache?.features === source
      && stableDrawOrderCache.length === (source?.length || 0)
      && stableDrawOrderCache.revision === revision) return stableDrawOrderCache;
    const byFeature = new WeakMap();
    const byId = new Map();
    const underlay = [];
    const detail = [];
    (source || []).forEach((feature) => {
      const id = String(getFeatureId(feature) || "").trim();
      (isPoliticalUnderlayFeature(feature, id) ? underlay : detail).push({ feature, id });
    });
    [...underlay, ...detail].forEach(({ feature, id }, index) => {
      if (feature && typeof feature === "object") byFeature.set(feature, index);
      if (id && !byId.has(id)) byId.set(id, index);
    });
    stableDrawOrderCache = { features: source, length: source?.length || 0, revision,
      byFeature, byId, underlayCount: underlay.length };
    return stableDrawOrderCache;
  }

  function getStablePoliticalDrawRank(entryOrFeature) {
    const feature = entryOrFeature?.feature || entryOrFeature;
    const cache = getStableDrawOrderCache();
    const directRank = feature && typeof feature === "object" ? cache.byFeature.get(feature) : undefined;
    if (directRank !== undefined) return directRank;
    const id = String(entryOrFeature?.id || getFeatureId(feature) || "").trim();
    const sourceRank = id ? cache.byId.get(id) : undefined;
    if (sourceRank !== undefined) return sourceRank;
    // Unknown parents stay behind known parents of their tier, independent of
    // the visible subset's order. Never treat a subset index as source rank.
    return isPoliticalUnderlayFeature(feature, id) ? -1 : cache.underlayCount - 0.5;
  }

  function orderPoliticalShellUnderlayFirst(entries = []) {
    if (isStablePaintOrderEnabled()) {
      return entries.map((entry) => ({ entry, rank: getStablePoliticalDrawRank(entry),
        id: String(entry?.id || getFeatureId(entry?.feature || entry) || "") }))
        .sort((left, right) => left.rank - right.rank
          || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .map(({ entry }) => entry);
    }
    const underlayEntries = [];
    const detailEntries = [];
    const foregroundEntries = [];
    const pendingIds = hasPendingPoliticalColorEdit()
      ? getRenderPassCacheState().pendingPoliticalColorEditIds ?? null
      : null;
    entries.forEach((entry) => {
      const feature = entry?.feature || entry;
      const featureId = entry?.id || getFeatureId(feature);
      let target = detailEntries;
      if (isPoliticalForegroundFeature(feature, featureId, pendingIds)) {
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
    if (isAntarcticSectorFeature(feature, featureId)
      && String(runtimeState.mapSemanticMode || "").trim().toLowerCase() !== "blank") return false;
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
    getStablePoliticalDrawRank,
    shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature,
    getAtlantropaGeometryRole,
    getAtlantropaJoinMode,
    isAntarcticSectorFeature,
    shouldExcludePoliticalVisualFeature,
    isPoliticalInteractionRenderableFeature,
    shouldExcludePoliticalInteractionFeature,
  });
}

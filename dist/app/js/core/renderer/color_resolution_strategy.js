import { getMapDataBoundary } from "../map_data_boundary.js";
import { resolveFeatureColor } from "../color_resolver.js";
import { isScenarioWaterLikeFeature } from "../scenario_runtime_queries.js";

const BLANK_OWNERLESS_FEATURE_FILL_COLOR = "#d7d3c7";

function isAtlantropaTaggedFeature(feature) {
  const props = feature?.properties || {};
  return !!(
    String(props.atl_color_rule || "").trim()
    || String(props.atl_surface_kind || "").trim()
    || String(props.region_group || "").trim().toLowerCase().startsWith("atlantropa_")
  );
}

export function isColorResolutionOceanFeature(feature, id, {
  isAtlantropaSeaFeature,
} = {}) {
  if (typeof isAtlantropaSeaFeature === "function" && isAtlantropaSeaFeature(feature, id)) {
    return true;
  }
  // Atlantropa 带色规则和 surface kind 的 feature 继续走政治/规则色，通用 water token 只接管普通水体壳层。
  if (isAtlantropaTaggedFeature(feature)) {
    return false;
  }
  return isScenarioWaterLikeFeature(feature, id);
}

/**
 * Owns political fill color strategy:
 * - read-only reference group precedence
 * - scenario shell owner hints
 * - final feature color delegation through color_resolver.js
 *
 * map_renderer.js keeps rebuild orchestration and cache invalidation; this owner only decides
 * which reference group seeds the color and which resolved color should be written.
 */
export function createColorResolutionStrategyOwner({
  state,
  helpers = {},
} = {}) {
  const {
    canonicalCountryCode,
    getFeatureCountryCodeNormalized,
    getFeatureId,
    getAtlantropaRuleColor,
    getOceanBaseFillColor,
    getSafeCanvasColor,
    isAntarcticSectorFeature,
    isAtlantropaSeaFeature,
    isScenarioShellFeature,
    normalizeMapSemanticMode,
  } = helpers;

  function getDisplayOwnerCode(feature, id) {
    const resolvedId = String(id || "").trim() || getFeatureId(feature);
    if (isAntarcticSectorFeature(feature, resolvedId)) {
      return "";
    }
    const mapSemanticMode = normalizeMapSemanticMode(state.mapSemanticMode);
    const isScenarioShell = isScenarioShellFeature(feature, resolvedId);
    const shellOwnerHintCode = canonicalCountryCode(feature?.properties?.scenario_shell_owner_hint || "");
    const shellControllerHintCode = canonicalCountryCode(feature?.properties?.scenario_shell_controller_hint || "");
    const shellOwnerCode = String(
      state.scenarioAutoShellOwnerByFeatureId?.[resolvedId] || shellOwnerHintCode || shellControllerHintCode || ""
    ).trim().toUpperCase();
    const directOwnerCode = getMapDataBoundary(state).reference.getScenarioGroupCode(resolvedId);
    if (mapSemanticMode === "blank") {
      return isScenarioShell ? (directOwnerCode || shellOwnerCode || "") : directOwnerCode;
    }
    const fallbackOwnerCode = getFeatureCountryCodeNormalized(feature);
    const ownershipOwnerCode = isScenarioShell
      ? (directOwnerCode || shellOwnerCode || "")
      : (directOwnerCode || fallbackOwnerCode || "");
    return ownershipOwnerCode;
  }

  // 颜色优先级继续由 color_resolver.js 统一裁决；这里仅注入 renderer runtime 上下文。
  function getResolvedFeatureColor(feature, id) {
    const resolved = resolveFeatureColor(id, {
      state,
      feature,
      getSafeColor: getSafeCanvasColor,
      isOceanFeature: (candidateFeature, candidateId) => isColorResolutionOceanFeature(
        candidateFeature,
        candidateId,
        { isAtlantropaSeaFeature },
      ),
      getAtlantropaRuleColor,
      getOceanBaseFillColor,
      getOwnerCode: getDisplayOwnerCode,
    });
    if (!resolved.color && normalizeMapSemanticMode(state.mapSemanticMode) === "blank") {
      return BLANK_OWNERLESS_FEATURE_FILL_COLOR;
    }
    return resolved.color;
  }

  return {
    getDisplayOwnerCode,
    getResolvedFeatureColor,
  };
}

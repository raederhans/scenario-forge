import { getMapDataBoundary } from "./map_data_boundary.js";
import { state as runtimeState } from "./state.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import {
  getCountryCode as getSharedFeatureCountryCode,
  getFeatureId as getSharedFeatureId,
} from "./feature_identity.js";
const state = runtimeState;
const WATER_LIKE_TOKEN_PATTERN = /(^|[_-])(water|marine|ocean|sea|gulf|bay|lake|river|strait|chokepoint)([_-]|$)/i;

export function canonicalScenarioCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

export function extractScenarioCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return prefix;
  }
  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return alphaPrefix ? alphaPrefix[0] : "";
}

export function getRuntimeGeometryFeatureId(geometry) {
  return getSharedFeatureId(geometry, { fallback: "" });
}

export function getScenarioRuntimeGeometryCountryCode(geometry) {
  return canonicalScenarioCountryCode(getSharedFeatureCountryCode(geometry));
}

// water-like 判定服务渲染和命中共同边界；新增 token 时同步检查颜色、hit 和 open-ocean 交互合同。
export function isScenarioWaterLikeFeature(feature, featureId = "") {
  const props = feature?.properties || {};
  const waterType = String(props.water_type || "").trim();
  if (waterType) return true;

  const regionGroup = String(props.region_group || "").trim();
  if (regionGroup && WATER_LIKE_TOKEN_PATTERN.test(regionGroup)) return true;

  const geometryRole = String(props.geometry_role || "").trim();
  if (geometryRole && WATER_LIKE_TOKEN_PATTERN.test(geometryRole)) return true;

  if (props.render_as_base_geography === true) {
    const identity = [
      featureId,
      getSharedFeatureId(feature, { fallback: "" }),
      props.__source,
      props.source_layer,
      props.layer,
      props.feature_class,
      props.kind,
    ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
    return WATER_LIKE_TOKEN_PATTERN.test(identity);
  }

  return false;
}

export function getScenarioEffectiveOwnerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    getMapDataBoundary(runtimeState).reference.getScenarioGroupCode(normalizedId) ||
    runtimeState.runtimeCanonicalCountryByFeatureId?.[normalizedId] ||
    ""
  )
    .trim()
    .toUpperCase();
}

export function shouldApplyHoi4FarEastSovietBackfill(scenarioId) {
  const normalizedId = String(scenarioId || "").trim();
  return normalizedId === "hoi4_1936" || normalizedId === "hoi4_1939";
}

export function hasExplicitScenarioAssignment(featureMap, featureId) {
  return !!(
    featureMap &&
    typeof featureMap === "object" &&
    Object.prototype.hasOwnProperty.call(featureMap, featureId)
  );
}


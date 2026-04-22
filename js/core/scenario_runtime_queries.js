import { state as runtimeState } from "./state.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
const state = runtimeState;

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
  const props = geometry?.properties || {};
  return String(props.id || geometry?.id || "").trim();
}

export function getScenarioRuntimeGeometryCountryCode(geometry) {
  const props = geometry?.properties || {};
  const direct = (
    props.cntr_code ||
    props.CNTR_CODE ||
    props.iso_a2 ||
    props.ISO_A2 ||
    props.iso_a2_eh ||
    props.ISO_A2_EH ||
    props.adm0_a2 ||
    props.ADM0_A2 ||
    ""
  );
  const normalizedDirect = canonicalScenarioCountryCode(direct);
  if (/^[A-Z]{2,3}$/.test(normalizedDirect) && normalizedDirect !== "ZZ" && normalizedDirect !== "XX") {
    return normalizedDirect;
  }
  return canonicalScenarioCountryCode(
    extractScenarioCountryCodeFromId(props.id) ||
    extractScenarioCountryCodeFromId(props.NUTS_ID) ||
    extractScenarioCountryCodeFromId(geometry?.id)
  );
}

export function getScenarioEffectiveOwnerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    runtimeState.sovereigntyByFeatureId?.[normalizedId] ||
    runtimeState.runtimeCanonicalCountryByFeatureId?.[normalizedId] ||
    ""
  )
    .trim()
    .toUpperCase();
}

export function getScenarioEffectiveControllerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    runtimeState.scenarioControllersByFeatureId?.[normalizedId] ||
    getScenarioEffectiveOwnerCodeByFeatureId(normalizedId) ||
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

